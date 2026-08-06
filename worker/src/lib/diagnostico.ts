import type { Env } from "../types";
import {
  ambiente,
  credenciaisUber,
  testeUsandoCredencialDeProducao,
} from "../config/ambiente";
import { modoAtual, podeUsarProducao } from "../config/modo";
import { nomeProvedor, provedoresAtivos } from "../config/provedores";
import { getUberToken } from "../services/tokens";

// ---------------------------------------------------------------------------
// DIAGNÓSTICO DE CONFIGURAÇÃO
//
// Responde uma pergunta só: "está tudo preenchido e funcionando para eu poder
// despachar?". Sem isso, a única forma de saber se uma credencial está certa é
// perder um pedido real descobrindo que não estava.
//
// LINGUAGEM: esta saída aparece na tela do DONO DO RESTAURANTE. Nada de nome
// de arquivo, variável de ambiente ou comando de terminal aqui — o passo a
// passo técnico vive no CREDENCIAIS.md, que é material de instalação.
//
// Nunca devolve o valor de um segredo — só se ele existe e se funcionou.
// ---------------------------------------------------------------------------

export type StatusItem = "ok" | "aviso" | "erro";

export interface ItemDiagnostico {
  chave: string;
  titulo: string;
  status: StatusItem;
  detalhe: string;
  /** O que fazer, em linguagem de negócio. */
  comoResolver?: string;
}

export interface Diagnostico {
  ambiente: string;
  verificadoEm: string;
  resumo: { ok: number; aviso: number; erro: number };
  itens: ItemDiagnostico[];
}

const SUPORTE = "Acione o suporte técnico para concluir a instalação.";

const preenchido = (v: string | undefined) =>
  typeof v === "string" && v.trim() !== "" && !v.startsWith("PREENCHER");

export async function rodarDiagnostico(env: Env): Promise<Diagnostico> {
  const itens: ItemDiagnostico[] = [];
  const amb = ambiente(env);
  const modo = await modoAtual(env);
  const cred = credenciaisUber(env, modo);
  const ativos = provedoresAtivos(env).map((p) => p.id);

  // --- Modo de operação -----------------------------------------------------
  // É o que decide se a corrida é cobrada. Primeiro item da lista de propósito.
  itens.push({
    chave: "modo",
    titulo: "Modo de operação",
    status: "ok",
    detalhe:
      modo === "producao"
        ? "PRODUÇÃO — as entregas despachadas são reais e cobradas."
        : podeUsarProducao(env)
          ? "Teste — nenhuma entrega é cobrada. Troque para produção quando validar."
          : "Teste — este ambiente não pode operar em produção.",
  });

  if (modo === "teste" && testeUsandoCredencialDeProducao(env)) {
    itens.push({
      chave: "credencial_teste",
      titulo: "Credenciais de teste",
      status: "aviso",
      detalhe:
        "O modo teste está usando as credenciais de produção — não há credenciais de teste cadastradas.",
      comoResolver:
        "Peça as credenciais de sandbox ao Uber e envie ao suporte, para que teste e produção fiquem separados.",
    });
  }

  // --- Infra ----------------------------------------------------------------
  try {
    await env.DB.prepare("SELECT 1").first();
    itens.push({
      chave: "d1",
      titulo: "Banco de dados",
      status: "ok",
      detalhe: "Conectado.",
    });
  } catch {
    itens.push({
      chave: "d1",
      titulo: "Banco de dados",
      status: "erro",
      detalhe: "Sem conexão. Os pedidos não podem ser gravados.",
      comoResolver: SUPORTE,
    });
  }

  try {
    await env.HUB_KV.get("diagnostico:ping");
    itens.push({
      chave: "kv",
      titulo: "Cache",
      status: "ok",
      detalhe: "Acessível.",
    });
  } catch {
    itens.push({
      chave: "kv",
      titulo: "Cache",
      status: "erro",
      detalhe: "Indisponível. As cotações podem ficar lentas.",
      comoResolver: SUPORTE,
    });
  }

  // --- Segredos internos ----------------------------------------------------
  itens.push({
    chave: "webhook_secret",
    titulo: "Integração com o Cardápio Web",
    status: preenchido(env.WEBHOOK_SECRET) ? "ok" : "erro",
    detalhe: preenchido(env.WEBHOOK_SECRET)
      ? "Chave de integração cadastrada."
      : "Chave de integração ausente — nenhum pedido do Cardápio Web será recebido.",
    comoResolver: SUPORTE,
  });

  itens.push({
    chave: "jwt_secret",
    titulo: "Acesso ao painel",
    status: preenchido(env.JWT_SECRET) ? "ok" : "erro",
    detalhe: preenchido(env.JWT_SECRET)
      ? "Chave de sessão cadastrada."
      : "Chave de sessão ausente — o login do painel não funciona.",
    comoResolver: SUPORTE,
  });

  // --- Restaurante ----------------------------------------------------------
  const lat = parseFloat(env.RESTAURANTE_LAT);
  const lng = parseFloat(env.RESTAURANTE_LNG);
  const coordsOk = Number.isFinite(lat) && Number.isFinite(lng);

  itens.push({
    chave: "restaurante",
    titulo: "Endereço da loja",
    status: coordsOk ? "ok" : "erro",
    detalhe: coordsOk
      ? `${env.RESTAURANTE_NOME || "Loja"} — localização cadastrada.`
      : "Localização da loja não cadastrada. É de onde o entregador coleta e o centro das faixas de preço do motoboy próprio.",
    comoResolver:
      "Informe ao suporte o endereço exato da loja, com a localização no mapa.",
  });

  // O Uber recusa a cotação inteira se o telefone da coleta não for válido —
  // e a mensagem dele não diz qual campo, então vale checar aqui.
  const tel = (env.RESTAURANTE_TELEFONE ?? "").trim();
  // E.164 com o "+" obrigatório. Um número local como "(31) 3333-4444" é
  // recusado de propósito: sem código de país o Uber devolve
  // "pickup phone number is not valid" e a cotação inteira morre.
  const telOk = /^\+[1-9]\d{9,14}$/.test(tel.replace(/[\s()-]/g, ""));

  itens.push({
    chave: "telefone",
    titulo: "Telefone da loja",
    status: telOk ? "ok" : "erro",
    detalhe: telOk
      ? tel
      : "Telefone inválido ou não cadastrado. O Uber recusa toda cotação sem ele — é o número que o entregador liga na coleta.",
    comoResolver: "Informe ao suporte o telefone de contato da loja, com DDD.",
  });

  // --- Cardápio Web ---------------------------------------------------------
  itens.push({
    chave: "cardapio_web",
    titulo: "Loja no Cardápio Web",
    status: preenchido(env.CARDAPIO_WEB_MERCHANT_ID) ? "ok" : "aviso",
    detalhe: preenchido(env.CARDAPIO_WEB_MERCHANT_ID)
      ? "Loja identificada."
      : "Código da loja não informado. Não impede o recebimento de pedidos.",
    comoResolver: "Informe ao suporte o código da sua loja no Cardápio Web.",
  });

  // --- Uber Direct ----------------------------------------------------------
  const customerId = cred.customerId;

  if (!ativos.includes("uber")) {
    itens.push({
      chave: "uber",
      titulo: "Uber Direct",
      status: "aviso",
      detalhe: "Desativado — não entra na cotação.",
    });
  } else {
    // Nomes como o Uber os chama no portal dele — é onde o lojista vai olhar.
    const faltando: string[] = [];
    if (!preenchido(cred.clientId)) faltando.push("Client ID");
    if (!preenchido(cred.clientSecret)) faltando.push("Client Secret");
    if (!preenchido(customerId)) faltando.push("Customer ID");

    if (faltando.length > 0) {
      itens.push({
        chave: "uber",
        titulo: "Uber Direct",
        status: "erro",
        detalhe: `Credenciais incompletas. Faltando: ${faltando.join(", ")}.`,
        comoResolver:
          "Pegue esses valores no portal de desenvolvedor do Uber e envie ao suporte.",
      });
    } else {
      // Dois testes reais, nenhum deles cria corrida:
      //   1) pede o token OAuth2  -> as credenciais valem?
      //   2) LISTA as entregas    -> a aplicação tem permissão de entrega?
      //
      // O passo 2 existe porque o passo 1 pode passar e a integração ainda não
      // funcionar: uma aplicação Uber pode autenticar com escopo de organização
      // e mesmo assim não ter liberação para o produto de entregas. Sem esta
      // checagem, isso só apareceria no primeiro pedido real.
      try {
        const token = await getUberToken(env, modo);

        const res = await fetch(
          `${cred.baseUrl}/v1/customers/${customerId}/deliveries`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (res.ok) {
          itens.push({
            chave: "uber",
            titulo: "Uber Direct",
            status: "ok",
            // O que importa aqui é o MODO (qual credencial), não o ambiente.
            detalhe:
              modo === "producao"
                ? "Conectado à conta real — pronto para despachar entregas cobradas."
                : "Conectado à conta de teste do Uber.",
          });
        } else if (res.status === 401 || res.status === 403) {
          itens.push({
            chave: "uber",
            titulo: "Uber Direct",
            status: "erro",
            detalhe:
              "Credenciais aceitas, mas a conta ainda não tem permissão para criar entregas.",
            comoResolver:
              "Peça ao seu gerente de conta Uber para habilitar o produto de entregas (escopo de delivery) nesta aplicação.",
          });
        } else if (res.status === 404) {
          itens.push({
            chave: "uber",
            titulo: "Uber Direct",
            status: "erro",
            detalhe: "O Uber não reconheceu o Customer ID cadastrado.",
            comoResolver:
              "Confirme o Customer ID no portal do Uber — ele é diferente entre teste e produção.",
          });
        } else {
          itens.push({
            chave: "uber",
            titulo: "Uber Direct",
            status: "aviso",
            detalhe: `Credenciais aceitas. O Uber respondeu de forma inesperada (código ${res.status}).`,
            comoResolver: "Tente novamente em alguns minutos.",
          });
        }
      } catch {
        itens.push({
          chave: "uber",
          titulo: "Uber Direct",
          status: "erro",
          detalhe: "O Uber recusou as credenciais cadastradas.",
          comoResolver:
            "Confira Client ID e Client Secret no portal do Uber e confirme se a aplicação está habilitada para entregas.",
        });
      }
    }
  }

  // --- Webhook de status da entrega -----------------------------------------
  if (ativos.includes("uber")) {
    itens.push({
      chave: "uber_webhook",
      titulo: "Acompanhamento da entrega",
      status: preenchido(cred.webhookSecret) ? "ok" : "aviso",
      detalhe: preenchido(cred.webhookSecret)
        ? "Configurado — o painel recebe status e localização do entregador."
        : "Sem chave de assinatura. O despacho funciona, mas o painel não recebe atualização de status nem a posição do entregador.",
      comoResolver:
        "No painel do Uber Direct, cadastre a URL de webhook do Hub e envie a chave de assinatura ao suporte.",
    });
  }

  // --- Provedores ativos ----------------------------------------------------
  //
  // Os nomes vêm de nomeProvedor(), não de uma lista aqui. Havia uma cópia
  // local que ficou para trás quando um provedor novo entrou, e a tela passou
  // a mostrar o id cru ("uber_carro") para o dono do restaurante.
  itens.push({
    chave: "provedores",
    titulo: "Transportadoras ativas",
    status: ativos.length > 0 ? "ok" : "erro",
    detalhe:
      ativos.length > 0
        ? ativos.map((a) => nomeProvedor(a)).join(", ")
        : "Nenhuma transportadora ativa — a cotação volta vazia.",
    comoResolver: SUPORTE,
  });

  const resumo = itens.reduce(
    (acc, i) => ({ ...acc, [i.status]: acc[i.status] + 1 }),
    { ok: 0, aviso: 0, erro: 0 }
  );

  return {
    ambiente: amb,
    verificadoEm: new Date().toISOString(),
    resumo,
    itens,
  };
}
