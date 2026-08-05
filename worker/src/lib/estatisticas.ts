import type { Env, Estatisticas, ProviderId } from "../types";
import { nomeProvedor } from "../config/provedores";

// ---------------------------------------------------------------------------
// Agregações da tabela `deliveries` para a tela de Relatórios.
//
// Fuso: as datas são gravadas em UTC. O restaurante raciocina em horário de
// Brasília, então "gasto do mês" precisa ser o mês em São Paulo, não em UTC.
// Uma entrega das 22h do dia 31 já é dia 1 em UTC — sem converter, ela cairia
// no mês errado. O Brasil não usa mais horário de verão desde 2019, então
// -03:00 fixo é seguro.
// ---------------------------------------------------------------------------

const FUSO = "America/Sao_Paulo";
const OFFSET = "-03:00";

/** Primeiro instante do mês corrente (em SP), como ISO UTC. */
export function inicioDoMes(agora = new Date()): string {
  const [ano, mes] = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
  })
    .format(agora)
    .split("-");

  return new Date(`${ano}-${mes}-01T00:00:00${OFFSET}`).toISOString();
}

/** Início do dia (em SP) de N dias atrás, como ISO UTC. */
export function inicioDeNDiasAtras(dias: number, agora = new Date()): string {
  const alvo = new Date(agora.getTime() - dias * 86_400_000);
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(alvo);

  return new Date(`${data}T00:00:00${OFFSET}`).toISOString();
}

interface LinhaResumo {
  qtd: number;
  total: number | null;
  media: number | null;
  eta: number | null;
}

interface LinhaPlataforma extends LinhaResumo {
  plataforma_escolhida: string;
}

interface LinhaDia {
  dia: string;
  qtd: number;
  total: number | null;
}

export async function calcularEstatisticas(
  env: Env,
  diasDaSerie = 30
): Promise<Estatisticas> {
  const desdeMes = inicioDoMes();
  const desdeSerie = inicioDeNDiasAtras(diasDaSerie);

  // ENTREGAS DE TESTE FICAM DE FORA (`teste = 0`) em todas as consultas.
  // Este relatório é lido como "quanto a loja gastou". Simulação nossa não é
  // gasto, e misturada aqui viraria uma decisão de negócio tomada em cima de
  // número inventado. Elas continuam visíveis no Histórico, com o selo.
  const [resumo, porPlataforma, serie, geral] = await env.DB.batch([
    // 1) Totais do mês corrente
    env.DB.prepare(
      `SELECT COUNT(*)             AS qtd,
              SUM(valor_pago)      AS total,
              AVG(valor_pago)      AS media,
              AVG(eta_minutos)     AS eta
         FROM deliveries
        WHERE teste = 0 AND data_criacao >= ?1`
    ).bind(desdeMes),

    // 2) Quebra por plataforma, no mês
    env.DB.prepare(
      `SELECT plataforma_escolhida,
              COUNT(*)         AS qtd,
              SUM(valor_pago)  AS total,
              AVG(valor_pago)  AS media,
              AVG(eta_minutos) AS eta
         FROM deliveries
        WHERE teste = 0 AND data_criacao >= ?1
        GROUP BY plataforma_escolhida
        ORDER BY total DESC`
    ).bind(desdeMes),

    // 3) Série diária para o gráfico. O '-3 hours' joga a data para SP antes
    //    de agrupar — sem isso, entregas da noite caem no dia seguinte.
    env.DB.prepare(
      `SELECT date(data_criacao, '-3 hours') AS dia,
              COUNT(*)        AS qtd,
              SUM(valor_pago) AS total
         FROM deliveries
        WHERE teste = 0 AND data_criacao >= ?1
        GROUP BY dia
        ORDER BY dia`
    ).bind(desdeSerie),

    // 4) Acumulado de todos os tempos (rodapé do relatório)
    env.DB.prepare(
      `SELECT COUNT(*)        AS qtd,
              SUM(valor_pago) AS total,
              AVG(valor_pago) AS media,
              AVG(eta_minutos) AS eta
         FROM deliveries
        WHERE teste = 0`
    ),
  ]);

  const r = (resumo.results as unknown as LinhaResumo[])[0];
  const g = (geral.results as unknown as LinhaResumo[])[0];

  const num = (v: number | null | undefined) =>
    v == null ? 0 : Math.round(v * 100) / 100;

  return {
    periodo: { de: desdeMes, ate: new Date().toISOString(), fuso: FUSO },

    mes: {
      gastoTotal: num(r?.total),
      entregas: r?.qtd ?? 0,
      custoMedio: num(r?.media),
      etaMedio: r?.eta == null ? null : Math.round(r.eta),
    },

    porPlataforma: (porPlataforma.results as unknown as LinhaPlataforma[]).map(
      (l) => ({
        provider: l.plataforma_escolhida as ProviderId,
        nome: nomeProvedor(l.plataforma_escolhida as ProviderId),
        entregas: l.qtd,
        gastoTotal: num(l.total),
        custoMedio: num(l.media),
        etaMedio: l.eta == null ? null : Math.round(l.eta),
      })
    ),

    serieDiaria: (serie.results as unknown as LinhaDia[]).map((l) => ({
      dia: l.dia,
      entregas: l.qtd,
      gasto: num(l.total),
    })),

    total: {
      gastoTotal: num(g?.total),
      entregas: g?.qtd ?? 0,
      custoMedio: num(g?.media),
    },
  };
}
