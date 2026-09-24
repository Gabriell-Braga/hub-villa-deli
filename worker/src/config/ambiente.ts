import type { Env, ModoOperacao } from "../types";

// ---------------------------------------------------------------------------
// AMBIENTE × MODO — dois conceitos diferentes, fácil de confundir.
//
//   AMBIENTE (dev | hml | producao)
//     Qual Worker está rodando. Definido no wrangler.toml, muda com deploy.
//     Cada um tem seu banco, seu KV e seus segredos.
//
//   MODO (teste | producao)
//     Quais CREDENCIAIS do parceiro usar. Trocado pela tela de Configurações,
//     sem deploy. Ver config/modo.ts.
//
// O worker de produção pode rodar em modo teste — é assim que se valida a
// instalação real com o sandbox antes de virar a chave. O contrário é
// bloqueado: dev e hml ficam presos em modo teste.
//
// Cada modo tem seu conjunto COMPLETO de credenciais. Antes, client_id e
// secret eram compartilhados e só a URL mudava — trocar de modo não trocava
// de conta, que é o erro que este arquivo existe para não deixar acontecer.
// ---------------------------------------------------------------------------

export type NomeAmbiente = "dev" | "hml" | "producao";

export function ambiente(env: Env): NomeAmbiente {
  const v = (env.AMBIENTE ?? "dev").trim().toLowerCase();
  if (v === "producao" || v === "production" || v === "prod") return "producao";
  if (v === "hml" || v === "homologacao" || v === "sandbox") return "hml";
  return "dev";
}

export interface CredenciaisUber {
  clientId: string;
  clientSecret: string;
  customerId: string;
  baseUrl: string;
  authUrl: string;
  scope: string;
  webhookSecret: string;
}

/**
 * Credenciais do Uber para o modo pedido.
 *
 * Em "teste" cada campo cai para o de produção se o de teste estiver vazio.
 * Isso existe para não quebrar quem só tem um par de credenciais — mas o
 * diagnóstico avisa quando está acontecendo, porque significa que o modo teste
 * está usando a conta real.
 */
export function credenciaisUber(env: Env, modo: ModoOperacao): CredenciaisUber {
  const teste = modo === "teste";
  const ou = (a: string | undefined, b: string | undefined) =>
    (a && a.trim()) || (b && b.trim()) || "";

  return {
    clientId: teste ? ou(env.UBER_CLIENT_ID_TESTE, env.UBER_CLIENT_ID) : ou(env.UBER_CLIENT_ID, undefined),
    clientSecret: teste
      ? ou(env.UBER_CLIENT_SECRET_TESTE, env.UBER_CLIENT_SECRET)
      : ou(env.UBER_CLIENT_SECRET, undefined),
    customerId: teste
      ? ou(env.UBER_CUSTOMER_ID_TESTE, env.UBER_CUSTOMER_ID)
      : ou(env.UBER_CUSTOMER_ID, undefined),
    baseUrl: teste
      ? ou(env.UBER_BASE_URL_TESTE, "https://sandbox-api.uber.com")
      : ou(env.UBER_BASE_URL, "https://api.uber.com"),
    // O endpoint de OAuth é o mesmo nos dois mundos; o que separa é a credencial.
    authUrl: ou(env.UBER_AUTH_URL, "https://auth.uber.com/oauth/v2/token"),
    // Escopo POR MODO: as duas contas podem ter permissões diferentes, e
    // pedir um escopo que a aplicação não tem derruba o token inteiro
    // (invalid_scope) em vez de ignorar o que falta.
    scope: teste
      ? ou(env.UBER_SCOPE_TESTE, env.UBER_SCOPE || "direct.organizations")
      : ou(env.UBER_SCOPE, "direct.organizations"),
    webhookSecret: teste
      ? ou(env.UBER_WEBHOOK_SECRET_TESTE, env.UBER_WEBHOOK_SECRET)
      : ou(env.UBER_WEBHOOK_SECRET, undefined),
  };
}

export interface CredenciaisIfood {
  clientId: string;
  clientSecret: string;
  /** Id da loja no iFood (UUID). É ele que vai na URL da cotação e do pedido. */
  merchantId: string;
  baseUrl: string;
}

/**
 * Credenciais do iFood para o modo pedido.
 *
 * O iFood NÃO tem host de sandbox: teste e produção falam com a mesma API. O
 * que separa os dois mundos é a LOJA — o portal de desenvolvedor entrega uma
 * loja de teste junto com a aplicação, e é o merchant id dela que vai no modo
 * teste. Por isso o merchant id também é por modo, não só o client.
 *
 * O Client Secret tem dupla função: gera o token e assina o webhook
 * (X-IFood-Signature). Não existe "signing key" separada como no Uber.
 */
export function credenciaisIfood(env: Env, modo: ModoOperacao): CredenciaisIfood {
  const teste = modo === "teste";
  const ou = (a: string | undefined, b: string | undefined) =>
    (a && a.trim()) || (b && b.trim()) || "";
  const base = "https://merchant-api.ifood.com.br";

  return {
    clientId: teste
      ? ou(env.IFOOD_CLIENT_ID_TESTE, env.IFOOD_CLIENT_ID)
      : ou(env.IFOOD_CLIENT_ID, undefined),
    clientSecret: teste
      ? ou(env.IFOOD_CLIENT_SECRET_TESTE, env.IFOOD_CLIENT_SECRET)
      : ou(env.IFOOD_CLIENT_SECRET, undefined),
    merchantId: teste
      ? ou(env.IFOOD_MERCHANT_ID_TESTE, env.IFOOD_MERCHANT_ID)
      : ou(env.IFOOD_MERCHANT_ID, undefined),
    baseUrl: teste
      ? ou(env.IFOOD_BASE_URL_TESTE, env.IFOOD_BASE_URL || base)
      : ou(env.IFOOD_BASE_URL, base),
  };
}

/** O modo teste está caindo nas credenciais de produção por falta das de teste? */
export function testeUsandoCredencialDeProducao(env: Env): boolean {
  return (
    !env.UBER_CLIENT_ID_TESTE?.trim() && !!env.UBER_CLIENT_ID?.trim()
  );
}

/**
 * Prefixo das chaves de cache no KV.
 *
 * Inclui o MODO, não só o ambiente: sem isso, trocar para produção
 * reaproveitaria o token OAuth2 do sandbox — que a API de produção recusaria,
 * ou pior, aceitaria contra a conta errada.
 */
export function prefixoCache(env: Env, modo: ModoOperacao): string {
  return `${ambiente(env)}:${modo}:`;
}
