import type {
  Env,
  FiltroHistorico,
  ItemHistorico,
  ProviderId,
  RespostaHistorico,
} from "../types";
import { nomeProvedor } from "../config/provedores";

// ---------------------------------------------------------------------------
// Histórico de entregas, com filtros e exportação.
//
// A base é `deliveries`, NÃO `pedidos`. Motivo concreto: o cron apaga pedidos
// despachados com mais de 30 dias, então um histórico montado sobre `pedidos`
// se esvaziaria sozinho. `deliveries` é o registro contábil e não é limpo.
//
// Fuso: as datas do filtro chegam como YYYY-MM-DD e são o dia em São Paulo.
// `data_criacao` está em UTC, então converter é obrigatório — sem isso um
// pedido das 22h do dia 5 cairia no dia 6 do relatório.
// ---------------------------------------------------------------------------

const OFFSET_SP = "-03:00";

/** Início do dia (SP) em ISO UTC. */
function inicioDoDia(data: string): string {
  return new Date(`${data}T00:00:00${OFFSET_SP}`).toISOString();
}

/** Início do dia SEGUINTE — usado como limite exclusivo, para incluir o dia todo. */
function fimDoDia(data: string): string {
  const d = new Date(`${data}T00:00:00${OFFSET_SP}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

const ehData = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const PLATAFORMAS: ProviderId[] = ["uber", "ifood", "99", "motoboy"];

/**
 * Monta o WHERE e os valores. Tudo por bind — nunca concatenando entrada do
 * usuário no SQL.
 */
function montarFiltro(f: FiltroHistorico): { where: string; valores: unknown[] } {
  const cond: string[] = [];
  const valores: unknown[] = [];
  const p = () => `?${valores.length + 1}`;

  if (ehData(f.de)) {
    cond.push(`data_criacao >= ${p()}`);
    valores.push(inicioDoDia(f.de!));
  }
  if (ehData(f.ate)) {
    cond.push(`data_criacao < ${p()}`);
    valores.push(fimDoDia(f.ate!));
  }
  if (f.plataforma && PLATAFORMAS.includes(f.plataforma as ProviderId)) {
    cond.push(`plataforma_escolhida = ${p()}`);
    valores.push(f.plataforma);
  }
  if (f.status && f.status.trim()) {
    cond.push(`COALESCE(status_ao_vivo, status) = ${p()}`);
    valores.push(f.status.trim());
  }
  // Sem filtro = mostra tudo. O Histórico é a tela onde as duas coisas
  // convivem; quem quer só o real usa este filtro (ou o Relatórios, que já
  // exclui teste sempre).
  if (f.teste === "sim") cond.push(`teste = 1`);
  if (f.teste === "nao") cond.push(`teste = 0`);

  const busca = f.busca?.trim();
  if (busca) {
    // LIKE com escape: sem isso um "%" digitado pelo atendente casaria com tudo.
    const termo = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const a = p();
    valores.push(termo);
    const b = p();
    valores.push(termo);
    const c = p();
    valores.push(termo);
    cond.push(
      `(id_pedido LIKE ${a} ESCAPE '\\' OR cliente_nome LIKE ${b} ESCAPE '\\' OR bairro LIKE ${c} ESCAPE '\\')`
    );
  }

  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", valores };
}

interface Linha {
  id_pedido: string;
  data_criacao: string;
  plataforma_escolhida: string;
  valor_pago: number;
  eta_minutos: number | null;
  status: string;
  status_ao_vivo: string | null;
  cliente_nome: string | null;
  bairro: string | null;
  valor_pedido: number | null;
  despachado_por: string | null;
  courier_nome: string | null;
  tracking_url: string | null;
  live_mode: number | null;
  teste: number;
}

const paraItem = (l: Linha): ItemHistorico => ({
  idPedido: l.id_pedido,
  dataCriacao: l.data_criacao,
  plataforma: l.plataforma_escolhida as ProviderId,
  valorPago: l.valor_pago,
  etaMinutos: l.eta_minutos,
  status: l.status_ao_vivo ?? l.status,
  clienteNome: l.cliente_nome,
  bairro: l.bairro,
  valorPedido: l.valor_pedido,
  despachadoPor: l.despachado_por,
  courierNome: l.courier_nome,
  trackingUrl: l.tracking_url,
  liveMode: l.live_mode === null ? null : l.live_mode === 1,
  teste: l.teste === 1,
});

const COLUNAS = `id_pedido, data_criacao, plataforma_escolhida, valor_pago,
  eta_minutos, status, status_ao_vivo, cliente_nome, bairro, valor_pedido,
  despachado_por, courier_nome, tracking_url, live_mode, teste`;

export async function listarHistorico(
  env: Env,
  f: FiltroHistorico
): Promise<RespostaHistorico> {
  const { where, valores } = montarFiltro(f);
  const limite = Math.min(Math.max(f.limite ?? 100, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);

  const [pagina, totais] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${COLUNAS} FROM deliveries ${where}
        ORDER BY data_criacao DESC
        LIMIT ?${valores.length + 1} OFFSET ?${valores.length + 2}`
    ).bind(...valores, limite, offset),

    // Totais do filtro inteiro. O rodapé precisa somar tudo o que foi
    // filtrado, não só a página que está na tela.
    env.DB.prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(valor_pago), 0)   AS frete,
              COALESCE(SUM(valor_pedido), 0) AS pedidos
         FROM deliveries ${where}`
    ).bind(...valores),
  ]);

  const t = (totais.results as unknown as {
    n: number;
    frete: number;
    pedidos: number;
  }[])[0];

  return {
    itens: (pagina.results as unknown as Linha[]).map(paraItem),
    total: t?.n ?? 0,
    somaFrete: Math.round((t?.frete ?? 0) * 100) / 100,
    somaPedidos: Math.round((t?.pedidos ?? 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// CSV
//
// Feito para abrir no Excel em português sem ninguém precisar mexer em nada:
//   - separador PONTO E VÍRGULA (o Excel pt-BR usa vírgula como decimal, e com
//     separador vírgula ele joga tudo numa coluna só)
//   - decimal com VÍRGULA
//   - BOM UTF-8 no começo, senão acento vira caractere quebrado
// ---------------------------------------------------------------------------

const SEP = ";";

function celula(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Aspas, separador ou quebra de linha exigem envolver em aspas e dobrar as
  // aspas internas.
  return /["\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dinheiro = (v: number | null) =>
  v === null || v === undefined ? "" : v.toFixed(2).replace(".", ",");

const dataSP = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const horaSP = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

const ROTULO_STATUS: Record<string, string> = {
  pending: "Procurando entregador",
  pickup: "A caminho da loja",
  pickup_complete: "Coletado",
  dropoff: "Saiu para entrega",
  delivered: "Entregue",
  canceled: "Cancelada",
  returned: "Devolvida",
  acionado: "Acionado",
};

export async function historicoCsv(env: Env, f: FiltroHistorico): Promise<string> {
  // Exporta o filtro INTEIRO, não a página da tela. Um CSV que traz só as 100
  // primeiras linhas é pior que não exportar: parece completo e não é.
  const r = await listarHistorico(env, { ...f, limite: 500, offset: 0 });

  const cab = [
    "Pedido",
    "Data",
    "Hora",
    "Transportadora",
    "Status",
    "Cliente",
    "Bairro",
    "Frete (R$)",
    "Total do pedido (R$)",
    "ETA (min)",
    "Entregador",
    "Despachado por",
    "Ambiente",
  ];

  const linhas = r.itens.map((i) =>
    [
      celula(i.idPedido),
      celula(dataSP(i.dataCriacao)),
      celula(horaSP(i.dataCriacao)),
      celula(nomeProvedor(i.plataforma)),
      celula(ROTULO_STATUS[i.status] ?? i.status),
      celula(i.clienteNome),
      celula(i.bairro),
      celula(dinheiro(i.valorPago)),
      celula(dinheiro(i.valorPedido)),
      celula(i.etaMinutos),
      celula(i.courierNome),
      celula(i.despachadoPor),
      // A coluna `teste` é a fonte de verdade: vale para todo provedor. O
      // liveMode só existe quando o parceiro manda webhook (o motoboy não
      // manda), então sozinho ele deixava metade das linhas em branco.
      celula(i.teste ? "Teste" : "Real"),
    ].join(SEP)
  );

  // Linha de total no fim — é o número que o dono do restaurante procura.
  const total = [
    celula(`TOTAL (${r.total} entregas)`),
    "",
    "",
    "",
    "",
    "",
    "",
    celula(dinheiro(r.somaFrete)),
    celula(dinheiro(r.somaPedidos)),
    "",
    "",
    "",
    "",
  ].join(SEP);

  return "﻿" + [cab.join(SEP), ...linhas, total].join("\r\n") + "\r\n";
}

/** Nome do arquivo, já refletindo o filtro aplicado. */
export function nomeArquivoCsv(f: FiltroHistorico): string {
  const partes = ["entregas"];
  if (ehData(f.de)) partes.push(f.de!);
  if (ehData(f.ate)) partes.push(f.ate!);
  if (f.plataforma) partes.push(f.plataforma);
  return `${partes.join("-")}.csv`;
}
