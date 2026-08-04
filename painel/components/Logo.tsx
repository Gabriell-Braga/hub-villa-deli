"use client";

import { useState } from "react";
import { MARCA, MONOGRAMA } from "@/config/marca";

// ---------------------------------------------------------------------------
// Logo da marca.
//
// Tenta carregar o arquivo de public/ (padrão: /marca/logo.png). Se o arquivo
// não existir — que é o estado de um cliente recém-instalado — desenha um
// monograma com as iniciais nas cores da marca. Assim o painel nunca mostra
// ícone quebrado e a instalação funciona antes de alguém enviar a arte.
//
// É client component só por causa do onError: é a única forma de detectar
// arquivo ausente sem ir ao disco no build.
// ---------------------------------------------------------------------------

export default function Logo({
  tamanho = 40,
  className = "",
}: {
  tamanho?: number;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);

  if (falhou || !MARCA.logo) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight ${className}`}
        style={{
          width: tamanho,
          height: tamanho,
          backgroundColor: "var(--marca-primaria)",
          color: "var(--marca-contraste)",
          fontSize: tamanho * 0.36,
        }}
        aria-hidden="true"
      >
        {MONOGRAMA}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={MARCA.logo}
      alt={MARCA.nome}
      width={tamanho}
      height={tamanho}
      onError={() => setFalhou(true)}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: tamanho, height: tamanho }}
    />
  );
}

/** Logo + nome + tagline. Usado na sidebar e na tela de login. */
export function LogoComNome({
  tamanho = 40,
  empilhado = false,
}: {
  tamanho?: number;
  empilhado?: boolean;
}) {
  if (empilhado) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Logo tamanho={tamanho} />
        <div className="text-center">
          <p className="text-lg font-semibold tracking-tight text-gray-900">
            {MARCA.nome}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">
            {MARCA.tagline}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo tamanho={tamanho} />
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight text-gray-900">
          {MARCA.nome}
        </p>
        <p className="truncate text-[10px] uppercase leading-tight tracking-[0.18em] text-gray-400">
          {MARCA.tagline}
        </p>
      </div>
    </div>
  );
}
