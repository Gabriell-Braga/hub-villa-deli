"use client";

import { useState } from "react";
import Link from "next/link";
import LayoutAcesso from "@/components/LayoutAcesso";
import { IconeVoltar } from "@/components/Icones";
import IconeDestaque from "@/components/IconeDestaque";

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
    <LayoutAcesso>
        <div>
          {mensagem ? (
            <>
              <IconeDestaque nome="email" />
              <h1 className="mt-4 text-center text-xl font-semibold tracking-tight text-gray-900">
                Solicitação registrada
              </h1>
              <p className="mt-2 text-center text-sm text-gray-500">{mensagem}</p>
              <Link
                href="/login"
                className="mt-6 flex h-10 items-center justify-center rounded-lg bg-[var(--marca-primaria)] text-center text-sm font-medium text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)]"
              >
                Voltar ao login
              </Link>
            </>
          ) : (
            <form onSubmit={enviar}>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Esqueceu a senha?</h1>
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
                className="mt-1.5 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm outline-none transition placeholder:text-gray-400 focus:border-gray-900 focus:ring-4 focus:ring-gray-900/5"
              />

              <button
                type="submit"
                disabled={enviando}
                className="mt-6 h-10 w-full rounded-lg bg-[var(--marca-primaria)] text-sm font-medium text-[var(--marca-contraste)] shadow-sm transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-60"
              >
                {enviando ? "Enviando..." : "Solicitar link de acesso"}
              </button>

              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-900"
              >
                <IconeVoltar />
                Voltar ao login
              </Link>
            </form>
          )}
        </div>
    </LayoutAcesso>
  );
}
