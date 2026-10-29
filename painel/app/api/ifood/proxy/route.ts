import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Saída alternativa das chamadas do Worker ao iFood (cotação, despacho...).
//
// Mesmo motivo do /api/ifood/polling: o firewall do iFood (Akamai) recusa com
// 403 "Access Denied" o que sai do Cloudflare (29/10/2026: toda cotação). O
// Worker repete por aqui, que sai do IP da Vercel.
//
// Sem sessão de propósito: só repassa para merchant-api.ifood.com.br, com o
// token iFood de quem chama. Sem token válido, o iFood recusa e nada vaza.
// ---------------------------------------------------------------------------
const BASE = "https://merchant-api.ifood.com.br";

async function repassar(req: NextRequest) {
  const caminho = req.nextUrl.searchParams.get("caminho") ?? "";
  const url = new URL(caminho, BASE);
  // Só o host do iFood: `caminho` não pode virar outro destino.
  if (!caminho.startsWith("/") || url.origin !== BASE) {
    return new Response("caminho inválido", { status: 400 });
  }
  const headers: Record<string, string> = {
    Authorization: req.headers.get("authorization") ?? "",
    Accept: "application/json",
  };
  for (const h of ["content-type", "idempotency-key"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.method === "GET" ? undefined : await req.text(),
    cache: "no-store",
  });
  return new Response(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}

export { repassar as GET, repassar as POST };
