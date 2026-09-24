import type { Cotacao, Env, ModoOperacao, Pedido, ResultadoDespacho } from "../types";
import { getIfoodToken } from "./tokens";
import { credenciaisIfood, prefixoCache } from "../config/ambiente";
import { observacaoParaEntregador } from "../lib/observacao-entregador";

// ---------------------------------------------------------------------------
// iFood — módulo SHIPPING (Entrega Fácil / Sob Demanda)
// Docs: developer.ifood.com.br → Módulos → Shipping
//
// São DOIS produtos com rotas diferentes, e qual usar depende de onde a venda
// nasceu — não é escolha da loja:
//
//   Pedido que veio do iFood (canal "ifood", com o UUID em `idExterno`)
//     cotação:   GET  /shipping/v1.0/orders/{orderId}/deliveryAvailabilities
//     despacho:  POST /shipping/v1.0/orders/{orderId}/requestDriver
//     cancelar:  POST /shipping/v1.0/orders/{orderId}/cancelRequestDriver
//   O pedido já existe no iFood, com cliente, endereço e pagamento. Só se pede
//   o entregador. Só funciona se a loja entrega o pedido por conta própria
//   (entrega da loja); se o iFood já entrega, não há o que pedir.
//
//   Pedido de outro canal (cardápio digital, portal, telefone)
//     cotação:   GET  /shipping/v1.0/merchants/{merchantId}/deliveryAvailabilities?latitude&longitude
//     despacho:  POST /shipping/v1.0/merchants/{merchantId}/orders
//     cancelar:  POST /shipping/v1.0/orders/{orderId}/cancel
//   O pedido é CRIADO no iFood, e o id devolvido passa a ser o da entrega.
//
// Nos dois casos a alocação do entregador é ASSÍNCRONA: o despacho responde
// 202 e o resultado chega por evento (ver ifood-webhook.ts). Por isso o status
// inicial é "pending", o mesmo "procurando entregador" do Uber.
// ---------------------------------------------------------------------------

/**
 * O pedido nasceu no iFood e deve usar a rota de pedido da plataforma?
 *
 * Em modo teste, nunca: o UUID é de um pedido REAL da Villa Deli, que o
 * aplicativo de teste não enxerga. Em teste tudo vira pedido externo na loja
 * de teste (ver emModoTeste).
 */
function ehPedidoDoIfood(pedido: Pedido, modo: ModoOperacao): boolean {
  return modo !== "teste" && pedido.canal === "ifood" && !!pedido.idExterno;
}

// ---------------------------------------------------------------------------
// MODO TESTE — o endereço do cliente é levado para perto da loja de teste.
//
// O iFood não tem sandbox. O que ele dá é uma LOJA de teste, e a do Villa Deli
// fica em Bujari (AC). Qualquer cliente real fica a milhares de km dela, e toda
// cotação voltava DeliveryDistanceTooHigh — o modo teste não testava nada.
//
// Solução: transladar. O destino é recolocado em volta da loja de teste com o
// MESMO deslocamento que tem da Villa Deli (3 km ao norte daqui = 3 km ao norte
// de lá). A distância, e portanto o preço, fica comparável ao real.
//
// O endereço escrito passa a ser o da loja de teste (o iFood valida que CEP,
// cidade e UF conversam entre si); só as coordenadas carregam a translação.
// O nome da rua do cliente vai na referência, para o pedido ser reconhecível
// no portal de teste.
//
// Nada disso acontece em produção.
// ---------------------------------------------------------------------------

interface LojaIfood {
  latitude: number;
  longitude: number;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Endereço da loja no iFood, com cache de um dia (não muda). */
async function lojaIfood(env: Env, modo: ModoOperacao): Promise<LojaIfood | null> {
  const cred = credenciaisIfood(env, modo);
  const chave = `${prefixoCache(env, modo)}ifood:loja:${cred.merchantId}`;

  const cache = await env.HUB_KV.get<LojaIfood>(chave, "json");
  if (cache) return cache;

  const res = await chamar(env, modo, "GET", `/merchant/v1.0/merchants/${encodeURIComponent(cred.merchantId)}`);
  if (!res.ok) return null;
  const m = (await res.json()) as { address?: Partial<LojaIfood> };
  const a = m.address;
  if (a?.latitude == null || a?.longitude == null) return null;

  const loja: LojaIfood = {
    latitude: a.latitude,
    longitude: a.longitude,
    // O iFood devolve "Ramal Bujari, 122, Bujari" em `street`; só o 1º pedaço é a rua.
    street: (a.street ?? "").split(",")[0].trim(),
    number: a.number ?? "S/N",
    district: a.district ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    postalCode: (a.postalCode ?? "").replace(/\D/g, ""),
  };
  await env.HUB_KV.put(chave, JSON.stringify(loja), { expirationTtl: 86_400 });
  return loja;
}

/**
 * Pedido com o endereço transladado para perto da loja de teste.
 * Fora do modo teste, devolve o pedido intacto.
 */
async function emModoTeste(env: Env, pedido: Pedido, modo: ModoOperacao): Promise<Pedido> {
  if (modo !== "teste") return pedido;

  const { lat, lng } = pedido.endereco;
  const origemLat = parseFloat(env.RESTAURANTE_LAT);
  const origemLng = parseFloat(env.RESTAURANTE_LNG);
  if (lat == null || lng == null || !Number.isFinite(origemLat) || !Number.isFinite(origemLng)) {
    return pedido;
  }

  const loja = await lojaIfood(env, modo);
  if (!loja) return pedido;

  // Longitude encolhe com o cosseno da latitude: 1° de longitude vale menos
  // km longe do equador. Sem a correção, a distância mudaria na translação.
  const rad = Math.PI / 180;
  const escala = Math.cos(origemLat * rad) / Math.cos(loja.latitude * rad);

  return {
    ...pedido,
    // Mesma regra do Uber: pedido de teste não pode chegar ao cliente real.
    cliente: env.TELEFONE_TESTE?.trim()
      ? { ...pedido.cliente, telefone: env.TELEFONE_TESTE.trim() }
      : pedido.cliente,
    endereco: {
      logradouro: loja.street,
      numero: loja.number,
      complemento: undefined,
      bairro: loja.district,
      cidade: loja.city,
      uf: loja.state,
      cep: loja.postalCode,
      lat: loja.latitude + (lat - origemLat),
      lng: loja.longitude + (lng - origemLng) * escala,
    },
    observacao: [`[TESTE] Cliente real em: ${pedido.endereco.logradouro}, ${pedido.endereco.numero}`, pedido.observacao]
      .filter(Boolean)
      .join(" · "),
  };
}

// ---------------------------------------------------------------------------
// Tradução dos erros. Mesma ideia do Uber: o atendente precisa saber se dá
// para despachar por ali, não ler JSON. Códigos da tabela oficial.
// ---------------------------------------------------------------------------
const ERROS: Record<string, string> = {
  DeliveryDistanceTooHigh: "Endereço a mais de 10 km da loja. O iFood não entrega tão longe.",
  ServiceAreaMismatch: "Fora da área de cobertura do iFood para este endereço.",
  OffOpeningHours: "Fora do horário de funcionamento da loja no iFood.",
  HighDemand: "O iFood está sem entregador disponível agora (alta demanda).",
  NRELimitExceeded: "A loja atingiu o limite de entregadores simultâneos do iFood.",
  OriginNotFound: "O iFood não encontrou a loja na área de logística. Veja em Configurações.",
  BadRequestMerchant: "A loja está temporariamente indisponível no iFood.",
  MerchantStatusAvailability: "A conta da loja no iFood tem pendências. Veja o Portal do Parceiro.",
  MerchantEasyDeliveryDisabled: "O Entrega Fácil não está habilitado para esta loja no iFood.",
  InvalidPaymentMethods: "O iFood não aceita a forma de pagamento deste pedido.",
  SaturatedOfflinePayment: "O iFood não está aceitando pagamento na entrega agora.",
  BadRequestCustomer: "O iFood recusou os dados do cliente. Confira nome e telefone.",
};

export function traduzirErroIfood(status: number, corpo: string): string {
  let e: { code?: string; message?: string; error?: { code?: string; message?: string } };
  try {
    e = JSON.parse(corpo);
  } catch {
    return `O iFood não respondeu como esperado (código ${status}).`;
  }

  // O iFood às vezes aninha em `error`, às vezes não.
  const code = e.code ?? e.error?.code;
  const message = e.message ?? e.error?.message;
  console.warn(`[ifood] ${status} ${code ?? "?"}: ${message ?? corpo.slice(0, 200)}`);

  if (code && ERROS[code]) return ERROS[code];
  if (status === 401 || status === 403) {
    return "O iFood recusou as credenciais ou a loja não autorizou o aplicativo. Veja em Configurações.";
  }
  if (status === 404) return "O iFood não encontrou este pedido ou esta loja.";
  if (status >= 500) return "O iFood está instável no momento. Tente novamente em instantes.";
  return message ? `O iFood recusou: ${message}` : `O iFood recusou a solicitação (código ${status}).`;
}

/** Chamada autenticada à API do iFood. */
async function chamar(
  env: Env,
  modo: ModoOperacao,
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: unknown
): Promise<Response> {
  const cred = credenciaisIfood(env, modo);
  const token = await getIfoodToken(env, modo);
  return fetch(`${cred.baseUrl}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
}

// ---------------------------------------------------------------------------
// COTAÇÃO
// ---------------------------------------------------------------------------

interface DisponibilidadeIfood {
  id: string;
  expirationAt?: string;
  /** metros */
  distance?: number;
  quote: { grossValue: number; discount: number; raise: number; netValue: number };
  /** segundos */
  deliveryTime?: { min: number; max: number };
}

export async function cotarIfood(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao
): Promise<Cotacao> {
  const base: Cotacao = {
    provider: "ifood",
    nome: "iFood Entrega Fácil",
    disponivel: false,
    preco: null,
    moeda: "BRL",
    etaMinutos: null,
    quoteId: null,
    expiraEm: null,
  };

  const cred = credenciaisIfood(env, modo);

  // Sem loja configurada para o modo, nem chama o iFood. Em produção isso
  // significa "o aplicativo ainda não foi homologado e autorizado pela loja
  // real" — e o erro que viria da API ("auth falhou: 403") não diz isso.
  if (!cred.merchantId || !cred.clientId) {
    return {
      ...base,
      erro:
        modo === "producao"
          ? "Aguardando homologação do iFood. Use o modo teste para experimentar."
          : "iFood não configurado para o modo teste. Veja em Configurações.",
    };
  }

  pedido = await emModoTeste(env, pedido, modo);
  let caminho: string;

  if (ehPedidoDoIfood(pedido, modo)) {
    caminho = `/shipping/v1.0/orders/${encodeURIComponent(pedido.idExterno!)}/deliveryAvailabilities`;
  } else {
    // Sem coordenada não há cotação: é o único dado de destino que a rota aceita.
    const { lat, lng } = pedido.endereco;
    if (lat == null || lng == null) {
      return { ...base, erro: "Endereço sem localização no mapa. O iFood precisa dela para cotar." };
    }
    if (!cred.merchantId) {
      return { ...base, erro: "Loja do iFood não configurada. Veja em Configurações." };
    }
    caminho =
      `/shipping/v1.0/merchants/${encodeURIComponent(cred.merchantId)}/deliveryAvailabilities` +
      `?latitude=${lat}&longitude=${lng}`;
  }

  const res = await chamar(env, modo, "GET", caminho);
  if (!res.ok) {
    return { ...base, erro: traduzirErroIfood(res.status, await res.text()) };
  }

  const q = (await res.json()) as DisponibilidadeIfood;

  // O iFood devolve faixa (min–max, em segundos). O card mostra um número só;
  // o MÁXIMO é o que dá para prometer ao cliente sem errar para menos.
  const etaMax = q.deliveryTime?.max;

  return {
    ...base,
    disponivel: true,
    // netValue = bruto − desconto + acréscimo. É o que a loja paga.
    preco: q.quote.netValue,
    etaMinutos: etaMax != null ? Math.round(etaMax / 60) : null,
    quoteId: q.id,
    expiraEm: q.expirationAt ?? null,
    detalhe:
      q.distance != null
        ? `${(q.distance / 1000).toFixed(2)} km` +
          (q.deliveryTime
            ? ` · ${Math.round(q.deliveryTime.min / 60)}–${Math.round(q.deliveryTime.max / 60)} min`
            : "")
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// DESPACHO
// ---------------------------------------------------------------------------

/**
 * "+5511987654321" -> { countryCode: "55", areaCode: "11", number: "987654321" }.
 * O Cardápio Web já entrega normalizado (normalizarTelefone), então só separa.
 */
function telefoneIfood(e164: string) {
  const d = e164.replace(/\D/g, "");
  const semDdi = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return {
    countryCode: "55",
    areaCode: semDdi.slice(0, 2),
    number: semDdi.slice(2),
  };
}

/**
 * CÓDIGO DE ENTREGA.
 *
 * Com `phone.type = "CUSTOMER"`, o iFood usa os 4 ÚLTIMOS dígitos do telefone
 * do cliente como código que o entregador pede na porta. Como a regra é fixa,
 * o Hub já sabe o código no despacho e mostra no card, igual ao PIN do Uber.
 *
 * Quando o telefone é o da LOJA (pedido de marketplace sem contato do cliente),
 * vai `STORE`: pedir ao cliente os 4 dígitos do número da loja não faz sentido,
 * e o iFood então só valida presença.
 */
function codigoPeloTelefone(pedido: Pedido): string | null {
  if (pedido.semTelefoneDoCliente) return null;
  const d = pedido.cliente.telefone.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

/** Preparo em minutos -> segundos, que é a unidade do iFood. */
function preparoEmSegundos(prontoEmMin: number): number {
  return Number.isFinite(prontoEmMin) && prontoEmMin > 0 ? Math.round(prontoEmMin * 60) : 0;
}

export async function despacharIfood(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao,
  _veiculo?: "moto" | "carro",
  _sequencia = 1,
  prontoEmMin = 0
): Promise<ResultadoDespacho> {
  if (!cotacao.quoteId) throw new Error("Cotação do iFood sem identificador. Cote novamente.");
  // O mesmo destino da cotação — o quoteId foi emitido para ele.
  pedido = await emModoTeste(env, pedido, modo);

  // --- Pedido que veio do iFood: só pede o entregador -----------------------
  if (ehPedidoDoIfood(pedido, modo)) {
    const orderId = pedido.idExterno!;
    const res = await chamar(
      env,
      modo,
      "POST",
      `/shipping/v1.0/orders/${encodeURIComponent(orderId)}/requestDriver`,
      { quoteId: cotacao.quoteId }
    );
    if (!res.ok) throw new Error(traduzirErroIfood(res.status, await res.text()));

    // 202 sem corpo. O id da entrega É o id do pedido no iFood — é por ele que
    // os eventos chegam, e é por ele que se cancela.
    //
    // Consequência: num reenvio do mesmo pedido, as duas corridas ficam com o
    // mesmo delivery_id_externo. O iFood não costuma aceitar um segundo
    // requestDriver para o mesmo pedido de qualquer forma.
    return {
      provider: "ifood",
      deliveryId: orderId,
      trackingUrl: null,
      status: "pending",
      // O cliente do iFood recebe o código no próprio app; o Hub não o conhece.
      codigoEntrega: null,
    };
  }

  // --- Pedido de outro canal: cria o pedido no iFood ------------------------
  const cred = credenciaisIfood(env, modo);
  const e = pedido.endereco;
  const obs = observacaoParaEntregador(pedido);

  const itens =
    pedido.itens.length > 0
      ? pedido.itens.map((i, idx) => ({
          id: `${pedido.id}-${idx + 1}`,
          name: i.nome,
          quantity: i.quantidade,
          unitPrice: i.preco,
          price: i.preco * i.quantidade,
          optionsPrice: 0,
          totalPrice: i.preco * i.quantidade,
        }))
      : [
          {
            id: `${pedido.id}-1`,
            name: "Pedido",
            quantity: 1,
            unitPrice: pedido.subtotal,
            price: pedido.subtotal,
            optionsPrice: 0,
            totalPrice: pedido.subtotal,
          },
        ];

  const res = await chamar(
    env,
    modo,
    "POST",
    `/shipping/v1.0/merchants/${encodeURIComponent(cred.merchantId)}/orders`,
    {
      customer: {
        name: pedido.cliente.nome,
        phone: {
          ...telefoneIfood(pedido.cliente.telefone),
          type: pedido.semTelefoneDoCliente ? "STORE" : "CUSTOMER",
        },
      },
      delivery: {
        // O frete que o CLIENTE pagou. Informativo para o iFood.
        merchantFee: pedido.freteCobrado,
        quoteId: cotacao.quoteId,
        // Segura a alocação do entregador até perto de a comida ficar pronta —
        // o equivalente à janela de coleta do Uber.
        preparationTime: preparoEmSegundos(prontoEmMin),
        deliveryAddress: {
          postalCode: e.cep.replace(/\D/g, ""),
          streetNumber: e.numero || "S/N",
          streetName: e.logradouro,
          ...(e.complemento ? { complement: e.complemento } : {}),
          neighborhood: e.bairro,
          city: e.cidade,
          state: e.uf,
          country: "BR",
          ...(obs ? { reference: obs.slice(0, 200) } : {}),
          coordinates: { latitude: e.lat, longitude: e.lng },
        },
      },
      items: itens,
      // SEM `payments`: o Hub só despacha pedido já pago, e o objeto só existe
      // para o entregador COBRAR na porta (o único `type` aceito é OFFLINE).
      // Mandar um método aqui faria o entregador cobrar de novo um pedido pago.
    }
  );

  if (!res.ok) throw new Error(traduzirErroIfood(res.status, await res.text()));

  const d = (await res.json()) as { id: string; trackingUrl?: string };

  return {
    provider: "ifood",
    deliveryId: d.id,
    trackingUrl: d.trackingUrl ?? null,
    status: "pending",
    codigoEntrega: codigoPeloTelefone(pedido),
  };
}

// ---------------------------------------------------------------------------
// CANCELAMENTO
// ---------------------------------------------------------------------------

/**
 * Cancela a entrega no iFood.
 *
 * Como o id de entrega de um pedido do iFood É o id do pedido, dá para saber
 * pela forma do despacho qual rota usar sem guardar nada a mais: se o
 * deliveryId é o idExterno do pedido, foi requestDriver.
 *
 * As duas rotas respondem 202: o pedido de cancelamento foi ACEITO para
 * análise, e a confirmação chega por evento. Mesmo assim o Hub marca como
 * cancelado na hora, como faz com o Uber — se o iFood recusar depois, o evento
 * de status seguinte corrige a tela.
 */
export async function cancelarIfood(
  env: Env,
  pedido: Pedido,
  deliveryId: string,
  modo: ModoOperacao
): Promise<{ ok: boolean; erro?: string }> {
  const id = encodeURIComponent(deliveryId);

  if (ehPedidoDoIfood(pedido, modo) && pedido.idExterno === deliveryId) {
    const res = await chamar(env, modo, "POST", `/shipping/v1.0/orders/${id}/cancelRequestDriver`);
    return res.ok ? { ok: true } : { ok: false, erro: traduzirErroIfood(res.status, await res.text()) };
  }

  // Pedido criado pelo Hub: o cancelamento exige um código de motivo, e a
  // lista válida vem da própria API (muda conforme a fase da entrega). Uma
  // lista vazia é a resposta do iFood para "não dá mais para cancelar".
  const motivos = await chamar(env, modo, "GET", `/shipping/v1.0/orders/${id}/cancellationReasons`);
  if (!motivos.ok) {
    return { ok: false, erro: traduzirErroIfood(motivos.status, await motivos.text()) };
  }

  const lista = (await motivos.json().catch(() => [])) as Array<{
    cancelCodeId?: string | number;
    cancellationCode?: string | number;
    code?: string | number;
    description?: string;
  }>;
  const motivo = Array.isArray(lista) ? lista[0] : undefined;
  const codigo = motivo?.cancelCodeId ?? motivo?.cancellationCode ?? motivo?.code;

  if (codigo == null) {
    return {
      ok: false,
      erro: "Esta entrega não pode mais ser cancelada no iFood: o entregador provavelmente já coletou o pedido.",
    };
  }

  const res = await chamar(env, modo, "POST", `/shipping/v1.0/orders/${id}/cancel`, {
    reason: motivo?.description ?? "Cancelado pela loja",
    cancellationCode: codigo,
  });

  return res.ok ? { ok: true } : { ok: false, erro: traduzirErroIfood(res.status, await res.text()) };
}
