import type { Cotacao, Env, ModoOperacao, Pedido, ResultadoDespacho } from "../types";
import { get99Token } from "./tokens";

// ---------------------------------------------------------------------------
// 99 Entregas B2B (credenciais corporativas)
// Token OAuth2 cacheado em tokens.ts (get99Token).
// Confirme os paths exatos no contrato corporativo da 99.
// ---------------------------------------------------------------------------

export async function cotar99(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao
): Promise<Cotacao> {
  const base: Cotacao = {
    provider: "99",
    nome: "99 Entregas",
    disponivel: false,
    preco: null,
    moeda: "BRL",
    etaMinutos: null,
    quoteId: null,
    expiraEm: null,
  };

  const token = await get99Token(env, modo);

  const res = await fetch(`${env.NOVA99_BASE_URL}/delivery/v1/quotes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      origin: {
        lat: parseFloat(env.RESTAURANTE_LAT),
        lng: parseFloat(env.RESTAURANTE_LNG),
      },
      destination: {
        lat: pedido.endereco.lat,
        lng: pedido.endereco.lng,
        address: `${pedido.endereco.logradouro}, ${pedido.endereco.numero}`,
        postalCode: pedido.endereco.cep.replace(/\D/g, ""),
      },
    }),
  });

  if (!res.ok) {
    return { ...base, erro: `99 cotação ${res.status}: ${await res.text()}` };
  }

  const q = (await res.json()) as {
    quoteId: string;
    priceInCents: number;
    etaMinutes: number;
    expiresAt?: string;
  };

  return {
    ...base,
    disponivel: true,
    preco: Math.round(q.priceInCents) / 100,
    etaMinutos: q.etaMinutes ?? null,
    quoteId: q.quoteId,
    expiraEm: q.expiresAt ?? null,
  };
}

export async function despachar99(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao
): Promise<ResultadoDespacho> {
  const token = await get99Token(env, modo);

  const res = await fetch(`${env.NOVA99_BASE_URL}/delivery/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      quoteId: cotacao.quoteId,
      externalId: pedido.id,
      customer: {
        name: pedido.cliente.nome,
        phone: pedido.cliente.telefone,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`99 despacho ${res.status}: ${await res.text()}`);
  }

  const d = (await res.json()) as {
    orderId: string;
    trackingUrl?: string;
    status: string;
  };

  return {
    provider: "99",
    deliveryId: d.orderId,
    trackingUrl: d.trackingUrl ?? null,
    status: d.status,
  };
}
