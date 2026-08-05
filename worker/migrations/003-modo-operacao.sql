-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 003 — chave/valor de configuração em tempo de execução
--
-- Nasce para guardar o MODO DE OPERAÇÃO (teste | producao), que o admin troca
-- pela tela de Configurações sem precisar de deploy.
--
-- Por que D1 e não KV: o KV é eventualmente consistente. Uma troca de modo que
-- demora segundos para propagar pode significar uma corrida cobrada de verdade
-- quando o operador achava estar em teste. Aqui a leitura tem que ser exata.
--
--   npx wrangler d1 execute hub-logistico --local  --file=./migrations/003-modo-operacao.sql
--   npx wrangler d1 execute hub-logistico --remote --file=./migrations/003-modo-operacao.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS config (
  chave           TEXT PRIMARY KEY,
  valor           TEXT NOT NULL,
  atualizado_em   TEXT NOT NULL,
  atualizado_por  TEXT
);
