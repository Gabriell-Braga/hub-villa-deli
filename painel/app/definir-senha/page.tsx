"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LogoComNome } from "@/components/Logo";
import { Skeleton } from "@/components/Skeleton";

// ---------------------------------------------------------------------------
// Definição de senha — primeiro acesso e recuperação usam esta mesma tela.
// A diferença é só o texto, que vem do tipo do token.
// ---------------------------------------------------------------------------

interface InfoToken {
  nome: string;
  email: string;
  tipo: "convite" | "recuperacao";
}

function Formulario() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [info, setInfo] = useState<InfoToken | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [tokenInvalido, setTokenInvalido] = useState<string | null>(null);

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const verificar = useCallback(async () => {
    if (!token) {
      setTokenInvalido("Link incompleto. Peça um novo ao administrador.");
      setVerificando(false);
      return;
    }

    try {
      const res = await fetch(`/api/senha/token/${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok) {
        setTokenInvalido(json.erro ?? "Link inválido ou expirado.");
        return;
      }
      setInfo(json);
    } catch {
      setTokenInvalido("Não foi possível verificar o link. Tente novamente.");
    } finally {
      setVerificando(false);
    }
  }, [token]);

  useEffect(() => {
    verificar();
  }, [verificar]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senha.length < 8) {
      setErro("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setErro("As senhas não conferem.");
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/senha/definir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, senha }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.erro ?? "Não foi possível salvar a senha.");
        return;
      }

      setPronto(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setErro("Erro de rede. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  const caixa =
    "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--marca-primaria)] focus:ring-2 focus:ring-gray-200";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <LogoComNome tamanho={72} empilhado />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          {verificando ? (
            <div aria-busy="true">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-4 w-56" />
              <Skeleton className="mt-6 h-4 w-24" />
              <Skeleton className="mt-2 h-11 w-full" />
              <Skeleton className="mt-4 h-4 w-24" />
              <Skeleton className="mt-2 h-11 w-full" />
              <Skeleton className="mt-6 h-11 w-full" />
            </div>
          ) : tokenInvalido ? (
            <>
              <p className="text-center text-3xl">🔗</p>
              <h1 className="mt-3 text-center font-semibold text-gray-900">
                Link inválido
              </h1>
              <p className="mt-2 text-center text-sm text-gray-500">
                {tokenInvalido}
              </p>
              <Link
                href="/esqueci-senha"
                className="mt-6 block rounded-lg bg-[var(--marca-primaria)] py-2.5 text-center text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)]"
              >
                Pedir um novo link
              </Link>
            </>
          ) : pronto ? (
            <>
              <p className="text-center text-3xl">✅</p>
              <h1 className="mt-3 text-center font-semibold text-gray-900">
                Senha criada
              </h1>
              <p className="mt-2 text-center text-sm text-gray-500">
                Redirecionando para o login...
              </p>
              <Link
                href="/login"
                className="mt-6 block rounded-lg bg-[var(--marca-primaria)] py-2.5 text-center text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)]"
              >
                Entrar agora
              </Link>
            </>
          ) : (
            <form onSubmit={enviar}>
              <h1 className="font-semibold text-gray-900">
                {info?.tipo === "convite"
                  ? `Bem-vindo, ${info.nome.split(" ")[0]}!`
                  : "Criar nova senha"}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {info?.tipo === "convite"
                  ? "Crie sua senha para acessar o painel."
                  : "Escolha uma senha nova para sua conta."}
              </p>
              <p className="mt-2 break-all text-xs text-gray-400">{info?.email}</p>

              <label
                className="mt-5 block text-sm font-medium text-gray-700"
                htmlFor="senha"
              >
                Nova senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="new-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                className={`mt-1.5 ${caixa}`}
              />

              <label
                className="mt-4 block text-sm font-medium text-gray-700"
                htmlFor="confirmacao"
              >
                Repita a senha
              </label>
              <input
                id="confirmacao"
                type="password"
                autoComplete="new-password"
                required
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder="••••••••"
                className={`mt-1.5 ${caixa}`}
              />

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
                {enviando ? "Salvando..." : "Salvar senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PaginaDefinirSenha() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <Formulario />
    </Suspense>
  );
}
