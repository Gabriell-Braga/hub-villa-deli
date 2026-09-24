import type { Env, EventoEntrega, StatusEntregaUber } from "../types";
import { registrarEvento, aplicarEstadoEntrega } from "../lib/store";

// ---------------------------------------------------------------------------
// Recebimento dos eventos do iFood (webhook).
//
// Docs: developer.ifood.com.br → Eventos → Webhook
//
// O iFood manda o MESMO formato de evento do polling:
//   { id, code, fullCode, orderId, merchantId, createdAt, metadata }
// e pode mandar um objeto ou uma lista. Aceitamos os dois.
//
// Quem assina é o Client Secret da aplicação (HMAC-SHA256 do corpo cru, hex,
// header X-IFood-Signature). A validação está na rota, em index.ts.
//
// FILTRO: a aplicação recebe TODOS os eventos das lojas autorizadas — pedido
// novo, confirmado, cancelado pelo cliente... A maior parte não é da conta do
// Hub. Só os eventos de entrega (tabela abaixo) são gravados; o resto é
// respondido com 2xx e descartado, senão o banco enche de evento de pedido que
// o Cardápio Web já trata.
// ---------------------------------------------------------------------------

/**
 * Evento do iFood -> status no vocabulário do Hub (o mesmo do Uber, que é o
 * que o painel sabe exibir). A chave é o fullCode; o code curto também entra
 * porque há eventos que chegam só com ele.
 *
 * `null` = evento de entrega que vale registrar mas não muda o status.
 */
const STATUS_POR_EVENTO: Record<string, StatusEntregaUber | null> = {
  // Pedido de entregador
  REQUEST_DRIVER: "pending",
  REQUEST_DRIVER_SUCCESS: "pending",
  // Nenhum entregador aceitou. A corrida morreu: o atendente precisa ver
  // "cancelada" para escolher outra transportadora.
  REQUEST_DRIVER_FAILED: "canceled",

  // Entregador
  ASSIGN_DRIVER: "pickup",
  ADR: "pickup",
  GOING_TO_ORIGIN: "pickup",
  GTO: "pickup",
  ARRIVED_AT_ORIGIN: "pickup",
  AAO: "pickup",
  COLLECTED: "pickup_complete",
  CLT: "pickup_complete",
  DISPATCHED: "dropoff",
  DSP: "dropoff",
  DELIVERY_IN_TRANSIT: "dropoff",
  ARRIVED_AT_DESTINATION: "dropoff",
  AAD: "dropoff",
  CONCLUDED: "delivered",
  CON: "delivered",
  DELIVERY_CONCLUDED: "delivered",

  // Devolução
  DELIVERY_RETURNING_TO_ORIGIN: "dropoff",
  DELIVERY_RETURNED_TO_ORIGIN: "returned",

  // Cancelamento
  CANCELLED: "canceled",
  CAN: "canceled",
  DELIVERY_CANCELLED: "canceled",
  DELIVERY_CANCELLATION_REQUEST_ACCEPTED: "canceled",
  DELIVERY_CANCELLATION_REQUESTED: null,
  // Recusado = a corrida continua. O próximo evento de status acerta a tela,
  // que o Hub marcou como cancelada no clique (ver /cancelar).
  DELIVERY_CANCELLATION_REQUEST_REJECTED: null,

  // Informativos
  DELIVERY_DROP_CODE_REQUESTED: null,
  DELIVERY_RETURN_CODE_REQUESTED: null,
  DELIVERY_ADDRESS_CHANGE_REQUESTED: null,
};

interface EventoIfood {
  id?: string;
  code?: string;
  fullCode?: string;
  orderId?: string;
  merchantId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/** Lê uma string do metadata tentando os nomes que o iFood já usou. */
function meta(m: Record<string, unknown> | undefined, ...chaves: string[]): string | null {
  if (!m) return null;
  for (const k of chaves) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Veículo em português de balcão. O iFood manda o tipo em inglês/maiúsculo. */
function veiculo(tipo: string | null): string | null {
  if (!tipo) return null;
  const t = tipo.toUpperCase();
  if (t.includes("MOTO")) return "Moto";
  if (t.includes("BIKE") || t.includes("BICYCLE")) return "Bicicleta";
  if (t.includes("CAR")) return "Carro";
  return tipo;
}

export type ResultadoWebhookIfood = {
  recebidos: number;
  aplicados: number;
  ignorados: number;
};

export async function processarWebhookIfood(
  env: Env,
  corpoBruto: string
): Promise<ResultadoWebhookIfood | { erro: string }> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(corpoBruto);
  } catch {
    return { erro: "corpo não é JSON" };
  }

  const eventos = (Array.isArray(bruto) ? bruto : [bruto]) as EventoIfood[];
  const r: ResultadoWebhookIfood = { recebidos: eventos.length, aplicados: 0, ignorados: 0 };

  for (const ev of eventos) {
    const nome = ev.fullCode ?? ev.code ?? "";
    const conhecido =
      nome in STATUS_POR_EVENTO || (ev.code != null && ev.code in STATUS_POR_EVENTO);

    if (!conhecido || !ev.orderId) {
      r.ignorados++;
      continue;
    }

    const status =
      STATUS_POR_EVENTO[nome] ?? (ev.code ? STATUS_POR_EVENTO[ev.code] : null) ?? null;

    const evento: EventoEntrega = {
      // O id do evento é a trava de idempotência: o iFood reenvia.
      id: ev.id ?? `ifood:${nome}:${ev.orderId}:${ev.createdAt ?? ""}`,
      provider: "ifood",
      kind: nome,
      status,
      deliveryIdExterno: ev.orderId,
      criadoEmParceiro: ev.createdAt ?? null,
      liveMode: null,
      payload: JSON.stringify(ev),
    };

    const { novo, idPedido } = await registrarEvento(env, evento);
    if (!novo || !idPedido) {
      // Duplicado, ou pedido do iFood que o Hub não despachou (a loja recebe
      // eventos de TODOS os pedidos). Nos dois casos, nada a aplicar.
      r.ignorados++;
      continue;
    }

    const m = ev.metadata;
    await aplicarEstadoEntrega(env, ev.orderId, {
      status,
      trackingUrl: meta(m, "trackingUrl", "TRACKING_URL"),
      dropoffEta: meta(m, "expectedDeliveryDate", "deliveryEta", "ETA_TO_DESTINATION"),
      pickupEta: meta(m, "expectedArrivalDate", "pickupEta", "ETA_TO_ORIGIN"),
      courierNome: meta(m, "workerName", "driverName", "WORKER_NAME"),
      courierTelefone: meta(m, "workerPhone", "driverPhone", "WORKER_PHONE"),
      courierVeiculo: veiculo(meta(m, "workerVehicleType", "vehicleType", "WORKER_VEHICLE_TYPE")),
      courierPlaca: meta(m, "vehiclePlate", "licensePlate"),
      courierLat: null,
      courierLng: null,
      liveMode: null,
    });
    r.aplicados++;
  }

  return r;
}
