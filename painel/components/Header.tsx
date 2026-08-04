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
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 md:static">
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

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Nome e papel ocupariam metade da tela no celular. O avatar já
            identifica quem está logado; o nome completo volta a partir de sm. */}
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-gray-900">{nome}</p>
          <p className="text-xs leading-tight text-gray-500">{papel}</p>
        </div>

        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{
            backgroundColor: "var(--marca-suave)",
            color: "var(--marca-suave-texto)",
          }}
          title={`${nome} · ${papel}`}
        >
          {iniciais || "A"}
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
