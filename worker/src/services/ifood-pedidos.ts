import type { Endereco, Env, ModoOperacao, Pedido, StatusPedidoIfood } from "../types";
import { chamar, traduzirErroIfood } from "./ifood";
import { modoAtual } from "../config/modo";
import { garantirCoordenadas } from "../lib/geocode";
import { atualizarStatusIfood, obterPedidoPorIdIfood, salvarPedidoNovo } from "../lib/store";

// ---------------------------------------------------------------------------
// PEDIDOS QUE CHEGAM DIRETO DO iFOOD (módulo Order)
// Docs: developer.ifood.com.br → Módulos → Order
//
// Na operação da Villa Deli o pedido do iFood entra pelo Cardápio Web, que é
// quem confirma e cancela o PEDIDO. O Hub só pede o entregador.
//
// A homologação do Shipping, porém, exige que o aplicativo receba o pedido
// (evento PLACED), confirme, cancele com motivo escolhido pelo atendente e
// acompanhe o que terceiros fizeram com ele. É o que este arquivo faz.
//
// Por isso o recebimento SÓ ACONTECE NO MODO TESTE: em produção o mesmo pedido
// chegaria pelos dois caminhos e apareceria duas vezes na fila, e o Hub
// passaria a confirmar pedidos que o restaurante ainda não viu no Cardápio
// Web. Em produção os eventos de pedido continuam sendo confirmados na fila
// (acknowledgment) e descartados, como antes.
//
//   receber:   GET  /order/v1.0/orders/{id}
//   confirmar: POST /order/v1.0/orders/{id}/confirm
//   motivos:   GET  /order/v1.0/orders/{id}/cancellationReasons
//   cancelar:  POST /order/v1.0/orders/{id}/requestCancellation
// ---------------------------------------------------------------------------

/** Evento do iFood -> status do pedido. fullCode e code curto. */
const STATUS_POR_EVENTO_DE_PEDIDO: Record<string, StatusPedidoIfood> = {
  PLACED: "PLACED",
  PLC: "PLACED",
  CONFIRMED: "CONFIRMED",
  CFM: "CONFIRMED",
  READY_TO_PICKUP: "READY_TO_PICKUP",
  RTP: "READY_TO_PICKUP",
  DISPATCHED: "DISPATCHED",
  DSP: "DISPATCHED",
  CONCLUDED: "CONCLUDED",
  CON: "CONCLUDED",
  CANCELLED: "CANCELLED",
  CAN: "CANCELLED",
};

/** Ordem do pedido. Evento atrasado não faz o status voltar. Cancelado é final. */
const ORDEM: Record<StatusPedidoIfood, number> = {
  PLACED: 0,
  CONFIRMED: 1,
  READY_TO_PICKUP: 2,
  DISPATCHED: 3,
  CONCLUDED: 4,
  CANCELLED: 5,
};

export function statusDoEventoDePedido(fullCode?: string, code?: string): StatusPedidoIfood | null {
  return (
    (fullCode ? STATUS_POR_EVENTO_DE_PEDIDO[fullCode] : undefined) ??
    (code ? STATUS_POR_EVENTO_DE_PEDIDO[code] : undefined) ??
    null
  );
}

// --- Formato do pedido no iFood (só o que o Hub usa) ------------------------

interface PedidoIfoodApi {
  id: string;
  displayId?: string;
  orderType?: string;
  orderTiming?: string;
  salesChannel?: string;
  createdAt?: string;
  isTest?: boolean;
  customer?: { name?: string; phone?: { number?: string; localizer?: string } };
  items?: Array<{
    name?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    observations?: string;
  }>;
  total?: { subTotal?: number; deliveryFee?: number; orderAmount?: number };
  payments?: {
    prepaid?: number;
    pending?: number;
    methods?: Array<{ method?: string; type?: string; value?: number }>;
  };
  delivery?: {
    deliveredBy?: string;
    observations?: string;
    pickupCode?: string;
    deliveryAddress?: {
      streetName?: string;
      streetNumber?: string;
      formattedAddress?: string;
      neighborhood?: string;
      complement?: string;
      reference?: string;
      postalCode?: string;
      city?: string;
      state?: string;
      coordinates?: { latitude?: number; longitude?: number };
    };
  };
}

const METODOS: Record<string, string> = {
  CREDIT: "Cartão de crédito",
  DEBIT: "Cartão de débito",
  PIX: "Pix",
  CASH: "Dinheiro",
  MEAL_VOUCHER: "Vale-refeição",
  FOOD_VOUCHER: "Vale-alimentação",
  DIGITAL_WALLET: "Carteira digital",
};

function descreverPagamento(o: PedidoIfoodApi): string {
  const m = o.payments?.methods?.[0];
  const nome = m?.method ? METODOS[m.method] ?? m.method : "iFood";
  // OFFLINE = o entregador cobra na porta. É a informação que o balcão
  // precisa ver; "pago online" não exige nada de ninguém.
  return m?.type === "OFFLINE" ? `${nome} na entrega` : `${nome} (pago no iFood)`;
}

function traduzirPedidoIfood(
  o: PedidoIfoodApi,
  status: StatusPedidoIfood,
  telefoneDaLoja: string,
  telefoneDeTeste?: string
): Pedido {
  const a = o.delivery?.deliveryAddress ?? {};
  const endereco: Endereco = {
    logradouro: a.streetName ?? a.formattedAddress ?? "",
    numero: a.streetNumber || "s/n",
    complemento: [a.complement, a.reference].filter(Boolean).join(", ") || undefined,
    bairro: a.neighborhood ?? "",
    cidade: a.city ?? "",
    uf: a.state ?? "",
    cep: (a.postalCode ?? "").replace(/\D/g, ""),
    lat: a.coordinates?.latitude ?? undefined,
    lng: a.coordinates?.longitude ?? undefined,
  };

  const total = o.total?.orderAmount ?? 0;
  const freteCobrado = o.total?.deliveryFee ?? 0;

  return {
    // Prefixo + começo do UUID: o displayId do iFood é curto e se repete, e
    // pode colidir com o número de um pedido do Cardápio Web.
    id: `ifood-${o.id.slice(0, 8)}`,
    criadoEm: o.createdAt ?? new Date().toISOString(),
    cliente: {
      nome: o.customer?.name ?? "Cliente iFood",
      // O iFood mascara o contato (0800 + localizador). A corrida precisa de
      // um número, então vai o da loja — ou o de teste, que é quem acompanha.
      telefone: telefoneDeTeste || telefoneDaLoja,
    },
    endereco,
    itens: (o.items ?? []).map((i) => ({
      nome: i.observations ? `${i.name ?? "Item"} (${i.observations})` : i.name ?? "Item",
      quantidade: i.quantity ?? 1,
      preco: i.totalPrice ?? i.unitPrice ?? 0,
    })),
    total,
    freteCobrado,
    subtotal: o.total?.subTotal ?? Math.round((total - freteCobrado) * 100) / 100,
    // O pagamento é do iFood: ou já foi pago no app, ou o entregador cobra.
    // Nos dois casos não há o que esperar para despachar.
    pago: true,
    formaPagamento: descreverPagamento(o),
    canal: "ifood",
    numeroExterno: o.displayId,
    idExterno: o.id,
    semTelefoneDoCliente: true,
    observacao: undefined,
    observacaoEntrega: o.delivery?.observations?.trim() || undefined,
    codigoColeta: o.delivery?.pickupCode || undefined,
    status: "recebido",
    teste: true,
    daApiIfood: true,
    statusIfood: status,
  };
}

async function buscarPedidoIfood(
  env: Env,
  orderId: string,
  modo: ModoOperacao
): Promise<PedidoIfoodApi> {
  const res = await chamar(env, modo, "GET", `/order/v1.0/orders/${encodeURIComponent(orderId)}`);
  if (!res.ok) {
    // Lança: o evento não é confirmado na fila e volta na próxima busca.
    throw new Error(`pedido ${orderId}: ${traduzirErroIfood(res.status, await res.text())}`);
  }
  return (await res.json()) as PedidoIfoodApi;
}

/**
 * Aplica um evento de PEDIDO (PLACED, CONFIRMED, CANCELLED...).
 *
 * Pedido desconhecido entra no Hub com o evento que chegar, não só com o
 * PLACED: se o PLACED se perdeu, o CONFIRMED feito no Gestor de Pedidos ainda
 * traz o pedido para a tela.
 *
 * Devolve true quando mexeu em um pedido do Hub.
 */
export async function aplicarEventoDePedidoIfood(
  env: Env,
  ev: { id?: string; code?: string; fullCode?: string; orderId?: string; createdAt?: string }
): Promise<boolean> {
  const status = statusDoEventoDePedido(ev.fullCode, ev.code);
  if (!status || !ev.orderId) return false;

  const existente = await obterPedidoPorIdIfood(env, ev.orderId);

  if (!existente) {
    const modo = await modoAtual(env);
    if (modo !== "teste") return false;

    const o = await buscarPedidoIfood(env, ev.orderId, modo);
    const pedido = traduzirPedidoIfood(
      o,
      status,
      env.RESTAURANTE_TELEFONE ?? "",
      env.TELEFONE_TESTE?.trim()
    );
    if (pedido.endereco.lat == null || pedido.endereco.lng == null) {
      pedido.endereco = await garantirCoordenadas(env, pedido.endereco);
    }
    const novo = await salvarPedidoNovo(env, pedido);
    console.log(
      `[ifood-pedido] recebido orderId=${o.id} displayId=${o.displayId ?? "-"} ` +
        `eventId=${ev.id ?? "-"} status=${status} tipo=${o.orderType ?? "-"}/${o.orderTiming ?? "-"} ` +
        `entregaPor=${o.delivery?.deliveredBy ?? "-"} novo=${novo}`
    );
    return novo;
  }

  // Pedido do Cardápio Web: o status do pedido é dele, não nosso.
  if (!existente.daApiIfood) return false;

  const atual = existente.statusIfood ?? "PLACED";
  if (atual === "CANCELLED" || ORDEM[status] <= ORDEM[atual]) return false;

  await atualizarStatusIfood(env, existente.id, status);
  console.log(
    `[ifood-pedido] orderId=${ev.orderId} eventId=${ev.id ?? "-"} ` +
      `criadoEm=${ev.createdAt ?? "-"} status ${atual} -> ${status}`
  );
  return true;
}

// ---------------------------------------------------------------------------
// AÇÕES DO ATENDENTE
// ---------------------------------------------------------------------------

function exigeDaApi(pedido: Pedido): string | null {
  if (!pedido.daApiIfood || !pedido.idExterno) {
    return "Este pedido não veio direto do iFood. Confirme e cancele pelo Cardápio Web.";
  }
  return null;
}

/**
 * Confirma o pedido no iFood. Responde 202; o evento CONFIRMED chega depois,
 * mas o status já é gravado para a tela liberar a cotação na hora.
 */
export async function confirmarPedidoIfood(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao,
  usuario: string
): Promise<{ ok: boolean; erro?: string }> {
  const recusa = exigeDaApi(pedido);
  if (recusa) return { ok: false, erro: recusa };
  if (pedido.statusIfood === "CANCELLED") return { ok: false, erro: "Este pedido foi cancelado no iFood." };
  if (pedido.statusIfood && pedido.statusIfood !== "PLACED") return { ok: true };

  const orderId = pedido.idExterno!;
  const res = await chamar(
    env,
    modo,
    "POST",
    `/order/v1.0/orders/${encodeURIComponent(orderId)}/confirm`,
    undefined,
    // Mesma chave em qualquer clique: confirmar duas vezes é uma operação só.
    { repetir: true, idempotencia: `confirmar-${orderId}` }
  );
  console.log(`[ifood-pedido] confirmar orderId=${orderId} por ${usuario} -> ${res.status}`);
  if (!res.ok) return { ok: false, erro: traduzirErroIfood(res.status, await res.text()) };

  await atualizarStatusIfood(env, pedido.id, "CONFIRMED");
  return { ok: true };
}

export interface MotivoCancelamentoPedido {
  codigo: string;
  descricao: string;
}

/** Motivos válidos agora para cancelar o PEDIDO. Vêm da API, nunca fixos. */
export async function motivosCancelamentoPedidoIfood(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao
): Promise<{ motivos: MotivoCancelamentoPedido[] } | { erro: string }> {
  const recusa = exigeDaApi(pedido);
  if (recusa) return { erro: recusa };

  const res = await chamar(
    env,
    modo,
    "GET",
    `/order/v1.0/orders/${encodeURIComponent(pedido.idExterno!)}/cancellationReasons`
  );
  if (res.status === 204) return { motivos: [] };
  if (!res.ok) return { erro: traduzirErroIfood(res.status, await res.text()) };

  const lista = (await res.json().catch(() => [])) as Array<{
    cancelCodeId?: string | number;
    code?: string | number;
    description?: string;
  }>;
  return {
    motivos: (Array.isArray(lista) ? lista : [])
      .map((m) => ({
        codigo: String(m.cancelCodeId ?? m.code ?? ""),
        descricao: m.description?.trim() || "Motivo sem descrição",
      }))
      .filter((m) => m.codigo !== ""),
  };
}

/**
 * Pede o cancelamento do pedido. O iFood responde 202 e decide depois: o
 * evento CANCELLED tira o pedido da fila; a recusa deixa tudo como estava.
 */
export async function cancelarPedidoIfood(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao,
  codigoMotivo: string | undefined,
  usuario: string
): Promise<{ ok: boolean; erro?: string }> {
  const r = await motivosCancelamentoPedidoIfood(env, pedido, modo);
  if ("erro" in r) return { ok: false, erro: r.erro };
  if (r.motivos.length === 0) return { ok: false, erro: "O iFood não aceita mais cancelar este pedido." };
  if (!codigoMotivo) return { ok: false, erro: "Escolha o motivo do cancelamento." };

  const motivo = r.motivos.find((m) => m.codigo === String(codigoMotivo));
  if (!motivo) {
    return { ok: false, erro: "Este motivo não vale mais para o pedido. Abra o cancelamento de novo." };
  }

  const orderId = pedido.idExterno!;
  const res = await chamar(
    env,
    modo,
    "POST",
    `/order/v1.0/orders/${encodeURIComponent(orderId)}/requestCancellation`,
    { reason: motivo.descricao, cancellationCode: motivo.codigo },
    { repetir: true, idempotencia: `cancelar-pedido-${orderId}-${motivo.codigo}` }
  );
  console.log(
    `[ifood-pedido] cancelar orderId=${orderId} motivo=${motivo.codigo} por ${usuario} -> ${res.status}`
  );
  return res.ok ? { ok: true } : { ok: false, erro: traduzirErroIfood(res.status, await res.text()) };
}

/** Pedido que veio direto do iFood e foi cancelado lá. */
export function pedidoCanceladoNoIfood(pedido: Pedido): boolean {
  return pedido.statusIfood === "CANCELLED";
}
