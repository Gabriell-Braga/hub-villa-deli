"use client";

import { useCallback, useEffect, useState } from "react";
import type { Estatisticas } from "@/lib/tipos";
import { COR_PROVEDOR } from "@/lib/tipos";
import LogoProvedor from "@/components/LogoProvedor";
import { brl } from "@/lib/formato";
import StatCard from "@/components/StatCard";
import { Skeleton, SkeletonGraficoBarras } from "@/components/Skeleton";
import { MARCA } from "@/config/marca";
import { EntregasPorPlataforma, FretePorDia } from "@/components/GraficoGastos";
import { apiFetch } from "@/lib/api";

const JANELAS = [7, 30, 90];

/**
 * Resultado com sinal explícito: "+R$ 12,40" / "−R$ 3,00".
 *
 * A cor sozinha não serve como único sinal — parte das pessoas não distingue
 * verde de vermelho, e num relatório de dinheiro confundir lucro com prejuízo
 * é o pior erro possível.
 */
const comSinal = (v: number) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + brl(Math.abs(v));

export default function PaginaRelatorios() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Estatisticas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await apiFetch(`/api/estatisticas?dias=${dias}`);
      const json = await res.json();
      if (!res.ok) {
        setErro(json.erro ?? `Erro ${res.status} ao carregar o relatório.`);
        setDados(null);
        return;
      }
      setDados(json);
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const mes = dados?.mes;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Relatórios</h1>
          <p className="mt-1 text-sm text-gray-500">
            Resultado das entregas no mês corrente: o frete que os clientes
            pagaram menos o que foi pago às transportadoras.
          </p>
          {/* Só aparece fora de produção. Lá o relatório é só de venda real e
              a frase não teria por que existir. */}
          {dados?.incluiTestes && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300">
              Ambiente de teste: as entregas simuladas estão somadas aqui
            </p>
          )}
        </div>

        {/* No celular ocupa a linha inteira: três alvos de toque confortáveis
            valem mais que economizar espaço horizontal. */}
        <div className="flex w-full rounded-lg border border-gray-200 bg-white p-1 sm:w-auto">
          {JANELAS.map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition sm:flex-none sm:py-1.5 ${
                dias === d
                  ? "bg-[var(--marca-primaria)] text-[var(--marca-contraste)]"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </header>

      {erro && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {erro}
        </div>
      )}

      {/* Stat cards — a conta na ordem em que se lê:
          entrou de frete, saiu para o parceiro, sobrou isto. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          rotulo="Frete cobrado no mês"
          valor={brl(mes?.freteCobrado ?? 0)}
          detalhe="O que os clientes pagaram de entrega"
          cor="#059669"
          carregando={carregando}
        />
        <StatCard
          rotulo="Custo com transportadoras"
          valor={brl(mes?.gastoTotal ?? 0)}
          detalhe="O que a loja pagou aos parceiros"
          cor={MARCA.cores.primaria}
          carregando={carregando}
        />
        <StatCard
          rotulo="Resultado das entregas"
          valor={comSinal(mes?.margem ?? 0)}
          detalhe={`${mes?.entregas ?? 0} entregas · ${comSinal(
            mes?.margemMedia ?? 0
          )} por entrega`}
          tom={(mes?.margem ?? 0) >= 0 ? "positivo" : "negativo"}
          carregando={carregando}
        />
        <StatCard
          rotulo="Tempo médio estimado"
          valor={mes?.etaMedio != null ? `${mes.etaMedio} min` : "—"}
          detalhe="ETA informado na cotação"
          carregando={carregando}
        />
      </div>

      {/* Um card por plataforma. A pergunta não é "quanto gastei com o Uber",
          é "com qual parceiro a loja sai ganhando" — por isso o número grande
          é o resultado, e o custo fica no detalhe. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Por plataforma, no mês
      </h2>

      {carregando ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
      ) : dados && dados.porPlataforma.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {dados.porPlataforma.map((p) => (
            <StatCard
              key={p.provider}
              rotulo={
                <>
                  <LogoProvedor provider={p.provider} tamanho={18} />
                  {p.nome}
                </>
              }
              valor={comSinal(p.margem)}
              detalhe={`${p.entregas} entregas · custo médio ${brl(
                p.custoMedio
              )} · ${comSinal(p.margemMedia)} por entrega`}
              tom={p.margem >= 0 ? "positivo" : "negativo"}
              cor={COR_PROVEDOR[p.provider]}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Nenhuma entrega despachada este mês.
        </div>
      )}

      {/* Gráficos */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              Frete cobrado × custo
              <span className="ml-2 font-normal text-gray-400">
                últimos {dias} dias
              </span>
            </h2>
            {/* Legenda à mão em vez da do Recharts: assim ela fica no
                cabeçalho, junto do título, e não rouba altura do gráfico. */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full bg-emerald-600"
                  aria-hidden="true"
                />
                Cobrado
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: MARCA.cores.primaria }}
                  aria-hidden="true"
                />
                Custo
              </span>
            </div>
          </div>
          <div className="mt-4">
            {carregando ? (
              <SkeletonGraficoBarras />
            ) : (
              <FretePorDia dados={dados?.serieDiaria ?? []} />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">
            Entregas por plataforma
            <span className="ml-2 font-normal text-gray-400">mês corrente</span>
          </h2>
          <div className="mt-4">
            {carregando ? (
              <SkeletonGraficoBarras />
            ) : (
              <EntregasPorPlataforma dados={dados?.porPlataforma ?? []} />
            )}
          </div>
        </section>
      </div>

      {dados && (
        <p className="mt-6 text-center text-xs text-gray-400">
          Acumulado de todos os tempos: {dados.total.entregas} entregas ·{" "}
          {brl(dados.total.freteCobrado)} cobrados ·{" "}
          {brl(dados.total.gastoTotal)} de custo · resultado{" "}
          {comSinal(dados.total.margem)}
          <br />
          {dados.incluiTestes
            ? "Entregas de teste estão somadas nestes números."
            : "Entregas de teste não entram nestes números."}
        </p>
      )}
    </div>
  );
}
