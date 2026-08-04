"use client";

import { useCallback, useEffect, useState } from "react";
import type { Estatisticas } from "@/lib/tipos";
import { COR_PROVEDOR, EMOJI_PROVEDOR } from "@/lib/tipos";
import { brl } from "@/lib/formato";
import StatCard from "@/components/StatCard";
import { Skeleton, SkeletonGraficoBarras } from "@/components/Skeleton";
import { MARCA } from "@/config/marca";
import { EntregasPorPlataforma, GastoPorDia } from "@/components/GraficoGastos";

const JANELAS = [7, 30, 90];

export default function PaginaRelatorios() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Estatisticas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/estatisticas?dias=${dias}`);
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
            Gasto com frete no mês corrente (horário de Brasília) e evolução no
            período.
          </p>
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

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          rotulo="Gasto com frete no mês"
          valor={brl(mes?.gastoTotal ?? 0)}
          detalhe="Soma de todas as plataformas"
          cor={MARCA.cores.primaria}
          carregando={carregando}
        />
        <StatCard
          rotulo="Entregas no mês"
          valor={String(mes?.entregas ?? 0)}
          detalhe="Corridas efetivamente despachadas"
          carregando={carregando}
        />
        <StatCard
          rotulo="Custo médio do frete"
          valor={brl(mes?.custoMedio ?? 0)}
          detalhe="Por entrega, no mês"
          carregando={carregando}
        />
        <StatCard
          rotulo="Tempo médio estimado"
          valor={mes?.etaMedio != null ? `${mes.etaMedio} min` : "—"}
          detalhe="ETA informado na cotação"
          carregando={carregando}
        />
      </div>

      {/* Um card por plataforma — a pergunta "quanto gastei com Uber?" */}
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
              rotulo={`${EMOJI_PROVEDOR[p.provider]} ${p.nome}`}
              valor={brl(p.gastoTotal)}
              detalhe={`${p.entregas} entregas · média ${brl(p.custoMedio)}`}
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
          <h2 className="text-sm font-semibold text-gray-900">
            Gasto por dia
            <span className="ml-2 font-normal text-gray-400">últimos {dias} dias</span>
          </h2>
          <div className="mt-4">
            {carregando ? (
              <SkeletonGraficoBarras />
            ) : (
              <GastoPorDia dados={dados?.serieDiaria ?? []} />
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
          {brl(dados.total.gastoTotal)} · média {brl(dados.total.custoMedio)}
        </p>
      )}
    </div>
  );
}
