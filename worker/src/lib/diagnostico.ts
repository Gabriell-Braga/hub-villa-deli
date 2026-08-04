import type { Env } from "../types";
import { ambiente, uberCustomerId, uberUrls } from "../config/ambiente";
import { provedoresAtivos } from "../config/provedores";
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
  const ativos = provedoresAtivos(env).map((p) => p.id);

  // --- Ambiente -------------------------------------------------------------
  itens.push({
    chave: "ambiente",
    titulo: "Ambiente",
    status: "ok",
    detalhe:
      amb === "producao"
        ? "Produção — as entregas despachadas aqui são cobradas de verdade."
        : "Ambiente de teste — nenhuma entrega é cobrada.",
  });

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
  const customerId = uberCustomerId(env);

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
    if (!preenchido(env.UBER_CLIENT_ID)) faltando.push("Client ID");
    if (!preenchido(env.UBER_CLIENT_SECRET)) faltando.push("Client Secret");
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
        const token = await getUberToken(env);

        const res = await fetch(
          `${uberUrls(env).base}/v1/customers/${customerId}/deliveries`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (res.ok) {
          itens.push({
            chave: "uber",
            titulo: "Uber Direct",
            status: "ok",
            detalhe:
              amb === "producao"
                ? "Conectado — pronto para despachar entregas reais."
                : "Conectado ao ambiente de teste do Uber.",
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

  // --- Provedores ativos ----------------------------------------------------
  const nomes: Record<string, string> = {
    uber: "Uber Direct",
    ifood: "iFood Entrega Fácil",
    "99": "99 Entregas",
    motoboy: "Motoboy Próprio",
  };

  itens.push({
    chave: "provedores",
    titulo: "Transportadoras ativas",
    status: ativos.length > 0 ? "ok" : "erro",
    detalhe:
      ativos.length > 0
        ? ativos.map((a) => nomes[a] ?? a).join(", ")
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
