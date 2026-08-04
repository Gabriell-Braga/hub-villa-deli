import type { Env } from "../types";

// ---------------------------------------------------------------------------
// AMBIENTES — dev | hml | producao
//
// Cada parceiro tem um host de teste (sandbox/homologação) e um de produção.
// Trocar de ambiente NÃO deve exigir mexer no código dos services: eles pedem
// a URL aqui e recebem a do ambiente corrente.
//
// Como se define o ambiente:
//   - `AMBIENTE` no wrangler.toml ([vars] do topo = dev, [env.hml], [env.producao])
//   - roda com:  npx wrangler dev            -> dev
//                npx wrangler dev --env hml  -> hml
//                npx wrangler deploy --env producao
//
// Regra de ouro: enquanto AMBIENTE != "producao", nenhuma corrida é cobrada de
// verdade — desde que as credenciais também sejam as de sandbox. Por isso os
// segredos são separados POR AMBIENTE no wrangler (`secret put --env hml`).
// ---------------------------------------------------------------------------

export type NomeAmbiente = "dev" | "hml" | "producao";

export function ambiente(env: Env): NomeAmbiente {
  const v = (env.AMBIENTE ?? "dev").trim().toLowerCase();
  if (v === "producao" || v === "production" || v === "prod") return "producao";
  if (v === "hml" || v === "homologacao" || v === "sandbox") return "hml";
  return "dev";
}

export function ehProducao(env: Env): boolean {
  return ambiente(env) === "producao";
}

/**
 * URLs do Uber Direct por ambiente.
 *
 * O host de sandbox pode variar conforme o contrato — por isso ele é uma
 * variável (`UBER_BASE_URL_HML`), não uma constante. Confirme o valor com seu
 * gerente de conta Uber antes de usar em HML.
 */
export function uberUrls(env: Env): { base: string; auth: string } {
  const producao = ehProducao(env);

  return {
    base: producao
      ? env.UBER_BASE_URL || "https://api.uber.com"
      : env.UBER_BASE_URL_HML || env.UBER_BASE_URL || "https://sandbox-api.uber.com",
    // O endpoint de OAuth costuma ser o mesmo nos dois ambientes; o que separa
    // os mundos são as credenciais e o customer_id.
    auth: env.UBER_AUTH_URL || "https://auth.uber.com/oauth/v2/token",
  };
}

/** customer_id do Uber Direct — é DIFERENTE entre sandbox e produção. */
export function uberCustomerId(env: Env): string {
  return ehProducao(env)
    ? env.UBER_CUSTOMER_ID
    : env.UBER_CUSTOMER_ID_HML || env.UBER_CUSTOMER_ID;
}

/** Prefixo das chaves de cache no KV — evita vazar token de HML para produção. */
export function prefixoCache(env: Env): string {
  return `${ambiente(env)}:`;
}
