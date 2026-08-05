import type { Env, EventoEntrega, StatusEntregaUber } from "../types";
import { registrarEvento, aplicarEstadoEntrega } from "../lib/store";

// ---------------------------------------------------------------------------
// Recebimento dos webhooks do Uber Direct.
//
// Documentação: developer.uber.com/docs/deliveries/guides/webhooks
//
// Tipos de evento:
//   event.delivery_status   — mudou o status da entrega
//   event.courier_update    — o entregador se moveu
//   event.refund_request    — pedido de reembolso
//   event.shopping_progress — compras (não usamos)
//
// Comportamento de reenvio da Uber: se não receber 2xx, tenta de novo em 10s,
// 30s, 60s e 120s — no máximo 3 tentativas. Duas consequências no desenho:
//
//   1. Responder rápido. Nada de processamento pesado aqui.
//   2. Ser idempotente. O mesmo evento chega mais de uma vez, e sem trava um
//      "delivered" repetido sobrescreveria um "canceled" que veio depois.
//      A trava é a PRIMARY KEY de eventos_entrega.
// ---------------------------------------------------------------------------

/** Status possíveis segundo a documentação da Uber. */
const STATUS_CONHECIDOS: StatusEntregaUber[] = [
  "pending",
  "pickup",
  "pickup_complete",
  "dropoff",
  "delivered",
  "canceled",
  "returned",
  "shopping_completed",
];

interface PayloadUber {
  id?: string;
  kind?: string;
  status?: string;
  delivery_id?: string;
  created?: string;
  live_mode?: boolean;
  location?: { lat?: number; lng?: number };
  data?: {
    id?: string;
    status?: string;
    tracking_url?: string;
    dropoff_eta?: string;
    courier?: {
      name?: string;
      phone_number?: string;
      vehicle_type?: string;
      vehicle_make?: string;
      vehicle_model?: string;
      location?: { lat?: number; lng?: number };
    } | null;
  };
}

function veiculo(c: NonNullable<NonNullable<PayloadUber["data"]>["courier"]>): string | null {
  const partes = [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ");
  return partes || c.vehicle_type || null;
}

export type ResultadoWebhook =
  | { ok: true; duplicado: boolean; detalhe: string }
  | { ok: false; motivo: string };

export async function processarWebhookUber(
  env: Env,
  corpoBruto: string
): Promise<ResultadoWebhook> {
  let p: PayloadUber;
  try {
    p = JSON.parse(corpoBruto) as PayloadUber;
  } catch {
    return { ok: false, motivo: "corpo não é JSON" };
  }

  const kind = p.kind ?? "desconhecido";
  const deliveryId = p.delivery_id ?? p.data?.id ?? null;

  // Sem id de evento não dá para garantir idempotência. Cai num id derivado do
  // conteúdo para não perder o evento nem processá-lo duas vezes.
  const idEvento =
    p.id ?? `${kind}:${deliveryId ?? "sem-id"}:${p.created ?? corpoBruto.length}`;

  const evento: EventoEntrega = {
    id: idEvento,
    provider: "uber",
    kind,
    status: p.status ?? p.data?.status ?? null,
    deliveryIdExterno: deliveryId,
    criadoEmParceiro: p.created ?? null,
    liveMode: p.live_mode ?? null,
    payload: corpoBruto,
  };

  const { novo, idPedido } = await registrarEvento(env, evento);

  if (!novo) {
    return { ok: true, duplicado: true, detalhe: `evento ${idEvento} já processado` };
  }

  if (!deliveryId) {
    return { ok: true, duplicado: false, detalhe: "evento sem delivery_id — só registrado" };
  }
  if (!idPedido) {
    // Entrega que não nasceu neste Hub (ou pedido já limpo pelo cron).
    // Responder 2xx mesmo assim: 4xx faria a Uber reenviar em vão.
    return {
      ok: true,
      duplicado: false,
      detalhe: `entrega ${deliveryId} não encontrada — evento arquivado`,
    };
  }

  const cour = p.data?.courier ?? null;
  const statusBruto = p.status ?? p.data?.status ?? null;

  // Status fora da lista documentada não é motivo para falhar — a Uber pode
  // acrescentar valores. Gravamos como veio e seguimos.
  if (statusBruto && !STATUS_CONHECIDOS.includes(statusBruto as StatusEntregaUber)) {
    console.warn(`[uber-webhook] status desconhecido: ${statusBruto}`);
  }

  await aplicarEstadoEntrega(env, deliveryId, {
    status: statusBruto,
    trackingUrl: p.data?.tracking_url ?? null,
    dropoffEta: p.data?.dropoff_eta ?? null,
    courierNome: cour?.name ?? null,
    courierTelefone: cour?.phone_number ?? null,
    courierVeiculo: cour ? veiculo(cour) : null,
    // O courier_update traz a posição na raiz; o delivery_status, dentro de courier.
    courierLat: p.location?.lat ?? cour?.location?.lat ?? null,
    courierLng: p.location?.lng ?? cour?.location?.lng ?? null,
    liveMode: p.live_mode ?? null,
  });

  return {
    ok: true,
    duplicado: false,
    detalhe: `${kind}${statusBruto ? ` (${statusBruto})` : ""} aplicado ao pedido ${idPedido}`,
  };
}
