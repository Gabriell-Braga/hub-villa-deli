import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// ---------------------------------------------------------------------------
// NextAuth — sessão do painel.
//
// Divisão de responsabilidade:
//   - O WORKER é a autoridade de identidade: valida a senha contra o D1 e
//     emite o JWT que dá acesso às rotas que gastam dinheiro.
//   - O NEXTAUTH só guarda esse JWT dentro do cookie de sessão (que é
//     criptografado com NEXTAUTH_SECRET) e o repassa nas chamadas server-side.
//
// O `hubToken` NUNCA entra no callback `session`, só no `jwt`. O que sai em
// `session` vai para o browser; o cookie do NextAuth, não. Assim o token que
// autoriza despachar corrida paga nunca chega ao JavaScript do cliente.
// ---------------------------------------------------------------------------

// Sem a barra final — ver o comentário em lib/hub.ts. Colar a URL do Worker
// com "/" no fim gera barra dupla e faz todo login falhar com 404.
const API = (process.env.HUB_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/** 8 h — mesma validade do JWT emitido pelo Worker, para os dois vencerem juntos. */
const DURACAO_SESSAO = 60 * 60 * 8;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: DURACAO_SESSAO },
  pages: { signIn: "/login" },

  providers: [
    CredentialsProvider({
      name: "E-mail e senha",
      credentials: {
        email: { label: "E-mail", type: "email" },
        senha: { label: "Senha", type: "password" },
      },

      async authorize(credenciais) {
        if (!credenciais?.email || !credenciais?.senha) return null;

        try {
          const res = await fetch(`${API}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: credenciais.email,
              senha: credenciais.senha,
            }),
            cache: "no-store",
          });

          if (!res.ok) return null;

          const d = (await res.json()) as {
            token: string;
            usuario: { id: string; nome: string; email: string; papel: string };
          };

          return {
            id: d.usuario.id,
            name: d.usuario.nome,
            email: d.usuario.email,
            papel: d.usuario.papel,
            hubToken: d.token,
          };
        } catch {
          // Worker fora do ar: trata como credencial inválida e a tela de login
          // mostra a mensagem genérica.
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // `user` só vem na primeira chamada, logo após o login.
      if (user) {
        token.papel = user.papel;
        token.hubToken = user.hubToken;
      }
      return token;
    },

    async session({ session, token }) {
      // Só o que pode ser público. hubToken fica de fora de propósito.
      if (session.user) {
        session.user.papel = token.papel;
      }
      return session;
    },
  },
};
