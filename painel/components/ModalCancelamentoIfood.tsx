"use client";

import { useEffect, useRef, useState } from "react";
import LogoProvedor from "./LogoProvedor";
import type { MotivoCancelamentoIfood } from "@/lib/tipos";

// ---------------------------------------------------------------------------
// Motivo do cancelamento de uma entrega do iFood.
//
// A lista vem do iFood na hora (GET .../cancellationReasons) e muda conforme a
// fase da entrega. O atendente escolhe; o sistema não decide por ele. É
// critério de homologação do iFood, e o motivo fica registrado contra a loja,
// então escolher "Problemas de sistema" sem ser verdade tem custo.
//
// Nenhum motivo vem marcado: com um pré-selecionado, o clique rápido em
// "Cancelar corrida" registraria um motivo que ninguém leu.
// ---------------------------------------------------------------------------

export default function ModalCancelamentoIfood({
  motivos,
  ocupado,
  onFechar,
  onConfirmar,
}: {
  /** null = fechado. */
  motivos: MotivoCancelamentoIfood[] | null;
  ocupado: boolean;
  onFechar: () => void;
  onConfirmar: (codigoMotivo: string) => void;
}) {
  const aberto = motivos !== null;
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ocupado) onFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, ocupado, onFechar]);

  useEffect(() => {
    if (aberto) {
      setEscolhido(null);
      caixa.current?.focus();
    }
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => !ocupado && onFechar()}
    >
      <div
        ref={caixa}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cancelamento-ifood"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl outline-none sm:p-6"
      >
        <div className="flex items-center gap-2.5">
          <LogoProvedor provider="ifood" tamanho={26} />
          <h2 id="titulo-cancelamento-ifood" className="text-lg font-semibold text-gray-900">
            Cancelar corrida no iFood
          </h2>
        </div>

        <p className="mt-4 text-sm font-medium text-gray-900">Motivo do cancelamento</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Lista enviada pelo iFood para esta entrega. O motivo fica registrado na conta da loja.
        </p>

        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto" role="radiogroup">
          {motivos.map((m) => {
            const ativo = escolhido === m.codigo;
            return (
              <button
                key={m.codigo}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => setEscolhido(m.codigo)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition ${
                  ativo
                    ? "border-red-300 bg-red-50 text-red-900 ring-2 ring-red-100"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    ativo ? "border-red-600" : "border-gray-300"
                  }`}
                >
                  {ativo && <span className="h-2 w-2 rounded-full bg-red-600" />}
                </span>
                {m.descricao}
              </button>
            );
          })}
        </div>

        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          Com entregador designado, o iFood cobra parte do frete. Depois da coleta,
          o iFood recusa o cancelamento.
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onFechar}
            disabled={ocupado}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => escolhido && onConfirmar(escolhido)}
            disabled={ocupado || !escolhido}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {ocupado ? "Cancelando..." : "Cancelar corrida"}
          </button>
        </div>
      </div>
    </div>
  );
}
