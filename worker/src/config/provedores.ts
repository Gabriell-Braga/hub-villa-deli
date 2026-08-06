import type {
  Cotacao,
  Env,
  ModoOperacao,
  Pedido,
  ProviderId,
  ResultadoDespacho,
} from "../types";
import { cotarUber, despacharUber } from "../services/uber";
import { cotarIfood, despacharIfood } from "../services/ifood";
import { cotar99, despachar99 } from "../services/noventa99";
import { cotarMotoboy, despacharMotoboy } from "../services/motoboy";

// ---------------------------------------------------------------------------
// TRAVA DE PROVEDORES
//
// Um único lugar decide quem entra na cotação e quem pode receber despacho.
// Provedor desligado: não é cotado, não aparece no painel e o /api/despachar
// recusa (mesmo que alguém chame a API na mão).
//
// Duas formas de ligar/desligar — a de cima vence:
//
//   1) Variável PROVEDORES_ATIVOS no wrangler.toml (ou no dashboard da
//      Cloudflare). Lista separada por vírgula. Muda sem mexer em código:
//          PROVEDORES_ATIVOS = "uber"
//          PROVEDORES_ATIVOS = "uber,motoboy"
//      Deixe "" (vazio) para cair na regra 2.
//
//   2) O campo `ativo` da tabela abaixo — o padrão de fábrica.
// ---------------------------------------------------------------------------

export interface Provedor {
  id: ProviderId;
  nome: string;
  /** Padrão de fábrica. Só vale quando PROVEDORES_ATIVOS está vazio. */
  ativo: boolean;
  cotar: (env: Env, pedido: Pedido, modo: ModoOperacao) => Promise<Cotacao>;
  despachar: (
    env: Env,
    pedido: Pedido,
    cotacao: Cotacao,
    modo: ModoOperacao
  ) => Promise<ResultadoDespacho>;
}

export const PROVEDORES: Record<ProviderId, Provedor> = {
  // Um card só. Chegou a haver "Uber Moto" e "Uber Carro" separados, mas a
  // API não tem como escolher veículo e os dois voltavam com preço idêntico —
  // ver o comentário longo em services/uber.ts.
  uber: {
    id: "uber",
    nome: "Uber Direct",
    ativo: true,
    cotar: cotarUber,
    despachar: despacharUber,
  },
  ifood: {
    id: "ifood",
    nome: "iFood Entrega Fácil",
    // Desligado: endpoints de logística ainda não confirmados no contrato B2B.
    ativo: false,
    cotar: cotarIfood,
    despachar: despacharIfood,
  },
  "99": {
    id: "99",
    nome: "99 Entregas",
    // Desligado: a 99 não tem API pública; depende do contrato corporativo.
    ativo: false,
    cotar: cotar99,
    despachar: despachar99,
  },
  motoboy: {
    id: "motoboy",
    nome: "Motoboy Próprio",
    // Ligado: cota offline pela tabela de raio em config/faixas-motoboy.ts,
    // sem depender de API de parceiro.
    ativo: true,
    cotar: cotarMotoboy,
    despachar: despacharMotoboy,
  },
};

const TODOS_IDS = Object.keys(PROVEDORES) as ProviderId[];

function ehProviderId(v: string): v is ProviderId {
  return (TODOS_IDS as string[]).includes(v);
}

/** Lista de provedores que devem ser cotados/despachados agora. */
export function provedoresAtivos(env: Env): Provedor[] {
  const daEnv = (env.PROVEDORES_ATIVOS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (daEnv.length > 0) {
    // Ignora nomes inválidos em silêncio seria pior: melhor não cotar do que
    // cotar quem não devia. Nomes desconhecidos simplesmente não entram.
    return daEnv.filter(ehProviderId).map((id) => PROVEDORES[id]);
  }

  return TODOS_IDS.map((id) => PROVEDORES[id]).filter((p) => p.ativo);
}

/** O provedor está ligado? Usado como trava no /api/despachar. */
export function provedorAtivo(env: Env, id: string): Provedor | null {
  return provedoresAtivos(env).find((p) => p.id === id) ?? null;
}

/** Nome amigável mesmo para provedor desligado (mensagens de erro). */
export function nomeProvedor(id: ProviderId): string {
  return PROVEDORES[id]?.nome ?? id;
}
