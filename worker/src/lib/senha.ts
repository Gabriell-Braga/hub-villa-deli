// ---------------------------------------------------------------------------
// Hash de senha com PBKDF2-SHA256 (WebCrypto — roda nativo no Worker).
//
// Formato armazenado:  pbkdf2$<iterações>$<salt-base64>$<hash-base64>
// O mesmo formato é gerado por scripts/hash-senha.mjs, que usa node:crypto.
//
// Por que PBKDF2 e não bcrypt/argon2: são módulos nativos que não rodam em
// Workers. PBKDF2 com 100k iterações é o padrão disponível no WebCrypto e
// suficiente para um painel interno.
// ---------------------------------------------------------------------------

const ITERACOES = 100_000;
const TAMANHO_HASH = 32; // bytes

function paraBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function deBase64(texto: string): Uint8Array {
  return Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));
}

async function derivar(
  senha: string,
  salt: Uint8Array,
  iteracoes: number
): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iteracoes, hash: "SHA-256" },
    chave,
    TAMANHO_HASH * 8
  );

  return new Uint8Array(bits);
}

export async function gerarHash(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(senha, salt, ITERACOES);
  return `pbkdf2$${ITERACOES}$${paraBase64(salt)}$${paraBase64(hash)}`;
}

export async function conferirSenha(
  senha: string,
  armazenado: string
): Promise<boolean> {
  const partes = armazenado.split("$");
  if (partes.length !== 4 || partes[0] !== "pbkdf2") return false;

  const iteracoes = Number(partes[1]);
  if (!Number.isFinite(iteracoes) || iteracoes < 1) return false;

  let salt: Uint8Array;
  try {
    salt = deBase64(partes[2]);
  } catch {
    return false;
  }

  const calculado = paraBase64(await derivar(senha, salt, iteracoes));

  // Comparação em tempo constante — ver lib/auth.ts.
  const esperado = partes[3];
  if (calculado.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < calculado.length; i++) {
    diff |= calculado.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}
