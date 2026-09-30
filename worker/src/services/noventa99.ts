import type {
  Cotacao,
  Env,
  ModoOperacao,
  Pedido,
  PreferenciaVeiculo,
  ResultadoDespacho,
  StatusEntregaUber,
} from "../types";
import { get99Token } from "./tokens";
import { credenciais99 } from "../config/ambiente";
import { observacaoParaEntregador } from "../lib/observacao-entregador";

// ---------------------------------------------------------------------------
// 99Entrega (API para empresas)
// Docs: https://entrega-api.99app.com/doc/index.html
//
//   token:     POST /oauth/v1/token               (client_credentials, scope entrega.order)
//   cotação:   POST /entrega/v1/order/estimate
//   despacho:  POST /entrega/v1/order/create
//   cancelar:  POST /entrega/v1/order/cancel
//   detalhe:   GET  /entrega/v1/order/detail?order_id=|external_order_id=
//
// Mesmo host para teste e produção: o client_id decide o ambiente. No teste o
// pedido é simulado — nenhum entregador aceita. Quem avança o status é a
// "Ferramenta de depuração" do Modo de desenvolvedor, colando o order_id que
// aparece no card da entrega.
//
// Erro de negócio vem com HTTP 200 e `errno` diferente de zero. Toda chamada
// passa por `chamar`, que transforma isso em erro de verdade.
//
// REATRIBUIÇÃO: se o entregador desistir, a 99 pode criar OUTRO pedido, com
// order_id novo e o mesmo external_order_id. Por isso o external_order_id é a
// chave estável (cancelar e consultar usam ele) e o order_id guardado no Hub é
// atualizado quando isso acontece (ver sincronizar99).
// ---------------------------------------------------------------------------

/** Códigos de errno da tabela oficial, em linguagem de balcão. */
const ERROS: Record<number, string> = {
  1001: "A 99 recusou os dados enviados.",
  3004: "A 99 não oferece este tipo de veículo aqui.",
  3005: "Endereço fora da área de entrega da 99.",
  3006: "A 99 não atende esta região.",
  3007: "A 99 recusou as informações do pedido.",
  3009: "A 99 não conseguiu criar o pedido. Tente novamente.",
  3010: "Fora do horário de funcionamento da 99.",
  4001: "Esta entrega não pode mais ser cancelada na 99: o entregador provavelmente já coletou o pedido.",
  4002: "Cotação da 99 vencida. Clique em Recotar.",
  6002: "A 99 recusou as informações do pedido.",
  6004: "Limite de crédito da conta na 99 insuficiente.",
  6005: "A conta da 99 tem fatura em atraso.",
  6101: "O endereço do pedido não bate com o da cotação da 99. Clique em Recotar.",
  6102: "Este pedido já foi enviado à 99.",
  6103: "Tipo de veículo inválido para a 99.",
  6104: "A 99 recusou o endereço de coleta ou de entrega.",
  6105: "Já há um envio deste pedido em andamento na 99. Aguarde alguns segundos.",
  6201: "A 99 não encontrou este pedido.",
  6202: "A cidade da loja está fora da área de operação da 99.",
  6203: "Fora do horário de funcionamento da 99.",
  6204: "A corrida excede o limite de crédito da conta na 99, ou há fatura vencida.",
};

export class Erro99 extends Error {
  constructor(
    message: string,
    readonly errno: number | null
  ) {
    super(message);
  }
}

function traduzirErro99(status: number, errno: number | null, errmsg: string | undefined): string {
  console.warn(`[99] ${status} errno=${errno ?? "?"}: ${errmsg ?? ""}`);
  if (errno != null && ERROS[errno]) {
    // 1001 é genérico ("params error: X is required"); o detalhe diz o quê.
    return errno === 1001 && errmsg ? `A 99 recusou: ${errmsg}` : ERROS[errno];
  }
  if (status === 401) return "A 99 recusou as credenciais. Veja em Configurações.";
  if (status >= 500) return "A 99 está instável no momento. Tente novamente em instantes.";
  return errmsg ? `A 99 recusou: ${errmsg}` : `A 99 recusou a solicitação (código ${errno ?? status}).`;
}

/** Chamada autenticada. Devolve `data` ou lança Erro99 com a mensagem traduzida. */
async function chamar<T>(
  env: Env,
  modo: ModoOperacao,
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: unknown
): Promise<T> {
  const cred = credenciais99(env, modo);
  const token = await get99Token(env, modo);
  const res = await fetch(`${cred.baseUrl}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });

  const json = (await res.json().catch(() => null)) as {
    errno?: number;
    errmsg?: string;
    data?: T;
  } | null;

  if (!res.ok || !json || json.errno !== 0) {
    const errno = typeof json?.errno === "number" ? json.errno : null;
    throw new Erro99(traduzirErro99(res.status, errno, json?.errmsg), errno);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Montagem dos endereços e contatos
// ---------------------------------------------------------------------------

function veiculo99(v: PreferenciaVeiculo | undefined): "entrega_moto" | "entrega_car" {
  return v === "carro" ? "entrega_car" : "entrega_moto";
}

/** "+5531984428765" -> "31984428765". A 99 recusa o DDI. */
function telefone99(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
}

function coleta(env: Env) {
  const lat = parseFloat(env.RESTAURANTE_LAT);
  const lng = parseFloat(env.RESTAURANTE_LNG);
  return {
    ...(Number.isFinite(lat) && Number.isFinite(lng) ? { location: { lat, lng } } : {}),
    structured_address: {
      street: env.RESTAURANTE_LOGRADOURO || "",
      number: env.RESTAURANTE_NUMERO || "S/N",
      ...(env.RESTAURANTE_COMPLEMENTO ? { complement: env.RESTAURANTE_COMPLEMENTO } : {}),
      neighborhood: env.RESTAURANTE_BAIRRO || "",
      city: env.RESTAURANTE_CIDADE || "",
      state: env.RESTAURANTE_UF || "",
      country: "Brasil",
      cep: env.RESTAURANTE_CEP || "",
    },
  };
}

function entrega(pedido: Pedido) {
  const e = pedido.endereco;
  return {
    ...(e.lat != null && e.lng != null ? { location: { lat: e.lat, lng: e.lng } } : {}),
    structured_address: {
      street: e.logradouro,
      number: e.numero || "S/N",
      ...(e.complemento ? { complement: e.complemento } : {}),
      neighborhood: e.bairro,
      city: e.cidade,
      state: e.uf,
      country: "Brasil",
      cep: e.cep,
    },
  };
}

/** Mesma regra do Uber e do iFood: pedido de teste nunca chega ao cliente real. */
function comTelefoneDeTeste(env: Env, pedido: Pedido, modo: ModoOperacao): Pedido {
  const tel = env.TELEFONE_TESTE?.trim();
  if (!tel || (modo !== "teste" && !pedido.teste)) return pedido;
  return { ...pedido, cliente: { ...pedido.cliente, telefone: tel } };
}

// ---------------------------------------------------------------------------
// COTAÇÃO
// ---------------------------------------------------------------------------

interface Estimativa99 {
  id: string;
  /** centavos */
  fee: number;
  /** metros */
  delivery_distance?: number;
  /** minutos */
  delivery_duration?: number;
  /** epoch em segundos */
  expires_time?: number | string;
}

async function estimar(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao,
  veiculo: PreferenciaVeiculo
): Promise<Estimativa99> {
  return chamar<Estimativa99>(env, modo, "POST", "/entrega/v1/order/estimate", {
    vehicle_type: veiculo99(veiculo),
    pickup_info: coleta(env),
    dropoff_info: entrega(pedido),
    return_type: 1,
  });
}

function epochParaIso(v: number | string | undefined): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

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

  const cred = credenciais99(env, modo);
  if (!cred.clientId || !cred.clientSecret) {
    return {
      ...base,
      erro:
        modo === "producao"
          ? "Aguardando liberação do ambiente de produção da 99. Use o modo teste."
          : "99 não configurada para o modo teste. Veja em Configurações.",
    };
  }

  try {
    // O card mostra o preço de MOTO, que é o caso normal de comida. O carro
    // tem preço próprio na 99 e é recotado no despacho, se for o escolhido.
    const q = await estimar(env, pedido, modo, "moto");
    return {
      ...base,
      disponivel: true,
      preco: Math.round(q.fee) / 100,
      etaMinutos: q.delivery_duration != null ? Number(q.delivery_duration) : null,
      quoteId: q.id,
      expiraEm: epochParaIso(q.expires_time),
      detalhe:
        q.delivery_distance != null
          ? `${(Number(q.delivery_distance) / 1000).toFixed(2)} km · moto`
          : "moto",
    };
  } catch (e) {
    return { ...base, erro: e instanceof Error ? e.message : "Falha ao cotar na 99." };
  }
}

// ---------------------------------------------------------------------------
// DESPACHO
// ---------------------------------------------------------------------------

/**
 * external_order_id: o id do pedido + a tentativa. A 99 garante no máximo UM
 * pedido por external_order_id, então um clique repetido (ou timeout de rede
 * seguido de nova tentativa) devolve o mesmo pedido em vez de criar outro.
 * A tentativa entra para o reenvio conseguir criar uma corrida nova.
 */
export function idExterno99(idPedido: string, sequencia: number): string {
  return `${idPedido}-${sequencia}`;
}

interface Detalhe99 {
  order_id: string;
  new_order_id?: string;
  external_order_id?: string;
  vehicle_type?: string;
  status?: string;
  tracking_link?: string;
  driver_info?: {
    name?: string;
    phone?: string;
    vehicle_info?: { plate_no?: string; color?: string };
    location?: { lat?: number; lng?: number };
  };
  verify_info?: { pickup_verify_code?: string; dropoff_verify_code?: string };
  price_info?: { fee?: number };
}

async function detalhe99(
  env: Env,
  modo: ModoOperacao,
  chave: { orderId?: string; externalOrderId?: string }
): Promise<Detalhe99> {
  const q = chave.externalOrderId
    ? `external_order_id=${encodeURIComponent(chave.externalOrderId)}`
    : `order_id=${encodeURIComponent(chave.orderId ?? "")}`;
  return chamar<Detalhe99>(env, modo, "GET", `/entrega/v1/order/detail?${q}`);
}

export async function despachar99(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao,
  veiculo: PreferenciaVeiculo = "moto",
  sequencia = 1
): Promise<ResultadoDespacho> {
  if (!cotacao.quoteId) throw new Error("Cotação da 99 sem identificador. Cote novamente.");

  pedido = comTelefoneDeTeste(env, pedido, modo);
  const externalOrderId = idExterno99(pedido.id, sequencia);

  // A cotação do card é de moto. Carro tem preço e estimate_id próprios.
  // O preço é corrigido NA cotação recebida: é dela que o /api/despachar tira
  // o custo gravado no histórico, logo depois deste retorno.
  let estimateId = cotacao.quoteId;
  if (veiculo === "carro") {
    const carro = await estimar(env, pedido, modo, "carro");
    estimateId = carro.id;
    cotacao.preco = Math.round(carro.fee) / 100;
  }

  const obs = observacaoParaEntregador(pedido);
  const corpo = (estimate_id: string) => ({
    vehicle_type: veiculo99(veiculo),
    external_order_id: externalOrderId,
    estimate_id,
    pickup_info: {
      ...coleta(env),
      name: env.RESTAURANTE_NOME || "Loja",
      phone: telefone99(env.RESTAURANTE_TELEFONE || ""),
      // Visível ao entregador. Limite de 127 caracteres.
      note: [`Pedido ${pedido.numeroExterno ?? pedido.id}`, env.RESTAURANTE_INSTRUCOES]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 127),
    },
    dropoff_info: {
      ...entrega(pedido),
      name: pedido.cliente.nome,
      phone: telefone99(pedido.cliente.telefone),
      note: obs.slice(0, 127),
    },
    package_info: { package_type: "food", package_weight: "5kg" },
    // Código na COLETA desligado: a 99 mostraria um código que só o Hub
    // conhece, e o balcão não tem onde vê-lo. O código na ENTREGA fica — é o
    // que impede entregar à pessoa errada, e vai no card como o PIN do Uber.
    need_pickup_code: false,
    need_dropoff_code: true,
    return_type: 1,
  });

  let criado: { order_id: string };
  try {
    criado = await chamar<{ order_id: string }>(env, modo, "POST", "/entrega/v1/order/create", corpo(estimateId));
  } catch (e) {
    // Estimativa vencida (4002) ou endereço divergente (6101): recota na hora
    // e tenta uma vez. O preço pode mudar alguns centavos — o valor guardado
    // no histórico é corrigido pelo detalhe logo abaixo.
    if (!(e instanceof Erro99) || (e.errno !== 4002 && e.errno !== 6101)) throw e;
    const nova = await estimar(env, pedido, modo, veiculo);
    criado = await chamar<{ order_id: string }>(env, modo, "POST", "/entrega/v1/order/create", corpo(nova.id));
  }

  // O create só devolve o id. Código de entrega e link vêm do detalhe; se ele
  // falhar, o despacho já aconteceu e não pode ser dado como erro.
  let d: Detalhe99 | null = null;
  try {
    d = await detalhe99(env, modo, { orderId: criado.order_id });
  } catch (e) {
    console.warn(`[99] detalhe após criar falhou: ${e instanceof Error ? e.message : e}`);
  }

  return {
    provider: "99",
    deliveryId: criado.order_id,
    trackingUrl: d?.tracking_link || null,
    status: "pending",
    veiculoPreferido: veiculo,
    codigoEntrega: d?.verify_info?.dropoff_verify_code || null,
  };
}

// ---------------------------------------------------------------------------
// CANCELAMENTO
// ---------------------------------------------------------------------------

/**
 * Cancela pelo external_order_id: depois de uma reatribuição, é ele que aponta
 * para o pedido vivo. O order_id guardado pode ser o antigo, já morto.
 */
export async function cancelar99(
  env: Env,
  idPedido: string,
  deliveryId: string,
  modo: ModoOperacao
): Promise<{ ok: boolean; erro?: string }> {
  const l = await env.DB.prepare(
    `SELECT sequencia FROM deliveries WHERE id_pedido = ?1 AND delivery_id_externo = ?2 LIMIT 1`
  )
    .bind(idPedido, deliveryId)
    .first<{ sequencia: number }>();

  try {
    await chamar(env, modo, "POST", "/entrega/v1/order/cancel", {
      external_order_id: l ? idExterno99(idPedido, l.sequencia) : "",
      order_id: deliveryId,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao cancelar na 99." };
  }
}

// ---------------------------------------------------------------------------
// ACOMPANHAMENTO — status da 99 -> vocabulário do Hub (o do Uber)
// ---------------------------------------------------------------------------

/** Status do detalhe do pedido. */
const STATUS_DETALHE: Record<string, StatusEntregaUber> = {
  finding: "pending",
  waiting: "pickup",
  delivering: "dropoff",
  completed: "delivered",
  canceled: "canceled",
  // Nenhum entregador aceitou a tempo, ou o atendimento encerrou. A corrida
  // morreu: o atendente precisa ver "cancelada" para escolher outra.
  closed: "canceled",
};

/** Eventos do webhook. `null` = não muda o status sozinho. */
export const STATUS_EVENTO_99: Record<string, StatusEntregaUber | null> = {
  DriverAccepted: "pickup",
  DriverArrived: "at_pickup",
  DriverBeginCharge: "dropoff",
  // Entregador desistiu. Com reatribuição, a busca recomeça no pedido novo.
  DriverCanceled: "pending",
  BroadcastTimeout: "canceled",
  OrderCompleted: "delivered",
  OrderClosed: "canceled",
};

/** Mesma régua do iFood: o status só avança; finais empatam no topo. */
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

function veiculoLegivel(tipo: string | undefined, cor: string | undefined): string | null {
  const t = tipo === "entrega_car" ? "Carro" : tipo === "entrega_moto" ? "Moto" : null;
  if (!t) return null;
  return cor ? `${t} ${cor.toLowerCase()}` : t;
}

/**
 * Lê o pedido na 99 e aplica o estado na entrega do Hub.
 *
 * É o caminho ÚNICO de atualização — webhook, tarefa agendada e a tela de
 * acompanhamento chamam isto. A própria 99 avisa que o webhook não é garantido
 * e manda confirmar pelo detalhe; e em dev (localhost) o webhook nem chega.
 *
 * `statusEvento` é o status que o evento do webhook indica. Ele importa porque
 * "entregador chegou na loja" só existe como evento — no detalhe é "waiting".
 */
export async function sincronizar99(
  env: Env,
  idPedido: string,
  modo: ModoOperacao,
  statusEvento: StatusEntregaUber | null = null
): Promise<{ ok: boolean; status?: string | null; erro?: string }> {
  const l = await env.DB.prepare(
    `SELECT sequencia, delivery_id_externo, status_ao_vivo, status
       FROM deliveries
      WHERE id_pedido = ?1 AND plataforma_escolhida = '99'
      ORDER BY sequencia DESC LIMIT 1`
  )
    .bind(idPedido)
    .first<{
      sequencia: number;
      delivery_id_externo: string | null;
      status_ao_vivo: string | null;
      status: string | null;
    }>();
  if (!l?.delivery_id_externo) return { ok: false, erro: "entrega da 99 não encontrada" };

  let d: Detalhe99;
  try {
    d = await detalhe99(env, modo, { externalOrderId: idExterno99(idPedido, l.sequencia) });
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  // Reatribuição: o pedido vivo passou a ser outro. Troca o id guardado para o
  // novo, senão o webhook seguinte (que vem com o id novo) não acha a entrega.
  //
  // É a única vez em que o status VOLTA: o entregador antigo saiu, a busca
  // recomeça. Os dados dele são apagados para a tela não mostrar quem desistiu.
  const idAtual = d.new_order_id || d.order_id || l.delivery_id_externo;
  let atual = l.status_ao_vivo ?? l.status;
  if (idAtual !== l.delivery_id_externo) {
    console.log(`[99] pedido ${idPedido} reatribuído: ${l.delivery_id_externo} -> ${idAtual}`);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE deliveries SET
           delivery_id_externo = ?3, status_ao_vivo = 'pending', status = 'pending',
           courier_nome = NULL, courier_telefone = NULL, courier_veiculo = NULL,
           courier_placa = NULL, courier_lat = NULL, courier_lng = NULL
         WHERE id_pedido = ?1 AND sequencia = ?2`
      ).bind(idPedido, l.sequencia, idAtual),
      env.DB.prepare(
        `UPDATE pedidos SET despacho = json_set(despacho, '$.deliveryId', ?2)
          WHERE id = ?1 AND json_extract(despacho, '$.provider') = '99'`
      ).bind(idPedido, idAtual),
    ]);
    atual = "pending";
    // O evento que avisou da reatribuição fala do pedido antigo.
    statusEvento = null;
  }

  // O mais avançado entre o detalhe e o evento, e nunca para trás.
  const doDetalhe = d.status ? STATUS_DETALHE[d.status] ?? null : null;
  const candidato = [doDetalhe, statusEvento]
    .filter((s): s is StatusEntregaUber => !!s)
    .reduce<string | null>((max, s) => (max == null || ETAPA[s] > ETAPA[max] ? s : max), null);
  const status =
    candidato && ETAPA[candidato] >= (ETAPA[atual ?? ""] ?? -1) && candidato !== atual ? candidato : null;

  const di = d.driver_info;
  const temEntregador = !!di?.name;
  const lat = Number(di?.location?.lat);
  const lng = Number(di?.location?.lng);

  await env.DB.prepare(
    `UPDATE deliveries SET
       status_ao_vivo       = COALESCE(?2, status_ao_vivo),
       status               = COALESCE(?2, status),
       status_atualizado_em = CASE WHEN ?2 IS NULL THEN status_atualizado_em ELSE ?3 END,
       tracking_url         = COALESCE(?4, tracking_url),
       courier_nome         = COALESCE(?5, courier_nome),
       courier_telefone     = COALESCE(?6, courier_telefone),
       courier_veiculo      = COALESCE(?7, courier_veiculo),
       courier_placa        = COALESCE(?8, courier_placa),
       courier_lat          = COALESCE(?9, courier_lat),
       courier_lng          = COALESCE(?10, courier_lng),
       codigo_entrega       = COALESCE(codigo_entrega, ?11),
       live_mode            = ?12
     WHERE id_pedido = ?1 AND sequencia = ?13`
  )
    .bind(
      idPedido,
      status,
      new Date().toISOString(),
      d.tracking_link || null,
      temEntregador ? di!.name! : null,
      temEntregador && di?.phone ? di.phone : null,
      temEntregador ? veiculoLegivel(d.vehicle_type, di?.vehicle_info?.color) : null,
      di?.vehicle_info?.plate_no || null,
      // A 99 manda 0,0 quando não há posição.
      Number.isFinite(lat) && lat !== 0 ? lat : null,
      Number.isFinite(lng) && lng !== 0 ? lng : null,
      d.verify_info?.dropoff_verify_code || null,
      modo === "producao" ? 1 : 0,
      l.sequencia
    )
    .run();

  // O card mostra o código a partir do despacho. Se o detalhe falhou logo
  // após criar, ele ficou sem — completa aqui, uma vez.
  const codigo = d.verify_info?.dropoff_verify_code;
  if (codigo) {
    await env.DB.prepare(
      `UPDATE pedidos SET despacho = json_set(despacho, '$.codigoEntrega', ?2)
        WHERE id = ?1 AND json_extract(despacho, '$.provider') = '99'
          AND json_extract(despacho, '$.codigoEntrega') IS NULL`
    )
      .bind(idPedido, codigo)
      .run();
  }

  return { ok: true, status: status ?? atual };
}

/** Entregas da 99 ainda em andamento — para a tarefa agendada. */
export async function sincronizarAbertas99(env: Env, modo: ModoOperacao): Promise<void> {
  // 24 h: é o prazo em que a 99 expira pedido de teste, e nenhuma entrega de
  // comida dura mais do que isso.
  const corte = new Date(Date.now() - 86_400_000).toISOString();
  const r = await env.DB.prepare(
    `SELECT id_pedido FROM deliveries
      WHERE plataforma_escolhida = '99'
        AND data_criacao >= ?1
        AND COALESCE(status_ao_vivo, status) NOT IN ('delivered', 'canceled', 'returned')
      ORDER BY data_criacao DESC LIMIT 20`
  )
    .bind(corte)
    .all<{ id_pedido: string }>();

  for (const { id_pedido } of r.results ?? []) {
    const s = await sincronizar99(env, id_pedido, modo);
    if (!s.ok) console.warn(`[99-sync] ${id_pedido}: ${s.erro}`);
  }
}
