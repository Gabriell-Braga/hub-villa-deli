import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Saída alternativa do polling do iFood.
//
// O firewall do iFood (Akamai) bloqueia por minutos seguidos o polling que sai
// do Cloudflare (16/10/2026: 403 em toda tentativa; do IP de casa, 204). O
// Worker repete a chamada por aqui, que sai do IP da Vercel.
//
// Sem sessão de propósito: só repassa para a URL fixa do iFood, com o token
// iFood de quem chama. Sem token válido, o iFood recusa e nada vaza.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    headers: {
      Authorization: req.headers.get("authorization") ?? "",
      "x-polling-merchants": req.headers.get("x-polling-merchants") ?? "",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  return new Response(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
