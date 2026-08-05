"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LogoComNome } from "@/components/Logo";
import CampoSenha from "@/components/CampoSenha";

function FormularioLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const destino = parametros.get("callbackUrl") ?? "/pedidos";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    const r = await signIn("credentials", {
      email,
      senha,
      redirect: false,
    });

    setEnviando(false);

    if (r?.ok) {
      router.push(destino);
      router.refresh();
      return;
    }

    // Mensagem genérica de propósito: não dizemos se o e-mail existe.
    setErro("E-mail ou senha inválidos.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <LogoComNome tamanho={72} empilhado />
          <p className="mt-4 text-center text-sm text-gray-500">
            Hub Logístico — entre para cotar e despachar entregas
          </p>
        </div>

        <form
          onSubmit={entrar}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <label className="block text-sm font-medium text-gray-700" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@restaurante.com"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--marca-primaria)] focus:ring-2 focus:ring-gray-200"
          />

          <div className="mt-4 flex items-baseline justify-between gap-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="senha">
              Senha
            </label>
            <Link
              href="/esqueci-senha"
              className="text-xs font-medium text-gray-500 transition hover:text-gray-900"
            >
              Esqueci minha senha
            </Link>
          </div>
          <div className="mt-1.5">
            <CampoSenha
              id="senha"
              autoComplete="current-password"
              required
              value={senha}
              onChange={setSenha}
              placeholder="••••••••"
            />
          </div>

          <p className="mt-3 text-xs text-gray-400">
            Primeiro acesso? Use o link que o administrador enviou para criar sua
            senha.
          </p>

          {erro && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="mt-6 w-full rounded-lg bg-[var(--marca-primaria)] py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-60"
          >
            {enviando ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-400">
          Acesso restrito aos atendentes do restaurante.
        </p>
      </div>
    </div>
  );
}

export default function PaginaLogin() {
  // useSearchParams exige Suspense no App Router.
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <FormularioLogin />
    </Suspense>
  );
}
