import type {
  Cotacao,
  Env,
  ModoOperacao,
  Pedido,
  PreferenciaVeiculo,
  ResultadoDespacho,
  StatusEntregaUber,
} from "../types";
import { credenciaisLalamove } from "../config/ambiente";
import { ETA_BASE_MIN, ETA_MIN_POR_KM } from "../config/faixas-motoboy";
import { assinaturaValidaLalamove, hmacSha256Hex } from "../lib/assinatura";
import { registrarEvento } from "../lib/store";
import { enderecoFormatado } from "../lib/geo";
import { observacaoParaEntregador } from "../lib/observacao-entregador";
import { ETAPA } from "./noventa99";

// ---------------------------------------------------------------------------
// Lalamove (API v3)
// Docs: https://developers.lalamove.com/
//
//   cotação:   POST   /v3/quotations
//   despacho:  POST   /v3/orders
//   cancelar:  DELETE /v3/orders/{id}
//   detalhe:   GET    /v3/orders/{id}
//   motorista: GET    /v3/orders/{id}/drivers/{driverId}
//
// Sandbox e produção têm hosts diferentes (rest.sandbox / rest). Não há
// OAuth: cada chamada é assinada com HMAC-SHA256 do texto
//   "{ms}\r\n{MÉTODO}\r\n{/v3/caminho}\r\n\r\n{corpo}"
// e vai no header `Authorization: hmac {key}:{ms}:{assinatura}`.
//
// Corpo de pedido e de resposta vêm embrulhados em { data: ... }. Erro vem
// como { errors: [{ id, message }] } com HTTP 4xx.
//
// A cotação vale 5 minutos — menos do que um pedido costuma ficar na tela.
// Por isso o despacho sempre recota (e corrige o preço) em vez de confiar no
// quotationId do card.
//
// Acompanhamento: o webhook (processarWebhookLalamove) é o gatilho; a tela
// do pedido e a tarefa de 5 em 5 minutos são a reserva. Os três terminam em
// sincronizarLalamove, que lê o detalhe do pedido.
//
// Validado no sandbox em 06/11/2026: cotação, pedido, detalhe, cancelamento
// e webhook assinado.
// ---------------------------------------------------------------------------

/**
 * Tipos de serviço do mercado BR (GET /v3/cities). O id varia por cidade;
 * estes existem em Belo Horizonte. LALAGO é a moto com bag térmica (comida);
 * HATCHBACK é o carro menor, mais barato que CAR.
 */
const SERVICO: Record<PreferenciaVeiculo, string> = {
  moto: "LALAGO",
  carro: "HATCHBACK",
};

const ERROS: Record<string, string> = {
  ERR_OUT_OF_SERVICE_AREA: "Endereço fora da área de entrega da Lalamove.",
  ERR_INVALID_PHONE_NUMBER: "A Lalamove recusou o telefone do pedido.",
  ERR_INVALID_SERVICE_TYPE: "A Lalamove não oferece este tipo de veículo aqui.",
  ERR_REVERSE_GEOCODE_FAILURE: "A Lalamove não reconheceu o endereço.",
  ERR_INSUFFICIENT_CREDIT: "Saldo insuficiente na carteira da Lalamove.",
  ERR_CANCELLATION_FORBIDDEN:
    "Esta entrega não pode mais ser cancelada na Lalamove: o entregador já foi designado há mais de 5 minutos ou coletou o pedido.",
  ERR_RATE_LIMIT_EXCEEDED: "Muitas chamadas à Lalamove. Tente novamente em instantes.",
  ERR_INVALID_QUOTATION_ID: "Cotação da Lalamove vencida. Clique em Recotar.",
};

export class ErroLalamove extends Error {
  constructor(
    message: string,
    readonly codigo: string | null,
    readonly http: number
  ) {
    super(message);
  }
}

function traduzir(status: number, codigo: string | null, msg: string | undefined): string {
  console.warn(`[lalamove] ${status} ${codigo ?? "?"}: ${msg ?? ""}`);
  if (codigo && ERROS[codigo]) return ERROS[codigo];
  if (status === 401) return "A Lalamove recusou as credenciais. Veja em Configurações.";
  if (status >= 500) return "A Lalamove está instável no momento. Tente novamente em instantes.";
  return msg ? `A Lalamove recusou: ${msg}` : `A Lalamove recusou a solicitação (${codigo ?? status}).`;
}

/** Chamada assinada. Devolve `data` (undefined no 204) ou lança ErroLalamove. */
export async function chamarLalamove<T>(
  env: Env,
  modo: ModoOperacao,
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: unknown
): Promise<T> {
  const cred = credenciaisLalamove(env, modo);
  const path = `/v3${caminho}`;
  const body = corpo !== undefined ? JSON.stringify({ data: corpo }) : "";
  const ts = Date.now().toString();
  const assinatura = await hmacSha256Hex(cred.apiSecret, `${ts}\r\n${metodo}\r\n${path}\r\n\r\n${body}`);

  const res = await fetch(`${cred.baseUrl}${path}`, {
    method: metodo,
    headers: {
      Authorization: `hmac ${cred.apiKey}:${ts}:${assinatura}`,
      Market: "BR",
      "Request-ID": crypto.randomUUID(),
      "Content-Type": "application/json",
    },
    body: body || undefined,
  });
  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: Array<{ id?: string; message?: string; detail?: string }>;
  } | null;
  if (!res.ok || !json) {
    const e = json?.errors?.[0];
    const codigo = e?.id ?? null;
    throw new ErroLalamove(traduzir(res.status, codigo, e?.message ?? e?.detail), codigo, res.status);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** E.164 com DDI: "(31) 98442-8765" -> "+5531984428765". */
function telefoneLalamove(tel: string): string {
  const d = tel.replace(/\D/g, "");
  return `+${d.startsWith("55") && d.length >= 12 ? d : `55${d}`}`;
}

function enderecoLoja(env: Env): string {
  return enderecoFormatado({
    logradouro: env.RESTAURANTE_LOGRADOURO || "",
    numero: env.RESTAURANTE_NUMERO || "S/N",
    complemento: env.RESTAURANTE_COMPLEMENTO || undefined,
    bairro: env.RESTAURANTE_BAIRRO || "",
    cidade: env.RESTAURANTE_CIDADE || "",
    uf: env.RESTAURANTE_UF || "",
    cep: env.RESTAURANTE_CEP || "",
  });
}

/** Mesma regra dos outros parceiros: pedido de teste nunca chega ao cliente real. */
function comTelefoneDeTeste(env: Env, pedido: Pedido, modo: ModoOperacao): Pedido {
  const tel = env.TELEFONE_TESTE?.trim();
  if (!tel || (modo !== "teste" && !pedido.teste)) return pedido;
  return { ...pedido, cliente: { ...pedido.cliente, telefone: tel } };
}

// ---------------------------------------------------------------------------
// SALDO DA CARTEIRA
//
// A API não tem consulta de saldo. Quem informa é o webhook
// WALLET_BALANCE_CHANGED, a cada débito, estorno ou recarga — o Hub guarda o
// último valor na tabela `config`, um por modo. Antes do primeiro evento o
// saldo é desconhecido (null) e nada é bloqueado.
// ---------------------------------------------------------------------------

/** Abaixo disto a cotação avisa "saldo baixo". */
export const SALDO_BAIXO = 50;

const chaveSaldo = (modo: ModoOperacao) => `lalamove_saldo_${modo}`;

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function saldoLalamove(
  env: Env,
  modo: ModoOperacao
): Promise<{ valor: number; em: string } | null> {
  const l = await env.DB.prepare(`SELECT valor, atualizado_em FROM config WHERE chave = ?1`)
    .bind(chaveSaldo(modo))
    .first<{ valor: string; atualizado_em: string }>()
    .catch(() => null);
  const valor = Number(l?.valor);
  return l && Number.isFinite(valor) ? { valor, em: l.atualizado_em } : null;
}

async function gravarSaldo(env: Env, modo: ModoOperacao, valor: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO config (chave, valor, atualizado_em, atualizado_por)
     VALUES (?1, ?2, ?3, 'lalamove')
     ON CONFLICT(chave) DO UPDATE SET valor = ?2, atualizado_em = ?3, atualizado_por = 'lalamove'`
  )
    .bind(chaveSaldo(modo), String(valor), new Date().toISOString())
    .run();
}

// ---------------------------------------------------------------------------
// COTAÇÃO
// ---------------------------------------------------------------------------

interface CotacaoLalamove {
  quotationId: string;
  expiresAt?: string;
  stops: Array<{ stopId: string }>;
  priceBreakdown: { total: string; currency?: string };
  distance?: { value: string; unit: string };
}

async function cotacaoLalamove(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao,
  veiculo: PreferenciaVeiculo
): Promise<CotacaoLalamove> {
  const { lat, lng } = pedido.endereco;
  // A Lalamove exige coordenadas nas duas pontas; não geocodifica sozinha.
  if (lat == null || lng == null) {
    throw new ErroLalamove("Endereço sem coordenadas: a Lalamove não consegue cotar.", null, 0);
  }
  return chamarLalamove<CotacaoLalamove>(env, modo, "POST", "/quotations", {
    serviceType: SERVICO[veiculo],
    language: "pt_BR",
    stops: [
      {
        coordinates: { lat: env.RESTAURANTE_LAT, lng: env.RESTAURANTE_LNG },
        address: enderecoLoja(env),
      },
      {
        coordinates: { lat: String(lat), lng: String(lng) },
        address: enderecoFormatado(pedido.endereco),
      },
    ],
  });
}

/**
 * Cota moto e carro e fica com o mais barato.
 *
 * Em produção a moto leva uma sobretaxa dinâmica (`surcharge`, horário de
 * pico) que o carro não teve: em 06/11/2026 às 17h30, 400 m saíam R$ 17,50
 * de moto (7,00 + 10,50 de sobretaxa) e R$ 9,00 de carro. O sandbox não tem
 * sobretaxa, por isso a diferença não apareceu nos testes. Empate fica com a
 * moto, que é o veículo normal de comida.
 */
async function cotacaoMaisBarata(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao
): Promise<{ q: CotacaoLalamove; veiculo: PreferenciaVeiculo }> {
  const [moto, carro] = await Promise.allSettled([
    cotacaoLalamove(env, pedido, modo, "moto"),
    cotacaoLalamove(env, pedido, modo, "carro"),
  ]);
  if (moto.status === "rejected" && carro.status === "rejected") throw moto.reason;
  if (carro.status === "rejected") return { q: (moto as PromiseFulfilledResult<CotacaoLalamove>).value, veiculo: "moto" };
  if (moto.status === "rejected") return { q: carro.value, veiculo: "carro" };
  return Number(carro.value.priceBreakdown.total) < Number(moto.value.priceBreakdown.total)
    ? { q: carro.value, veiculo: "carro" }
    : { q: moto.value, veiculo: "moto" };
}

export async function cotarLalamove(env: Env, pedido: Pedido, modo: ModoOperacao): Promise<Cotacao> {
  const base: Cotacao = {
    provider: "lalamove",
    nome: "Lalamove",
    disponivel: false,
    preco: null,
    moeda: "BRL",
    etaMinutos: null,
    quoteId: null,
    expiraEm: null,
  };

  const cred = credenciaisLalamove(env, modo);
  if (!cred.apiKey || !cred.apiSecret) {
    return {
      ...base,
      erro:
        modo === "producao"
          ? "Lalamove sem chaves de produção. Use o modo teste."
          : "Lalamove não configurada para o modo teste. Veja em Configurações.",
    };
  }

  try {
    const [{ q, veiculo }, saldo] = await Promise.all([cotacaoMaisBarata(env, pedido, modo), saldoLalamove(env, modo)]);
    const km = q.distance ? Number(q.distance.value) / (q.distance.unit === "m" ? 1000 : 1) : null;
    const preco = Number(q.priceBreakdown.total);
    // A carteira é pré-paga: sem saldo a Lalamove recusa o pedido (402). Avisar
    // na cotação poupa o clique em Despachar que ia falhar.
    if (saldo && saldo.valor < preco) {
      return { ...base, preco, erro: `Saldo insuficiente na carteira da Lalamove (${reais(saldo.valor)}). Recarregue no Partner Portal.` };
    }
    return {
      ...base,
      disponivel: true,
      preco,
      quoteId: q.quotationId,
      expiraEm: q.expiresAt ?? null,
      // A Lalamove não devolve tempo na cotação. Estimativa do Hub: a mesma
      // régua do motoboy sem faixa fixa, sobre a distância da rota deles.
      etaMinutos: km != null && Number.isFinite(km) ? Math.round(ETA_BASE_MIN + km * ETA_MIN_POR_KM) : null,
      detalhe: [
        km != null && Number.isFinite(km) ? `${km.toFixed(2)} km · ${veiculo} · tempo estimado` : veiculo,
        saldo && saldo.valor < SALDO_BAIXO ? `saldo baixo: ${reais(saldo.valor)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  } catch (e) {
    return { ...base, erro: e instanceof Error ? e.message : "Falha ao cotar na Lalamove." };
  }
}

// ---------------------------------------------------------------------------
// DESPACHO
// ---------------------------------------------------------------------------

interface PedidoLalamove {
  orderId: string;
  status?: string;
  shareLink?: string;
  driverId?: string;
  priceBreakdown?: { total?: string };
  /** O código de entrega (PIN) fica na parada do cliente; vazio se a conta não usa. */
  stops?: Array<{ deliveryCode?: { value?: string } }>;
}

const codigoEntrega = (o: PedidoLalamove) => o.stops?.[1]?.deliveryCode?.value || null;

export async function despacharLalamove(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao,
  _veiculo: PreferenciaVeiculo = "moto",
  sequencia = 1
): Promise<ResultadoDespacho> {
  pedido = comTelefoneDeTeste(env, pedido, modo);

  // Recota sempre: a do card vence em 5 minutos, e o pedido precisa dos
  // stopId dela. O preço é corrigido NA cotação recebida, que é de onde o
  // /api/despachar tira o custo gravado no histórico. O veículo pedido pelo
  // painel é ignorado: vai o mais barato agora, como no card.
  const { q, veiculo } = await cotacaoMaisBarata(env, pedido, modo);
  cotacao.preco = Number(q.priceBreakdown.total);

  const remarks = [
    `Pedido ${pedido.numeroExterno ?? pedido.id}`,
    env.RESTAURANTE_INSTRUCOES,
    observacaoParaEntregador(pedido),
  ]
    .filter(Boolean)
    .join("\r\n")
    .slice(0, 1500);

  const o = await chamarLalamove<PedidoLalamove>(env, modo, "POST", "/orders", {
    quotationId: q.quotationId,
    sender: {
      stopId: q.stops[0].stopId,
      name: env.RESTAURANTE_NOME || "Loja",
      phone: telefoneLalamove(env.RESTAURANTE_TELEFONE || ""),
    },
    recipients: [
      {
        stopId: q.stops[1].stopId,
        name: pedido.cliente.nome,
        phone: telefoneLalamove(pedido.cliente.telefone),
        remarks,
      },
    ],
    isPODEnabled: false,
    metadata: { idPedido: pedido.id, sequencia: String(sequencia) },
  });

  return {
    provider: "lalamove",
    deliveryId: o.orderId,
    trackingUrl: o.shareLink || null,
    status: "pending",
    veiculoPreferido: veiculo,
    codigoEntrega: codigoEntrega(o),
  };
}

// ---------------------------------------------------------------------------
// CANCELAMENTO
// ---------------------------------------------------------------------------

export async function cancelarLalamove(
  env: Env,
  deliveryId: string,
  modo: ModoOperacao
): Promise<{ ok: boolean; erro?: string }> {
  try {
    await chamarLalamove(env, modo, "DELETE", `/orders/${encodeURIComponent(deliveryId)}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao cancelar na Lalamove." };
  }
}

// ---------------------------------------------------------------------------
// ACOMPANHAMENTO — status da Lalamove -> vocabulário do Hub (o do Uber)
// ---------------------------------------------------------------------------

export const STATUS_LALAMOVE: Record<string, StatusEntregaUber> = {
  ASSIGNING_DRIVER: "pending",
  ON_GOING: "pickup",
  PICKED_UP: "dropoff",
  COMPLETED: "delivered",
  CANCELED: "canceled",
  // Nenhum entregador aceitou, ou a Lalamove recusou: a corrida morreu e o
  // atendente precisa ver "cancelada" para escolher outra.
  REJECTED: "canceled",
  EXPIRED: "canceled",
};

interface MotoristaLalamove {
  name?: string;
  phone?: string;
  plateNumber?: string;
  coordinates?: { lat?: string; lng?: string };
}

/** Lê o pedido na Lalamove e aplica o estado na entrega do Hub. */
export async function sincronizarLalamove(
  env: Env,
  idPedido: string,
  modo: ModoOperacao
): Promise<{ ok: boolean; status?: string | null; erro?: string }> {
  const l = await env.DB.prepare(
    `SELECT sequencia, delivery_id_externo, status_ao_vivo, status
       FROM deliveries
      WHERE id_pedido = ?1 AND plataforma_escolhida = 'lalamove'
      ORDER BY sequencia DESC LIMIT 1`
  )
    .bind(idPedido)
    .first<{ sequencia: number; delivery_id_externo: string | null; status_ao_vivo: string | null; status: string | null }>();
  if (!l?.delivery_id_externo) return { ok: false, erro: "entrega da Lalamove não encontrada" };

  const id = encodeURIComponent(l.delivery_id_externo);
  let o: PedidoLalamove;
  try {
    o = await chamarLalamove<PedidoLalamove>(env, modo, "GET", `/orders/${id}`);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  // O motorista só pode ser lido da designação até o fim (403 fora disso).
  let m: MotoristaLalamove | null = null;
  if (o.driverId) {
    m = await chamarLalamove<MotoristaLalamove>(env, modo, "GET", `/orders/${id}/drivers/${encodeURIComponent(o.driverId)}`).catch(
      () => null
    );
  }

  const atual = l.status_ao_vivo ?? l.status;
  const candidato = o.status ? STATUS_LALAMOVE[o.status] ?? null : null;
  const status =
    candidato && candidato !== atual && ETAPA[candidato] >= (ETAPA[atual ?? ""] ?? -1) ? candidato : null;
  const lat = Number(m?.coordinates?.lat);
  const lng = Number(m?.coordinates?.lng);

  await env.DB.prepare(
    `UPDATE deliveries SET
       status_ao_vivo       = COALESCE(?2, status_ao_vivo),
       status               = COALESCE(?2, status),
       status_atualizado_em = CASE WHEN ?2 IS NULL THEN status_atualizado_em ELSE ?3 END,
       tracking_url         = COALESCE(?4, tracking_url),
       courier_nome         = COALESCE(?5, courier_nome),
       courier_telefone     = COALESCE(?6, courier_telefone),
       courier_placa        = COALESCE(?7, courier_placa),
       courier_lat          = COALESCE(?8, courier_lat),
       courier_lng          = COALESCE(?9, courier_lng),
       live_mode            = ?10,
       codigo_entrega       = COALESCE(codigo_entrega, ?12)
     WHERE id_pedido = ?1 AND sequencia = ?11`
  )
    .bind(
      idPedido,
      status,
      new Date().toISOString(),
      o.shareLink || null,
      m?.name || null,
      m?.phone || null,
      m?.plateNumber || null,
      Number.isFinite(lat) && lat !== 0 ? lat : null,
      Number.isFinite(lng) && lng !== 0 ? lng : null,
      modo === "producao" ? 1 : 0,
      l.sequencia,
      codigoEntrega(o)
    )
    .run();

  return { ok: true, status: status ?? atual };
}

/** Entregas da Lalamove ainda em andamento — para a tarefa agendada. */
export async function sincronizarAbertasLalamove(env: Env, modo: ModoOperacao): Promise<void> {
  const corte = new Date(Date.now() - 86_400_000).toISOString();
  const r = await env.DB.prepare(
    `SELECT id_pedido FROM deliveries
      WHERE plataforma_escolhida = 'lalamove'
        AND data_criacao >= ?1
        AND COALESCE(status_ao_vivo, status) NOT IN ('delivered', 'canceled', 'returned')
      ORDER BY data_criacao DESC LIMIT 20`
  )
    .bind(corte)
    .all<{ id_pedido: string }>();

  for (const { id_pedido } of r.results ?? []) {
    const s = await sincronizarLalamove(env, id_pedido, modo);
    if (!s.ok) console.warn(`[lalamove-sync] ${id_pedido}: ${s.erro}`);
  }
}

// ---------------------------------------------------------------------------
// WEBHOOK
//
// URL cadastrada pela própria API (PATCH /v3/webhook), uma por conta: a de
// sandbox aponta para o hml. Não há chave separada: a assinatura usa o mesmo
// API secret das chamadas (ver assinaturaValidaLalamove). Formato capturado
// de eventos reais do sandbox:
//
//   { apiKey, timestamp (s), signature, eventId, eventType, eventVersion,
//     data: { order: { orderId, status, previousStatus, driverId, shareLink,
//             metadata? }, updatedAt } }
//
// O cadastro da URL manda um POST de corpo VAZIO e exige 200.
// ---------------------------------------------------------------------------

/** Eventos que mexem numa entrega. WALLET_BALANCE_CHANGED etc. são ignorados. */
const EVENTOS_DE_PEDIDO = new Set([
  "ORDER_STATUS_CHANGED",
  "DRIVER_ASSIGNED",
  "ORDER_REPLACED",
  "ORDER_EDITED",
  "ORDER_AMOUNT_CHANGED",
  "DELIVERY_CODE_STATUS_CHANGED",
]);

interface EventoLalamove {
  apiKey?: string;
  timestamp?: number;
  signature?: string;
  eventId?: string;
  eventType?: string;
  data?: {
    order?: {
      orderId?: string;
      status?: string;
      metadata?: { idPedido?: string; sequencia?: string };
    };
    balance?: { amount?: string; currency?: string };
  };
}

export type RespostaWebhookLalamove =
  | { http: 200; aplicado: boolean; motivo?: string }
  | { http: 400 | 401; motivo: string };

export async function processarWebhookLalamove(
  env: Env,
  path: string,
  corpoBruto: string
): Promise<RespostaWebhookLalamove> {
  if (!corpoBruto.trim()) return { http: 200, aplicado: false, motivo: "verificação da URL" };

  let ev: EventoLalamove;
  try {
    ev = JSON.parse(corpoBruto) as EventoLalamove;
  } catch {
    return { http: 400, motivo: "corpo não é JSON" };
  }

  // A apiKey diz de qual conta (e modo) é o evento; o secret dela confere.
  const modo = (["teste", "producao"] as const).find((m) => {
    const k = credenciaisLalamove(env, m).apiKey;
    return !!k && k === ev.apiKey;
  });
  if (!modo) return { http: 401, motivo: "apiKey desconhecida" };
  const valida = await assinaturaValidaLalamove(
    credenciaisLalamove(env, modo).apiSecret,
    path,
    corpoBruto,
    ev.timestamp,
    ev.signature
  );
  if (!valida) return { http: 401, motivo: "assinatura inválida" };

  const tipo = ev.eventType ?? "";
  if (tipo === "WALLET_BALANCE_CHANGED") {
    const valor = Number(ev.data?.balance?.amount);
    if (!Number.isFinite(valor)) return { http: 200, aplicado: false, motivo: "saldo sem valor" };
    // Eventos fora de ordem: o mais recente vence pela hora de chegada. A
    // Lalamove manda um por movimento, segundos entre eles.
    await gravarSaldo(env, modo, valor);
    return { http: 200, aplicado: true };
  }
  const o = ev.data?.order;
  if (!EVENTOS_DE_PEDIDO.has(tipo) || !o?.orderId) return { http: 200, aplicado: false, motivo: "ignorado" };

  // Acha a entrega pelo orderId. Se não achar e o pedido trouxer o metadata
  // que o Hub manda no despacho, é uma SUBSTITUIÇÃO (ORDER_REPLACED: o
  // suporte da Lalamove troca o pedido e o orderId muda): o id guardado passa
  // a ser o novo, senão a entrega fica órfã.
  let l = await env.DB.prepare(
    `SELECT id_pedido FROM deliveries
      WHERE delivery_id_externo = ?1 AND plataforma_escolhida = 'lalamove' LIMIT 1`
  )
    .bind(o.orderId)
    .first<{ id_pedido: string }>();

  const meta = o.metadata;
  if (!l && meta?.idPedido && meta.sequencia) {
    const r = await env.DB.prepare(
      `UPDATE deliveries SET delivery_id_externo = ?3
        WHERE id_pedido = ?1 AND sequencia = ?2 AND plataforma_escolhida = 'lalamove'`
    )
      .bind(meta.idPedido, Number(meta.sequencia), o.orderId)
      .run();
    if (r.meta.changes > 0) {
      console.log(`[lalamove-webhook] pedido ${meta.idPedido} substituído: novo orderId ${o.orderId}`);
      await env.DB.prepare(
        `UPDATE pedidos SET despacho = json_set(despacho, '$.deliveryId', ?2)
          WHERE id = ?1 AND json_extract(despacho, '$.provider') = 'lalamove'`
      )
        .bind(meta.idPedido, o.orderId)
        .run();
      l = { id_pedido: meta.idPedido };
    }
  }
  if (!l) {
    // Sem metadata não há como ligar a entrega. O corpo vai para o log, para
    // descobrir o formato do evento se isso acontecer.
    console.warn(`[lalamove-webhook] ${tipo} de pedido desconhecido: ${corpoBruto.slice(0, 2000)}`);
    return { http: 200, aplicado: false, motivo: "entrega não é deste Hub" };
  }

  const { novo } = await registrarEvento(env, {
    id: `lalamove:${ev.eventId ?? `${tipo}:${o.orderId}:${ev.timestamp ?? ""}`}`,
    provider: "lalamove",
    kind: tipo,
    status: o.status ? STATUS_LALAMOVE[o.status] ?? null : null,
    deliveryIdExterno: o.orderId,
    criadoEmParceiro: ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : null,
    liveMode: modo === "producao",
    payload: corpoBruto,
  });
  if (!novo) return { http: 200, aplicado: false, motivo: "duplicado" };

  const s = await sincronizarLalamove(env, l.id_pedido, modo);
  if (!s.ok) throw new Error(s.erro);
  return { http: 200, aplicado: true };
}
