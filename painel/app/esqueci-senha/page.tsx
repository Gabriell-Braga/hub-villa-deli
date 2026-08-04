"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoComNome } from "@/components/Logo";

export default function PaginaEsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);

    try {
      const res = await fetch("/api/senha/esqueci", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();

      // A resposta é sempre a mesma, exista o e-mail ou não — dizer que a conta
      // não existe entregaria uma lista de e-mails válidos do restaurante.
      setMensagem(
        json.mensagem ??
          "Se este e-mail estiver cadastrado, o link de acesso foi gerado."
      );
    } catch {
      setMensagem("Não foi possível concluir agora. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <LogoComNome tamanho={72} empilhado />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          {mensagem ? (
            <>
              <p className="text-center text-3xl">📩</p>
              <h1 className="mt-3 text-center font-semibold text-gray-900">
                Solicitação registrada
              </h1>
              <p className="mt-2 text-center text-sm text-gray-500">{mensagem}</p>
              <Link
                href="/login"
                className="mt-6 block rounded-lg bg-[var(--marca-primaria)] py-2.5 text-center text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)]"
              >
                Voltar ao login
              </Link>
            </>
          ) : (
            <form onSubmit={enviar}>
              <h1 className="font-semibold text-gray-900">Esqueceu a senha?</h1>
              <p className="mt-1 text-sm text-gray-500">
                Informe seu e-mail e o administrador do restaurante receberá um
                link de acesso para lhe repassar.
              </p>

              <label
                className="mt-5 block text-sm font-medium text-gray-700"
                htmlFor="email"
              >
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

              <button
                type="submit"
                disabled={enviando}
                className="mt-6 w-full rounded-lg bg-[var(--marca-primaria)] py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-60"
              >
                {enviando ? "Enviando..." : "Solicitar link de acesso"}
              </button>

              <Link
                href="/login"
                className="mt-4 block text-center text-sm text-gray-500 transition hover:text-gray-900"
              >
                Voltar ao login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
