-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 007 — reenvio de pedido (múltiplas entregas por pedido)
--
--   npx wrangler d1 execute hub-logistico --local  --file=./migrations/007-reenvio.sql
--   npx wrangler d1 execute hub-logistico --remote --file=./migrations/007-reenvio.sql
--
-- Antes: UNIQUE(id_pedido) impedia segunda corrida quando faltava item.
-- Agora: sequencia distingue tentativas; o histórico mantém todas.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS deliveries_v2 (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pedido             TEXT NOT NULL,
  sequencia             INTEGER NOT NULL DEFAULT 1,
  plataforma_escolhida  TEXT NOT NULL,
  valor_pago            REAL NOT NULL,
  frete_cobrado         REAL NOT NULL DEFAULT 0,
  eta_minutos           INTEGER,
  status                TEXT NOT NULL,
  data_criacao          TEXT NOT NULL,
  codigo_entrega        TEXT,
  delivery_id_externo   TEXT,
  tracking_url          TEXT,
  cliente_nome          TEXT,
  bairro                TEXT,
  valor_pedido          REAL,
  despachado_por        TEXT,
  status_ao_vivo        TEXT,
  status_atualizado_em  TEXT,
  dropoff_eta           TEXT,
  courier_nome          TEXT,
  courier_telefone      TEXT,
  courier_veiculo       TEXT,
  courier_lat           REAL,
  courier_lng           REAL,
  live_mode             INTEGER,
  teste                 INTEGER NOT NULL DEFAULT 0,
  UNIQUE(id_pedido, sequencia)
);

INSERT INTO deliveries_v2 (
  id, id_pedido, sequencia, plataforma_escolhida, valor_pago, frete_cobrado,
  eta_minutos, status, data_criacao, codigo_entrega, delivery_id_externo,
  tracking_url, cliente_nome, bairro, valor_pedido, despachado_por,
  status_ao_vivo, status_atualizado_em, dropoff_eta, courier_nome,
  courier_telefone, courier_veiculo, courier_lat, courier_lng, live_mode, teste
)
SELECT
  id, id_pedido, 1, plataforma_escolhida, valor_pago, frete_cobrado,
  eta_minutos, status, data_criacao, codigo_entrega, delivery_id_externo,
  tracking_url, cliente_nome, bairro, valor_pedido, despachado_por,
  status_ao_vivo, status_atualizado_em, dropoff_eta, courier_nome,
  courier_telefone, courier_veiculo, courier_lat, courier_lng, live_mode, teste
FROM deliveries;

DROP TABLE deliveries;
ALTER TABLE deliveries_v2 RENAME TO deliveries;

CREATE INDEX IF NOT EXISTS idx_deliveries_data       ON deliveries (data_criacao);
CREATE INDEX IF NOT EXISTS idx_deliveries_plataforma ON deliveries (plataforma_escolhida, data_criacao);
CREATE INDEX IF NOT EXISTS idx_deliveries_externo    ON deliveries (delivery_id_externo);
CREATE INDEX IF NOT EXISTS idx_deliveries_pedido     ON deliveries (id_pedido, sequencia);

PRAGMA foreign_keys=ON;
