import type { Cotacao, Env, ModoOperacao, Pedido, ResultadoDespacho } from "../types";
import { getIfoodToken } from "./tokens";

// ---------------------------------------------------------------------------
// iFood Entrega Fácil / Logística (on-demand delivery)
// O token OAuth2 é resolvido/cacheado em tokens.ts (getIfoodToken).
//
// ATENÇÃO: os paths abaixo seguem o padrão da API de logística do iFood, mas
// confirme os endpoints exatos no seu contrato/portal de parceiro. A forma
// (auth -> cotação -> criação) está correta; só os nomes de rota podem variar.
// ---------------------------------------------------------------------------

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

  const token = await getIfoodToken(env, modo);

  const res = await fetch(
    `${env.IFOOD_BASE_URL}/logistics/v1.0/merchants/${env.IFOOD_MERCHANT_ID}/deliveries/quotations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deliveryAddress: {
          streetName: pedido.endereco.logradouro,
          streetNumber: pedido.endereco.numero,
          complement: pedido.endereco.complemento,
          neighborhood: pedido.endereco.bairro,
          city: pedido.endereco.cidade,
          state: pedido.endereco.uf,
          postalCode: pedido.endereco.cep.replace(/\D/g, ""),
          coordinates: {
            latitude: pedido.endereco.lat,
            longitude: pedido.endereco.lng,
          },
        },
        totalAmount: pedido.total,
      }),
    }
  );

  if (!res.ok) {
    return { ...base, erro: `iFood cotação ${res.status}: ${await res.text()}` };
  }

  const q = (await res.json()) as {
    quotationId: string;
    price: { value: number; currency?: string }; // value em reais
    estimatedDeliveryTimeInMinutes: number;
    expiresAt?: string;
  };

  return {
    ...base,
    disponivel: true,
    preco: q.price.value,
    moeda: q.price.currency || "BRL",
    etaMinutos: q.estimatedDeliveryTimeInMinutes ?? null,
    quoteId: q.quotationId,
    expiraEm: q.expiresAt ?? null,
  };
}

export async function despacharIfood(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao
): Promise<ResultadoDespacho> {
  const token = await getIfoodToken(env, modo);

  const res = await fetch(
    `${env.IFOOD_BASE_URL}/logistics/v1.0/merchants/${env.IFOOD_MERCHANT_ID}/deliveries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quotationId: cotacao.quoteId,
        externalOrderId: pedido.id,
        customer: {
          name: pedido.cliente.nome,
          phone: pedido.cliente.telefone,
        },
        items: pedido.itens.map((i) => ({
          name: i.nome,
          quantity: i.quantidade,
        })),
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`iFood despacho ${res.status}: ${await res.text()}`);
  }

  const d = (await res.json()) as {
    deliveryId: string;
    trackingUrl?: string;
    status: string;
  };

  return {
    provider: "ifood",
    deliveryId: d.deliveryId,
    trackingUrl: d.trackingUrl ?? null,
    status: d.status,
  };
}
