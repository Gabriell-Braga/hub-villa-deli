import type { Endereco, Env, ItemPedido, Pedido } from "../types";
import { ambiente } from "../config/ambiente";
import { modoAtual } from "../config/modo";
import { garantirCoordenadas } from "../lib/geocode";
import {
  atualizarStatusCardapio,
  marcarEventoComErro,
  marcarEventoProcessado,
  obterPedido,
  salvarPedidoNovo,
  type EventoCardapio,
} from "../lib/store";

// ---------------------------------------------------------------------------
// Cardápio Web — cliente da API de pedidos.
//
// Docs: docs.cardapioweb.com
//
// O ponto que define todo o desenho: o webhook deles NÃO traz o pedido. Traz
// só `order_id`, e a gente busca em GET /api/partner/v1/orders/{id}.
//
// Ambientes:
//   sandbox   https://integracao.sandbox.cardapioweb.com
//   produção  https://integracao.cardapioweb.com
//
// Autenticação: `X-API-KEY` (legado, é o que a conta do Villa Deli tem) ou
// `Authorization: Bearer` (OAuth, recomendado pela doc para novas
// integrações). Mandamos o que estiver configurado.
// ---------------------------------------------------------------------------

export function baseCardapioWeb(env: Env): string {
  const explicito = env.CARDAPIO_WEB_BASE_URL?.trim();
  if (explicito) return explicito.replace(/\/+$/, "");

  return ambiente(env) === "producao"
    ? "https://integracao.cardapioweb.com"
    : "https://integracao.sandbox.cardapioweb.com";
}

/**
 * Formato do pedido, conferido contra pedidos REAIS da loja — não só contra a
 * documentação. Três diferenças que a doc não deixava claras e que quebrariam
 * a integração em silêncio:
 *
 *   - latitude/longitude vêm como STRING ("-19.9865187"), não número
 *   - o campo de observação é `observation`, no singular
 *   - o DDI vem separado do telefone, em `customer.ddi`
 */
interface PedidoCW {
  id: number;
  /** Número curto que a loja usa no balcão. O `id` é longo e ninguém decora. */
  display_id?: number;
  status?: string;
  /** delivery | takeout | closed_table — só o primeiro é entrega. */
  order_type?: string;
  /** merchant = a loja entrega. Outro valor = quem entrega é o marketplace. */
  delivered_by?: string | null;
  /** catalog | portal | ifood — de onde veio a venda. */
  sales_channel?: string;
  /** Tempo que a própria loja prometeu ao cliente, em minutos. */
  estimated_time?: number;
  total?: number;
  delivery_fee?: number;
  observation?: string | null;
  customer?: { name?: string; phone?: string; ddi?: string } | null;
  delivery_address?: {
    street?: string;
    number?: string;
    complement?: string | null;
    neighborhood?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    /** String, não número. Ex.: "-19.9865187". */
    latitude?: string | number | null;
    longitude?: string | number | null;
    reference?: string | null;
  } | null;
  items?: Array<{
    name?: string;
    quantity?: number;
    unit_price?: number;
    /** Já inclui os adicionais escolhidos (options). É este que vale. */
    total_price?: number;
  }>;
}

/**
 * Este pedido é assunto do Hub?
 *
 * A loja recebe balcão, mesa e retirada pelo mesmo canal. Sem este filtro, um
 * pedido de retirada — que não tem nem endereço — entraria na fila de entregas
 * e alguém acabaria acionando um entregador para ninguém.
 *
 * `delivered_by` cuida do outro caso caro: pedido de marketplace em que o
 * próprio marketplace entrega. Acionar o Uber ali é pagar a entrega duas vezes.
 */
export function deveEntrarNoHub(cw: PedidoCW): { entra: boolean; motivo?: string } {
  if (cw.order_type !== "delivery") {
    return { entra: false, motivo: `não é entrega (${cw.order_type ?? "?"})` };
  }
  if (cw.delivered_by && cw.delivered_by !== "merchant") {
    return { entra: false, motivo: `quem entrega é ${cw.delivered_by}` };
  }
  if (!cw.delivery_address?.street) {
    return { entra: false, motivo: "pedido sem endereço de entrega" };
  }
  return { entra: true };
}

/** Coordenada deles é string. Number("") é 0 — daria um ponto no oceano. */
function coordenada(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

export async function buscarPedidoCW(
  env: Env,
  orderId: string
): Promise<PedidoCW> {
  const headers: Record<string, string> = { Accept: "application/json" };

  if (env.CARDAPIO_WEB_OAUTH_TOKEN?.trim()) {
    headers.Authorization = `Bearer ${env.CARDAPIO_WEB_OAUTH_TOKEN.trim()}`;
  } else if (env.CARDAPIO_WEB_TOKEN?.trim()) {
    headers["X-API-KEY"] = env.CARDAPIO_WEB_TOKEN.trim();
  } else {
    throw new Error("Token do Cardápio Web não configurado.");
  }

  const res = await fetch(
    `${baseCardapioWeb(env)}/api/partner/v1/orders/${encodeURIComponent(orderId)}`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(
      `Cardápio Web ${res.status} ao buscar o pedido ${orderId}: ${(
        await res.text()
      ).slice(0, 200)}`
    );
  }

  return (await res.json()) as PedidoCW;
}

/**
 * Telefone para E.164, que é o que o Uber exige — sem o +55 ele recusa a
 * cotação inteira. O DDI vem em campo separado (`customer.ddi`), então usamos
 * o que a loja informou em vez de assumir Brasil.
 */
export function normalizarTelefone(bruto?: string, ddi?: string): string {
  const d = (bruto ?? "").replace(/\D/g, "");
  if (!d) return "";

  const codigo = (ddi ?? "").replace(/\D/g, "") || "55";
  // 12+ dígitos já começando pelo DDI = número completo, não prefixar de novo.
  if (d.startsWith(codigo) && d.length >= 12) return `+${d}`;
  return `+${codigo}${d}`;
}

/**
 * Traduz o pedido deles para o formato do Hub.
 *
 * `telefoneDaLoja` é usado quando o pedido não traz telefone do cliente — o
 * que acontece de verdade nos pedidos vindos do iFood, onde o número é
 * mascarado pela plataforma. Sem nenhum telefone o Uber recusa a corrida; com
 * o da loja, o entregador ao menos consegue falar com alguém.
 */
export function traduzirPedidoCW(
  cw: PedidoCW,
  teste: boolean,
  telefoneDaLoja: string
): Pedido {
  const e = cw.delivery_address ?? {};

  const endereco: Endereco = {
    logradouro: e.street ?? "",
    numero: e.number ?? "s/n",
    complemento:
      [e.complement, e.reference].filter(Boolean).join(" — ") || undefined,
    bairro: e.neighborhood ?? "",
    cidade: e.city ?? "",
    uf: e.state ?? "",
    cep: e.postal_code ?? "",
    // Os pedidos de entrega vêm com coordenada. Quando vem, é o caminho exato:
    // dispensa geocodificar e não erra o número da casa.
    lat: coordenada(e.latitude),
    lng: coordenada(e.longitude),
  };

  const itens: ItemPedido[] = (cw.items ?? []).map((i) => ({
    nome: i.name ?? "Item",
    quantidade: i.quantity ?? 1,
    // total_price já soma os adicionais (options); unit_price é só o item base.
    preco: i.total_price ?? i.unit_price ?? 0,
  }));

  const telefone =
    normalizarTelefone(cw.customer?.phone, cw.customer?.ddi) || telefoneDaLoja;

  return {
    id: String(cw.display_id ?? cw.id),
    criadoEm: new Date().toISOString(),
    cliente: {
      nome: cw.customer?.name ?? "Cliente",
      telefone,
    },
    endereco,
    itens,
    // O total deles inclui a taxa de entrega — é o que o cliente pagou, e é
    // esse número que a loja reconhece.
    total: cw.total ?? 0,
    observacao: cw.observation ?? undefined,
    status: "recebido",
    statusCardapio: cw.status,
    teste,
  };
}

/** Qualquer variação de "cancelado" nas duas grafias que eles usam. */
export function cancelado(status?: string | null): boolean {
  return /cancel/i.test(status ?? "");
}

// ---------------------------------------------------------------------------
// PROCESSAMENTO DO EVENTO
//
// Roda FORA do caminho da resposta do webhook (ctx.waitUntil), ou pelo cron
// quando uma tentativa anterior falhou. Nunca lança: o que der errado é
// anotado no evento para o cron tentar de novo e para dar para investigar.
// ---------------------------------------------------------------------------
export async function processarEventoCardapio(
  env: Env,
  evento: EventoCardapio
): Promise<void> {
  try {
    if (!evento.orderId) {
      // Evento sem pedido não tem o que buscar. Encerra em vez de ficar
      // voltando no cron para sempre.
      await marcarEventoProcessado(env, evento.eventId);
      return;
    }

    const cw = await buscarPedidoCW(env, evento.orderId);

    const filtro = deveEntrarNoHub(cw);
    if (!filtro.entra) {
      // Retirada, mesa, entrega do marketplace. Não é erro nenhum — é a maior
      // parte do movimento da loja. Encerra o evento e não enche a fila.
      console.log(`[cardapio-web] pedido ${evento.orderId}: ${filtro.motivo}`);
      await marcarEventoProcessado(env, evento.eventId);
      return;
    }

    // Pedido de teste quando estamos com credencial de sandbox do entregador
    // ou fora do Worker de produção — nos dois casos não é uma entrega que a
    // loja vai ver acontecer de verdade.
    const teste =
      (await modoAtual(env)) === "teste" || ambiente(env) !== "producao";

    const pedido = traduzirPedidoCW(cw, teste, env.RESTAURANTE_TELEFONE ?? "");
    const jaExiste = await obterPedido(env, pedido.id);

    if (jaExiste) {
      // ORDER_STATUS_UPDATED (ou reenvio): só o status deles muda. Não
      // sobrescrevemos o pedido, que a esta altura já pode estar cotado.
      await atualizarStatusCardapio(env, pedido.id, cw.status ?? null);
    } else {
      // Sem coordenada não dá para calcular a faixa do motoboy próprio. Os
      // pedidos de entrega deles já trazem lat/lng, então isto quase nunca
      // roda — mas quando roda, ViaCEP + geocoder passam fácil dos 5 s que
      // eles esperam, e é justamente por isso que a fila existe.
      if (pedido.endereco.lat == null || pedido.endereco.lng == null) {
        pedido.endereco = await garantirCoordenadas(env, pedido.endereco);
      }
      await salvarPedidoNovo(env, pedido);
    }

    await marcarEventoProcessado(env, evento.eventId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[cardapio-web] evento ${evento.eventId}: ${msg}`);
    await marcarEventoComErro(env, evento.eventId, msg);
  }
}
