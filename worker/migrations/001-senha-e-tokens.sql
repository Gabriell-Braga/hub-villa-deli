-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 001 — senha opcional + tokens de definição de senha
--
-- Para bancos que JÁ existem. Instalação nova não precisa: o schema.sql já vem
-- com tudo isto.
--
-- O que muda:
--   1. usuarios.senha_hash passa a aceitar NULL. Um usuário recém-criado pelo
--      admin não tem senha — ele define a dele pelo link de acesso.
--   2. nasce a tabela tokens_senha.
--
-- SQLite não sabe remover um NOT NULL, então a tabela é recriada e os dados
-- copiados. Rodar:
--   npx wrangler d1 execute hub-logistico --local  --file=./migrations/001-senha-e-tokens.sql
--   npx wrangler d1 execute hub-logistico --remote --file=./migrations/001-senha-e-tokens.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usuarios_novo (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT,
  papel       TEXT NOT NULL DEFAULT 'atendente',
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT NOT NULL
);

INSERT OR IGNORE INTO usuarios_novo (id, nome, email, senha_hash, papel, ativo, criado_em)
  SELECT id, nome, email, senha_hash, papel, ativo, criado_em FROM usuarios;

DROP TABLE usuarios;
ALTER TABLE usuarios_novo RENAME TO usuarios;

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);

-- ---------------------------------------------------------------------------
-- Tokens de definição de senha (convite e recuperação).
--
-- Guardamos o HASH do token, nunca o token. Pelo mesmo motivo das senhas: se
-- alguém ler o banco, não pode sair assumindo contas.
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
