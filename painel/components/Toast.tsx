"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Avisos passageiros (toast).
//
// Substitui as faixas que empurravam a tela para baixo: despachar um pedido
// inseria uma div acima dos cards e tudo pulava, justamente no momento em que
// o atendente estava olhando o resultado.
//
// Regra de uso: toast é para o RESULTADO DE UMA AÇÃO ("despachado", "não foi
// possível salvar"). Erro que descreve o ESTADO da tela — não carregou, sem
// permissão — continua inline, porque some junto com o toast e a pessoa fica
// sem saber por que a tela está vazia.
// ---------------------------------------------------------------------------

type Tipo = "sucesso" | "erro";

interface Aviso {
  id: number;
  tipo: Tipo;
  texto: string;
}

interface API {
  sucesso: (texto: string) => void;
  erro: (texto: string) => void;
}

const Contexto = createContext<API | null>(null);

/** Erro fica mais tempo: costuma ter algo a ler e decidir. */
const DURACAO: Record<Tipo, number> = { sucesso: 4000, erro: 7000 };

const Icone = ({ tipo }: { tipo: Tipo }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5 shrink-0"
    aria-hidden="true"
  >
    {tipo === "sucesso" ? (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="m9 11 3 3L22 4" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </>
    )}
  </svg>
);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const remover = useCallback(
    (id: number) => setAvisos((a) => a.filter((x) => x.id !== id)),
    []
  );

  const empilhar = useCallback(
    (tipo: Tipo, texto: string) => {
      // Date.now() colidiria com dois toasts no mesmo milissegundo.
      const id = Math.random();
      setAvisos((a) => [...a, { id, tipo, texto }]);
      setTimeout(() => remover(id), DURACAO[tipo]);
    },
    [remover]
  );

  const api = useMemo<API>(
    () => ({
      sucesso: (t) => empilhar("sucesso", t),
      erro: (t) => empilhar("erro", t),
    }),
    [empilhar]
  );

  return (
    <Contexto.Provider value={api}>
      {children}

      {/* aria-live="polite": o leitor de tela anuncia sem interromper o que
          a pessoa está fazendo. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {avisos.map((a) => (
          <div
            key={a.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg motion-safe:animate-[subir_.18s_ease-out] ${
              a.tipo === "sucesso"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            <span
              className={a.tipo === "sucesso" ? "text-emerald-600" : "text-red-600"}
            >
              <Icone tipo={a.tipo} />
            </span>

            <p className="flex-1 leading-snug">{a.texto}</p>

            <button
              onClick={() => remover(a.id)}
              aria-label="Fechar aviso"
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 opacity-60 transition hover:opacity-100"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

export function useToast(): API {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
