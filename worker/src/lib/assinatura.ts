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

/**
 * Assinatura da 99Entrega (header X-Webhook-Signature): HMAC-SHA256 do corpo
 * cru com a "Chave de assinatura" do Modo de desenvolvedor.
 *
 * A documentação deles se contradiz: o texto manda codificar em Base64, e o
 * exemplo em Python usa hexdigest. Aceita os dois — são a mesma assinatura em
 * grafias diferentes, então não afrouxa nada.
 */
export async function assinaturaValida99(
  segredo: string,
  corpoBruto: string,
  recebida: string | null
): Promise<boolean> {
  if (!segredo || !recebida) return false;

  const hex = await hmacSha256Hex(segredo, corpoBruto);
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
  const base64 = btoa(String.fromCharCode(...bytes));
  const r = recebida.trim();

  return comparaSegura(base64, r) || comparaSegura(hex, r.toLowerCase());
}

/**
 * Assinatura do webhook da Lalamove. Não está na documentação pública: foi
 * descoberta comparando eventos reais do sandbox (06/11/2026).
 *
 *   HMAC-SHA256(api secret, "{timestamp}\r\nPOST\r\n{path}\r\n\r\n{data}") em hex
 *
 * `timestamp` e `signature` vêm DENTRO do corpo (em segundos). `path` é o da
 * nossa rota. `data` é o trecho CRU do campo data, como chegou — re-serializar
 * muda a ordem das chaves e o hash não bate. O campo data é sempre o último
 * do corpo, então o trecho vai de `"data":` até a chave final.
 */
export async function assinaturaValidaLalamove(
  segredo: string,
  path: string,
  corpoBruto: string,
  timestamp: number | string | undefined,
  recebida: string | undefined
): Promise<boolean> {
  const inicio = corpoBruto.indexOf('"data":');
  if (!segredo || !recebida || timestamp == null || inicio < 0) return false;
  const data = corpoBruto.slice(inicio + 7, corpoBruto.lastIndexOf("}")).trim();
  const esperada = await hmacSha256Hex(segredo, `${timestamp}\r\nPOST\r\n${path}\r\n\r\n${data}`);
  return comparaSegura(esperada, recebida.trim().toLowerCase());
}
