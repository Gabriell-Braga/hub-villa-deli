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
import { hmacSha256Hex } from "../lib/assinatura";
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
// Acompanhamento sem webhook por enquanto: a tela do pedido e a tarefa de 5
// em 5 minutos consultam o detalhe, como a 99 sem chave de assinatura.
// Validado no sandbox em 06/11/2026: cotação, pedido, detalhe e cancelamento.
// ponytail: sem webhook nem ORDER_REPLACED; adicionar quando o atraso de até
// 20 s (tela) / 5 min (cron) atrapalhar a operação.
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
    const q = await cotacaoLalamove(env, pedido, modo, "moto");
    const km = q.distance ? Number(q.distance.value) / (q.distance.unit === "m" ? 1000 : 1) : null;
    return {
      ...base,
      disponivel: true,
      preco: Number(q.priceBreakdown.total),
      quoteId: q.quotationId,
      expiraEm: q.expiresAt ?? null,
      detalhe: km != null && Number.isFinite(km) ? `${km.toFixed(2)} km · moto` : "moto",
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
  veiculo: PreferenciaVeiculo = "moto",
  sequencia = 1
): Promise<ResultadoDespacho> {
  pedido = comTelefoneDeTeste(env, pedido, modo);

  // Recota sempre: a do card vence em 5 minutos, e o pedido precisa dos
  // stopId dela. O preço é corrigido NA cotação recebida, que é de onde o
  // /api/despachar tira o custo gravado no histórico.
  const q = await cotacaoLalamove(env, pedido, modo, veiculo);
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
