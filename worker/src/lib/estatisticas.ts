import type { Env, Estatisticas, ProviderId } from "../types";
import { nomeProvedor } from "../config/provedores";
import { ambiente } from "../config/ambiente";

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
  cobrado: number | null;
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
  cobrado: number | null;
}

export async function calcularEstatisticas(
  env: Env,
  diasDaSerie = 30
): Promise<Estatisticas> {
  const desdeMes = inicioDoMes();
  const desdeSerie = inicioDeNDiasAtras(diasDaSerie);

  // ENTREGAS DE TESTE: entram ou não, conforme o AMBIENTE.
  //
  // Em produção ficam de fora. O relatório de lá é lido como "quanto a loja
  // gastou", e simulação nossa não é gasto — misturada, viraria decisão de
  // negócio tomada em cima de número inventado.
  //
  // Em dev e homologação entram. Lá TODA entrega é de teste; excluí-las
  // deixava a tela permanentemente zerada, e um relatório vazio não mostra
  // que o relatório funciona. O painel avisa na tela qual dos dois é o caso.
  const soReais = ambiente(env) === "producao";

  // ENTREGAS FEITAS POR FORA DO HUB ficam de fora SEMPRE.
  //
  // São as marcadas em lote como "outra plataforma": o Hub não cotou nem
  // despachou, então não sabe o custo. Elas entram no banco com zero nos dois
  // lados (ver marcarEntregasEmLote), e somar zero aqui puxaria o custo médio
  // para baixo e inventaria uma margem que ninguém apurou. No Histórico elas
  // continuam visíveis, que é onde a pergunta é "o que aconteceu com o
  // pedido", não "quanto isso custou".
  const filtroTeste = [
    soReais ? "teste = 0" : null,
    "plataforma_escolhida <> 'outra'",
  ]
    .filter(Boolean)
    .join(" AND ");
  // Entregas que saíram POR FORA do Hub, no mesmo período. Contadas à parte,
  // sem valores: é volume que o Hub não cotou nem despachou, e é o número que
  // justifica (ou não) integrar iFood e 99.
  const filtroOutras = [
    soReais ? "teste = 0" : null,
    "plataforma_escolhida = 'outra'",
  ]
    .filter(Boolean)
    .join(" AND ");

  const [resumo, porPlataforma, serie, geral, outras] = await env.DB.batch([
    // 1) Totais do mês corrente
    env.DB.prepare(
      `SELECT COUNT(*)             AS qtd,
              SUM(valor_pago)      AS total,
              SUM(frete_cobrado)   AS cobrado,
              AVG(valor_pago)      AS media,
              AVG(eta_minutos)     AS eta
         FROM deliveries
        WHERE ${filtroTeste} AND data_criacao >= ?1`
    ).bind(desdeMes),

    // 2) Quebra por plataforma, no mês
    env.DB.prepare(
      `SELECT plataforma_escolhida,
              COUNT(*)           AS qtd,
              SUM(valor_pago)    AS total,
              SUM(frete_cobrado) AS cobrado,
              AVG(valor_pago)    AS media,
              AVG(eta_minutos)   AS eta
         FROM deliveries
        WHERE ${filtroTeste} AND data_criacao >= ?1
        GROUP BY plataforma_escolhida
        ORDER BY total DESC`
    ).bind(desdeMes),

    // 3) Série diária para o gráfico. O '-3 hours' joga a data para SP antes
    //    de agrupar — sem isso, entregas da noite caem no dia seguinte.
    env.DB.prepare(
      `SELECT date(data_criacao, '-3 hours') AS dia,
              COUNT(*)           AS qtd,
              SUM(valor_pago)    AS total,
              SUM(frete_cobrado) AS cobrado
         FROM deliveries
        WHERE ${filtroTeste} AND data_criacao >= ?1
        GROUP BY dia
        ORDER BY dia`
    ).bind(desdeSerie),

    // 4) Acumulado de todos os tempos (rodapé do relatório)
    env.DB.prepare(
      `SELECT COUNT(*)           AS qtd,
              SUM(valor_pago)    AS total,
              SUM(frete_cobrado) AS cobrado,
              AVG(valor_pago)    AS media,
              AVG(eta_minutos)   AS eta
         FROM deliveries
        WHERE ${filtroTeste}`
    ),

    // 5) Entregas por fora do Hub. Só a contagem, no mês e no acumulado.
    env.DB.prepare(
      `SELECT COUNT(*) AS qtd,
              SUM(CASE WHEN data_criacao >= ?1 THEN 1 ELSE 0 END) AS qtd_mes
         FROM deliveries
        WHERE ${filtroOutras}`
    ).bind(desdeMes),
  ]);

  const r = (resumo.results as unknown as LinhaResumo[])[0];
  const g = (geral.results as unknown as LinhaResumo[])[0];

  const num = (v: number | null | undefined) =>
    v == null ? 0 : Math.round(v * 100) / 100;

  /** Receita menos custo. Sempre calculado aqui, nunca somado no SQL. */
  const margem = (cobrado: number | null | undefined, custo: number | null | undefined) =>
    num((cobrado ?? 0) - (custo ?? 0));

  const porEntrega = (v: number, qtd: number) => (qtd ? num(v / qtd) : 0);

  const mesMargem = margem(r?.cobrado, r?.total);
  const geralMargem = margem(g?.cobrado, g?.total);

  const o = (outras.results as unknown as { qtd: number; qtd_mes: number }[])[0];

  return {
    periodo: { de: desdeMes, ate: new Date().toISOString(), fuso: FUSO },

    // Sem valores de propósito: o Hub não sabe o que a loja pagou ao parceiro
    // que fez essas entregas. Contá-las junto inventaria margem; escondê-las
    // esconderia volume real da operação.
    outrasPlataformas: {
      entregasMes: o?.qtd_mes ?? 0,
      entregasTotal: o?.qtd ?? 0,
    },
    // O painel precisa DIZER na tela o que está somando. Um número que às
    // vezes inclui teste e às vezes não, sem avisar, é pior que não ter.
    incluiTestes: !soReais,

    mes: {
      gastoTotal: num(r?.total),
      freteCobrado: num(r?.cobrado),
      margem: mesMargem,
      entregas: r?.qtd ?? 0,
      custoMedio: num(r?.media),
      margemMedia: porEntrega(mesMargem, r?.qtd ?? 0),
      etaMedio: r?.eta == null ? null : Math.round(r.eta),
    },

    porPlataforma: (porPlataforma.results as unknown as LinhaPlataforma[]).map(
      (l) => {
        const m = margem(l.cobrado, l.total);
        return {
          provider: l.plataforma_escolhida as ProviderId,
          nome: nomeProvedor(l.plataforma_escolhida as ProviderId),
          entregas: l.qtd,
          gastoTotal: num(l.total),
          freteCobrado: num(l.cobrado),
          margem: m,
          custoMedio: num(l.media),
          // É esta coluna que responde "qual parceiro compensa mais". Comparar
          // só o custo médio esconde que as faixas de frete são diferentes.
          margemMedia: porEntrega(m, l.qtd),
          etaMedio: l.eta == null ? null : Math.round(l.eta),
        };
      }
    ),

    serieDiaria: (serie.results as unknown as LinhaDia[]).map((l) => ({
      dia: l.dia,
      entregas: l.qtd,
      gasto: num(l.total),
      cobrado: num(l.cobrado),
      margem: margem(l.cobrado, l.total),
    })),

    total: {
      gastoTotal: num(g?.total),
      freteCobrado: num(g?.cobrado),
      margem: geralMargem,
      entregas: g?.qtd ?? 0,
      custoMedio: num(g?.media),
    },
  };
}
