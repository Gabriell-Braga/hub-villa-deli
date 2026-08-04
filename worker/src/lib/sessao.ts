import { sign, verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";
import { createMiddleware } from "hono/factory";
import type { Env, Usuario, UsuarioSessao } from "../types";

/**
 * Algoritmo fixo, declarado nos dois lados. Nunca aceite o `alg` que vem no
 * cabeçalho do token: é assim que se faz o ataque de "alg confusion" (trocar
 * HS256 por "none" e passar um token forjado).
 */
const ALG = "HS256" as const;

// ---------------------------------------------------------------------------
// Sessão via JWT (HS256).
//
// Quem emite: o Worker, na rota POST /api/auth/login.
// Quem consome: o Worker, no middleware `exigirLogin` abaixo.
// Quem carrega: o NextAuth do painel guarda o token na sessão e o proxy do
//               Next repassa em Authorization: Bearer.
//
// O painel NÃO valida nem confia no token por conta própria — a autoridade é
// sempre o Worker, que é quem fala com as APIs que cobram dinheiro.
// ---------------------------------------------------------------------------

/** 8 horas — cobre um turno inteiro sem obrigar novo login no meio. */
export const VALIDADE_SEGUNDOS = 60 * 60 * 8;

export async function emitirToken(env: Env, usuario: Usuario): Promise<string> {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET não configurado no Worker.");
  }

  const agora = Math.floor(Date.now() / 1000);

  const payload: JWTPayload = {
    sub: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    iat: agora,
    exp: agora + VALIDADE_SEGUNDOS,
  };

  return sign(payload, env.JWT_SECRET, ALG);
}

/**
 * Middleware. Bloqueia a rota se não vier um JWT válido e deixa os dados do
 * atendente disponíveis em `c.get("usuario")`.
 */
export const exigirLogin = createMiddleware<{
  Bindings: Env;
  Variables: { usuario: UsuarioSessao };
}>(async (c, next) => {
  if (!c.env.JWT_SECRET) {
    // Falha fechada: sem segredo configurado, ninguém entra.
    return c.json(
      { erro: "Painel não configurado — acione o suporte técnico." },
      500
    );
  }

  const cabecalho = c.req.header("authorization");
  if (!cabecalho?.toLowerCase().startsWith("bearer ")) {
    return c.json({ erro: "não autenticado" }, 401);
  }

  try {
    const payload = (await verify(
      cabecalho.slice(7).trim(),
      c.env.JWT_SECRET,
      ALG
    )) as unknown as UsuarioSessao;

    c.set("usuario", payload);
    await next();
  } catch {
    // Token inválido, adulterado ou expirado — o painel trata 401 mandando
    // o atendente para a tela de login.
    return c.json({ erro: "sessão inválida ou expirada" }, 401);
  }
});

/**
 * Middleware extra para rotas que só o admin vê (Relatórios).
 * Usar sempre DEPOIS de `exigirLogin`.
 */
export const exigirAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { usuario: UsuarioSessao };
}>(async (c, next) => {
  if (c.get("usuario")?.papel !== "admin") {
    return c.json({ erro: "acesso restrito ao administrador" }, 403);
  }
  await next();
});
