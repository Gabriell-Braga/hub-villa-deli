import type { Env } from "../types";
import { registrarEvento } from "../lib/store";
import { modoAtual } from "../config/modo";
import { STATUS_EVENTO_99, sincronizar99 } from "./noventa99";

// ---------------------------------------------------------------------------
// Recebimento dos eventos da 99Entrega (webhook).
//
// Docs: https://entrega-api.99app.com/doc/webhook.html
//
// Formato:
//   { event, event_id, message, timestamp }
// `message` é uma STRING com JSON dentro: { order_id, external_order_id } — ou
// { old_order_id, new_order_id, external_order_id } no DriverCanceled.
//
// O evento não traz entregador, placa nem link. Por isso ele só serve de
// gatilho: o estado vem do detalhe do pedido (sincronizar99), que é o que a
// própria 99 recomenda — ela avisa que o webhook não tem entrega garantida.
//
// A assinatura (X-Webhook-Signature) é validada na rota, em index.ts.
// ---------------------------------------------------------------------------

interface Evento99 {
  event?: string;
  event_id?: string;
  message?: string | Record<string, unknown>;
  timestamp?: number;
}

interface Mensagem99 {
  order_id?: string;
  old_order_id?: string;
  new_order_id?: string;
  external_order_id?: string;
}

/**
 * Acha a entrega do Hub a que o evento se refere. Primeiro pelo order_id
 * guardado; depois pelo external_order_id ("{idPedido}-{tentativa}"), que
 * sobrevive à reatribuição e é o único que o OrderCompleted às vezes traz.
 */
async function acharEntrega(
  env: Env,
  m: Mensagem99
): Promise<{ idPedido: string; deliveryId: string } | null> {
  const ids = [m.order_id, m.old_order_id, m.new_order_id].filter((x): x is string => !!x);
  for (const id of ids) {
    const l = await env.DB.prepare(
      `SELECT id_pedido, delivery_id_externo FROM deliveries
        WHERE delivery_id_externo = ?1 AND plataforma_escolhida = '99' LIMIT 1`
    )
      .bind(id)
      .first<{ id_pedido: string; delivery_id_externo: string }>();
    if (l) return { idPedido: l.id_pedido, deliveryId: l.delivery_id_externo };
  }

  const ext = m.external_order_id;
  const corte = ext?.lastIndexOf("-") ?? -1;
  if (ext && corte > 0) {
    const l = await env.DB.prepare(
      `SELECT id_pedido, delivery_id_externo FROM deliveries
        WHERE id_pedido = ?1 AND sequencia = ?2 AND plataforma_escolhida = '99' LIMIT 1`
    )
      .bind(ext.slice(0, corte), Number(ext.slice(corte + 1)))
      .first<{ id_pedido: string; delivery_id_externo: string }>();
    if (l) return { idPedido: l.id_pedido, deliveryId: l.delivery_id_externo };
  }
  return null;
}

export async function processarWebhook99(
  env: Env,
  corpoBruto: string
): Promise<{ ok: true; aplicado: boolean; motivo?: string } | { ok: false; motivo: string }> {
  let ev: Evento99;
  try {
    ev = JSON.parse(corpoBruto) as Evento99;
  } catch {
    return { ok: false, motivo: "corpo não é JSON" };
  }

  let m: Mensagem99;
  try {
    m = (typeof ev.message === "string" ? JSON.parse(ev.message) : ev.message ?? {}) as Mensagem99;
  } catch {
    return { ok: false, motivo: "message não é JSON" };
  }

  const nome = ev.event ?? "";
  if (!(nome in STATUS_EVENTO_99)) return { ok: true, aplicado: false, motivo: `evento ${nome} ignorado` };

  const alvo = await acharEntrega(env, m);
  if (!alvo) return { ok: true, aplicado: false, motivo: "entrega não é deste Hub" };

  const status = STATUS_EVENTO_99[nome];
  const { novo } = await registrarEvento(env, {
    // A 99 reenvia o mesmo evento em falha de rede; o event_id é a trava.
    id: `99:${ev.event_id ?? `${nome}:${alvo.deliveryId}:${ev.timestamp ?? ""}`}`,
    provider: "99",
    kind: nome,
    status,
    deliveryIdExterno: alvo.deliveryId,
    criadoEmParceiro: ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : null,
    liveMode: null,
    payload: corpoBruto,
  });
  if (!novo) return { ok: true, aplicado: false, motivo: "duplicado" };

  const r = await sincronizar99(env, alvo.idPedido, await modoAtual(env), status);
  if (!r.ok) throw new Error(r.erro);
  return { ok: true, aplicado: true };
}
