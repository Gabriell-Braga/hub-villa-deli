import type { Env, TipoTokenSenha } from "../types";

// ---------------------------------------------------------------------------
// Tokens de definição de senha — convite de primeiro acesso e recuperação.
//
// O token cru só existe UMA vez: no momento em que é gerado, para virar link.
// No banco fica apenas o SHA-256 dele. Se o banco vazar, os links já emitidos
// não valem nada.
//
// Validade curta e uso único. Definir a senha invalida todos os outros tokens
// daquele usuário — senão um link de convite antigo continuaria abrindo a
// conta depois de uma troca de senha.
// ---------------------------------------------------------------------------

/** Convite: o atendente pode demorar a abrir o WhatsApp. */
const VALIDADE_CONVITE_HORAS = 7 * 24;
/** Recuperação: janela curta, é uma ação deliberada e imediata. */
const VALIDADE_RECUPERACAO_HORAS = 2;

function paraBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** SHA-256 em hex. É o que vai para a coluna token_hash. */
export async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function gerarTokenCru(): string {
  // 32 bytes = 256 bits de entropia. Inviável de adivinhar por força bruta.
  return paraBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function validadeHoras(tipo: TipoTokenSenha): number {
  return tipo === "convite" ? VALIDADE_CONVITE_HORAS : VALIDADE_RECUPERACAO_HORAS;
}

/**
 * Monta o link que o usuário vai abrir.
 *
 * A base sai de PAINEL_ORIGIN (primeira entrada). É a mesma variável que já
 * controla o CORS, então não há como o link apontar para um domínio que o
 * painel não atende.
 */
export function montarLink(env: Env, token: string): string {
  const base =
    env.PAINEL_ORIGIN?.split(",")[0]?.trim() || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/definir-senha?token=${encodeURIComponent(token)}`;
}

/**
 * Entrega o link ao usuário.
 *
 * Hoje não há provedor de e-mail configurado, então o link é registrado no log
 * do Worker e devolvido ao admin na tela de Usuários, para ele repassar por
 * WhatsApp. Quando houver e-mail, é só implementar o envio aqui — nenhuma
 * outra parte do sistema muda.
 */
export async function entregarLink(
  env: Env,
  destinatario: string,
  link: string,
  tipo: TipoTokenSenha
): Promise<{ enviadoPorEmail: boolean }> {
  console.log(
    `[senha] link de ${tipo} para ${destinatario}: ${link}`
  );

  // Ponto de extensão: com um provedor configurado, envie o e-mail aqui e
  // devolva { enviadoPorEmail: true }.
  void env;
  return { enviadoPorEmail: false };
}
