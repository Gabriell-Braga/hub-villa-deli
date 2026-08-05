import type { Env, ModoOperacao } from "../types";
import { ambiente } from "./ambiente";

// ---------------------------------------------------------------------------
// MODO DE OPERAÇÃO — teste | producao
//
// É o que decide QUAIS credenciais do parceiro serão usadas. Em "teste" o Hub
// fala com o sandbox e nada é cobrado; em "producao" a corrida é real.
//
// Fica no D1 (tabela `config`), não em variável de ambiente, para o admin
// trocar pela tela de Configurações sem precisar de deploy. Fica no D1 e não
// no KV porque a leitura precisa ser exata — o KV é eventualmente consistente,
// e alguns segundos de atraso numa troca de modo podem virar uma corrida
// cobrada quando se achava estar em teste.
//
// TRAVA IMPORTANTE: só o Worker de PRODUÇÃO pode entrar em modo produção.
// Um worker de dev ou homologação fica preso em "teste" mesmo que alguém
// grave outra coisa no banco. Assim o ambiente de teste jamais gasta dinheiro,
// e o worker de produção ainda pode ser validado com sandbox antes de virar
// a chave.
// ---------------------------------------------------------------------------

const CHAVE = "modo_operacao";

/**
 * Padrão quando ninguém nunca trocou: SEMPRE teste, inclusive no Worker de
 * produção.
 *
 * A alternativa — produção já ligada no ambiente de produção — significa que o
 * primeiro deploy começa cobrando corrida de verdade, antes de qualquer
 * validação. Aqui o caminho é explícito: publica, confere na tela de
 * Configurações, e só então um admin vira a chave.
 *
 * O custo é o inverso: se o banco for recriado, produção volta para teste e as
 * entregas param de ser despachadas de verdade. Mas isso falha SEM gastar
 * dinheiro e a faixa amarela no topo do painel é impossível de não ver.
 */
function padrao(_env: Env): ModoOperacao {
  return "teste";
}

/** O ambiente atual sequer permite modo produção? */
export function podeUsarProducao(env: Env): boolean {
  return ambiente(env) === "producao";
}

export async function modoAtual(env: Env): Promise<ModoOperacao> {
  if (!podeUsarProducao(env)) return "teste";

  try {
    const l = await env.DB.prepare(`SELECT valor FROM config WHERE chave = ?1`)
      .bind(CHAVE)
      .first<{ valor: string }>();

    if (l?.valor === "producao") return "producao";
    if (l?.valor === "teste") return "teste";
  } catch {
    // Tabela ainda não migrada: cai no padrão em vez de derrubar a cotação.
  }

  return padrao(env);
}

export async function definirModo(
  env: Env,
  modo: ModoOperacao,
  quem: string
): Promise<{ ok: boolean; erro?: string }> {
  if (modo === "producao" && !podeUsarProducao(env)) {
    return {
      ok: false,
      erro: "Este ambiente é de teste e não pode operar em produção.",
    };
  }

  await env.DB.prepare(
    `INSERT INTO config (chave, valor, atualizado_em, atualizado_por)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(chave) DO UPDATE SET
       valor = ?2, atualizado_em = ?3, atualizado_por = ?4`
  )
    .bind(CHAVE, modo, new Date().toISOString(), quem)
    .run();

  return { ok: true };
}

export async function quemTrocouModo(
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
