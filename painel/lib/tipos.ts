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
}

export interface CotacaoResponse {
  idPedido: string;
  pedido: PedidoDetalhe;
  maisBarato: ProviderId | null;
  cotacoes: Cotacao[];
  despacho: Despacho | null;
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

export const EMOJI_PROVEDOR: Record<ProviderId, string> = {
  uber: "🚗",
  ifood: "🍔",
  "99": "🛵",
  motoboy: "🏍️",
};

/** Cores por plataforma — usadas nos gráficos e badges. */
export const COR_PROVEDOR: Record<ProviderId, string> = {
  uber: "#111827",
  ifood: "#EA1D2C",
  "99": "#FFC700",
  motoboy: "#6B7280", // cinza neutro: o motoboy é "da casa", sem marca de parceiro
};
