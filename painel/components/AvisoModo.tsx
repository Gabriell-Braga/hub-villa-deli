"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Faixa permanente no topo quando o Hub está em MODO TESTE.
//
// Existe para responder, sem clique nenhum, a pergunta mais cara do sistema:
// "essa entrega vai ser cobrada de verdade?". Um atendente que não sabe em que
// modo está ou deixa pedido real parado achando que despachou, ou despacha de
// verdade achando que era teste.
// ---------------------------------------------------------------------------

interface Modo {
  modo: "teste" | "producao";
  podeTrocarParaProducao: boolean;
}

export default function AvisoModo({ ehAdmin }: { ehAdmin: boolean }) {
  const [modo, setModo] = useState<Modo | null>(null);

  useEffect(() => {
    let vivo = true;

    const buscar = async () => {
      try {
        const res = await fetch("/api/modo");
        if (!res.ok) return;
        const json = await res.json();
        if (vivo) setModo(json);
      } catch {
        // Sem conexão o painel já avisa de outras formas.
      }
    };

    buscar();
    // O admin pode trocar o modo em outra aba ou outro aparelho.
    const t = setInterval(buscar, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (!modo || modo.modo !== "teste") return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
      <span>
        <span aria-hidden="true">⚠️</span> Modo de teste. Nenhuma entrega é
        cobrada de verdade.
      </span>
      {ehAdmin && modo.podeTrocarParaProducao && (
        <Link href="/configuracoes" className="underline underline-offset-2">
          Trocar para produção
        </Link>
      )}
    </div>
  );
}
