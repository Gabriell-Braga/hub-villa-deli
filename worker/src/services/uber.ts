import type { Cotacao, Env, ModoOperacao, Pedido, ResultadoDespacho } from "../types";
import { getUberToken } from "./tokens";
import { distanciaKm, enderecoFormatado } from "../lib/geo";
import { credenciaisUber } from "../config/ambiente";

// ---------------------------------------------------------------------------
// Uber Direct B2B
// Docs: https://developer.uber.com/docs/deliveries
// Cotação:  POST /v1/customers/{customer_id}/delivery_quotes
// Criação:  POST /v1/customers/{customer_id}/deliveries
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tradução dos erros da Uber.
//
// A resposta crua deles é JSON em inglês, e ia inteira para a tela do
// atendente. No meio de um pico de pedidos ninguém lê
// `{"code":"address_undeliverable","metadata":{"details":"..."}}` — a pessoa
// só precisa saber se dá para despachar por ali ou não.
//
// O que não for reconhecido cai numa mensagem genérica, mas o código original
// vai para o log do Worker para a gente conseguir investigar depois.
// ---------------------------------------------------------------------------

const MILHA_KM = 1.60934;

/** Nomes de campo do payload da Uber em linguagem de gente. */
const CAMPOS: Record<string, string> = {
  pickup_phone_number: "telefone da loja",
  dropoff_phone_number: "telefone do cliente",
  pickup_address: "endereço da loja",
  dropoff_address: "endereço de entrega",
  pickup_name: "nome da loja",
  dropoff_name: "nome do cliente",
  manifest_items: "itens do pedido",
};

interface ErroUber {
  code?: string;
  message?: string;
  metadata?: Record<string, string> & { details?: string };
}

export function traduzirErroUber(status: number, corpo: string): string {
  let e: ErroUber;
  try {
    e = JSON.parse(corpo) as ErroUber;
  } catch {
    return `A Uber não respondeu como esperado (código ${status}).`;
  }

  console.warn(`[uber] ${status} ${e.code ?? "?"}: ${e.message ?? corpo.slice(0, 200)}`);

  switch (e.code) {
    case "address_undeliverable": {
      // details vem como "... (Max Radius: 3.11 miles, Calculated Distance: 3.67 miles)."
      const d = e.metadata?.details ?? "";
      const max = d.match(/Max Radius: ([\d.]+) miles/);
      const dist = d.match(/Calculated Distance: ([\d.]+) miles/);

      if (max && dist) {
        const km = (n: string) => (Number(n) * MILHA_KM).toFixed(1).replace(".", ",");
        return `Fora da área de cobertura da Uber: ${km(dist[1])} km de rota, e o limite da loja é ${km(max[1])} km.`;
      }
      return "Fora da área de cobertura da Uber para este endereço.";
    }

    case "address_undeliverable_limited_couriers":
      return "A Uber não tem entregador disponível para este endereço agora.";

    case "invalid_params": {
      // metadata traz o campo problemático como chave.
      const campo = Object.keys(e.metadata ?? {}).find((k) => k !== "details");
      const rotulo = campo ? CAMPOS[campo] ?? campo : null;
      return rotulo
        ? `A Uber recusou o ${rotulo}. Confira o cadastro.`
        : "A Uber recusou os dados do pedido. Confira o endereço e os telefones.";
    }

    case "customer_blocked":
      return "A conta da Uber não está autorizada a criar entregas. Veja em Configurações.";

    case "unauthorized":
      return "A conta da Uber não tem permissão para entregas. Veja em Configurações.";

    case "duplicate_delivery":
      return "A Uber já tem uma entrega para este pedido.";

    case "quote_expired":
      return "A cotação da Uber venceu. Clique em Recotar.";

    default:
      if (status === 401 || status === 403) {
        return "A Uber recusou as credenciais. Veja em Configurações.";
      }
      if (status >= 500) {
        return "A Uber está instável no momento. Tente novamente em instantes.";
      }
      return e.message
        ? `A Uber recusou: ${e.message}`
        : `A Uber recusou a solicitação (código ${status}).`;
  }
}

// ---------------------------------------------------------------------------
// POR QUE NÃO EXISTE "UBER MOTO" E "UBER CARRO" SEPARADOS
//
// Chegamos a ter dois cards, e eles voltavam com preço IDÊNTICO. O motivo, na
// especificação oficial deles (uber/uber-direct-sdk, openapi.yaml):
//
//   1) O create quote aceita 14 campos, e `manifest_items` NÃO é um deles.
//      Mandar tamanho na cotação não muda nada — o campo é descartado antes
//      de chegar no motor de preço.
//   2) Não existe campo de veículo em lugar nenhum da API. Nem no quote, nem
//      no create delivery. `vehicle_type` aparece uma única vez no spec
//      inteiro, e é somente leitura, no Get Delivery, depois que já há um
//      entregador designado.
//
// Quem escolhe o veículo é a Uber, pelo peso e volume declarados no CREATE
// DELIVERY. Nas palavras deles: "if your package is heavy, our system will
// provide you a driver instead of a biker".
//
// Então o que dá para fazer é declarar o pedido com honestidade e deixar a
// Uber decidir. É o que `manifesto()` faz. Se um dia a conta brasileira tiver
// produtos separados de moto e carro, isso virá como outro customer_id — e aí
// será um provedor novo de verdade, com credencial própria.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PORTE DO PEDIDO
//
// Como não há campo de veículo, o que sobra é declarar tamanho e peso com
// honestidade e deixar a Uber decidir. É o comportamento documentado deles:
// "if your package is heavy, our system will provide you a driver instead of
// a biker".
//
// ATENÇÃO AO QUE ISTO **NÃO** FAZ: não muda o preço. A cotação é criada antes,
// num endpoint que nem aceita manifesto, e o `quote_id` já fixou a tarifa. O
// porte influencia QUEM vem buscar, não quanto custa.
//
// Os pesos são estimativas por faixa, não medições. Servem para cair do lado
// certo do critério da Uber; declarar 20 kg num pedido de 2 kg seria pedir
// carro na marra, e mentir para o parceiro que vai executar a entrega.
// ---------------------------------------------------------------------------
export type PorteUber = "normal" | "grande" | "volumoso";

const PORTES: Record<PorteUber, { size: string; gramas: number }> = {
  // Sacola de delivery comum. `medium` = "precisa de uma sacola" na régua
  // deles. Nunca `small`: esse é o padrão quando nada é informado e descreve
  // uma garrafa d'água — pode render entregador de bicicleta.
  normal: { size: "medium", gramas: 3_000 },
  // Duas mãos para carregar. Pedido de família, caixa de pizza grande.
  grande: { size: "large", gramas: 9_000 },
  // Várias viagens até o veículo. É aqui que a Uber costuma mandar carro.
  volumoso: { size: "xlarge", gramas: 20_000 },
};

/**
 * Manifesto do pedido. Vai só no CREATE DELIVERY — a cotação não aceita.
 *
 * O peso é declarado UMA vez, na primeira linha, e não repetido item a item:
 * é o peso do pedido inteiro que interessa ao critério da Uber, e distribuir
 * daria um total errado quando há muitos itens.
 */
function manifesto(pedido: Pedido, porte: PorteUber) {
  const { size, gramas } = PORTES[porte];

  const itens =
    pedido.itens.length > 0
      ? pedido.itens.map((i) => ({
          name: i.nome,
          quantity: i.quantidade,
          size,
        }))
      : [{ name: "Pedido", quantity: 1, size }];

  return itens.map((i, idx) => (idx === 0 ? { ...i, weight: gramas } : i));
}

/**
 * Distância em linha reta da loja até o cliente, no mesmo formato do card do
 * motoboy — para os dois serem comparáveis de relance.
 *
 * É a mesma régua que o Uber usa para recusar endereço: nas recusas deles, a
 * "Calculated Distance" bate com a linha reta, e o limite da loja hoje é
 * 5,0 km. Com o número na tela, quando um endereço for recusado dá para ver
 * na hora se foi por pouco ou por muito.
 */
function distanciaAteOCliente(env: Env, pedido: Pedido): string | undefined {
  const { lat, lng } = pedido.endereco;
  if (lat == null || lng == null) return undefined;

  const km = distanciaKm(
    parseFloat(env.RESTAURANTE_LAT),
    parseFloat(env.RESTAURANTE_LNG),
    lat,
    lng
  );

  return `${km.toFixed(2)} km em linha reta`;
}

function pickupPayload(env: Env) {
  return {
    pickup_address: env.RESTAURANTE_CEP, // em prod, use o endereço estruturado completo
    pickup_name: env.RESTAURANTE_NOME,
    pickup_phone_number: env.RESTAURANTE_TELEFONE,
    pickup_latitude: parseFloat(env.RESTAURANTE_LAT),
    pickup_longitude: parseFloat(env.RESTAURANTE_LNG),
  };
}

export async function cotarUber(
  env: Env,
  pedido: Pedido,
  modo: ModoOperacao
): Promise<Cotacao> {
  const cred = credenciaisUber(env, modo);
  const base: Cotacao = {
    provider: "uber",
    nome: "Uber Direct",
    disponivel: false,
    preco: null,
    moeda: "BRL",
    etaMinutos: null,
    quoteId: null,
    expiraEm: null,
    // Vai no `base` para aparecer também quando a cotação FALHA. É justamente
    // aí que a distância mais importa: "fora da área de cobertura" sem número
    // não diz se faltaram 200 metros ou 3 km.
    detalhe: distanciaAteOCliente(env, pedido),
  };

  const token = await getUberToken(env, modo);
  const res = await fetch(
    `${cred.baseUrl}/v1/customers/${cred.customerId}/delivery_quotes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...pickupPayload(env),
        dropoff_address: enderecoFormatado(pedido.endereco),
        dropoff_latitude: pedido.endereco.lat,
        dropoff_longitude: pedido.endereco.lng,
        // Nada de manifest_items aqui: o create quote aceita 14 campos e este
        // não é um deles. Mandar era ruído — o campo era descartado.
      }),
    }
  );

  if (!res.ok) {
    return { ...base, erro: traduzirErroUber(res.status, await res.text()) };
  }

  // Uber retorna fee em centavos e duração em segundos.
  const q = (await res.json()) as {
    id: string;
    fee: number;
    currency: string;
    duration: number; // minutos até entrega (dropoff_eta) — normalizamos
    dropoff_eta?: string;
    expires?: string;
  };

  return {
    ...base,
    disponivel: true,
    preco: Math.round(q.fee) / 100,
    moeda: q.currency || "BRL",
    etaMinutos: q.duration ?? null,
    quoteId: q.id,
    expiraEm: q.expires ?? null,
  };
}

export async function despacharUber(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  modo: ModoOperacao,
  porte: PorteUber = "normal"
): Promise<ResultadoDespacho> {
  const cred = credenciaisUber(env, modo);
  const token = await getUberToken(env, modo);
  const res = await fetch(
    `${cred.baseUrl}/v1/customers/${cred.customerId}/deliveries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quote_id: cotacao.quoteId,
        ...pickupPayload(env),
        dropoff_address: enderecoFormatado(pedido.endereco),
        dropoff_name: pedido.cliente.nome,
        dropoff_phone_number: pedido.cliente.telefone,
        dropoff_latitude: pedido.endereco.lat,
        dropoff_longitude: pedido.endereco.lng,
        manifest_items: manifesto(pedido, porte),

        // CÓDIGO DE ENTREGA (PIN de 4 dígitos).
        //
        // O entregador só consegue fechar a entrega depois que o cliente
        // informa este número na porta. É o que impede o pedido de ser
        // deixado com a pessoa errada — e, quando o cliente reclama que não
        // recebeu, é a prova de que recebeu.
        //
        // A Uber devolve o valor gerado em verification_requirements.pincode.
        // Incompatível com "deixar na porta", que não usamos.
        dropoff_verification: { pincode: { enabled: true } },

        // ENTREGADOR SIMULADO — só em modo teste.
        //
        // O "robocourier" da Uber NÃO é automático: sem este bloco a entrega
        // de sandbox fica parada em `pending` para sempre, nenhum webhook é
        // disparado, e parece que a integração quebrou.
        //
        // Com mode "auto" ele percorre os status de 30 em 30 segundos —
        // atribuído, a caminho, coletado, saiu, entregue — em ~2min30, e
        // dispara delivery_status e courier_update normalmente.
        //
        // Em produção este campo NUNCA vai: lá o entregador é de verdade.
        ...(modo === "teste"
          ? {
              test_specifications: {
                robo_courier_specification: { mode: "auto" },
              },
            }
          : {}),
      }),
    }
  );

  if (!res.ok) {
    throw new Error(traduzirErroUber(res.status, await res.text()));
  }

  interface Verificacao {
    pincode?: { enabled?: boolean; value?: string };
  }

  const d = (await res.json()) as {
    id: string;
    tracking_url: string;
    status: string;
    // O PIN vem DENTRO do waypoint de entrega, não na raiz. A página de guia
    // da Uber mostra um exemplo achatado que engana; no OpenAPI oficial,
    // DeliveryResp.dropoff é um WaypointInfo e é ele que tem o campo.
    dropoff?: { verification_requirements?: Verificacao };
    verification_requirements?: Verificacao;
  };

  const pin =
    d.dropoff?.verification_requirements?.pincode ??
    // Tolerância: se um dia eles promoverem o campo para a raiz, continua
    // funcionando em vez de voltar a sumir em silêncio.
    d.verification_requirements?.pincode;

  if (!pin?.value) {
    // Não é motivo para cancelar a entrega — ela já foi criada e cancelar aqui
    // custaria dinheiro. Mas precisa aparecer no log: significa que a conta
    // não tem o recurso liberado, e a entrega saiu sem a proteção.
    console.warn(`[uber] entrega ${d.id} criada SEM código de verificação`);
  }

  return {
    provider: "uber",
    deliveryId: d.id,
    trackingUrl: d.tracking_url,
    status: d.status,
    codigoEntrega: pin?.value ?? null,
    // Guardado para dar para conferir depois, contra a fatura da Uber, se
    // declarar peso maior muda o que é cobrado. Hoje não sabemos: o preço vem
    // do quote_id, e a documentação não diz o que acontece quando o manifesto
    // exige um veículo maior que o precificado.
    porteDeclarado: porte,
  };
}
