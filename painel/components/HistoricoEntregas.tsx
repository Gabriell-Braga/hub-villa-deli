"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ProviderId } from "@/lib/tipos";
import {
  COR_STATUS_ENTREGA,
  ROTULO_PROVEDOR,
  ROTULO_STATUS_ENTREGA,
} from "@/lib/tipos";
import { brl, brlOuGratis, dataHora } from "@/lib/formato";
import LogoProvedor from "./LogoProvedor";
import SeloTeste from "./SeloTeste";
import { SkeletonListaPedidos } from "./Skeleton";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Histórico com filtros e exportação.
//
// Os filtros vão para a URL da consulta e o CSV usa EXATAMENTE os mesmos —
// o arquivo baixado é sempre o que está na tela, nunca a base inteira.
// ---------------------------------------------------------------------------

interface Item {
  idPedido: string;
  dataCriacao: string;
  plataforma: ProviderId;
  valorPago: number;
  freteCobrado: number;
  margem: number;
  etaMinutos: number | null;
  status: string;
  clienteNome: string | null;
  bairro: string | null;
  valorPedido: number | null;
  courierNome: string | null;
  liveMode: boolean | null;
  teste: boolean;
}

interface Resposta {
  itens: Item[];
  total: number;
  somaFrete: number;
  somaFreteCobrado: number;
  somaMargem: number;
  somaPedidos: number;
}

interface Filtros {
  de: string;
  ate: string;
  plataforma: string;
  status: string;
  busca: string;
  teste: string;
}

const VAZIO: Filtros = {
  de: "",
  ate: "",
  plataforma: "",
  status: "",
  busca: "",
  teste: "",
};

/** Últimos N dias em YYYY-MM-DD, no fuso de São Paulo. */
function diaSP(offsetDias = 0): string {
  const d = new Date(Date.now() - offsetDias * 86400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Valor com sinal explícito: "+R$ 1,99" / "−R$ 3,00".
 *
 * Sem o sinal, um prejuízo de R$ 3 e um lucro de R$ 3 aparecem idênticos, e a
 * cor sozinha não basta — parte das pessoas não distingue verde de vermelho.
 */
function saldo(v: number): string {
  const sinal = v > 0 ? "+" : v < 0 ? "−" : "";
  return sinal + brl(Math.abs(v));
}

const ATALHOS = [
  { rotulo: "Hoje", dias: 0 },
  { rotulo: "7 dias", dias: 6 },
  { rotulo: "30 dias", dias: 29 },
];

/**
 * Qual atalho corresponde ao período atual — para destacar o botão certo.
 * Comparar as datas (em vez de guardar o atalho escolhido) faz o destaque
 * continuar correto quando o usuário mexe nos campos De/Até na mão.
 */
function atalhoAtivo(de: string, ate: string): number | null {
  if (!de || !ate || ate !== diaSP(0)) return null;
  return ATALHOS.find((a) => diaSP(a.dias) === de)?.dias ?? null;
}

const campo =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[var(--marca-primaria)] focus:ring-2 focus:ring-gray-200";

export default function HistoricoEntregas() {
  const [f, setF] = useState<Filtros>(VAZIO);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const query = useCallback(() => {
    const q = new URLSearchParams();
    (Object.keys(f) as (keyof Filtros)[]).forEach((k) => {
      if (f[k]) q.set(k, f[k]);
    });
    return q.toString();
  }, [f]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await apiFetch(`/api/historico?${query()}`);
      const json = await res.json();
      if (!res.ok) {
        setErro(json.erro ?? `Erro ${res.status} ao carregar.`);
        setDados(null);
        return;
      }
      setDados(json);
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [query]);

  // Espera o atendente parar de digitar antes de consultar.
  useEffect(() => {
    const t = setTimeout(carregar, 350);
    return () => clearTimeout(t);
  }, [carregar]);

  const set = (k: keyof Filtros, v: string) => setF((a) => ({ ...a, [k]: v }));
  const periodo = (dias: number) =>
    setF((a) => ({ ...a, de: diaSP(dias), ate: diaSP(0) }));

  const temFiltro = Object.values(f).some(Boolean);

  const ativo = atalhoAtivo(f.de, f.ate);

  return (
    <>
      {/* Cabeçalho com o seletor de período à direita, igual ao de Relatórios. */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Histórico</h1>
          <p className="mt-1 text-sm text-gray-500">
            Entregas despachadas, com a transportadora e o frete pago. Filtre e
            exporte para o Excel.
          </p>
        </div>

        <div className="flex w-full rounded-lg border border-gray-200 bg-white p-1 sm:w-auto">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              onClick={() => periodo(a.dias)}
              className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition sm:flex-none sm:py-1.5 ${
                ativo === a.dias
                  ? "bg-[var(--marca-primaria)] text-[var(--marca-contraste)]"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </header>

      {/* ---------------- Filtros ---------------- */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="block text-xs font-medium text-gray-500" htmlFor="de">
              De
            </label>
            <input
              id="de"
              type="date"
              value={f.de}
              max={f.ate || undefined}
              onChange={(e) => set("de", e.target.value)}
              className={`mt-1 ${campo}`}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500" htmlFor="ate">
              Até
            </label>
            <input
              id="ate"
              type="date"
              value={f.ate}
              min={f.de || undefined}
              onChange={(e) => set("ate", e.target.value)}
              className={`mt-1 ${campo}`}
            />
          </div>

          <div>
            <label
              className="block text-xs font-medium text-gray-500"
              htmlFor="plataforma"
            >
              Transportadora
            </label>
            <select
              id="plataforma"
              value={f.plataforma}
              onChange={(e) => set("plataforma", e.target.value)}
              className={`mt-1 ${campo}`}
            >
              <option value="">Todas</option>
              {(Object.keys(ROTULO_PROVEDOR) as ProviderId[]).map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PROVEDOR[p]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              value={f.status}
              onChange={(e) => set("status", e.target.value)}
              className={`mt-1 ${campo}`}
            >
              <option value="">Todos</option>
              <option value="delivered">Entregue</option>
              <option value="canceled">Cancelada</option>
              <option value="returned">Devolvida</option>
              <option value="acionado">Acionado</option>
              <option value="pending">Procurando entregador</option>
              <option value="pickup">A caminho da loja</option>
              <option value="dropoff">Saiu para entrega</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500" htmlFor="teste">
              Tipo
            </label>
            <select
              id="teste"
              value={f.teste}
              onChange={(e) => set("teste", e.target.value)}
              className={`mt-1 ${campo}`}
            >
              <option value="">Todas</option>
              <option value="nao">Somente reais</option>
              <option value="sim">Somente testes</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500" htmlFor="busca">
              Buscar
            </label>
            <input
              id="busca"
              value={f.busca}
              onChange={(e) => set("busca", e.target.value)}
              placeholder="Pedido, cliente ou bairro"
              className={`mt-1 ${campo}`}
            />
          </div>
        </div>

        {temFiltro && (
          <button
            onClick={() => setF(VAZIO)}
            className="mt-3 text-xs font-medium text-gray-500 underline-offset-2 transition hover:text-gray-900 hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </section>

      {/* ---------------- Resumo + exportar ----------------
          Três números na ordem da conta: o que entrou de frete, o que saiu
          para os parceiros, e o que sobrou. "Gasto com frete" sozinho não
          responde nada — a loja também RECEBEU frete. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {carregando ? (
          <p className="text-sm text-gray-600">Carregando...</p>
        ) : dados ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-gray-600">
              <strong className="text-gray-900">{dados.total}</strong>{" "}
              {dados.total === 1 ? "entrega" : "entregas"}
            </span>
            <span className="text-gray-600">
              Frete cobrado{" "}
              <strong className="text-gray-900">
                {brlOuGratis(dados.somaFreteCobrado)}
              </strong>
            </span>
            <span className="text-gray-600">
              Custo{" "}
              <strong className="text-gray-900">
                {brlOuGratis(dados.somaFrete)}
              </strong>
            </span>
            <span
              className={`rounded-lg px-2.5 py-1 font-semibold ${
                dados.somaMargem >= 0
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              Resultado {saldo(dados.somaMargem)}
            </span>
          </div>
        ) : (
          <span />
        )}

        {/* Link comum, não fetch: o navegador cuida do download sozinho e o
            nome do arquivo vem do cabeçalho que o Worker manda. */}
        <a
          href={`/api/historico/csv?${query()}`}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            dados && dados.total > 0
              ? "bg-[var(--marca-primaria)] text-[var(--marca-contraste)] hover:bg-[var(--marca-primaria-hover)]"
              : "pointer-events-none bg-gray-200 text-gray-400"
          }`}
        >
          Exportar CSV
        </a>
      </div>

      {/* ---------------- Resultado ---------------- */}
      {erro ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {erro}
        </div>
      ) : carregando ? (
        <SkeletonListaPedidos />
      ) : !dados || dados.itens.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center sm:p-12">
          <p className="text-3xl">🔎</p>
          <p className="mt-3 font-medium text-gray-900">
            {temFiltro ? "Nada encontrado com esses filtros" : "Nada no histórico ainda"}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {temFiltro
              ? "Tente ampliar o período ou limpar os filtros."
              : "As entregas despachadas aparecem aqui."}
          </p>
        </div>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="space-y-3 sm:hidden">
            {dados.itens.map((i) => (
              <li
                key={i.idPedido}
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">
                      {i.clienteNome ?? "—"}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      #{i.idPedido} · {dataHora(i.dataCriacao)}
                    </p>
                  </div>
                  {/* No celular não cabe a conta inteira: mostra o resultado,
                      que é o número que importa, e o custo abaixo em cinza. */}
                  <div className="shrink-0 text-right">
                    <p
                      className={`font-semibold ${
                        i.margem >= 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {saldo(i.margem)}
                    </p>
                    <p className="text-xs text-gray-400">
                      custo {brlOuGratis(i.valorPago)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {i.teste && <SeloTeste />}
                  <LogoProvedor provider={i.plataforma} tamanho={16} />
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      COR_STATUS_ENTREGA[i.status] ??
                      "bg-gray-100 text-gray-700 ring-gray-300"
                    }`}
                  >
                    {ROTULO_STATUS_ENTREGA[i.status] ?? i.status}
                  </span>
                  {i.bairro && (
                    <span className="text-xs text-gray-500">{i.bairro}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Tablet e desktop: tabela */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Pedido</th>
                    <th className="px-5 py-3 font-medium">Cliente</th>
                    <th className="hidden px-5 py-3 font-medium lg:table-cell">
                      Bairro
                    </th>
                    <th className="px-5 py-3 font-medium">Transportadora</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    {/* A conta lida da esquerda para a direita: cobrado − custo
                        = resultado. */}
                    <th className="hidden px-5 py-3 text-right font-medium md:table-cell">
                      Frete cobrado
                    </th>
                    <th className="px-5 py-3 text-right font-medium">Custo</th>
                    <th className="px-5 py-3 text-right font-medium">Resultado</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {dados.itens.map((i) => (
                    <tr key={i.idPedido} className="transition hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">#{i.idPedido}</p>
                          {i.teste && <SeloTeste />}
                        </div>
                        <p className="text-xs text-gray-400">
                          {dataHora(i.dataCriacao)}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-gray-900">
                        {i.clienteNome ?? "—"}
                      </td>
                      <td className="hidden px-5 py-3 text-gray-600 lg:table-cell">
                        {i.bairro || "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2 text-gray-700">
                          <LogoProvedor provider={i.plataforma} tamanho={16} />
                          {ROTULO_PROVEDOR[i.plataforma]}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            COR_STATUS_ENTREGA[i.status] ??
                            "bg-gray-100 text-gray-700 ring-gray-300"
                          }`}
                        >
                          {ROTULO_STATUS_ENTREGA[i.status] ?? i.status}
                        </span>
                      </td>
                      <td className="hidden px-5 py-3 text-right text-gray-600 md:table-cell">
                        {brlOuGratis(i.freteCobrado)}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {brlOuGratis(i.valorPago)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-semibold ${
                          i.margem >= 0 ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        {saldo(i.margem)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/pedidos/${encodeURIComponent(i.idPedido)}?de=historico`}
                          className="inline-block whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                        >
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {dados.total > dados.itens.length && (
            <p className="mt-4 text-center text-xs text-gray-400">
              Mostrando {dados.itens.length} de {dados.total}. Refine o período para
              ver o restante. A exportação inclui até 500 linhas do filtro.
            </p>
          )}
        </>
      )}
    </>
  );
}
