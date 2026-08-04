import type {
  Cotacao,
  Env,
  Papel,
  Pedido,
  PedidoResumo,
  ResultadoDespacho,
  StatusPedido,
  TipoTokenSenha,
  Usuario,
  UsuarioListado,
} from "../types";

// ---------------------------------------------------------------------------
// Persistência de pedidos no D1 (SQLite).
//
// Ver o porquê de D1 e não KV no comentário do schema.sql.
// ---------------------------------------------------------------------------

interface LinhaPedido {
  id: string;
  criado_em: string;
  status: string;
  dados: string;
  cotacoes: string | null;
  cotado_em: string | null;
  despacho: string | null;
  despachado_em: string | null;
}

function linhaParaPedido(l: LinhaPedido): Pedido {
  // `dados` guarda o pedido inteiro; status vem da coluna (é o que muda).
  const p = JSON.parse(l.dados) as Pedido;
  return { ...p, id: l.id, criadoEm: l.criado_em, status: l.status as StatusPedido };
}

/**
 * Grava o pedido do webhook.
 *
 * INSERT OR IGNORE de propósito: o Cardápio Web pode reenviar o mesmo webhook
 * (retry por timeout). Reprocessar não pode zerar um pedido já despachado.
 * Retorna false quando o pedido já existia.
 */
export async function salvarPedidoNovo(env: Env, pedido: Pedido): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO pedidos (id, criado_em, status, dados)
     VALUES (?1, ?2, ?3, ?4)`
  )
    .bind(pedido.id, pedido.criadoEm, pedido.status, JSON.stringify(pedido))
    .run();

  return (r.meta.changes ?? 0) > 0;
}

export async function obterPedido(env: Env, id: string): Promise<Pedido | null> {
  const l = await env.DB.prepare(`SELECT * FROM pedidos WHERE id = ?1`)
    .bind(id)
    .first<LinhaPedido>();

  return l ? linhaParaPedido(l) : null;
}

/** Salva a cotação. Não mexe em pedido já despachado/em despacho. */
export async function salvarCotacoes(
  env: Env,
  idPedido: string,
  cotacoes: Cotacao[]
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pedidos
        SET cotacoes = ?2,
            cotado_em = ?3,
            status = CASE WHEN status = 'recebido' THEN 'cotado' ELSE status END
      WHERE id = ?1
        AND status IN ('recebido', 'cotado')`
  )
    .bind(idPedido, JSON.stringify(cotacoes), new Date().toISOString())
    .run();
}

export async function obterCotacoes(
  env: Env,
  idPedido: string
): Promise<Cotacao[] | null> {
  const l = await env.DB.prepare(`SELECT cotacoes FROM pedidos WHERE id = ?1`)
    .bind(idPedido)
    .first<{ cotacoes: string | null }>();

  return l?.cotacoes ? (JSON.parse(l.cotacoes) as Cotacao[]) : null;
}

/** Despacho já concluído, se houver. Base da idempotência. */
export async function obterDespacho(
  env: Env,
  idPedido: string
): Promise<ResultadoDespacho | null> {
  const l = await env.DB.prepare(`SELECT despacho FROM pedidos WHERE id = ?1`)
    .bind(idPedido)
    .first<{ despacho: string | null }>();

  return l?.despacho ? (JSON.parse(l.despacho) as ResultadoDespacho) : null;
}

/**
 * TRAVA CONTRA DESPACHO DUPLICADO.
 *
 * Move o pedido para 'despachando' só se ele ainda não estiver despachado nem
 * em despacho. O UPDATE condicional é atômico no SQLite: se dois cliques
 * chegarem juntos, só um recebe changes > 0. O outro é barrado ANTES de bater
 * na API do parceiro — que é onde a corrida seria cobrada em dobro.
 */
export async function reservarDespacho(env: Env, idPedido: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE pedidos SET status = 'despachando'
      WHERE id = ?1 AND status IN ('recebido', 'cotado')`
  )
    .bind(idPedido)
    .run();

  return (r.meta.changes ?? 0) > 0;
}

/** Libera a trava quando o parceiro recusou — permite tentar de novo. */
export async function liberarDespacho(env: Env, idPedido: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE pedidos SET status = 'cotado' WHERE id = ?1 AND status = 'despachando'`
  )
    .bind(idPedido)
    .run();
}

export async function concluirDespacho(
  env: Env,
  idPedido: string,
  resultado: ResultadoDespacho
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pedidos
        SET status = 'despachado', despacho = ?2, despachado_em = ?3
      WHERE id = ?1`
  )
    .bind(idPedido, JSON.stringify(resultado), new Date().toISOString())
    .run();
}

/**
 * Limpeza dos pedidos antigos. O KV expirava sozinho por TTL; o D1 não —
 * por isso o cron em wrangler.toml chama isto uma vez por dia.
 *
 * Só apaga de `pedidos` (estado ao vivo). O histórico em `deliveries` fica,
 * senão o relatório perderia o passado.
 */
export async function limparPedidosAntigos(env: Env, dias = 30): Promise<number> {
  const corte = new Date(Date.now() - dias * 86400_000).toISOString();
  const r = await env.DB.prepare(
    `DELETE FROM pedidos WHERE criado_em < ?1 AND status = 'despachado'`
  )
    .bind(corte)
    .run();

  return r.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// DELIVERIES — histórico para relatório
// ---------------------------------------------------------------------------

/**
 * Grava a entrega no histórico. `INSERT OR IGNORE` porque UNIQUE(id_pedido) é
 * a última linha de defesa contra contar a mesma entrega duas vezes no
 * relatório, caso alguma corrida de código escape das travas do /api/despachar.
 */
export async function registrarDelivery(
  env: Env,
  pedido: Pedido,
  cotacao: Cotacao,
  resultado: ResultadoDespacho,
  despachadoPor: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO deliveries (
       id_pedido, plataforma_escolhida, valor_pago, eta_minutos, status,
       data_criacao, delivery_id_externo, tracking_url,
       cliente_nome, bairro, valor_pedido, despachado_por
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  )
    .bind(
      pedido.id,
      resultado.provider,
      cotacao.preco ?? 0,
      cotacao.etaMinutos,
      resultado.status,
      new Date().toISOString(),
      resultado.deliveryId,
      resultado.trackingUrl,
      pedido.cliente.nome,
      pedido.endereco.bairro,
      pedido.total,
      despachadoPor
    )
    .run();
}

// ---------------------------------------------------------------------------
// Listagem para as telas "Pedidos em Aberto" e "Histórico"
// ---------------------------------------------------------------------------

interface LinhaLista {
  id: string;
  criado_em: string;
  status: string;
  dados: string;
  cotacoes: string | null;
  despacho: string | null;
  valor_pago: number | null;
}

export async function listarPedidos(
  env: Env,
  opcoes: { abertos: boolean; limite?: number }
): Promise<PedidoResumo[]> {
  const limite = Math.min(Math.max(opcoes.limite ?? 50, 1), 200);

  // Abertos = tudo que ainda não virou corrida. Histórico = o resto.
  const filtro = opcoes.abertos
    ? `p.status IN ('recebido', 'cotado', 'despachando')`
    : `p.status = 'despachado'`;

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.criado_em, p.status, p.dados, p.cotacoes, p.despacho,
            d.valor_pago
       FROM pedidos p
       LEFT JOIN deliveries d ON d.id_pedido = p.id
      WHERE ${filtro}
      ORDER BY p.criado_em DESC
      LIMIT ?1`
  )
    .bind(limite)
    .all<LinhaLista>();

  return (results ?? []).map((l) => {
    const p = JSON.parse(l.dados) as Pedido;
    const cotacoes = l.cotacoes ? (JSON.parse(l.cotacoes) as Cotacao[]) : [];
    const despacho = l.despacho
      ? (JSON.parse(l.despacho) as ResultadoDespacho)
      : null;

    const precos = cotacoes
      .filter((c) => c.disponivel && c.preco != null)
      .map((c) => c.preco as number);

    return {
      id: l.id,
      criadoEm: l.criado_em,
      status: l.status as StatusPedido,
      clienteNome: p.cliente?.nome ?? "—",
      bairro: p.endereco?.bairro ?? "",
      cidade: p.endereco?.cidade ?? "",
      total: p.total ?? 0,
      itens: p.itens?.length ?? 0,
      despacho: despacho ? { ...despacho, valorPago: l.valor_pago } : null,
      melhorPreco: precos.length ? Math.min(...precos) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// USUARIOS
// ---------------------------------------------------------------------------

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  senha_hash: string | null;
  papel: string;
  ativo: number;
  criado_em?: string;
}

export const normalizarEmail = (e: string) => e.trim().toLowerCase();

export async function buscarUsuarioPorEmail(
  env: Env,
  email: string
): Promise<(Usuario & { senhaHash: string | null; ativo: boolean }) | null> {
  const l = await env.DB.prepare(
    `SELECT id, nome, email, senha_hash, papel, ativo FROM usuarios WHERE email = ?1`
  )
    .bind(normalizarEmail(email))
    .first<LinhaUsuario>();

  if (!l) return null;

  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.papel as Papel,
    senhaHash: l.senha_hash,
    ativo: l.ativo === 1,
  };
}

export async function buscarUsuarioPorId(
  env: Env,
  id: string
): Promise<Usuario | null> {
  const l = await env.DB.prepare(
    `SELECT id, nome, email, papel FROM usuarios WHERE id = ?1`
  )
    .bind(id)
    .first<LinhaUsuario>();

  return l ? { id: l.id, nome: l.nome, email: l.email, papel: l.papel as Papel } : null;
}

/**
 * Lista para a tela de gestão. O LEFT JOIN traz o vencimento do link de acesso
 * ainda válido, se houver — é o que mostra "aguardando primeiro acesso".
 */
export async function listarUsuarios(env: Env): Promise<UsuarioListado[]> {
  const agora = new Date().toISOString();

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
            (u.senha_hash IS NULL) AS sem_senha,
            (SELECT MAX(t.expira_em) FROM tokens_senha t
              WHERE t.usuario_id = u.id AND t.usado_em IS NULL AND t.expira_em > ?1
            ) AS link_ate
       FROM usuarios u
      ORDER BY u.ativo DESC, u.nome COLLATE NOCASE`
  )
    .bind(agora)
    .all<{
      id: string;
      nome: string;
      email: string;
      papel: string;
      ativo: number;
      criado_em: string;
      sem_senha: number;
      link_ate: string | null;
    }>();

  return (results ?? []).map((l) => ({
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.papel as Papel,
    ativo: l.ativo === 1,
    criadoEm: l.criado_em,
    semSenha: l.sem_senha === 1,
    linkPendenteAte: l.link_ate,
  }));
}

/** Retorna null quando o e-mail já existe (UNIQUE). */
export async function criarUsuario(
  env: Env,
  dados: { nome: string; email: string; papel: Papel }
): Promise<Usuario | null> {
  const id = crypto.randomUUID();
  const email = normalizarEmail(dados.email);

  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO usuarios (id, nome, email, senha_hash, papel, ativo, criado_em)
     VALUES (?1, ?2, ?3, NULL, ?4, 1, ?5)`
  )
    .bind(id, dados.nome.trim(), email, dados.papel, new Date().toISOString())
    .run();

  if ((r.meta.changes ?? 0) === 0) return null;

  return { id, nome: dados.nome.trim(), email, papel: dados.papel };
}

export async function atualizarUsuario(
  env: Env,
  id: string,
  campos: { nome?: string; papel?: Papel; ativo?: boolean }
): Promise<boolean> {
  const partes: string[] = [];
  const valores: unknown[] = [];

  if (campos.nome !== undefined) {
    partes.push(`nome = ?${partes.length + 1}`);
    valores.push(campos.nome.trim());
  }
  if (campos.papel !== undefined) {
    partes.push(`papel = ?${partes.length + 1}`);
    valores.push(campos.papel);
  }
  if (campos.ativo !== undefined) {
    partes.push(`ativo = ?${partes.length + 1}`);
    valores.push(campos.ativo ? 1 : 0);
  }
  if (partes.length === 0) return false;

  const r = await env.DB.prepare(
    `UPDATE usuarios SET ${partes.join(", ")} WHERE id = ?${partes.length + 1}`
  )
    .bind(...valores, id)
    .run();

  return (r.meta.changes ?? 0) > 0;
}

/** Quantos admins ativos existem — usado para não deixar o sistema sem dono. */
export async function contarAdminsAtivos(env: Env): Promise<number> {
  const l = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin' AND ativo = 1`
  ).first<{ n: number }>();

  return l?.n ?? 0;
}

// ---------------------------------------------------------------------------
// TOKENS DE SENHA
// ---------------------------------------------------------------------------

export async function salvarTokenSenha(
  env: Env,
  tokenHash: string,
  usuarioId: string,
  tipo: TipoTokenSenha,
  expiraEm: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tokens_senha (token_hash, usuario_id, tipo, criado_em, expira_em)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(tokenHash, usuarioId, tipo, new Date().toISOString(), expiraEm)
    .run();
}

export interface TokenValido {
  usuarioId: string;
  tipo: TipoTokenSenha;
  nome: string;
  email: string;
}

/** Só consulta — não marca como usado. Usado para a tela mostrar o nome. */
export async function lerTokenSenha(
  env: Env,
  tokenHash: string
): Promise<TokenValido | null> {
  const l = await env.DB.prepare(
    `SELECT t.usuario_id, t.tipo, u.nome, u.email
       FROM tokens_senha t
       JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.token_hash = ?1
        AND t.usado_em IS NULL
        AND t.expira_em > ?2
        AND u.ativo = 1`
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{ usuario_id: string; tipo: string; nome: string; email: string }>();

  if (!l) return null;

  return {
    usuarioId: l.usuario_id,
    tipo: l.tipo as TipoTokenSenha,
    nome: l.nome,
    email: l.email,
  };
}

/**
 * Define a senha e queima o token, tudo de uma vez.
 *
 * O UPDATE do token vem com as mesmas condições da leitura (não usado, não
 * expirado): se dois pedidos chegarem juntos com o mesmo link, só um encontra
 * o token disponível. Sem isso, um link vazado poderia ser usado duas vezes.
 *
 * Todos os outros tokens do usuário morrem junto — um convite antigo não pode
 * continuar abrindo a conta depois de a senha existir.
 */
export async function consumirTokenEDefinirSenha(
  env: Env,
  tokenHash: string,
  senhaHash: string
): Promise<boolean> {
  const agora = new Date().toISOString();

  const marcado = await env.DB.prepare(
    `UPDATE tokens_senha SET usado_em = ?2
      WHERE token_hash = ?1 AND usado_em IS NULL AND expira_em > ?2`
  )
    .bind(tokenHash, agora)
    .run();

  if ((marcado.meta.changes ?? 0) === 0) return false;

  const dono = await env.DB.prepare(
    `SELECT usuario_id FROM tokens_senha WHERE token_hash = ?1`
  )
    .bind(tokenHash)
    .first<{ usuario_id: string }>();

  if (!dono) return false;

  await env.DB.batch([
    env.DB.prepare(`UPDATE usuarios SET senha_hash = ?2 WHERE id = ?1`).bind(
      dono.usuario_id,
      senhaHash
    ),
    env.DB.prepare(
      `UPDATE tokens_senha SET usado_em = ?2
        WHERE usuario_id = ?1 AND usado_em IS NULL`
    ).bind(dono.usuario_id, agora),
  ]);

  return true;
}

/** Invalida links pendentes — ao desativar um usuário, por exemplo. */
export async function invalidarTokensDoUsuario(
  env: Env,
  usuarioId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE tokens_senha SET usado_em = ?2 WHERE usuario_id = ?1 AND usado_em IS NULL`
  )
    .bind(usuarioId, new Date().toISOString())
    .run();
}

/** Limpeza: tokens vencidos há mais de 30 dias não servem nem para auditoria. */
export async function limparTokensAntigos(env: Env): Promise<number> {
  const corte = new Date(Date.now() - 30 * 86400_000).toISOString();
  const r = await env.DB.prepare(`DELETE FROM tokens_senha WHERE expira_em < ?1`)
    .bind(corte)
    .run();

  return r.meta.changes ?? 0;
}
