import type { Env } from "../types";

// ---------------------------------------------------------------------------
// MOTOBOY PRÓPRIO — liga/desliga pela tela de Configurações.
//
// Existe porque o motoboy é gente, não API: tem dia que ele não veio, está
// em outra entrega longa, ou a loja fechou o delivery próprio no feriado. Sem
// esta chave, o card continuava aparecendo — muitas vezes como o mais barato
// — e o atendente despachava para ninguém.
//
// Fica no D1 (tabela `config`), como o modo de operação: o admin troca sem
// deploy, e a leitura é exata (KV é eventualmente consistente).
//
// É uma camada POR CIMA da trava de provedores (PROVEDORES_ATIVOS): se a trava
// não inclui o motoboy, esta chave não o liga. Ela só desliga.
// ---------------------------------------------------------------------------

const CHAVE = "motoboy_ativo";

/** Ligado, a menos que um admin tenha desligado. Tabela sem migrar = ligado. */
export async function motoboyLigado(env: Env): Promise<boolean> {
  try {
    const l = await env.DB.prepare(`SELECT valor FROM config WHERE chave = ?1`)
      .bind(CHAVE)
      .first<{ valor: string }>();
    return l?.valor !== "0";
  } catch {
    return true;
  }
}

export async function definirMotoboy(env: Env, ativo: boolean, quem: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO config (chave, valor, atualizado_em, atualizado_por)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(chave) DO UPDATE SET
       valor = ?2, atualizado_em = ?3, atualizado_por = ?4`
  )
    .bind(CHAVE, ativo ? "1" : "0", new Date().toISOString(), quem)
    .run();
}

export async function quemTrocouMotoboy(
  env: Env
): Promise<{ em: string; por: string | null } | null> {
  try {
    const l = await env.DB.prepare(
      `SELECT atualizado_em, atualizado_por FROM config WHERE chave = ?1`
    )
      .bind(CHAVE)
      .first<{ atualizado_em: string; atualizado_por: string | null }>();
    return l ? { em: l.atualizado_em, por: l.atualizado_por } : null;
  } catch {
    return null;
  }
}
