#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Simula um webhook do Uber Direct, assinado igual ao real.
//
// Serve para testar o fluxo de status SEM depender da Uber — útil enquanto a
// conta não tem o produto de entregas liberado, e para reproduzir um caso
// específico depois.
//
// Uso:
//   node scripts/simular-webhook-uber.mjs <delivery_id> [status] [url]
//
// Exemplos:
//   node scripts/simular-webhook-uber.mjs del_123 pickup
//   node scripts/simular-webhook-uber.mjs del_123 delivered
//   node scripts/simular-webhook-uber.mjs del_123 courier   # posição do entregador
//
// A signing key sai de worker/.dev.vars (UBER_WEBHOOK_SECRET).
// ---------------------------------------------------------------------------

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const [, , deliveryId, statusArg = "pickup", urlArg] = process.argv;

if (!deliveryId) {
  console.error(
    "Uso: node scripts/simular-webhook-uber.mjs <delivery_id> [status|courier] [url]"
  );
  process.exit(1);
}

const url = urlArg ?? "http://127.0.0.1:8787/api/webhook/uber";

// Lê a signing key do .dev.vars
let chave = "";
try {
  const dev = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  chave = dev.match(/^UBER_WEBHOOK_SECRET=(.*)$/m)?.[1]?.trim() ?? "";
} catch {
  /* segue com chave vazia e falha adiante com mensagem clara */
}

if (!chave) {
  console.error("UBER_WEBHOOK_SECRET não encontrado em worker/.dev.vars");
  process.exit(1);
}

const agora = new Date().toISOString();
const ehCourier = statusArg === "courier";

const payload = ehCourier
  ? {
      id: randomUUID(),
      kind: "event.courier_update",
      delivery_id: deliveryId,
      created: agora,
      live_mode: false,
      location: { lat: -19.9755, lng: -43.9301 },
      data: {
        id: deliveryId,
        courier: {
          name: "Entregador Teste",
          phone_number: "+5531988887777",
          vehicle_type: "motorcycle",
          vehicle_make: "Honda",
          vehicle_model: "CG 160",
          location: { lat: -19.9755, lng: -43.9301 },
        },
      },
    }
  : {
      id: randomUUID(),
      kind: "event.delivery_status",
      status: statusArg,
      delivery_id: deliveryId,
      created: agora,
      live_mode: false,
      data: {
        id: deliveryId,
        status: statusArg,
        tracking_url: `https://direct.uber.com/track/${deliveryId}`,
        dropoff_eta: new Date(Date.now() + 25 * 60000).toISOString(),
        courier: {
          name: "Entregador Teste",
          phone_number: "+5531988887777",
          vehicle_type: "motorcycle",
          vehicle_make: "Honda",
          vehicle_model: "CG 160",
          location: { lat: -19.9755, lng: -43.9301 },
        },
      },
    };

// Assinatura sobre o corpo EXATO que vai no fetch.
const corpo = JSON.stringify(payload);
const assinatura = createHmac("sha256", chave).update(corpo, "utf8").digest("hex");

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-uber-signature": assinatura,
  },
  body: corpo,
});

console.log(`${res.status} ${await res.text()}`);
