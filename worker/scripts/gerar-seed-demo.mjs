#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Gera worker/seed-demo.sql: entregas fictícias dos últimos 30 dias para você
// ver a tela de Relatórios populada antes de ter volume real.
//
//   node scripts/gerar-seed-demo.mjs
//   npx wrangler d1 execute hub-logistico --local --file=./seed-demo.sql
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";

const PLATAFORMAS = [
  ["uber", 0.42, 14.5],
  ["motoboy", 0.33, 11.99],
  ["ifood", 0.15, 12.9],
  ["99", 0.1, 13.4],
];
const BAIRROS = ["Centro", "Savassi", "Funcionarios", "Sion", "Lourdes", "Santo Antonio"];
const NOMES = [
  "Ana Souza",
  "Bruno Lima",
  "Carla Dias",
  "Diego Alves",
  "Elisa Rocha",
  "Fabio Melo",
  "Gisele Pinto",
  "Hugo Torres",
];

// Gerador determinístico: rodar duas vezes produz o mesmo arquivo.
let semente = 20260804;
const rnd = () => {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
};

const esc = (s) => String(s).replace(/'/g, "''");
const linhas = [];
let n = 0;

for (let d = 29; d >= 0; d--) {
  const qtd = 1 + Math.floor(rnd() * 4);

  for (let k = 0; k < qtd; k++) {
    n++;
    const dt = new Date(Date.now() - d * 86_400_000);
    dt.setUTCHours(15 + Math.floor(rnd() * 7), Math.floor(rnd() * 60), 0, 0);

    const sorteio = rnd();
    let acumulado = 0;
    let plataforma = "uber";
    let base = 14.5;
    for (const [p, peso, b] of PLATAFORMAS) {
      acumulado += peso;
      if (sorteio <= acumulado) {
        plataforma = p;
        base = b;
        break;
      }
    }

    const valor = Math.round((base + rnd() * 9) * 100) / 100;
    const eta = Math.round(28 + rnd() * 22);
    const cliente = esc(NOMES[Math.floor(rnd() * NOMES.length)]);
    const bairro = esc(BAIRROS[Math.floor(rnd() * BAIRROS.length)]);
    const valorPedido = Math.round((45 + rnd() * 90) * 100) / 100;

    linhas.push(
      `INSERT OR IGNORE INTO deliveries (id_pedido, plataforma_escolhida, valor_pago, eta_minutos, status, data_criacao, delivery_id_externo, cliente_nome, bairro, valor_pedido, despachado_por) ` +
        `VALUES ('DEMO-${n}', '${plataforma}', ${valor}, ${eta}, 'concluida', '${dt.toISOString()}', 'demo-${n}', '${cliente}', '${bairro}', ${valorPedido}, 'demo@restaurante.com');`
    );
  }
}

const cabecalho = [
  "-- ---------------------------------------------------------------------------",
  `-- DADOS DE DEMONSTRACAO para a tela de Relatorios (30 dias, ${n} entregas).`,
  "--",
  "-- Serve so para voce ver os graficos populados antes de ter volume real.",
  "--",
  "-- Rodar:",
  "--   npx wrangler d1 execute hub-logistico --local --file=./seed-demo.sql",
  "--",
  "-- Apagar depois:",
  `--   npx wrangler d1 execute hub-logistico --local --command "DELETE FROM deliveries WHERE id_pedido LIKE 'DEMO-%';"`,
  "--",
  "-- NAO rode em producao: sujaria o relatorio de verdade.",
  "-- ---------------------------------------------------------------------------",
  "",
  "",
].join("\n");

writeFileSync("seed-demo.sql", cabecalho + linhas.join("\n") + "\n");
console.log(`gerado seed-demo.sql com ${n} entregas`);
