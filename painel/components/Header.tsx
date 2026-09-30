"use client";

import { signOut, useSession } from "next-auth/react";
import Logo from "./Logo";
import { MARCA } from "@/config/marca";

export default function Header({ onAbrirMenu }: { onAbrirMenu?: () => void }) {
  const { data: sessao } = useSession();
  const nome = sessao?.user?.name ?? "Atendente";
  const papel = sessao?.user?.papel === "admin" ? "Administrador" : "Atendente";

  const iniciais = nome
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    // sticky no celular: a página inteira rola, e o cabeçalho (com o botão de
    // menu) precisa continuar alcançável no meio de uma lista longa.
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white/90 px-4 backdrop-blur sm:px-6 md:static">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onAbrirMenu}
          aria-label="Abrir menu"
          className="-ml-2 rounded-lg p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>

        {/* A marca aparece aqui só no celular — no desktop ela vive na sidebar. */}
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <Logo tamanho={28} />
          <span className="truncate font-semibold text-gray-900">
            {MARCA.nome}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-center gap-2.5" title={`${nome} · ${papel}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
            {iniciais || "A"}
          </div>
          {/* Nome e papel ocupariam metade da tela no celular. O avatar já
              identifica quem está logado; o nome volta a partir de sm. Papel
              igual ao nome ("Administrador · Administrador") é omitido. */}
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-medium text-gray-900">{nome}</p>
            {papel !== nome && <p className="text-xs text-gray-500">{papel}</p>}
          </div>
        </div>

        <span className="hidden h-6 w-px bg-gray-200 sm:block" aria-hidden="true" />

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sair
        </button>
      </div>
    </header>
  );
}
