// ---------------------------------------------------------------------------
// Bindings do Worker (KV + variáveis + segredos)
// ---------------------------------------------------------------------------
export interface Env {
  /** Cache: token OAuth2 e geocodificação. Nada de estado de pedido aqui. */
  HUB_KV: KVNamespace;
  /** Estado dos pedidos (ver schema.sql). */
  DB: D1Database;

  /**
   * TRAVA DE PROVEDORES. Lista separada por vírgula: "uber", "uber,motoboy".
   * Vazio = usa o padrão de src/config/provedores.ts.
   */
  PROVEDORES_ATIVOS: string;

  /** Origens liberadas no CORS, separadas por vírgula. */
  PAINEL_ORIGIN: string;

  /** dev | hml | producao. Define quais URLs e credenciais são usadas. */
  AMBIENTE: string;

  // Restaurante (origem)
  RESTAURANTE_NOME: string;
  RESTAURANTE_CEP: string;
  RESTAURANTE_LAT: string;
  RESTAURANTE_LNG: string;
  RESTAURANTE_TELEFONE: string;
  /**
   * Telefone que substitui o do cliente em TODO pedido de teste.
   *
   * O Uber manda SMS de acompanhamento para o número do destino. Sem esta
   * troca, um teste nosso dispara mensagem para um cliente real que não faz
   * ideia do que é — e o dono do Hub perde a chance de acompanhar o teste.
   */
  TELEFONE_TESTE: string;

  // Base URLs — produção
  UBER_BASE_URL: string;
  UBER_AUTH_URL: string;
  IFOOD_BASE_URL: string;
  NOVA99_BASE_URL: string;
  NOVA99_AUTH_URL: string;

  // Base URLs — sandbox, usadas no MODO teste (ver config/modo.ts)
  UBER_BASE_URL_TESTE: string;
  IFOOD_BASE_URL_TESTE: string;
  NOVA99_BASE_URL_TESTE: string;

  // IDs (o customer_id do Uber é diferente entre sandbox e produção)
  UBER_CUSTOMER_ID: string;
  UBER_CUSTOMER_ID_TESTE: string;
  /** Escopos OAuth2 pedidos ao Uber, separados por espaço. */
  UBER_SCOPE: string;
  /** Escopos da conta de TESTE — podem diferir dos de produção. */
  UBER_SCOPE_TESTE: string;
  IFOOD_MERCHANT_ID: string;

  // Cardápio Web — quem manda o pedido para cá.
  /** Nome do header que o Cardápio Web usa para assinar o webhook. */
  CARDAPIO_WEB_HEADER: string;
  /** Base da API do Cardápio Web, se um dia formos escrever de volta nela. */
  CARDAPIO_WEB_BASE_URL: string;
  CARDAPIO_WEB_MERCHANT_ID: string;

  // Motoboy próprio: a tabela de preço mora em src/config/faixas-motoboy.ts
  // (é uma lista de faixas, não cabe em env var).

  // Segredos (wrangler secret put ...)
  UBER_CLIENT_ID: string;
  UBER_CLIENT_SECRET: string;
  IFOOD_CLIENT_ID: string;
  IFOOD_CLIENT_SECRET: string;
  NOVA99_CLIENT_ID: string;
  NOVA99_CLIENT_SECRET: string;
  /** Valida o webhook do Cardápio Web. Sem ele, a rota recusa tudo. */
  WEBHOOK_SECRET: string;
  /** Assina/valida o JWT de sessão dos atendentes. Sem ele, ninguém entra. */
  JWT_SECRET: string;
  /** Token para o Hub chamar a API do Cardápio Web (opcional hoje). */
  CARDAPIO_WEB_TOKEN: string;
  /** Token OAuth do Cardápio Web. Se presente, tem prioridade sobre a API Key. */
  CARDAPIO_WEB_OAUTH_TOKEN: string;
  /** Signing key do webhook do Uber Direct (Dashboard > Developer > Webhooks). */
  UBER_WEBHOOK_SECRET: string;

  // --- Credenciais de TESTE (sandbox) ---------------------------------------
  // Conjunto completo e separado. Usadas quando o modo de operação é "teste".
  UBER_CLIENT_ID_TESTE: string;
  UBER_CLIENT_SECRET_TESTE: string;
  UBER_WEBHOOK_SECRET_TESTE: string;

  // Geocodificação (opcional). Sem chave, usa Nominatim/OpenStreetMap grátis.
  GOOGLE_MAPS_API_KEY: string;
}

// ---------------------------------------------------------------------------
// Domínio
// ---------------------------------------------------------------------------
/**
 * `uber` e `uber_carro` são a MESMA conta do Uber Direct. O que muda é o
 * tamanho declarado do pedido, que decide se vem moto ou carro e muda o preço.
 * Ficam separados porque o atendente escolhe um ou outro, e o relatório
 * precisa conseguir comparar os dois. Ver services/uber.ts.
 */
export type ProviderId = "uber" | "uber_carro" | "ifood" | "99" | "motoboy";

export interface Endereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  lat?: number; // se o Cardápio Web já geocodifica, ótimo
  lng?: number;
}

export interface Cliente {
  nome: string;
  telefone: string;
}

export interface ItemPedido {
  nome: string;
  quantidade: number;
  preco: number;
}

/** "despachando" = trava ativa, alguém está criando a corrida agora. */
export type StatusPedido = "recebido" | "cotado" | "despachando" | "despachado";

export interface Pedido {
  id: string;
  criadoEm: string;
  cliente: Cliente;
  endereco: Endereco;
  itens: ItemPedido[];
  /** O que o cliente pagou no total — JÁ INCLUI o frete. */
  total: number;
  /**
   * Frete que o CLIENTE pagou, definido pela tabela de raio do Cardápio Web.
   *
   * É a receita da entrega, e não muda conforme o parceiro escolhido. O preço
   * do Uber (ou do motoboy) é o CUSTO. A diferença entre os dois é o que a
   * loja ganha ou perde na entrega — é essa conta que o painel mostra.
   */
  freteCobrado: number;
  /** Total dos produtos, sem o frete. `total - freteCobrado`. */
  subtotal: number;
  /** Já foi pago? Pedido não pago não é cotado. */
  pago: boolean;
  /** Como foi pago, em português, para a tela ("Pix", "Cartão de crédito"). */
  formaPagamento?: string;
  observacao?: string;
  status: StatusPedido;
  /**
   * Status do pedido no Cardápio Web (o nosso `status` é o do despacho, são
   * coisas diferentes). Serve principalmente para barrar o despacho de um
   * pedido que a loja cancelou lá.
   */
  statusCardapio?: string | null;
  /** true = pedido de teste. Nunca é uma venda real da loja. */
  teste?: boolean;
}

// Resultado normalizado de cotação — todo provider devolve neste formato.
export interface Cotacao {
  provider: ProviderId;
  nome: string; // rótulo amigável para o painel
  disponivel: boolean;
  preco: number | null; // em R$ (reais), já convertido
  moeda: string;
  etaMinutos: number | null; // tempo estimado até a entrega
  quoteId: string | null; // id da cotação no parceiro (usado no despacho)
  expiraEm: string | null; // ISO — cotações têm validade curta
  erro?: string; // motivo, quando indisponível
  detalhe?: string; // memória de cálculo (ex: "3.42 km · faixa 3,5 km")
}

export interface ResultadoDespacho {
  provider: ProviderId;
  deliveryId: string;
  trackingUrl: string | null;
  status: string;
  /**
   * PIN que o cliente informa ao entregador na porta. Sem ele o entregador não
   * fecha a entrega, o que impede pedido entregue à pessoa errada.
   * Null quando o parceiro não oferece (é o caso do motoboy próprio).
   */
  codigoEntrega?: string | null;
}

// ---------------------------------------------------------------------------
// Usuários / sessão
// ---------------------------------------------------------------------------
export type Papel = "atendente" | "admin";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
}

/** Como o usuário aparece na tela de gestão. Nunca inclui hash de senha. */
export interface UsuarioListado extends Usuario {
  ativo: boolean;
  criadoEm: string;
  /** true = criado pelo admin e ainda não definiu a própria senha. */
  semSenha: boolean;
  /** Há um link de acesso emitido e ainda válido? */
  linkPendenteAte: string | null;
}

export type TipoTokenSenha = "convite" | "recuperacao";

/** Quais credenciais do parceiro usar. Ver config/modo.ts. */
export type ModoOperacao = "teste" | "producao";

// ---------------------------------------------------------------------------
// Webhooks de entrega
// ---------------------------------------------------------------------------

/** Status documentados do Uber Direct. */
export type StatusEntregaUber =
  | "pending"
  | "pickup"
  | "pickup_complete"
  | "dropoff"
  | "delivered"
  | "canceled"
  | "returned"
  | "shopping_completed";

export interface EventoEntrega {
  /** id do evento no parceiro — é a chave de idempotência. */
  id: string;
  provider: ProviderId;
  kind: string;
  status: string | null;
  deliveryIdExterno: string | null;
  criadoEmParceiro: string | null;
  liveMode: boolean | null;
  payload: string;
}

/** Campos que um webhook pode atualizar na entrega. Tudo opcional. */
export interface EstadoEntrega {
  status: string | null;
  trackingUrl: string | null;
  dropoffEta: string | null;
  courierNome: string | null;
  courierTelefone: string | null;
  courierVeiculo: string | null;
  courierLat: number | null;
  courierLng: number | null;
  liveMode: boolean | null;
}

/** Estado ao vivo devolvido ao painel. */
export interface EntregaAoVivo {
  provider: ProviderId;
  deliveryIdExterno: string | null;
  status: string | null;
  statusAtualizadoEm: string | null;
  trackingUrl: string | null;
  dropoffEta: string | null;
  courierNome: string | null;
  courierTelefone: string | null;
  courierVeiculo: string | null;
  liveMode: boolean | null;
}

/** Conteúdo do JWT. `sub` é o id do usuário (convenção JWT). */
export interface UsuarioSessao {
  sub: string;
  nome: string;
  email: string;
  papel: Papel;
}

// ---------------------------------------------------------------------------
// Listagem de pedidos (telas "Pedidos em Aberto" e "Histórico")
// ---------------------------------------------------------------------------
export interface PedidoResumo {
  id: string;
  criadoEm: string;
  status: StatusPedido;
  clienteNome: string;
  bairro: string;
  cidade: string;
  total: number;
  /** Frete cobrado do cliente — a receita da entrega. */
  freteCobrado: number;
  pago: boolean;
  itens: number;
  /** Preenchido quando já foi despachado. */
  despacho: (ResultadoDespacho & { valorPago: number | null }) | null;
  /** Menor preço disponível na última cotação, se houver. */
  melhorPreco: number | null;
  /** true = pedido simulado. O painel marca na tela para não confundir. */
  teste: boolean;
}

// ---------------------------------------------------------------------------
// Histórico de entregas (tela Histórico + exportação CSV)
// ---------------------------------------------------------------------------

/** Datas em YYYY-MM-DD, interpretadas no fuso de São Paulo. */
export interface FiltroHistorico {
  de?: string;
  ate?: string;
  plataforma?: string;
  status?: string;
  /** Casa com id do pedido, nome do cliente ou bairro. */
  busca?: string;
  /** "sim" = só simulados, "nao" = só reais, ausente = os dois. */
  teste?: "sim" | "nao";
  limite?: number;
  offset?: number;
}

export interface ItemHistorico {
  idPedido: string;
  dataCriacao: string;
  plataforma: ProviderId;
  /** CUSTO: o que a loja pagou ao parceiro. */
  valorPago: number;
  /** RECEITA: o que o cliente pagou de frete. */
  freteCobrado: number;
  /** `freteCobrado - valorPago`. Negativo = a loja bancou a diferença. */
  margem: number;
  etaMinutos: number | null;
  status: string;
  clienteNome: string | null;
  bairro: string | null;
  valorPedido: number | null;
  despachadoPor: string | null;
  courierNome: string | null;
  trackingUrl: string | null;
  liveMode: boolean | null;
  /** true = entrega simulada. Não conta nos Relatórios. */
  teste: boolean;
}

export interface RespostaHistorico {
  itens: ItemHistorico[];
  /** Totais do FILTRO INTEIRO, não só da página devolvida. */
  total: number;
  /** Custo com os parceiros. */
  somaFrete: number;
  /** Frete cobrado dos clientes. */
  somaFreteCobrado: number;
  /** Resultado das entregas: cobrado − custo. */
  somaMargem: number;
  somaPedidos: number;
}

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------
// O relatório é sobre O RESULTADO DA ENTREGA, não sobre gasto.
//
// O frete que o cliente paga vem da tabela de raio do Cardápio Web e não muda
// conforme o parceiro escolhido. Escolher Uber ou motoboy próprio não altera o
// que o cliente pagou — altera só quanto sobra para a loja. Por isso todo
// número aqui vem em trio: cobrado (receita), custo, e a diferença.
export interface Estatisticas {
  periodo: { de: string; ate: string; fuso: string };
  /**
   * true = entregas de teste estão somadas aqui (dev e homologação, onde tudo
   * é teste e um relatório vazio não demonstraria nada). Em produção é false.
   */
  incluiTestes: boolean;
  mes: {
    gastoTotal: number;
    freteCobrado: number;
    /** `freteCobrado - gastoTotal`. Negativo = a loja bancou a diferença. */
    margem: number;
    entregas: number;
    custoMedio: number;
    /** Margem média por entrega. */
    margemMedia: number;
    etaMedio: number | null;
  };
  porPlataforma: Array<{
    provider: ProviderId;
    nome: string;
    entregas: number;
    gastoTotal: number;
    freteCobrado: number;
    margem: number;
    custoMedio: number;
    margemMedia: number;
    etaMedio: number | null;
  }>;
  serieDiaria: Array<{
    dia: string;
    entregas: number;
    gasto: number;
    cobrado: number;
    margem: number;
  }>;
  total: {
    gastoTotal: number;
    freteCobrado: number;
    margem: number;
    entregas: number;
    custoMedio: number;
  };
}
