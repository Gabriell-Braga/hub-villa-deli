"use client";

import { useCallback, useEffect, useState } from "react";
import { dataHora } from "@/lib/formato";

// ---------------------------------------------------------------------------
// Troca entre modo TESTE e PRODUÇÃO.
//
// É a chave que decide se uma corrida é cobrada de verdade, então:
//   - ir para produção exige confirmação escrita, não só um clique
//   - voltar para teste é imediato (parar de gastar nunca deve ter atrito)
//   - o Worker recusa a troca se as credenciais reais não estiverem no lugar
// ---------------------------------------------------------------------------

interface Modo {
  modo: "teste" | "producao";
  ambiente: string;
  podeTrocarParaProducao: boolean;
  ultimaTroca: { em: string; por: string | null } | null;
  uber: {
    baseUrl: string;
    customerId: string | null;
    clientIdConfigurado: boolean;
    webhookConfigurado: boolean;
  };
}

export default function SeletorModo({
  aoTrocar,
}: {
  /** Avisa a tela de Configurações para revalidar o diagnóstico. */
  aoTrocar?: () => void;
}) {
  const [dados, setDados] = useState<Modo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/modo");
      const json = await res.json();
      if (res.ok) setDados(json);
    } catch {
      setErro("Não foi possível ler o modo atual.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function trocar(alvo: "teste" | "producao") {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/modo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: alvo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.erro ?? "Não foi possível trocar o modo.");
        return;
      }
      setConfirmando(false);
      setTexto("");
      await carregar();
      aoTrocar?.();
    } catch {
      setErro("Erro de rede ao trocar o modo.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="h-4 w-40 rounded bg-gray-200/80 motion-safe:animate-pulse" />
        <div className="mt-4 h-20 rounded bg-gray-200/80 motion-safe:animate-pulse" />
      </section>
    );
  }

  if (!dados) return null;

  const emProducao = dados.modo === "producao";

  return (
    <section
      className={`mb-6 overflow-hidden rounded-xl border bg-white ${
        emProducao ? "border-red-300" : "border-amber-300"
      }`}
    >
      <div
        className={`px-5 py-3 text-sm font-semibold ${
          emProducao ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"
        }`}
      >
        {emProducao
          ? "🔴 Modo produção — entregas são reais e cobradas"
          : "🟡 Modo teste — nenhuma entrega é cobrada"}
      </div>

      <div className="p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Conta do Uber em uso</dt>
            <dd className="text-gray-900">
              {emProducao ? "Conta real" : "Conta de teste (sandbox)"}
            </dd>
            <dd className="break-all text-xs text-gray-400">{dados.uber.baseUrl}</dd>
          </div>

          <div>
            <dt className="text-gray-500">Identificação do cliente</dt>
            <dd className="font-mono text-gray-900">
              {dados.uber.customerId ?? "—"}
            </dd>
            <dd className="text-xs text-gray-400">
              {dados.uber.clientIdConfigurado
                ? "Credenciais cadastradas"
                : "Credenciais ausentes"}
              {dados.uber.webhookConfigurado
                ? " · acompanhamento ativo"
                : " · sem acompanhamento"}
            </dd>
          </div>
        </dl>

        {dados.ultimaTroca && (
          <p className="mt-3 text-xs text-gray-400">
            Última troca em {dataHora(dados.ultimaTroca.em)}
            {dados.ultimaTroca.por && ` por ${dados.ultimaTroca.por}`}
          </p>
        )}

        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {erro}
          </p>
        )}

        {/* --- Ações --- */}
        {!dados.podeTrocarParaProducao ? (
          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Este é um ambiente de homologação: ele só opera em modo teste, por
            segurança. A troca para produção fica disponível no ambiente
            definitivo.
          </p>
        ) : emProducao ? (
          <button
            onClick={() => trocar("teste")}
            disabled={salvando}
            className="mt-5 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 sm:w-auto sm:px-6"
          >
            {salvando ? "Voltando..." : "Voltar para o modo teste"}
          </button>
        ) : confirmando ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-900">
              A partir da troca, toda entrega despachada é real e será cobrada
              na sua conta do Uber.
            </p>
            <p className="mt-2 text-sm text-red-800">
              Para confirmar, digite <strong>PRODUCAO</strong> abaixo.
            </p>

            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value.toUpperCase())}
              placeholder="PRODUCAO"
              className="mt-3 w-full rounded-lg border border-red-300 px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 sm:max-w-xs"
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => trocar("producao")}
                disabled={texto !== "PRODUCAO" || salvando}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {salvando ? "Trocando..." : "Confirmar e ir para produção"}
              </button>
              <button
                onClick={() => {
                  setConfirmando(false);
                  setTexto("");
                }}
                className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmando(true)}
            className="mt-5 w-full rounded-lg bg-[var(--marca-primaria)] px-4 py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] sm:w-auto sm:px-6"
          >
            Trocar para o modo produção
          </button>
        )}
      </div>
    </section>
  );
}
