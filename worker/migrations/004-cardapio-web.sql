-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 004 — formato real do Cardápio Web + marcação de pedido de teste
--
-- Para bancos que JÁ existem. Instalação nova não precisa: schema.sql já traz.
--
--   npx wrangler d1 execute hub-logistico-hml --remote --file=./migrations/004-cardapio-web.sql
-- ---------------------------------------------------------------------------

-- Pedido de teste fica marcado no banco, não só na tela: o relatório e a
-- exportação precisam conseguir separar teste de venda real.
ALTER TABLE pedidos    ADD COLUMN teste INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN teste INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Fila de eventos do Cardápio Web.
--
-- Eles NÃO mandam o pedido no webhook — mandam só o `order_id`, e a gente
-- busca. E exigem HTTP 200 em até 5 segundos, senão reenviam até 15 vezes e
-- depois PAUSAM o webhook, descartando notificações até alguém reativar na
-- mão.
--
-- Por isso o webhook só grava aqui e responde 200 na hora. Buscar o pedido e
-- geocodificar acontece depois, fora do caminho da resposta. O que falhar fica
-- com `processado_em` nulo e o cron tenta de novo — sem depender do reenvio
-- deles, que tem consequência grave demais para ser nossa rede de segurança.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_cardapio (
  -- event_id deles: é a chave de idempotência que a própria doc indica
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
