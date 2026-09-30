"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import LayoutAcesso from "@/components/LayoutAcesso";
import CampoSenha from "@/components/CampoSenha";

function FormularioLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const destino = parametros.get("callbackUrl") ?? "/pedidos";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Quem chega aqui por sessão vencida não errou nada, e não pode ser recebido
  // com a mesma cara de quem digitou a senha errada. O aviso some assim que a
  // pessoa tenta entrar.
  const expirou = parametros.get("expirou") === "1" && !erro;

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
    <LayoutAcesso>
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Entrar</h1>
      <p className="mt-1.5 text-sm text-gray-500">
        Acesse com o e-mail cadastrado pelo administrador.
      </p>

      {expirou && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          Sua sessão terminou por segurança. Entre novamente para continuar.
        </div>
      )}

      <form onSubmit={entrar} className="mt-8">
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
          className="mt-1.5 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm outline-none transition placeholder:text-gray-400 focus:border-gray-900 focus:ring-4 focus:ring-gray-900/5"
        />

        <div className="mt-5 flex items-baseline justify-between gap-2">
          <label className="block text-sm font-medium text-gray-700" htmlFor="senha">
            Senha
          </label>
          <Link
            href="/esqueci-senha"
            className="text-sm font-medium text-gray-500 transition hover:text-gray-900"
          >
            Esqueci a senha
          </Link>
        </div>
        <div className="mt-1.5">
          <CampoSenha
            id="senha"
            autoComplete="current-password"
            required
            value={senha}
            onChange={setSenha}
            placeholder="Sua senha"
          />
        </div>

        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            {erro}
          </p>
        )}

        <button type="submit" disabled={enviando} className="mt-6 h-10 w-full rounded-lg bg-[var(--marca-primaria)] text-sm font-medium text-[var(--marca-contraste)] shadow-sm transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-60">
          {enviando ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="mt-8 border-t border-gray-100 pt-6 text-sm text-gray-500">
        Primeiro acesso? Use o link que o administrador enviou para criar sua senha.
      </p>
    </LayoutAcesso>
  );
}

export default function PaginaLogin() {
  // useSearchParams exige Suspense no App Router.
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <FormularioLogin />
    </Suspense>
  );
}
