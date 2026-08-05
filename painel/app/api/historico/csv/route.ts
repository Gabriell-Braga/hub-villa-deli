import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { queryDosFiltros } from "@/lib/filtros";

export const dynamic = "force-dynamic";

const API = (process.env.HUB_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/**
 * O CSV não passa pelo `chamarHub` porque precisa repassar os cabeçalhos de
 * download (Content-Type e Content-Disposition) que o Worker define. O
 * `chamarHub` normaliza tudo para JSON, e o navegador abriria o arquivo como
 * texto na tela em vez de baixar.
 */
export async function GET(req: NextRequest) {
  const sessao = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!sessao?.hubToken) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  try {
    const res = await fetch(`${API}/api/historico/csv?${queryDosFiltros(req)}`, {
      headers: { Authorization: `Bearer ${sessao.hubToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { erro: "Não foi possível gerar o arquivo." },
        { status: res.status }
      );
    }

    return new NextResponse(await res.text(), {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "text/csv; charset=utf-8",
        "Content-Disposition":
          res.headers.get("content-disposition") ?? 'attachment; filename="entregas.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    console.error("[hub] falha ao gerar CSV");
    return NextResponse.json(
      { erro: "Serviço indisponível no momento." },
      { status: 502 }
    );
  }
}
