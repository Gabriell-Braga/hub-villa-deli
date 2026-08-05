// Espelho dos tipos que o Worker devolve. Mantido à mão de propósito: o painel
// e o Worker são deployados separados, então um `import` entre eles criaria um
// acoplamento de build que não existe em runtime.

export type ProviderId = "uber" | "ifood" | "99" | "motoboy";
export type Papel = "atendente" | "admin";
export type StatusPedido = "recebido" | "cotado" | "despachando" | "despachado";

export interface Cotacao {
  provider: ProviderId;
  nome: string;
  disponivel: boolean;
  preco: number | null;
  moeda: string;
  etaMinutos: number | null;
  quoteId: string | null;
  expiraEm: string | null;
  erro?: string;
  detalhe?: string;
}

export interface Despacho {
  provider: ProviderId;
  deliveryId: string;
  trackingUrl: string | null;
  status: string;
}

export interface PedidoDetalhe {
  id: string;
  criadoEm: string;
  status: StatusPedido;
  cliente: { nome: string; telefone: string };
  endereco: {
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  };
  itens: Array<{ nome: string; quantidade: number; preco: number }>;
  total: number;
  observacao?: string;
  /** Status do pedido lá no Cardápio Web — o `status` acima é o do despacho. */
  statusCardapio?: string | null;
  /** true = pedido simulado. Não é uma venda da loja. */
  teste?: boolean;
}

/** Estado ao vivo da entrega, alimentado pelos webhooks do parceiro. */
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
  /** false = evento de teste (credenciais de sandbox). */
  liveMode: boolean | null;
}

/** Status do Uber Direct em português, na ordem do ciclo de vida. */
export const ROTULO_STATUS_ENTREGA: Record<string, string> = {
  pending: "Procurando entregador",
  pickup: "A caminho da loja",
  pickup_complete: "Pedido coletado",
  dropoff: "Saiu para entrega",
  delivered: "Entregue",
  canceled: "Cancelada",
  returned: "Devolvida",
  shopping_completed: "Compras concluídas",
  acionado: "Acionado",
};

/** Cor do selo por status. */
export const COR_STATUS_ENTREGA: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  pickup: "bg-blue-50 text-blue-700 ring-blue-200",
  pickup_complete: "bg-blue-50 text-blue-700 ring-blue-200",
  dropoff: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  canceled: "bg-red-50 text-red-700 ring-red-200",
  returned: "bg-red-50 text-red-700 ring-red-200",
};

export interface CotacaoResponse {
  idPedido: string;
  pedido: PedidoDetalhe;
  maisBarato: ProviderId | null;
  cotacoes: Cotacao[];
  despacho: Despacho | null;
  entrega: EntregaAoVivo | null;
}

export interface PedidoResumo {
  id: string;
  criadoEm: string;
  status: StatusPedido;
  clienteNome: string;
  bairro: string;
  cidade: string;
  total: number;
  itens: number;
  despacho: (Despacho & { valorPago: number | null }) | null;
  melhorPreco: number | null;
  /** true = pedido simulado. Não é uma venda da loja. */
  teste: boolean;
}

export interface Estatisticas {
  periodo: { de: string; ate: string; fuso: string };
  mes: {
    gastoTotal: number;
    entregas: number;
    custoMedio: number;
    etaMedio: number | null;
  };
  porPlataforma: Array<{
    provider: ProviderId;
    nome: string;
    entregas: number;
    gastoTotal: number;
    custoMedio: number;
    etaMedio: number | null;
  }>;
  serieDiaria: Array<{ dia: string; entregas: number; gasto: number }>;
  total: { gastoTotal: number; entregas: number; custoMedio: number };
}

export const ROTULO_PROVEDOR: Record<ProviderId, string> = {
  uber: "Uber Direct",
  ifood: "iFood Entrega Fácil",
  "99": "99 Entregas",
  motoboy: "Motoboy Próprio",
};

/** Cores por plataforma — usadas nos gráficos e badges. */
export const COR_PROVEDOR: Record<ProviderId, string> = {
  uber: "#111827",
  ifood: "#EA1D2C",
  "99": "#FFC700",
  motoboy: "#6B7280", // cinza neutro: o motoboy é "da casa", sem marca de parceiro
};
