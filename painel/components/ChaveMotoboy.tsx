"use client";

import { useCallback, useEffect, useState } from "react";
import { dataHora } from "@/lib/formato";
import { apiFetch } from "@/lib/api";
import LogoProvedor from "./LogoProvedor";

// ---------------------------------------------------------------------------
// Liga/desliga o Motoboy Próprio.
//
// Um clique, sem confirmação escrita: desligar não gasta dinheiro, só tira o
// card da cotação. É para o dia em que o motoboy não veio — sem isto, o card
// continua lá, muitas vezes como o mais barato, e alguém despacha para
// ninguém.
// ---------------------------------------------------------------------------

interface Estado {
  ativo: boolean;
  /** false = a trava do ambiente nem inclui o motoboy; a chave não o liga. */
  permitidoNoAmbiente: boolean;
  ultimaTroca: { em: string; por: string | null } | null;
}

export default function ChaveMotoboy({ aoTrocar }: { aoTrocar?: () => void }) {
  const [dados, setDados] = useState<Estado | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/config/motoboy");
      if (res.ok) setDados(await res.json());
    } catch {
      setErro("Não foi possível ler a configuração do motoboy.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function alternar() {
    if (!dados) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await apiFetch("/api/config/motoboy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !dados.ativo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.erro ?? "Não foi possível salvar.");
        return;
      }
      await carregar();
      aoTrocar?.();
    } catch {
      setErro("Erro de rede ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  if (!dados) return null;

  const ligado = dados.ativo && dados.permitidoNoAmbiente;

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-4">
        <LogoProvedor provider="motoboy" tamanho={36} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-900">Motoboy Próprio</h2>
          <p className="text-sm text-gray-500">
            {!dados.permitidoNoAmbiente
              ? "Desativado neste ambiente pela configuração do servidor."
              : ligado
                ? "Aparece na cotação e pode receber pedidos."
                : "Fora da cotação. Nenhum pedido vai para o motoboy."}
          </p>
        </div>

        <button
          role="switch"
          aria-checked={ligado}
          aria-label="Motoboy Próprio ativo"
          onClick={alternar}
          disabled={salvando || !dados.permitidoNoAmbiente}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            ligado ? "bg-emerald-500" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
              ligado ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {dados.ultimaTroca && (
        <p className="mt-3 text-xs text-gray-400">
          {dados.ativo ? "Ativado" : "Desativado"} em {dataHora(dados.ultimaTroca.em)}
          {dados.ultimaTroca.por && ` por ${dados.ultimaTroca.por}`}
        </p>
      )}

      {erro && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      )}
    </section>
  );
}
