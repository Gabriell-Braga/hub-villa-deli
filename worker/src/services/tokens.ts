import type { Env, ModoOperacao } from "../types";
import { credenciaisUber, prefixoCache } from "../config/ambiente";

// ---------------------------------------------------------------------------
// Cache de tokens OAuth2 no Cloudflare KV.
//
// Problema: iFood e 99 têm limites de rate na rota de autenticação. Se
// pedirmos um token novo a cada cotação, estouramos o limite. Solução:
// guardamos o access_token no KV e só renovamos quando faltar pouco para
// expirar.
//
// A chave do cache inclui AMBIENTE e MODO. Sem isso, trocar de teste para
// produção reaproveitaria o token do sandbox — que a API de produção recusaria,
// ou pior, aceitaria contra a conta errada.
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  /** epoch em segundos de quando o token expira de fato */
  expiresAtEpoch: number;
}

/** Margem de segurança: renova 60s antes de expirar de verdade. */
const SKEW_SECONDS = 60;

export type TokenFetcher = () => Promise<{
  access_token: string;
  expires_in: number;
}>;

export async function getCachedToken(
  env: Env,
  modo: ModoOperacao,
  chaveBase: string, // ex: "token:ifood"
  fetcher: TokenFetcher
): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const chave = `${prefixoCache(env, modo)}${chaveBase}`;

  // 1) Tenta o cache
  const cache = await env.HUB_KV.get<TokenCache>(chave, "json");
  if (cache && cache.expiresAtEpoch - SKEW_SECONDS > agora) {
    return cache.accessToken;
  }

  // 2) Cache vazio/expirado -> busca token novo
  const token = await fetcher();
  const expiresAtEpoch = agora + token.expires_in;

  const novo: TokenCache = { accessToken: token.access_token, expiresAtEpoch };

  // 3) Persiste com TTL alinhado à expiração real (menos a margem).
  //    KV exige TTL mínimo de 60s.
  const ttl = Math.max(60, token.expires_in - SKEW_SECONDS);
  await env.HUB_KV.put(chave, JSON.stringify(novo), { expirationTtl: ttl });

  return token.access_token;
}

// --- Fetchers específicos (client_credentials) --------------------------------

export function getIfoodToken(env: Env, modo: ModoOperacao): Promise<string> {
  return getCachedToken(env, modo, "token:ifood", async () => {
    const body = new URLSearchParams({
      grantType: "client_credentials",
      clientId: env.IFOOD_CLIENT_ID,
      clientSecret: env.IFOOD_CLIENT_SECRET,
    });

    const base =
      modo === "teste"
        ? env.IFOOD_BASE_URL_TESTE || env.IFOOD_BASE_URL
        : env.IFOOD_BASE_URL;

    const res = await fetch(`${base}/authentication/v1.0/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`iFood auth falhou: ${res.status}`);

    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    // Normaliza o formato do iFood para o esperado pelo getCachedToken
    return { access_token: data.accessToken, expires_in: data.expiresIn };
  });
}

export function get99Token(env: Env, modo: ModoOperacao): Promise<string> {
  return getCachedToken(env, modo, "token:99", async () => {
    const res = await fetch(env.NOVA99_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.NOVA99_CLIENT_ID,
        client_secret: env.NOVA99_CLIENT_SECRET,
      }),
    });
    if (!res.ok) throw new Error(`99 auth falhou: ${res.status}`);
    return (await res.json()) as { access_token: string; expires_in: number };
  });
}

/**
 * Identificador curto e não-reversível da credencial, para entrar na chave de
 * cache.
 *
 * Sem isto, trocar o Client ID/Secret NÃO invalida o token guardado — e o
 * token do Uber dura 30 dias. Dois estragos reais que isso causa:
 *
 *   - credencial nova e ERRADA passa no diagnóstico, porque ele reusa o token
 *     da credencial antiga (aconteceu aqui, em 04/08/2026);
 *   - rotacionar um secret vazado deixa o token velho valendo por um mês.
 *
 * Só o client_id entra: ele é público (vai no corpo do OAuth) e já identifica
 * a conta. O secret fica de fora para não existir derivado dele em lugar nenhum.
 */
async function marcaDaCredencial(clientId: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(clientId)
  );
  return Array.from(new Uint8Array(bytes).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getUberToken(
  env: Env,
  modo: ModoOperacao
): Promise<string> {
  const cred = credenciaisUber(env, modo);
  const marca = await marcaDaCredencial(cred.clientId);

  return getCachedToken(env, modo, `token:uber:${marca}`, async () => {
    const res = await fetch(cred.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
        grant_type: "client_credentials",
        // Configurável porque muda conforme as permissões liberadas na
        // aplicação Uber. Pedir um escopo que a aplicação NÃO tem faz o token
        // inteiro falhar com invalid_scope — não é "ignora o que não tem".
        scope: cred.scope,
      }),
    });
    if (!res.ok) throw new Error(`Uber auth falhou: ${res.status}`);
    return (await res.json()) as { access_token: string; expires_in: number };
  });
}
