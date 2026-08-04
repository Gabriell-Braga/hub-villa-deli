-- ---------------------------------------------------------------------------
-- Usuários de DESENVOLVIMENTO.
--
--   admin@restaurante.com  / hub123456   (admin — vê Relatórios)
--   maria@restaurante.com  / atende123   (atendente)
--
-- Rodar depois do schema.sql:
--   npx wrangler d1 execute hub-logistico --local --file=./seed.sql
--
-- ATENÇÃO: NÃO rode isto em produção. Para criar o usuário real:
--   node scripts/hash-senha.mjs "senha-forte" "Seu Nome" voce@loja.com admin
--   npx wrangler d1 execute hub-logistico --remote --command "<o INSERT impresso>"
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO usuarios (id, nome, email, senha_hash, papel, ativo, criado_em)
VALUES (
  '024dd8b9-fc8f-4b87-8ba1-03124d1e625a',
  'Administrador',
  'admin@restaurante.com',
  'pbkdf2$100000$rTvyURiV6qi7CRTSItVPGA==$hPTtlkk0FifS/y5dFCHx7IHHPvoO12hBrFaDLTLUT3Y=',
  'admin',
  1,
  '2026-08-04T04:17:51.538Z'
);

INSERT OR IGNORE INTO usuarios (id, nome, email, senha_hash, papel, ativo, criado_em)
VALUES (
  'c69b2304-b9ee-43be-9a47-65e28140f99f',
  'Maria Atendente',
  'maria@restaurante.com',
  'pbkdf2$100000$RhA6yaBhOM+REWG8vY0Csg==$nseaCPgQKCSSg4RirfonrAbnOj8IHGBXomo3wNHpGLw=',
  'atendente',
  1,
  '2026-08-04T04:17:51.732Z'
);
