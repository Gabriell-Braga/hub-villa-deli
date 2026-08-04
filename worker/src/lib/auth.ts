// ---------------------------------------------------------------------------
// Autenticação das rotas.
//
// Regra de ouro aqui: FALHA FECHADA. Se o segredo não estiver configurado, a
// rota recusa tudo. A versão anterior fazia o contrário — sem WEBHOOK_SECRET
// setado, o webhook aceitava qualquer POST da internet.
// ---------------------------------------------------------------------------

/**
 * Compara em tempo constante. Um `===` normal para de comparar no primeiro
 * byte diferente, o que permite descobrir o token caractere por caractere
 * medindo o tempo de resposta.
 */
export function comparaSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Extrai o token de `Authorization: Bearer <token>` ou do header alternativo. */
export function tokenDoRequest(
  headers: Headers,
  headerAlternativo: string
): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return headers.get(headerAlternativo);
}

export type ResultadoAuth = { ok: true } | { ok: false; status: 401 | 500; erro: string };

export function validarToken(
  esperado: string | undefined,
  recebido: string | null,
  nomeDaVariavel: string
): ResultadoAuth {
  if (!esperado) {
    // Falha fechada: sem segredo configurado, ninguém entra.
    // O nome da variável fica no log do servidor, não na resposta — quem
    // chama esta rota pode ser um sistema externo, e dizer qual configuração
    // falta entrega o desenho interno de graça.
    console.warn(`[auth] ${nomeDaVariavel} não configurado — rota bloqueada.`);
    return {
      ok: false,
      status: 500,
      erro: "Integração não configurada.",
    };
  }
  if (!recebido || !comparaSegura(esperado, recebido)) {
    return { ok: false, status: 401, erro: "não autorizado" };
  }
  return { ok: true };
}
