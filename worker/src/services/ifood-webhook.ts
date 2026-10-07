import type { Env, EventoEntrega, StatusEntregaUber } from "../types";
import { registrarEvento, aplicarEstadoEntrega } from "../lib/store";
import { credenciaisIfood } from "../config/ambiente";
import { modoAtual } from "../config/modo";
import { getIfoodToken } from "./tokens";
import { aplicarEventoDePedidoIfood } from "./ifood-pedidos";

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
// novo, confirmado, cancelado pelo cliente... Os eventos de entrega (tabela
// abaixo) são gravados. Os de pedido só valem para pedido que chegou direto
// do iFood (modo teste, ver ifood-pedidos.ts); o resto é respondido com 2xx e
// descartado, senão o banco enche de evento de pedido que o Cardápio Web já
// trata.
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
  ARRIVED_AT_ORIGIN: "at_pickup",
  AAO: "at_pickup",
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
  // Mesma coisa na rota /cancel (entrega criada pelo Hub).
  CANCELLATION_REQUESTED: null,
  CANCELLATION_REQUEST_FAILED: null,

  // Informativos
  DELIVERY_DROP_CODE_REQUESTED: null,
  DELIVERY_RETURN_CODE_REQUESTED: null,

  // Mudança de endereço: não mudam o status, mas abrem/fecham o aviso no
  // card (ver PENDENCIA abaixo).
  DELIVERY_ADDRESS_CHANGE_REQUESTED: null,
  DELIVERY_ADDRESS_CHANGE_ACCEPTED: null,
  DELIVERY_ADDRESS_CHANGE_DENIED: null,
  DELIVERY_ADDRESS_CHANGE_USER_CONFIRMED: null,
};

/** Eventos que dizem "o iFood NÃO cancelou": a corrida continua. */
const CANCELAMENTO_RECUSADO = new Set([
  "DELIVERY_CANCELLATION_REQUEST_REJECTED",
  "CANCELLATION_REQUEST_FAILED",
]);

// ---------------------------------------------------------------------------
// PENDÊNCIAS DA ENTREGA — o que o atendente precisa ver e que não é status.
//
// Ficam no KV, por entrega, e não no D1: duram minutos (mudança de endereço
// expira em 15) ou só enquanto a corrida existe (código de coleta), e não
// entram no relatório. Assim não há migração de banco.
// ---------------------------------------------------------------------------

/** Prazo do iFood para a loja responder a uma mudança de endereço. */
const PRAZO_MUDANCA_MS = 15 * 60_000;

export interface PendenciasIfood {
  mudancaEndereco?: {
    /** Novo endereço em texto, quando o evento traz; senão null. */
    novoEndereco: string | null;
    pedidaEm: string;
    /** Depois disso o iFood recusa sozinho. */
    prazo: string;
  };
  /** Código que o ENTREGADOR informa no balcão para retirar o pedido. */
  codigoColeta?: string;
  /** Código que o CLIENTE informa ao entregador na porta. */
  codigoEntrega?: string;
}

const chavePendencias = (orderId: string) => `ifood:pendencias:${orderId}`;

export async function pendenciasIfood(env: Env, orderId: string): Promise<PendenciasIfood | null> {
  const p = await env.HUB_KV.get<PendenciasIfood>(chavePendencias(orderId), "json");
  if (!p) return null;
  // Mudança vencida não aparece: o iFood já recusou sozinho.
  if (p.mudancaEndereco && Date.parse(p.mudancaEndereco.prazo) < Date.now()) {
    delete p.mudancaEndereco;
  }
  return p;
}

async function salvarPendencias(env: Env, orderId: string, p: PendenciasIfood): Promise<void> {
  // Um dia: o iFood expira a entrega em 8 h, então nada aqui sobrevive a ela.
  await env.HUB_KV.put(chavePendencias(orderId), JSON.stringify(p), { expirationTtl: 86_400 });
}

/** Marca a mudança de endereço como respondida (pela tela ou por evento). */
export async function encerrarMudancaEndereco(env: Env, orderId: string): Promise<void> {
  const p = await env.HUB_KV.get<PendenciasIfood>(chavePendencias(orderId), "json");
  if (!p?.mudancaEndereco) return;
  delete p.mudancaEndereco;
  await salvarPendencias(env, orderId, p);
}

/**
 * Novo endereço em uma linha, a partir do metadata do evento.
 *
 * O formato do metadata deste evento não está documentado. Aceita os nomes da
 * rota deliveryAddressChangeRequest (streetName, streetNumber...), em camelCase
 * ou MAIÚSCULO_COM_SUBLINHADO, soltos ou dentro de um objeto de endereço.
 */
function enderecoDoMetadata(m: Record<string, unknown> | undefined): string | null {
  if (!m) return null;
  const aninhado = [m.address, m.deliveryAddress, m.newAddress, m.NEW_ADDRESS, m.ADDRESS].find(
    (v): v is Record<string, unknown> => !!v && typeof v === "object"
  );
  const fonte = aninhado ?? m;
  const ler = (...k: string[]) => meta(fonte, ...k);

  const rua = ler("streetName", "STREET_NAME", "street");
  if (!rua) return ler("formattedAddress", "FORMATTED_ADDRESS");
  const numero = ler("streetNumber", "STREET_NUMBER", "number");
  const partes = [
    numero ? `${rua}, ${numero}` : rua,
    ler("complement", "COMPLEMENT"),
    ler("neighborhood", "NEIGHBORHOOD"),
    ler("city", "CITY"),
  ].filter(Boolean);
  const referencia = ler("reference", "REFERENCE");
  return partes.join(" · ") + (referencia ? ` (ref.: ${referencia})` : "");
}

/** Atualiza as pendências da entrega conforme o evento. */
async function aplicarPendencias(env: Env, nome: string, ev: EventoIfood): Promise<void> {
  const orderId = ev.orderId!;
  const m = ev.metadata;
  const codigoColeta = meta(m, "pickupCode", "PICKUP_CODE");
  const codigoEntrega =
    nome === "DELIVERY_DROP_CODE_REQUESTED" ? meta(m, "CODE", "code", "dropCode") : null;
  const pedeMudanca = nome === "DELIVERY_ADDRESS_CHANGE_REQUESTED";
  const fechaMudanca = nome.startsWith("DELIVERY_ADDRESS_CHANGE_") && !pedeMudanca;

  if (!codigoColeta && !codigoEntrega && !pedeMudanca && !fechaMudanca) return;

  const p =
    (await env.HUB_KV.get<PendenciasIfood>(chavePendencias(orderId), "json")) ?? {};
  if (codigoColeta) p.codigoColeta = codigoColeta;
  if (codigoEntrega) p.codigoEntrega = codigoEntrega;
  if (pedeMudanca) {
    const pedidaEm = ev.createdAt ?? new Date().toISOString();
    p.mudancaEndereco = {
      novoEndereco: enderecoDoMetadata(m),
      pedidaEm,
      prazo: new Date(Date.parse(pedidaEm) + PRAZO_MUDANCA_MS).toISOString(),
    };
  }
  if (fechaMudanca) delete p.mudancaEndereco;

  await salvarPendencias(env, orderId, p);
}

/**
 * Ordem das etapas. Um evento só muda o status se não for para trás.
 * Finais empatam no topo: depois de cancelada, entregue ou devolvida, nenhum
 * evento atrasado reabre a entrega.
 */
const ETAPA: Record<string, number> = {
  pending: 0,
  pickup: 1,
  at_pickup: 2,
  pickup_complete: 3,
  dropoff: 4,
  delivered: 5,
  returned: 5,
  canceled: 5,
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

  return aplicarEventosIfood(env, (Array.isArray(bruto) ? bruto : [bruto]) as EventoIfood[]);
}

/**
 * Aplica uma lista de eventos do iFood. Usado pelo webhook e pela busca de
 * reserva (buscarEventosIfood) — os dois caminhos passam pelo mesmo filtro,
 * pela mesma trava de idempotência e pela mesma régua de status.
 */
async function aplicarEventosIfood(
  env: Env,
  eventos: EventoIfood[]
): Promise<ResultadoWebhookIfood> {
  const r: ResultadoWebhookIfood = { recebidos: eventos.length, aplicados: 0, ignorados: 0 };

  for (const ev of eventos) {
    const nome = ev.fullCode ?? ev.code ?? "";
    const conhecido =
      nome in STATUS_POR_EVENTO || (ev.code != null && ev.code in STATUS_POR_EVENTO);

    // Eventos do PEDIDO (recebido, confirmado, cancelado...). Só mexem em
    // pedido que veio direto do iFood — ver ifood-pedidos.ts. Lança se não
    // conseguir buscar o pedido novo: aí o evento não é confirmado na fila e
    // volta na próxima busca.
    const mexeuNoPedido = await aplicarEventoDePedidoIfood(env, ev);

    if (!conhecido || !ev.orderId) {
      if (mexeuNoPedido) r.aplicados++;
      else r.ignorados++;
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
      if (mexeuNoPedido) r.aplicados++;
      else r.ignorados++;
      continue;
    }

    // O STATUS SÓ AVANÇA. O iFood manda eventos no mesmo milissegundo e fora
    // de ordem — visto em 24/09/2026: DISPATCHED antes de COLLECTED, e o
    // "coletado" que chegou por último rebaixou "saiu para entrega". O evento
    // atrasado continua valendo para os outros campos (entregador, veículo).
    const atual = await env.DB.prepare(
      `SELECT status_ao_vivo FROM deliveries WHERE delivery_id_externo = ?1 LIMIT 1`
    )
      .bind(ev.orderId)
      .first<{ status_ao_vivo: string | null }>();
    let statusAplicado: string | null =
      status && ETAPA[status] < (ETAPA[atual?.status_ao_vivo ?? ""] ?? -1) ? null : status;

    // CANCELAMENTO RECUSADO. O Hub marca "cancelada" no clique, sem esperar o
    // iFood (ver /cancelar). Se ele recusar, a corrida continua — e como
    // "cancelada" é final na régua acima, nenhum evento seguinte a reabriria.
    // Volta para a etapa mais avançada que a corrida já tinha atingido.
    if (CANCELAMENTO_RECUSADO.has(nome) && atual?.status_ao_vivo === "canceled") {
      const anteriores = await env.DB.prepare(
        `SELECT status FROM eventos_entrega
          WHERE delivery_id_externo = ?1 AND provider = 'ifood'
            AND status IS NOT NULL AND status <> 'canceled'`
      )
        .bind(ev.orderId)
        .all<{ status: string }>();
      statusAplicado = (anteriores.results ?? []).reduce<string>(
        (max, l) => ((ETAPA[l.status] ?? -1) > (ETAPA[max] ?? -1) ? l.status : max),
        "pending"
      );
    }

    const m = ev.metadata;
    await aplicarEstadoEntrega(env, ev.orderId, {
      status: statusAplicado,
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
    await aplicarPendencias(env, nome, ev);
    // Log de operação crítica, com o que o iFood pede: orderId, eventId,
    // horário e status. Os logs do Worker ficam no Workers Logs; o evento
    // inteiro fica em eventos_entrega, que a limpeza diária não apaga.
    console.log(
      `[ifood-evento] orderId=${ev.orderId} eventId=${ev.id ?? "-"} code=${nome} ` +
        `criadoEm=${ev.createdAt ?? "-"} status=${statusAplicado ?? "-"}`
    );
    r.aplicados++;
  }

  return r;
}

// ---------------------------------------------------------------------------
// POLLING — busca na fila de eventos do iFood.
//
// Roda a cada 30 segundos (cron de 1 minuto que busca duas vezes, ver
// index.ts): é o intervalo que o critério de homologação exige. Também cobre
// o webhook quando ele falha calado — em 24/09/2026 ele ficou com a URL
// errada no portal, e o card da entrega simplesmente não andava.
//
// Não compete com o webhook: o evento que chegar pelos dois caminhos é gravado
// uma vez só (a PRIMARY KEY de eventos_entrega é o id do evento).
//
// CONFIRMAR É OBRIGATÓRIO. O iFood devolve o mesmo evento em toda busca até
// receber o acknowledgment — sem ele, a fila cresce sem parar. Por isso se
// confirma TUDO que veio, inclusive o que o Hub ignora (pedido novo,
// confirmado...): ignorar é uma decisão tomada, não um evento pendente.
// ---------------------------------------------------------------------------

export async function buscarEventosIfood(
  env: Env
): Promise<ResultadoWebhookIfood | { pulado: string }> {
  const modo = await modoAtual(env);
  const cred = credenciaisIfood(env, modo);
  if (!cred.clientId || !cred.clientSecret || !cred.merchantId) {
    return { pulado: `iFood sem credencial ou loja no modo ${modo}` };
  }

  let token: string;
  try {
    token = await getIfoodToken(env, modo);
  } catch (e) {
    // Antes da homologação o token de produção é recusado (403). Não é erro
    // desta rotina, e ela não tem o que fazer a respeito.
    return { pulado: e instanceof Error ? e.message : "sem token do iFood" };
  }

  const inicio = Date.now();
  let res: Response;
  try {
    res = await fetch(`${cred.baseUrl}/events/v1.0/events:polling`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Sem este header o iFood devolve eventos de TODAS as lojas do app.
        "x-polling-merchants": cred.merchantId,
      },
    });
  } catch (e) {
    await registrarFalhaPolling(env, `falha de rede: ${e instanceof Error ? e.message : e}`);
    return { pulado: "falha de rede no polling" };
  }
  const duracao = Date.now() - inicio;
  if (duracao > 30_000) {
    console.error(`[ALERTA ifood-polling] fila demorou ${duracao} ms para responder`);
  }

  // 204 = fila vazia, o caso mais comum.
  if (res.status === 204) {
    await zerarFalhasPolling(env);
    return { recebidos: 0, aplicados: 0, ignorados: 0 };
  }
  if (!res.ok) {
    await registrarFalhaPolling(env, `fila respondeu ${res.status}`);
    return { pulado: `fila respondeu ${res.status}` };
  }
  await zerarFalhasPolling(env);

  const eventos = (await res.json().catch(() => [])) as EventoIfood[];
  if (!Array.isArray(eventos) || eventos.length === 0) {
    return { recebidos: 0, aplicados: 0, ignorados: 0 };
  }

  const r = await aplicarEventosIfood(env, eventos);

  // Só confirma depois de aplicar: se aplicar falhar (exceção), o evento fica
  // na fila e volta na próxima rodada.
  const ids = eventos.filter((e) => e.id).map((e) => ({ id: e.id }));
  if (ids.length > 0) {
    const ack = await fetch(`${cred.baseUrl}/events/v1.0/events/acknowledgment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    });
    if (!ack.ok) console.warn(`[ifood-polling] acknowledgment respondeu ${ack.status}`);
  }

  console.log(
    `[ifood-polling] ${r.recebidos} recebido(s), ${r.aplicados} aplicado(s), ` +
      `${ids.length} confirmado(s) em ${duracao} ms`
  );
  return r;
}

// ---------------------------------------------------------------------------
// ALERTA DE POLLING. Critério do iFood: alertar depois de mais de 5 falhas
// seguidas. O contador fica no KV porque cada busca roda numa invocação nova.
// O alerta é um console.error com prefixo fixo ([ALERTA ...]), fácil de
// filtrar nos Workers Logs e de ligar a uma notificação da Cloudflare.
// ---------------------------------------------------------------------------

const CHAVE_FALHAS = "ifood:polling:falhas";
const LIMITE_FALHAS = 5;

async function registrarFalhaPolling(env: Env, motivo: string): Promise<void> {
  const falhas = Number((await env.HUB_KV.get(CHAVE_FALHAS)) ?? "0") + 1;
  await env.HUB_KV.put(CHAVE_FALHAS, String(falhas), { expirationTtl: 86_400 });
  if (falhas > LIMITE_FALHAS) {
    console.error(`[ALERTA ifood-polling] ${falhas} falhas seguidas. Última: ${motivo}`);
  } else {
    console.warn(`[ifood-polling] falha ${falhas}: ${motivo}`);
  }
}

async function zerarFalhasPolling(env: Env): Promise<void> {
  // Lê antes de escrever: o KV cobra escrita, e o caso comum é já estar zerado.
  if ((await env.HUB_KV.get(CHAVE_FALHAS)) !== null) await env.HUB_KV.delete(CHAVE_FALHAS);
}
