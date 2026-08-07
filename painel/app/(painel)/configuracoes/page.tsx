"use client";

import { useCallback, useEffect, useState } from "react";
import { MARCA } from "@/config/marca";
import Logo from "@/components/Logo";
import { SkeletonDiagnostico } from "@/components/Skeleton";
import SeletorModo from "@/components/SeletorModo";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Tela de Configurações / Diagnóstico.
//
// Existe para responder uma pergunta antes do primeiro pedido real:
// "as credenciais estão certas?". O Worker testa de verdade o que dá para
// testar sem gastar dinheiro — inclusive autenticando no Uber — e devolve um
// item por checagem com o lugar exato onde se resolve cada pendência.
// ---------------------------------------------------------------------------

type StatusItem = "ok" | "aviso" | "erro";

interface ItemDiagnostico {
  chave: string;
  titulo: string;
  status: StatusItem;
  detalhe: string;
  /** O que fazer, em linguagem de negócio. Sem comandos nem nome de arquivo. */
  comoResolver?: string;
}

interface Diagnostico {
  ambiente: string;
  verificadoEm: string;
  resumo: { ok: number; aviso: number; erro: number };
  itens: ItemDiagnostico[];
}

const ESTILO: Record<StatusItem, { ponto: string; texto: string; rotulo: string }> = {
  ok: { ponto: "bg-emerald-500", texto: "text-emerald-700", rotulo: "OK" },
  aviso: { ponto: "bg-amber-500", texto: "text-amber-700", rotulo: "Atenção" },
  erro: { ponto: "bg-red-500", texto: "text-red-700", rotulo: "Pendente" },
};

const AMBIENTE_ESTILO: Record<string, string> = {
  dev: "bg-gray-100 text-gray-700 ring-gray-300",
  hml: "bg-amber-50 text-amber-800 ring-amber-300",
  producao: "bg-red-50 text-red-800 ring-red-300",
};

export default function PaginaConfiguracoes() {
  const [dados, setDados] = useState<Diagnostico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const verificar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await apiFetch("/api/diagnostico");
      const json = await res.json();
      if (!res.ok) {
        setErro(json.erro ?? `Erro ${res.status} ao verificar.`);
        setDados(null);
        return;
      }
      setDados(json);
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    verificar();
  }, [verificar]);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Configurações</h1>
          <p className="mt-1 text-sm text-gray-500">
            Verificação das credenciais e integrações. Rode aqui antes de ligar
            qualquer ambiente novo.
          </p>
        </div>

        <button
          onClick={verificar}
          disabled={carregando}
          className="rounded-lg bg-[var(--marca-primaria)] px-4 py-2 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-50"
        >
          {carregando ? "Verificando..." : "Verificar agora"}
        </button>
      </header>

      {/* Modo de operação — primeiro de propósito: é o que decide se a
          entrega é cobrada de verdade. */}
      <SeletorModo aoTrocar={verificar} />

      {/* Identidade do cliente */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Marca
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Logo tamanho={56} />
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">{MARCA.nome}</p>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
              {MARCA.tagline}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            {Object.entries(MARCA.cores).map(([nome, cor]) => (
              <span
                key={nome}
                title={`${nome}: ${cor}`}
                className="h-7 w-7 rounded-full border border-gray-200"
                style={{ backgroundColor: cor }}
              />
            ))}
          </div>
        </div>
      </section>

      {erro && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {erro}
        </div>
      )}

      {carregando && !dados ? (
        <SkeletonDiagnostico />
      ) : dados ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${
                AMBIENTE_ESTILO[dados.ambiente] ?? AMBIENTE_ESTILO.dev
              }`}
            >
              {dados.ambiente}
            </span>

            <span className="text-sm text-gray-500">
              {dados.resumo.ok} ok · {dados.resumo.aviso} atenção ·{" "}
              {dados.resumo.erro} pendente
            </span>

            {dados.resumo.erro === 0 && (
              <span className="text-sm font-medium text-emerald-700">
                Pronto para receber pedidos.
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {dados.itens.map((item) => {
              const e = ESTILO[item.status];
              return (
                <div key={item.chave} className="flex gap-4 p-5">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${e.ponto}`}
                    aria-hidden="true"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="font-medium text-gray-900">{item.titulo}</p>
                      <span className={`text-xs font-semibold ${e.texto}`}>
                        {e.rotulo}
                      </span>
                    </div>

                    <p className="mt-1 break-words text-sm text-gray-600">
                      {item.detalhe}
                    </p>

                    {item.comoResolver && item.status !== "ok" && (
                      <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        {item.comoResolver}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-center text-xs text-gray-400">
            Verificado em{" "}
            {new Date(dados.verificadoEm).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
          </p>
        </>
      ) : null}
    </div>
  );
}
