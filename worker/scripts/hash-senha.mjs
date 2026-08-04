#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Gera o hash de uma senha no mesmo formato que o Worker valida
// (src/lib/senha.ts) e imprime o INSERT pronto para colar no D1.
//
// Uso:
//   node scripts/hash-senha.mjs "minha-senha" "Nome do Atendente" email@loja.com admin
//
// Depois:
//   npx wrangler d1 execute hub-logistico --local  --command "<INSERT>"
//   npx wrangler d1 execute hub-logistico --remote --command "<INSERT>"
// ---------------------------------------------------------------------------

import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

const ITERACOES = 100_000;
const TAMANHO_HASH = 32;

const [, , senha, nome = "Atendente", email = "atendente@restaurante.com", papel = "atendente"] =
  process.argv;

if (!senha) {
  console.error('Uso: node scripts/hash-senha.mjs "senha" [nome] [email] [atendente|admin]');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(senha, salt, ITERACOES, TAMANHO_HASH, "sha256");
const senhaHash = `pbkdf2$${ITERACOES}$${salt.toString("base64")}$${hash.toString("base64")}`;

const id = randomUUID();
const criadoEm = new Date().toISOString();
const emailNormalizado = email.trim().toLowerCase();

// Aspas simples viram '' dentro de string SQL.
const esc = (v) => String(v).replace(/'/g, "''");

const insert =
  `INSERT INTO usuarios (id, nome, email, senha_hash, papel, ativo, criado_em) ` +
  `VALUES ('${id}', '${esc(nome)}', '${esc(emailNormalizado)}', '${senhaHash}', '${esc(papel)}', 1, '${criadoEm}');`;

console.log("\nsenha_hash:\n" + senhaHash);
console.log("\nSQL:\n" + insert + "\n");
