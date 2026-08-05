"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { SkeletonUsuarios } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Gestão de atendentes.
//
// O admin cria o usuário SEM senha e recebe um link de acesso para repassar.
// Quem define a senha é sempre o dono da conta — nem o admin a conhece.
//
// Enquanto não há provedor de e-mail configurado, o link aparece aqui para o
// admin mandar por WhatsApp. Quando o e-mail existir, o link deixa de ser
// exibido e nada mais muda nesta tela.
// ---------------------------------------------------------------------------

interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "atendente";
  ativo: boolean;
  criadoEm: string;
  semSenha: boolean;
  linkPendenteAte: string | null;
}

function CaixaLink({
  link,
  aoFechar,
}: {
  link: { url: string; nome: string; expiraEm: string };
  aoFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o campo abaixo permite
      // selecionar e copiar na mão.
    }
  }

  const validade = new Date(link.expiraEm).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-emerald-900">
          Link de acesso de {link.nome}
        </p>
        <button
          onClick={aoFechar}
          aria-label="Fechar"
          className="shrink-0 text-emerald-700 hover:text-emerald-900"
        >
          ✕
        </button>
      </div>

      <p className="mt-1 text-xs text-emerald-800">
        Envie por WhatsApp. Vale até {validade} e só pode ser usado uma vez.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-xs text-gray-700"
        />
        <button
          onClick={copiar}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

export default function PaginaUsuarios() {
  const { data: sessao } = useSession();
  const meuEmail = sessao?.user?.email;

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const toast = useToast();
  const [link, setLink] = useState<{
    url: string;
    nome: string;
    expiraEm: string;
  } | null>(null);

  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<"admin" | "atendente">("atendente");
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/usuarios");
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Erro ao carregar.");
        return;
      }
      setUsuarios(json.usuarios ?? []);
    } catch {
      toast.erro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);

    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, papel }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível criar.");
        return;
      }

      setLink({ url: json.link, nome: json.usuario.nome, expiraEm: json.expiraEm });
      toast.sucesso(`${json.usuario.nome} foi cadastrado.`);
      setNome("");
      setEmail("");
      setPapel("atendente");
      setFormAberto(false);
      carregar();
    } catch {
      toast.erro("Erro de rede.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(u: Usuario) {
    setOcupado(u.id);
    try {
      const res = await fetch(`/api/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !u.ativo }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível alterar.");
        return;
      }
      carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function trocarPapel(u: Usuario) {
    setOcupado(u.id);
    try {
      const res = await fetch(`/api/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          papel: u.papel === "admin" ? "atendente" : "admin",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível alterar.");
        return;
      }
      carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function gerarLink(u: Usuario) {
    setOcupado(u.id);
    try {
      const res = await fetch(`/api/usuarios/${u.id}/link-acesso`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível gerar.");
        return;
      }
      setLink({ url: json.link, nome: u.nome, expiraEm: json.expiraEm });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Usuários</h1>
          <p className="mt-1 text-sm text-gray-500">
            Quem pode entrar no painel. A senha é sempre definida pelo próprio
            usuário, pelo link de acesso.
          </p>
        </div>

        <button
          onClick={() => setFormAberto((v) => !v)}
          className="w-full rounded-lg bg-[var(--marca-primaria)] px-4 py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] sm:w-auto sm:py-2"
        >
          {formAberto ? "Cancelar" : "Novo usuário"}
        </button>
      </header>

      {/* A caixa do link continua inline, não vira toast: ela tem um campo
          para copiar e some sozinha em segundos se fosse toast — o admin
          perderia o link antes de repassar. */}
      {link && <CaixaLink link={link} aoFechar={() => setLink(null)} />}

      {formAberto && (
        <form
          onSubmit={criar}
          className="mb-5 rounded-xl border border-gray-200 bg-white p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="nome">
                Nome
              </label>
              <input
                id="nome"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Maria Silva"
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--marca-primaria)] focus:ring-2 focus:ring-gray-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="email-novo">
                E-mail
              </label>
              <input
                id="email-novo"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maria@villadeli.com.br"
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--marca-primaria)] focus:ring-2 focus:ring-gray-200"
              />
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-gray-700">Permissão</legend>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
              {(
                [
                  ["atendente", "Atendente", "Cota e despacha entregas."],
                  ["admin", "Administrador", "Também vê relatórios e usuários."],
                ] as const
              ).map(([valor, titulo, desc]) => (
                <label
                  key={valor}
                  className={`flex flex-1 cursor-pointer gap-3 rounded-lg border p-3 transition ${
                    papel === valor
                      ? "border-[var(--marca-primaria)] bg-[var(--marca-suave)]"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="papel"
                    value={valor}
                    checked={papel === valor}
                    onChange={() => setPapel(valor)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">
                      {titulo}
                    </span>
                    <span className="block text-xs text-gray-500">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={salvando}
            className="mt-5 w-full rounded-lg bg-[var(--marca-primaria)] py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-60 sm:w-auto sm:px-6"
          >
            {salvando ? "Criando..." : "Criar e gerar link"}
          </button>
        </form>
      )}

      {carregando ? (
        <SkeletonUsuarios />
      ) : (
        <ul className="space-y-3">
          {usuarios.map((u) => {
            const souEu = u.email === meuEmail;

            return (
              <li
                key={u.id}
                className={`rounded-xl border bg-white p-4 sm:p-5 ${
                  u.ativo ? "border-gray-200" : "border-gray-200 opacity-60"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                      {u.nome}
                      {souEu && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">
                          você
                        </span>
                      )}
                    </p>
                    <p className="break-all text-sm text-gray-500">{u.email}</p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          u.papel === "admin"
                            ? "bg-gray-100 text-gray-800 ring-gray-300"
                            : "bg-blue-50 text-blue-700 ring-blue-200"
                        }`}
                      >
                        {u.papel === "admin" ? "Administrador" : "Atendente"}
                      </span>

                      {!u.ativo && (
                        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-300">
                          Inativo
                        </span>
                      )}

                      {u.semSenha && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                          {u.linkPendenteAte
                            ? "Aguardando primeiro acesso"
                            : "Sem senha — gere um link"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <button
                      onClick={() => gerarLink(u)}
                      disabled={ocupado === u.id || !u.ativo}
                      className="flex-1 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 sm:flex-none"
                    >
                      {u.semSenha ? "Gerar link" : "Redefinir senha"}
                    </button>

                    <button
                      onClick={() => trocarPapel(u)}
                      disabled={ocupado === u.id || souEu}
                      title={souEu ? "Você não pode alterar a própria permissão" : undefined}
                      className="flex-1 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 sm:flex-none"
                    >
                      {u.papel === "admin" ? "Tornar atendente" : "Tornar admin"}
                    </button>

                    <button
                      onClick={() => alternarAtivo(u)}
                      disabled={ocupado === u.id || souEu}
                      title={souEu ? "Você não pode desativar a própria conta" : undefined}
                      className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-50 sm:flex-none ${
                        u.ativo
                          ? "border-red-200 text-red-700 hover:bg-red-50"
                          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      }`}
                    >
                      {u.ativo ? "Desativar" : "Reativar"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
