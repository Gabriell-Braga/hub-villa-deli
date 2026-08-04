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
  despachado_em  TEXT
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
-- UNIQUE(id_pedido) é a trava contra despacho duplicado no nível do banco: se
-- alguma corrida de código escapar, o INSERT falha em vez de contar duas vezes.
--
-- SEM FOREIGN KEY para `pedidos`, de propósito. A tabela `pedidos` é limpa
-- pelo cron depois de 30 dias; com FK, ou o DELETE do cron passaria a falhar,
-- ou o histórico seria apagado junto e o relatório perderia o passado. O
-- `id_pedido` aqui é uma referência histórica, não um vínculo de integridade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pedido             TEXT NOT NULL UNIQUE,
  -- uber | ifood | 99 | motoboy
  plataforma_escolhida  TEXT NOT NULL,
  -- em reais. 0 = frete grátis (faixa de 1 km do motoboy próprio)
  valor_pago            REAL NOT NULL,
  eta_minutos           INTEGER,
  status                TEXT NOT NULL,
  data_criacao          TEXT NOT NULL,

  -- contexto útil no relatório (não exigido, mas barato de guardar)
  delivery_id_externo   TEXT,
  tracking_url          TEXT,
  cliente_nome          TEXT,
  bairro                TEXT,
  valor_pedido          REAL,
  despachado_por        TEXT    -- e-mail do atendente que clicou
);

CREATE INDEX IF NOT EXISTS idx_deliveries_data       ON deliveries (data_criacao);
CREATE INDEX IF NOT EXISTS idx_deliveries_plataforma ON deliveries (plataforma_escolhida, data_criacao);


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
