import type { Endereco, Env, ItemPedido, Pedido } from "../types";
import { ambiente } from "../config/ambiente";
import { modoAtual } from "../config/modo";
import { garantirCoordenadas } from "../lib/geocode";
import {
  atualizarDoCardapio,
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
  /** Número do pedido no marketplace — o que o cliente vê no app do iFood. */
  external_display_id?: string | null;
  /**
   * Id INTERNO do pedido no marketplace (UUID). É por ele que a API do iFood
   * identifica o pedido — o display_id não serve para chamar endpoint.
   */
  external_order_id?: string | null;
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
  payments?: Array<{
    total?: number;
    /** online = pago no app. Outro valor = pagamento na entrega. */
    payment_type?: string;
    /** pix_auto, online_credit_card, ifood, ifood_voucher, dinheiro… */
    payment_method?: string;
    /** paid = já caiu. É o que decide se o pedido pode ser cotado. */
    status?: string;
  }>;
}

/** Nomes de meio de pagamento em português, para a tela do atendente. */
const FORMAS: Record<string, string> = {
  pix_auto: "Pix",
  pix: "Pix",
  online_credit_card: "Cartão de crédito",
  online_debit_card: "Cartão de débito",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  ifood: "iFood",
  ifood_voucher: "Vale iFood",
  dinheiro: "Dinheiro",
  cash: "Dinheiro",
};

/**
 * O pedido já foi pago?
 *
 * Exigimos que TODAS as linhas de pagamento estejam `paid` — pedido do iFood
 * costuma vir em duas (vale + resto), e considerar pago com uma só deixaria
 * passar pedido parcialmente quitado.
 *
 * Sem nenhuma linha de pagamento tratamos como NÃO pago. Falha fechada: o
 * prejuízo de segurar um pedido pago por engano é uma ligação; o de despachar
 * um pedido não pago é a comida e o frete.
 */
function estaPago(cw: PedidoCW): boolean {
  const p = cw.payments ?? [];
  return p.length > 0 && p.every((x) => x.status === "paid");
}

function descreverPagamento(cw: PedidoCW): string | undefined {
  const metodos = (cw.payments ?? [])
    .map((p) => FORMAS[p.payment_method ?? ""] ?? p.payment_method)
    .filter(Boolean);

  // Sem duplicar: iFood manda "ifood" duas vezes em alguns pedidos.
  return [...new Set(metodos)].join(" + ") || undefined;
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
 *
 * `telefoneDeTeste`, quando o pedido é de teste, SUBSTITUI o do cliente. O
 * Uber manda SMS de acompanhamento para o número do destino: sem esta troca,
 * um teste nosso vira mensagem estranha no celular de um cliente real.
 */
export function traduzirPedidoCW(
  cw: PedidoCW,
  teste: boolean,
  telefoneDaLoja: string,
  telefoneDeTeste?: string
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

  const doCliente = normalizarTelefone(cw.customer?.phone, cw.customer?.ddi);
  // Pedido de marketplace não traz o contato do cliente. Sem telefone nenhum o
  // Uber recusa a corrida, então cai no da loja — e isso fica sinalizado, para
  // ninguém no balcão achar que está ligando para quem fez o pedido.
  const semTelefoneDoCliente = !doCliente;

  // Em teste o número do dono do Hub tem prioridade sobre tudo: é ele quem
  // precisa receber o SMS do Uber para acompanhar.
  const telefone =
    teste && telefoneDeTeste ? telefoneDeTeste : doCliente || telefoneDaLoja;

  const total = cw.total ?? 0;
  const freteCobrado = cw.delivery_fee ?? 0;

  return {
    id: String(cw.display_id ?? cw.id),
    criadoEm: new Date().toISOString(),
    cliente: {
      nome: cw.customer?.name ?? "Cliente",
      telefone,
    },
    endereco,
    itens,
    // O total deles JÁ INCLUI a taxa de entrega — é o que o cliente pagou.
    total,
    freteCobrado,
    // Arredondado porque subtração de float dá 38.989999999999995.
    subtotal: Math.round((total - freteCobrado) * 100) / 100,
    pago: estaPago(cw),
    formaPagamento: descreverPagamento(cw),
    canal: cw.sales_channel,
    numeroExterno: cw.external_display_id ?? undefined,
    idExterno: cw.external_order_id ?? undefined,
    semTelefoneDoCliente,
    observacao: cw.observation ?? undefined,
    status: "recebido",
    statusCardapio: cw.status,
    teste,
  };
}

/**
 * Reconsulta o pedido no Cardápio Web e reaplica o que mudou.
 *
 * Usada quando o Hub acha que o pedido não está pago. O caminho normal é o
 * webhook de status avisar, mas ele pode falhar — e um pedido travado como
 * "aguardando pagamento" some da operação sem ninguém entender por quê. Aqui
 * a dúvida custa uma chamada; do outro lado, custa uma venda.
 *
 * Devolve o pedido atualizado, ou null se não deu para reconsultar (aí vale o
 * que já estava guardado).
 */
export async function revalidarPedido(
  env: Env,
  pedido: Pedido
): Promise<Pedido | null> {
  try {
    // O id do Hub é o display_id; a API deles busca pelo id interno também
    // por esse número, que é o que o webhook mandou.
    const cw = await buscarPedidoCW(env, pedido.id);
    const atualizado = traduzirPedidoCW(
      cw,
      !!pedido.teste,
      env.RESTAURANTE_TELEFONE ?? "",
      env.TELEFONE_TESTE
    );

    await atualizarDoCardapio(env, pedido.id, {
      statusCardapio: atualizado.statusCardapio ?? null,
      pago: atualizado.pago,
      formaPagamento: atualizado.formaPagamento,
      freteCobrado: atualizado.freteCobrado,
      subtotal: atualizado.subtotal,
      total: atualizado.total,
      canal: atualizado.canal,
      numeroExterno: atualizado.numeroExterno,
      idExterno: atualizado.idExterno,
      semTelefoneDoCliente: atualizado.semTelefoneDoCliente,
    });

    // Só os campos do Cardápio Web. O resto continua sendo do Hub.
    return {
      ...pedido,
      statusCardapio: atualizado.statusCardapio,
      pago: atualizado.pago,
      formaPagamento: atualizado.formaPagamento,
      freteCobrado: atualizado.freteCobrado,
      subtotal: atualizado.subtotal,
      total: atualizado.total,
      canal: atualizado.canal,
      numeroExterno: atualizado.numeroExterno,
      idExterno: atualizado.idExterno,
      semTelefoneDoCliente: atualizado.semTelefoneDoCliente,
    };
  } catch (e) {
    console.warn(
      `[cardapio-web] revalidar ${pedido.id}: ${e instanceof Error ? e.message : e}`
    );
    return null;
  }
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

    const pedido = traduzirPedidoCW(
      cw,
      teste,
      env.RESTAURANTE_TELEFONE ?? "",
      env.TELEFONE_TESTE
    );
    const jaExiste = await obterPedido(env, pedido.id);

    if (jaExiste) {
      // ORDER_STATUS_UPDATED (ou reenvio). Reaplica o que o Cardápio Web pode
      // ter mudado desde a criação — pagamento em primeiro lugar. Pedido no
      // Pix entra com o pagamento pendente e só compensa depois; é justamente
      // para isso que este evento existe.
      await atualizarDoCardapio(env, pedido.id, {
        statusCardapio: pedido.statusCardapio ?? null,
        pago: pedido.pago,
        formaPagamento: pedido.formaPagamento,
        freteCobrado: pedido.freteCobrado,
        subtotal: pedido.subtotal,
        total: pedido.total,
        canal: pedido.canal,
        numeroExterno: pedido.numeroExterno,
        idExterno: pedido.idExterno,
        semTelefoneDoCliente: pedido.semTelefoneDoCliente,
      });
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
