-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 002 — recebimento de webhooks de entrega (Uber Direct)
--
-- Para bancos que JÁ existem. Instalação nova não precisa: o schema.sql já vem
-- com tudo isto.
--
--   npx wrangler d1 execute hub-logistico --local  --file=./migrations/002-webhook-uber.sql
--   npx wrangler d1 execute hub-logistico --remote --file=./migrations/002-webhook-uber.sql
--
-- SQLite não tem "ADD COLUMN IF NOT EXISTS". Rodar duas vezes dá erro de coluna
-- duplicada — é inofensivo, só significa que já foi aplicada.
-- ---------------------------------------------------------------------------

-- Estado ao vivo da entrega, alimentado pelos webhooks.
-- `valor_pago` e `data_criacao` continuam imutáveis: são o registro contábil.
ALTER TABLE deliveries ADD COLUMN status_ao_vivo        TEXT;
ALTER TABLE deliveries ADD COLUMN status_atualizado_em  TEXT;
ALTER TABLE deliveries ADD COLUMN dropoff_eta           TEXT;
ALTER TABLE deliveries ADD COLUMN courier_nome          TEXT;
ALTER TABLE deliveries ADD COLUMN courier_telefone      TEXT;
ALTER TABLE deliveries ADD COLUMN courier_veiculo       TEXT;
ALTER TABLE deliveries ADD COLUMN courier_lat           REAL;
ALTER TABLE deliveries ADD COLUMN courier_lng           REAL;
-- false = evento de teste (credenciais de sandbox). Guardado para o relatório
-- poder separar corrida real de simulação.
ALTER TABLE deliveries ADD COLUMN live_mode             INTEGER;

-- ---------------------------------------------------------------------------
-- Trilha de eventos recebidos.
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
