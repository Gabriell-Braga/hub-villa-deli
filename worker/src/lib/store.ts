import type {
  Cotacao,
  EntregaAoVivo,
  Env,
  EstadoEntrega,
  EventoEntrega,
  ModoOperacao,
  Papel,
  ProviderId,
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
    `INSERT OR IGNORE INTO pedidos (id, criado_em, status, dados, teste)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(
      pedido.id,
      pedido.criadoEm,
      pedido.status,
      JSON.stringify(pedido),
      pedido.teste ? 1 : 0
    )
    .run();

  return (r.meta.changes ?? 0) > 0;
}

/** O que o Cardápio Web ainda pode mudar depois do pedido ter entrado. */
export interface AtualizacaoCardapio {
  statusCardapio: string | null;
  pago: boolean;
  formaPagamento?: string;
  freteCobrado: number;
  subtotal: number;
  total: number;
  canal?: string;
  numeroExterno?: string;
  idExterno?: string;
  semTelefoneDoCliente?: boolean;
}

/**
 * Reaplica no pedido o que veio do Cardápio Web numa releitura.
 *
 * PRECISA existir, e não é detalhe: um pedido no Pix entra com o pagamento
 * ainda não compensado. Se só o status fosse atualizado, `pago` ficaria
 * congelado em false para sempre e o pedido nunca sairia da fila — foi
 * exatamente o que aconteceu.
 *
 * Atualiza campo a campo com json_set em vez de reescrever `dados` inteiro: o
 * pedido pode estar sendo cotado no mesmo instante, e um "lê, altera, grava"
 * aqui apagaria o que a cotação escreveu.
 *
 * O que NÃO é tocado: id, criadoEm, status do despacho, marca de teste e o
 * telefone. Esses são do Hub, não do Cardápio Web — em especial o telefone,
 * que em pedido de teste foi trocado de propósito pelo do dono do Hub.
 */
export async function atualizarDoCardapio(
  env: Env,
  idPedido: string,
  a: AtualizacaoCardapio
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pedidos SET dados = json_set(
        dados,
        '$.statusCardapio', ?2,
        '$.pago',           json(?3),
        '$.formaPagamento', ?4,
        '$.freteCobrado',   ?5,
        '$.subtotal',       ?6,
        '$.total',          ?7,
        '$.canal',          ?8,
        '$.numeroExterno',  ?9,
        '$.idExterno',      ?10,
        '$.semTelefoneDoCliente', json(?11)
      )
      WHERE id = ?1`
  )
    .bind(
      idPedido,
      a.statusCardapio,
      // json() porque um bind de 1/0 viraria número, e o painel checa booleano.
      a.pago ? "true" : "false",
      a.formaPagamento ?? null,
      a.freteCobrado,
      a.subtotal,
      a.total,
      a.canal ?? null,
      a.numeroExterno ?? null,
      a.idExterno ?? null,
      a.semTelefoneDoCliente ? "true" : "false"
    )
    .run();
}

// ---------------------------------------------------------------------------
// FILA DE EVENTOS DO CARDÁPIO WEB
//
// O webhook deles exige HTTP 200 em até 5 s, e depois de 15 falhas PAUSA o
// webhook — a loja para de receber pedidos no Hub sem ninguém perceber. Por
// isso a rota só grava aqui e responde; o processamento pesado (buscar o
// pedido na API deles + geocodificar) acontece fora do caminho da resposta.
// ---------------------------------------------------------------------------

export interface EventoCardapio {
  eventId: string;
  tipo: string;
  orderId: string | null;
  merchantId: string | null;
  payload: string;
}

/** Devolve false quando é reenvio — a doc deles indica `event_id` para isso. */
export async function enfileirarEventoCardapio(
  env: Env,
  e: EventoCardapio
): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO eventos_cardapio
       (event_id, tipo, order_id, merchant_id, recebido_em, payload)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  )
    .bind(
      e.eventId,
      e.tipo,
      e.orderId,
      e.merchantId,
      new Date().toISOString(),
      e.payload
    )
    .run();

  return (r.meta.changes ?? 0) > 0;
}

export async function marcarEventoProcessado(
  env: Env,
  eventId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE eventos_cardapio SET processado_em = ?2, erro = NULL WHERE event_id = ?1`
  )
    .bind(eventId, new Date().toISOString())
    .run();
}

export async function marcarEventoComErro(
  env: Env,
  eventId: string,
  erro: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE eventos_cardapio
        SET tentativas = tentativas + 1, erro = ?2
      WHERE event_id = ?1`
  )
    .bind(eventId, erro.slice(0, 500))
    .run();
}

/**
 * Eventos que ainda não deram certo. O cron reprocessa.
 *
 * `tentativas < 10` evita ficar batendo para sempre num pedido que a API deles
 * nunca vai devolver — um id apagado, por exemplo.
 */
export async function eventosCardapioPendentes(
  env: Env,
  limite = 20
): Promise<EventoCardapio[]> {
  const { results } = await env.DB.prepare(
    `SELECT event_id, tipo, order_id, merchant_id, payload
       FROM eventos_cardapio
      WHERE processado_em IS NULL AND tentativas < 10
      ORDER BY recebido_em
      LIMIT ?1`
  )
    .bind(limite)
    .all<{
      event_id: string;
      tipo: string;
      order_id: string | null;
      merchant_id: string | null;
      payload: string;
    }>();

  return (results ?? []).map((l) => ({
    eventId: l.event_id,
    tipo: l.tipo,
    orderId: l.order_id,
    merchantId: l.merchant_id,
    payload: l.payload,
  }));
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
  despachadoPor: string,
  /** Modo no momento do clique — é o que decide se saiu dinheiro de verdade. */
  modo: ModoOperacao
): Promise<void> {
  // Teste é qualquer um dos dois: pedido simulado, ou despacho com credencial
  // de sandbox. Basta um para a linha não ser uma venda real.
  const teste = pedido.teste || modo === "teste" ? 1 : 0;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO deliveries (
       id_pedido, plataforma_escolhida, valor_pago, frete_cobrado,
       eta_minutos, status, data_criacao, delivery_id_externo, tracking_url,
       codigo_entrega, cliente_nome, bairro, valor_pedido, despachado_por, teste
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
  )
    .bind(
      pedido.id,
      resultado.provider,
      cotacao.preco ?? 0,
      // Congelado no momento do despacho, junto com o custo. Se a loja mudar a
      // tabela de frete amanhã, o resultado de hoje continua sendo o de hoje.
      pedido.freteCobrado ?? 0,
      cotacao.etaMinutos,
      resultado.status,
      new Date().toISOString(),
      resultado.deliveryId,
      resultado.trackingUrl,
      resultado.codigoEntrega ?? null,
      pedido.cliente.nome,
      pedido.endereco.bairro,
      pedido.total,
      despachadoPor,
      teste
    )
    .run();
}

// ---------------------------------------------------------------------------
// WEBHOOKS DE ENTREGA
// ---------------------------------------------------------------------------

/**
 * Arquiva o evento recebido. O INSERT OR IGNORE contra a PRIMARY KEY é a trava
 * de idempotência: a Uber reenvia o mesmo evento até 3 vezes, e reaplicar um
 * "delivered" por cima de um "canceled" posterior inverteria a realidade.
 *
 * Devolve `novo: false` quando é reenvio, e o pedido dono da entrega (se ela
 * nasceu neste Hub).
 */
export async function registrarEvento(
  env: Env,
  e: EventoEntrega
): Promise<{ novo: boolean; idPedido: string | null }> {
  let idPedido: string | null = null;

  if (e.deliveryIdExterno) {
    const l = await env.DB.prepare(
      `SELECT id_pedido FROM deliveries WHERE delivery_id_externo = ?1`
    )
      .bind(e.deliveryIdExterno)
      .first<{ id_pedido: string }>();
    idPedido = l?.id_pedido ?? null;
  }

  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO eventos_entrega
       (id, provider, kind, status, delivery_id_externo, id_pedido,
        criado_em_parceiro, recebido_em, live_mode, payload)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(
      e.id,
      e.provider,
      e.kind,
      e.status,
      e.deliveryIdExterno,
      idPedido,
      e.criadoEmParceiro,
      new Date().toISOString(),
      e.liveMode === null ? null : e.liveMode ? 1 : 0,
      e.payload
    )
    .run();

  return { novo: (r.meta.changes ?? 0) > 0, idPedido };
}

/**
 * Aplica o estado ao vivo na entrega.
 *
 * COALESCE em cada campo de propósito: o courier_update não repete o status, e
 * o delivery_status nem sempre traz a posição do entregador. Sem COALESCE, um
 * evento sobrescreveria com NULL o que o outro acabou de preencher.
 *
 * `valor_pago` e `data_criacao` nunca são tocados — são o registro contábil.
 */
export async function aplicarEstadoEntrega(
  env: Env,
  deliveryIdExterno: string,
  s: EstadoEntrega
): Promise<void> {
  await env.DB.prepare(
    `UPDATE deliveries SET
       status_ao_vivo       = COALESCE(?2,  status_ao_vivo),
       status               = COALESCE(?2,  status),
       status_atualizado_em = ?10,
       tracking_url         = COALESCE(?3,  tracking_url),
       dropoff_eta          = COALESCE(?4,  dropoff_eta),
       courier_nome         = COALESCE(?5,  courier_nome),
       courier_telefone     = COALESCE(?6,  courier_telefone),
       courier_veiculo      = COALESCE(?7,  courier_veiculo),
       courier_lat          = COALESCE(?8,  courier_lat),
       courier_lng          = COALESCE(?9,  courier_lng),
       live_mode            = COALESCE(?11, live_mode)
     WHERE delivery_id_externo = ?1`
  )
    .bind(
      deliveryIdExterno,
      s.status,
      s.trackingUrl,
      s.dropoffEta,
      s.courierNome,
      s.courierTelefone,
      s.courierVeiculo,
      s.courierLat,
      s.courierLng,
      new Date().toISOString(),
      s.liveMode === null ? null : s.liveMode ? 1 : 0
    )
    .run();
}

/**
 * Marca a entrega do motoboy próprio como concluída (ou cancelada).
 *
 * Existe porque o motoboy não tem webhook: sem isto o status dele fica em
 * "Acionado" para sempre, e o histórico nunca mostra o que de fato aconteceu.
 * Quem confirma é o atendente, na tela do pedido.
 *
 * Restrito ao motoboy de propósito. Deixar um atendente escrever o status de
 * uma corrida da Uber criaria um dado que discorda do parceiro — e o parceiro
 * é a fonte da verdade quando existe webhook.
 */
export async function marcarEntregaManual(
  env: Env,
  idPedido: string,
  status: "delivered" | "canceled",
  quem: string
): Promise<{ ok: boolean; erro?: string }> {
  const l = await env.DB.prepare(
    `SELECT plataforma_escolhida, COALESCE(status_ao_vivo, status) AS atual
       FROM deliveries WHERE id_pedido = ?1`
  )
    .bind(idPedido)
    .first<{ plataforma_escolhida: string; atual: string }>();

  if (!l) return { ok: false, erro: "Entrega não encontrada." };
  if (l.plataforma_escolhida !== "motoboy") {
    return {
      ok: false,
      erro: "O status desta entrega vem do parceiro e não pode ser alterado à mão.",
    };
  }
  if (l.atual === "delivered" || l.atual === "canceled") {
    return { ok: false, erro: "Esta entrega já foi encerrada." };
  }

  const agora = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE deliveries
          SET status_ao_vivo = ?2, status = ?2, status_atualizado_em = ?3
        WHERE id_pedido = ?1`
    ).bind(idPedido, status, agora),

    // Fica na trilha de eventos igual aos do parceiro, com quem confirmou.
    env.DB.prepare(
      `INSERT OR IGNORE INTO eventos_entrega
         (id, provider, kind, status, delivery_id_externo, id_pedido,
          criado_em_parceiro, recebido_em, live_mode, payload)
       VALUES (?1, 'motoboy', 'manual.status', ?2, ?3, ?3, ?4, ?4, NULL, ?5)`
    ).bind(
      `manual:${idPedido}:${status}:${agora}`,
      status,
      idPedido,
      agora,
      JSON.stringify({ confirmadoPor: quem, status })
    ),
  ]);

  return { ok: true };
}

/** Estado ao vivo para o painel mostrar no detalhe do pedido. */
export async function obterEntregaAoVivo(
  env: Env,
  idPedido: string
): Promise<EntregaAoVivo | null> {
  const l = await env.DB.prepare(
    `SELECT plataforma_escolhida, delivery_id_externo, status, status_ao_vivo,
            status_atualizado_em, tracking_url, dropoff_eta,
            courier_nome, courier_telefone, courier_veiculo, live_mode
       FROM deliveries WHERE id_pedido = ?1`
  )
    .bind(idPedido)
    .first<{
      plataforma_escolhida: string;
      delivery_id_externo: string | null;
      status: string | null;
      status_ao_vivo: string | null;
      status_atualizado_em: string | null;
      tracking_url: string | null;
      dropoff_eta: string | null;
      courier_nome: string | null;
      courier_telefone: string | null;
      courier_veiculo: string | null;
      live_mode: number | null;
    }>();

  if (!l) return null;

  return {
    provider: l.plataforma_escolhida as ProviderId,
    deliveryIdExterno: l.delivery_id_externo,
    status: l.status_ao_vivo ?? l.status,
    statusAtualizadoEm: l.status_atualizado_em,
    trackingUrl: l.tracking_url,
    dropoffEta: l.dropoff_eta,
    courierNome: l.courier_nome,
    courierTelefone: l.courier_telefone,
    courierVeiculo: l.courier_veiculo,
    liveMode: l.live_mode === null ? null : l.live_mode === 1,
  };
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
      freteCobrado: p.freteCobrado ?? 0,
      // Pedido antigo, de antes desta checagem existir, não tem o campo.
      // Tratar como pago evita travar o que já estava na fila.
      pago: p.pago !== false,
      canal: p.canal,
      numeroExterno: p.numeroExterno,
      itens: p.itens?.length ?? 0,
      despacho: despacho ? { ...despacho, valorPago: l.valor_pago } : null,
      melhorPreco: precos.length ? Math.min(...precos) : null,
      teste: !!p.teste,
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
