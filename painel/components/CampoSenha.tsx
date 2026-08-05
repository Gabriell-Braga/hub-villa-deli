"use client";

import { useId, useState } from "react";

// ---------------------------------------------------------------------------
// Campo de senha com alternância de visibilidade.
//
// Não é firula: em teclado de celular a senha é digitada às cegas, e o
// atendente que erra duas vezes seguidas geralmente errou uma tecla — não
// esqueceu a senha. Ver o que digitou resolve na hora.
//
// O componente cuida só do input e do botão; o rótulo fica com quem chama,
// porque a tela de login tem o link "Esqueci minha senha" na mesma linha.
// ---------------------------------------------------------------------------

const Olho = ({ aberto }: { aberto: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
    aria-hidden="true"
  >
    {aberto ? (
      <>
        {/* Olho cortado = a senha está visível, clique para esconder. */}
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <path d="m2 2 20 20" />
      </>
    ) : (
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

export default function CampoSenha({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  required,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const gerado = useId();
  const idCampo = id ?? gerado;
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="relative">
      <input
        id={idCampo}
        type={visivel ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // pr-11 abre espaço para o botão: sem isso a senha longa passa por
        // baixo do ícone.
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-11 text-sm outline-none transition focus:border-[var(--marca-primaria)] focus:ring-2 focus:ring-gray-200"
      />

      <button
        // type="button" é obrigatório: dentro de um <form>, o padrão é submit
        // e o clique enviaria o formulário em vez de revelar a senha.
        type="button"
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visivel}
        // tabIndex -1 mantém o Tab indo direto do campo para o botão de
        // entrar, que é o caminho de quem usa teclado.
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition hover:text-gray-700"
      >
        <Olho aberto={visivel} />
      </button>
    </div>
  );
}
