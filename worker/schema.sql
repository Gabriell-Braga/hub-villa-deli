-- ---------------------------------------------------------------------------
-- Schema do Hub Logístico (Cloudflare D1 / SQLite)
--
-- Rodar:
--   npx wrangler d1 execute hub-logistico --local  --file=./schema.sql   # dev
--   npx wrangler d1 execute hub-logistico --remote --file=./schema.sql   # prod
--
-- Todas as datas são ISO 8601 em UTC (ex: 2026-08-04T13:45:00.000Z).
-- Os relatórios convertem para America/Sao_Paulo na hora de agrupar por dia/mês.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1) PEDIDOS — estado ao vivo do que está em operação.
--
-- Por que D1 e não KV: o KV é eventualmente consistente e aceita 1 escrita/s
-- por chave. O painel lê o pedido segundos depois do webhook, o que dava
-- "pedido não encontrado" intermitente. O KV ficou só para cache (token OAuth2
-- e geocodificação), onde ele é ótimo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedidos (
  id             TEXT PRIMARY KEY,
  criado_em      TEXT NOT NULL,
  -- recebido | cotado | despachando | despachado
  status         TEXT NOT NULL,
  -- JSON completo do pedido (cliente, endereço, itens)
  dados          TEXT NOT NULL,
  -- JSON da última cotação (array de Cotacao)
  cotacoes       TEXT,
  cotado_em      TEXT,
  -- JSON do ResultadoDespacho. Preenchido = já despachado (idempotência)
  despacho       TEXT,
  despachado_em  TEXT,
  -- 1 = pedido de teste. Marcado no banco, não só na tela, para o relatório
  -- conseguir separar teste de venda real.
  teste          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pedidos_criado_em ON pedidos (criado_em);
CREATE INDEX IF NOT EXISTS idx_pedidos_status    ON pedidos (status);


-- ---------------------------------------------------------------------------
-- 2) DELIVERIES — histórico imutável para relatório.
--
-- Uma linha por entrega efetivamente despachada. Separada de `pedidos` de
-- propósito: `pedidos` é estado que muda e é limpo pelo cron; `deliveries` é
-- o registro contábil que fica. Nunca sofre UPDATE de valor.
--
-- UNIQUE(id_pedido, sequencia) permite reenvio quando falta item no pedido.
-- Cada tentativa vira uma linha no histórico contábil.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pedido             TEXT NOT NULL,
  sequencia             INTEGER NOT NULL DEFAULT 1,
  plataforma_escolhida  TEXT NOT NULL,
  -- CUSTO: o que a loja pagou ao parceiro, em reais.
  valor_pago            REAL NOT NULL,
  -- RECEITA: o que o CLIENTE pagou de frete, pela tabela de raio do Cardápio
  -- Web. Não muda conforme o parceiro escolhido — o parceiro muda o custo, não
  -- o preço. `frete_cobrado - valor_pago` é o resultado da entrega, e é a
  -- pergunta que o dono do restaurante realmente faz.
  -- 0 = frete grátis (faixa de 1 km).
  frete_cobrado         REAL NOT NULL DEFAULT 0,
  eta_minutos           INTEGER,
  status                TEXT NOT NULL,
  data_criacao          TEXT NOT NULL,
  -- PIN informado pelo cliente ao entregador na porta (Uber Direct). O motoboy
  -- próprio não tem, então aceita NULL.
  codigo_entrega        TEXT,

  -- contexto útil no relatório (não exigido, mas barato de guardar)
  delivery_id_externo   TEXT,
  tracking_url          TEXT,
  cliente_nome          TEXT,
  bairro                TEXT,
  valor_pedido          REAL,
  despachado_por        TEXT,   -- e-mail do atendente que clicou

  -- Estado ao vivo, alimentado pelos webhooks do parceiro. `valor_pago` e
  -- `data_criacao` NÃO mudam: são o registro contábil.
  status_ao_vivo        TEXT,
  status_atualizado_em  TEXT,
  dropoff_eta           TEXT,
  courier_nome          TEXT,
  courier_telefone      TEXT,
  courier_veiculo       TEXT,
  -- Placa: duas motos pretas na porta ao mesmo tempo, e o balcao precisa saber
  -- qual e a do pedido.
  courier_placa         TEXT,
  -- Quando o entregador chega NA LOJA (o dropoff_eta e a chegada no cliente).
  -- A cozinha usa para saber se embala agora ou espera.
  pickup_eta            TEXT,
  courier_lat           REAL,
  courier_lng           REAL,
  -- false = evento de teste (credenciais de sandbox)
  live_mode             INTEGER,
  teste                 INTEGER NOT NULL DEFAULT 0,
  UNIQUE(id_pedido, sequencia)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_data       ON deliveries (data_criacao);
CREATE INDEX IF NOT EXISTS idx_deliveries_plataforma ON deliveries (plataforma_escolhida, data_criacao);
CREATE INDEX IF NOT EXISTS idx_deliveries_externo    ON deliveries (delivery_id_externo);
CREATE INDEX IF NOT EXISTS idx_deliveries_pedido     ON deliveries (id_pedido, sequencia);


-- ---------------------------------------------------------------------------
-- 5) EVENTOS_ENTREGA — trilha dos webhooks recebidos dos parceiros.
--
-- A PRIMARY KEY é o id do evento no parceiro: é o que garante idempotência.
-- A Uber reenvia o mesmo evento até 3 vezes se não receber 2xx em tempo, e sem
-- isto um "delivered" repetido sobrescreveria um "canceled" posterior.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_entrega (
  id                   TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  -- event.delivery_status | event.courier_update | event.refund_request | ...
  kind                 TEXT NOT NULL,
  status               TEXT,
  delivery_id_externo  TEXT,
  id_pedido            TEXT,
  criado_em_parceiro   TEXT,
  recebido_em          TEXT NOT NULL,
  live_mode            INTEGER,
  -- JSON cru, para auditoria e para depurar campo que ainda não mapeamos
  payload              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_delivery ON eventos_entrega (delivery_id_externo);
CREATE INDEX IF NOT EXISTS idx_eventos_pedido   ON eventos_entrega (id_pedido);
CREATE INDEX IF NOT EXISTS idx_eventos_recebido ON eventos_entrega (recebido_em);


-- ---------------------------------------------------------------------------
-- 3) USUARIOS — atendentes do restaurante.
--
-- A senha nunca é guardada em texto. `senha_hash` usa o formato
-- pbkdf2$<iterações>$<salt-base64>$<hash-base64> (ver src/lib/senha.ts).
--
-- senha_hash aceita NULL de propósito: o admin cria o usuário sem senha e o
-- próprio usuário define a dele pelo link de acesso. Ninguém além do dono
-- jamais conhece a senha — nem quem cadastrou.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT,
  -- atendente | admin  (admin gerencia usuários e vê Relatórios)
  papel       TEXT NOT NULL DEFAULT 'atendente',
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);


-- ---------------------------------------------------------------------------
-- 4) TOKENS_SENHA — convite de primeiro acesso e recuperação de senha.
--
-- Guardamos o HASH do token, nunca o token em si. Mesmo motivo das senhas: se
-- alguém ler o banco, não pode sair assumindo contas.
--
-- Uso único (`usado_em`) e com validade curta (`expira_em`).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tokens_senha (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL,
  -- convite | recuperacao
  tipo        TEXT NOT NULL,
  criado_em   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  usado_em    TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_usuario ON tokens_senha (usuario_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expira  ON tokens_senha (expira_em);


-- ---------------------------------------------------------------------------
-- 6) CONFIG — chave/valor ajustável em tempo de execução, sem deploy.
--
-- Hoje guarda o MODO DE OPERAÇÃO (teste | producao), trocado pela tela de
-- Configurações. Fica no D1 e não no KV porque a leitura precisa ser exata:
-- o KV é eventualmente consistente, e segundos de atraso numa troca de modo
-- podem virar uma corrida cobrada de verdade quando se achava estar em teste.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config (
  chave           TEXT PRIMARY KEY,
  valor           TEXT NOT NULL,
  atualizado_em   TEXT NOT NULL,
  atualizado_por  TEXT
);


-- ---------------------------------------------------------------------------
-- 7) EVENTOS_CARDAPIO — fila dos webhooks do Cardápio Web.
--
-- Eles NÃO mandam o pedido no webhook: mandam só o , e a gente busca
-- em GET /api/partner/v1/orders/{id}. E exigem HTTP 200 em até 5 SEGUNDOS,
-- senão reenviam até 15 vezes e depois PAUSAM o webhook, descartando
-- notificações até alguém reativar na mão.
--
-- Por isso o webhook só grava aqui e responde 200 na hora. Buscar o pedido e
-- geocodificar acontece fora do caminho da resposta; o que falhar fica com
-- processado_em nulo e o cron tenta de novo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_cardapio (
  event_id       TEXT PRIMARY KEY,
  tipo           TEXT NOT NULL,
  order_id       TEXT,
  merchant_id    TEXT,
  recebido_em    TEXT NOT NULL,
  processado_em  TEXT,
  tentativas     INTEGER NOT NULL DEFAULT 0,
  erro           TEXT,
  payload        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ev_cw_pendente ON eventos_cardapio (processado_em, recebido_em);
CREATE INDEX IF NOT EXISTS idx_ev_cw_order    ON eventos_cardapio (order_id);
