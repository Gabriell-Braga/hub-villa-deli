"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

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
        const res = await apiFetch("/api/modo");
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

  // Discreta, mas impossível de não ver: faixa fina âmbar com um ponto, no
  // topo de toda tela. A versão anterior era amarelo cheio com emoji, que
  // competia com o conteúdo e cansava num turno inteiro de tela aberta.
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        <span>
          <strong className="font-semibold">Modo teste</strong> · nenhuma entrega é cobrada
        </span>
      </span>
      {ehAdmin && modo.podeTrocarParaProducao && (
        <Link href="/configuracoes" className="font-medium underline underline-offset-2 hover:text-amber-950">
          Trocar para produção
        </Link>
      )}
    </div>
  );
}
