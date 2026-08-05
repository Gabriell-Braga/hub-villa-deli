import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Filtros do histórico.
//
// Fica aqui, e não dentro de um route.ts, porque arquivo de rota do Next só
// pode exportar os métodos HTTP (GET/POST/...) e alguns campos de config —
// exportar um utilitário de lá quebra o build com um erro de tipo obscuro.
// ---------------------------------------------------------------------------

/** Lista fechada: nada de encaminhar query solta do cliente para o Worker. */
const PERMITIDOS = [
  "de",
  "ate",
  "plataforma",
  "status",
  "busca",
  "teste",
  "limite",
  "offset",
] as const;

export function queryDosFiltros(req: NextRequest): string {
  const q = new URLSearchParams();
  for (const k of PERMITIDOS) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) q.set(k, v);
  }
  return q.toString();
}
