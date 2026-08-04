import type { Cotacao, Env, Pedido, ResultadoDespacho } from "../types";
import { getUberToken } from "./tokens";
import { enderecoFormatado } from "../lib/geo";
import { uberCustomerId, uberUrls } from "../config/ambiente";

// ---------------------------------------------------------------------------
// Uber Direct B2B
// Docs: https://developer.uber.com/docs/deliveries
// Cotação:  POST /v1/customers/{customer_id}/delivery_quotes
// Criação:  POST /v1/customers/{customer_id}/deliveries
// ---------------------------------------------------------------------------

function pickupPayload(env: Env) {
  return {
    pickup_address: env.RESTAURANTE_CEP, // em prod, use o endereço estruturado completo
    pickup_name: env.RESTAURANTE_NOME,
    pickup_phone_number: env.RESTAURANTE_TELEFONE,
    pickup_latitude: parseFloat(env.RESTAURANTE_LAT),
    pickup_longitude: parseFloat(env.RESTAURANTE_LNG),
  };
}

export async function cotarUber(env: Env, pedido: Pedido): Promise<Cotacao> {
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

  const token = await getUberToken(env);
  const res = await fetch(
    `${uberUrls(env).base}/v1/customers/${uberCustomerId(env)}/delivery_quotes`,
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
    return { ...base, erro: `Uber cotação ${res.status}: ${await res.text()}` };
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
  cotacao: Cotacao
): Promise<ResultadoDespacho> {
  const token = await getUberToken(env);
  const res = await fetch(
    `${uberUrls(env).base}/v1/customers/${uberCustomerId(env)}/deliveries`,
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
    throw new Error(`Uber despacho ${res.status}: ${await res.text()}`);
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
