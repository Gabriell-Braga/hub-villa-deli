import type { Cotacao, Env, ModoOperacao, Pedido, ResultadoDespacho } from "../types";
import { getUberToken } from "./tokens";
import { enderecoFormatado } from "../lib/geo";
import { credenciaisUber } from "../config/ambiente";

// ---------------------------------------------------------------------------
// Uber Direct B2B
// Docs: https://developer.uber.com/docs/deliveries
// Cotação:  POST /v1/customers/{customer_id}/delivery_quotes
// Criação:  POST /v1/customers/{customer_id}/deliveries
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tradução dos erros da Uber.
//
// A resposta crua deles é JSON em inglês, e ia inteira para a tela do
// atendente. No meio de um pico de pedidos ninguém lê
// `{"code":"address_undeliverable","metadata":{"details":"..."}}` — a pessoa
// só precisa saber se dá para despachar por ali ou não.
//
// O que não for reconhecido cai numa mensagem genérica, mas o código original
// vai para o log do Worker para a gente conseguir investigar depois.
// ---------------------------------------------------------------------------

const MILHA_KM = 1.60934;

/** Nomes de campo do payload da Uber em linguagem de gente. */
const CAMPOS: Record<string, string> = {
  pickup_phone_number: "telefone da loja",
  dropoff_phone_number: "telefone do cliente",
  pickup_address: "endereço da loja",
  dropoff_address: "endereço de entrega",
  pickup_name: "nome da loja",
  dropoff_name: "nome do cliente",
  manifest_items: "itens do pedido",
};

interface ErroUber {
  code?: string;
  message?: string;
  metadata?: Record<string, string> & { details?: string };
}

export function traduzirErroUber(status: number, corpo: string): string {
  let e: ErroUber;
  try {
    e = JSON.parse(corpo) as ErroUber;
  } catch {
    return `A Uber não respondeu como esperado (código ${status}).`;
  }

  console.warn(`[uber] ${status} ${e.code ?? "?"}: ${e.message ?? corpo.slice(0, 200)}`);

  switch (e.code) {
    case "address_undeliverable": {
      // details vem como "... (Max Radius: 3.11 miles, Calculated Distance: 3.67 miles)."
      const d = e.metadata?.details ?? "";
      const max = d.match(/Max Radius: ([\d.]+) miles/);
      const dist = d.match(/Calculated Distance: ([\d.]+) miles/);

      if (max && dist) {
        const km = (n: string) => (Number(n) * MILHA_KM).toFixed(1).replace(".", ",");
        return `Fora da área de cobertura da Uber: ${km(dist[1])} km de rota, e o limite da loja é ${km(max[1])} km.`;
      }
      return "Fora da área de cobertura da Uber para este endereço.";
    }

    case "address_undeliverable_limited_couriers":
      return "A Uber não tem entregador disponível para este endereço agora.";

    case "invalid_params": {
      // metadata traz o campo problemático como chave.
      const campo = Object.keys(e.metadata ?? {}).find((k) => k !== "details");
      const rotulo = campo ? CAMPOS[campo] ?? campo : null;
      return rotulo
        ? `A Uber recusou o ${rotulo}. Confira o cadastro.`
        : "A Uber recusou os dados do pedido. Confira o endereço e os telefones.";
    }

    case "customer_blocked":
      return "A conta da Uber não está autorizada a criar entregas. Veja em Configurações.";

    case "unauthorized":
      return "A conta da Uber não tem permissão para entregas. Veja em Configurações.";

    case "duplicate_delivery":
      return "A Uber já tem uma entrega para este pedido.";

    case "quote_expired":
      return "A cotação da Uber venceu. Clique em Recotar.";

    default:
      if (status === 401 || status === 403) {
        return "A Uber recusou as credenciais. Veja em Configurações.";
      }
      if (status >= 500) {
        return "A Uber está instável no momento. Tente novamente em instantes.";
      }
      return e.message
        ? `A Uber recusou: ${e.message}`
        : `A Uber recusou a solicitação (código ${status}).`;
  }
}

function pickupPayload(env: Env) {
  return {
    pickup_address: env.RESTAURANTE_CEP, // em prod, use o endereço estruturado completo
    pickup_name: env.RESTAURANTE_NOME,
    pickup_phone_number: env.RESTAURANTE_TELEFONE,
    pickup_latitude: parseFloat(env.RESTAURANTE_LAT),
    pickup_longitude: parseFloat(env.RESTAURANTE_LNG),
  };
}

export async function cotarUber(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao
): Promise<Cotacao> {
  const cred = credenciaisUber(env, modo);
  const base: Cotacao = {
    provider: "uber",
    nome: "Uber Direct",
    disponivel: false,
    preco: null,
    moeda: "BRL",
    etaMinutos: null,
    quoteId: null,
    expiraEm: null,
  };

  const token = await getUberToken(env, modo);
  const res = await fetch(
    `${cred.baseUrl}/v1/customers/${cred.customerId}/delivery_quotes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...pickupPayload(env),
        dropoff_address: enderecoFormatado(pedido.endereco),
        dropoff_latitude: pedido.endereco.lat,
        dropoff_longitude: pedido.endereco.lng,
      }),
    }
  );

  if (!res.ok) {
    return { ...base, erro: traduzirErroUber(res.status, await res.text()) };
  }

  // Uber retorna fee em centavos e duração em segundos.
  const q = (await res.json()) as {
    id: string;
    fee: number;
    currency: string;
    duration: number; // minutos até entrega (dropoff_eta) — normalizamos
    dropoff_eta?: string;
    expires?: string;
  };

  return {
    ...base,
    disponivel: true,
    preco: Math.round(q.fee) / 100,
    moeda: q.currency || "BRL",
    etaMinutos: q.duration ?? null,
    quoteId: q.id,
    expiraEm: q.expires ?? null,
  };
}

export async function despacharUber(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao
): Promise<ResultadoDespacho> {
  const cred = credenciaisUber(env, modo);
  const token = await getUberToken(env, modo);
  const res = await fetch(
    `${cred.baseUrl}/v1/customers/${cred.customerId}/deliveries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quote_id: cotacao.quoteId,
        ...pickupPayload(env),
        dropoff_address: enderecoFormatado(pedido.endereco),
        dropoff_name: pedido.cliente.nome,
        dropoff_phone_number: pedido.cliente.telefone,
        dropoff_latitude: pedido.endereco.lat,
        dropoff_longitude: pedido.endereco.lng,
        manifest_items: pedido.itens.map((i) => ({
          name: i.nome,
          quantity: i.quantidade,
        })),
      }),
    }
  );

  if (!res.ok) {
    throw new Error(traduzirErroUber(res.status, await res.text()));
  }

  const d = (await res.json()) as {
    id: string;
    tracking_url: string;
    status: string;
  };

  return {
    provider: "uber",
    deliveryId: d.id,
    trackingUrl: d.tracking_url,
    status: d.status,
  };
}
