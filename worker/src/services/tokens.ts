import type { Env } from "../types";
import { prefixoCache, uberUrls } from "../config/ambiente";

// ---------------------------------------------------------------------------
// Cache de tokens OAuth2 no Cloudflare KV.
//
// Problema: iFood e 99 têm limites de rate na rota de autenticação. Se
// pedirmos um token novo a cada cotação, estouramos o limite. Solução:
// guardamos o access_token no KV e só renovamos quando faltar pouco para
// expirar.
//
// A função é GENÉRICA: recebe uma chave e um "fetcher" que sabe pegar um
// token novo. Reutilizada por iFood, 99 e Uber.
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  // epoch em segundos de quando o token expira de fato
  expiresAtEpoch: number;
}

// Margem de segurança: renova 60s antes de expirar de verdade.
const SKEW_SECONDS = 60;

export type TokenFetcher = () => Promise<{
  access_token: string;
  expires_in: number; // segundos, como retornado pelo provider OAuth2
}>;

export async function getCachedToken(
  env: Env,
  chaveBase: string, // ex: "token:ifood"
  fetcher: TokenFetcher
): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);

  // Prefixo por ambiente: um token de HML jamais pode ser reaproveitado em
  // produção (e vice-versa) só porque compartilham o mesmo KV.
  const chave = `${prefixoCache(env)}${chaveBase}`;

  // 1) Tenta o cache
  const cache = await env.HUB_KV.get<TokenCache>(chave, "json");
  if (cache && cache.expiresAtEpoch - SKEW_SECONDS > agora) {
    return cache.accessToken;
  }

  // 2) Cache vazio/expirado -> busca token novo
  const token = await fetcher();
  const expiresAtEpoch = agora + token.expires_in;

  const novo: TokenCache = {
    accessToken: token.access_token,
    expiresAtEpoch,
  };

  // 3) Persiste com TTL alinhado à expiração real (menos a margem).
  //    KV exige TTL mínimo de 60s.
  const ttl = Math.max(60, token.expires_in - SKEW_SECONDS);
  await env.HUB_KV.put(chave, JSON.stringify(novo), { expirationTtl: ttl });

  return token.access_token;
}

// --- Fetchers específicos (client_credentials) --------------------------------

export function getIfoodToken(env: Env): Promise<string> {
  return getCachedToken(env, "token:ifood", async () => {
    const body = new URLSearchParams({
      grantType: "client_credentials",
      clientId: env.IFOOD_CLIENT_ID,
      clientSecret: env.IFOOD_CLIENT_SECRET,
    });

    const res = await fetch(
      `${env.IFOOD_BASE_URL}/authentication/v1.0/oauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }
    );
    if (!res.ok) throw new Error(`iFood auth falhou: ${res.status}`);
    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    // Normaliza o formato do iFood para o esperado pelo getCachedToken
    return { access_token: data.accessToken, expires_in: data.expiresIn };
  });
}

export function get99Token(env: Env): Promise<string> {
  return getCachedToken(env, "token:99", async () => {
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

export function getUberToken(env: Env): Promise<string> {
  return getCachedToken(env, "token:uber", async () => {
    const res = await fetch(uberUrls(env).auth, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.UBER_CLIENT_ID,
        client_secret: env.UBER_CLIENT_SECRET,
        grant_type: "client_credentials",
        // Configurável porque muda conforme as permissões liberadas na
        // aplicação Uber. Pedir um escopo que a aplicação NÃO tem faz o token
        // inteiro falhar com invalid_scope — não é "ignora o que não tem".
        // Ver UBER_SCOPE no wrangler.toml.
        scope: env.UBER_SCOPE || "direct.organizations",
      }),
    });
    if (!res.ok) throw new Error(`Uber auth falhou: ${res.status}`);
    return (await res.json()) as { access_token: string; expires_in: number };
  });
}
