// ---------------------------------------------------------------------------
// Verificação de assinatura HMAC de webhook.
//
// A Uber assina cada webhook com HMAC-SHA256 do CORPO CRU, em hexadecimal,
// usando a signing key do endpoint (Dashboard > Developer > Webhooks).
//
// Detalhe que quebra implementações: tem que ser o corpo EXATAMENTE como
// chegou. Fazer JSON.parse e re-serializar muda espaçamento e ordem de chaves,
// e o hash não bate mais. Por isso a rota lê `c.req.text()` antes de qualquer
// parse.
// ---------------------------------------------------------------------------

function paraHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC-SHA256 do corpo, em hex minúsculo. */
export async function hmacSha256Hex(
  segredo: string,
  corpoBruto: string
): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const assinatura = await crypto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(corpoBruto)
  );

  return paraHex(assinatura);
}

/**
 * Compara em tempo constante. Um `===` para no primeiro byte diferente, o que
 * permite descobrir a assinatura correta medindo tempo de resposta.
 */
function comparaSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function assinaturaValida(
  segredo: string,
  corpoBruto: string,
  recebida: string | null
): Promise<boolean> {
  if (!segredo || !recebida) return false;

  const esperada = await hmacSha256Hex(segredo, corpoBruto);
  // A Uber manda em minúsculo, mas normalizar é barato e evita um falso
  // negativo bobo caso mudem.
  return comparaSegura(esperada, recebida.trim().toLowerCase());
}
