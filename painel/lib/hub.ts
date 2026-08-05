import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ---------------------------------------------------------------------------
// Proxy do painel para o Worker.
//
// Por que existe: o JWT do Hub não pode ir para o browser. Se ele estivesse em
// NEXT_PUBLIC_* ou na sessão do cliente, qualquer um leria no DevTools e
// despacharia corridas pagas. Então o browser fala com o próprio Next.js
// (mesma origem, sem CORS) e só o servidor lê o token do cookie de sessão.
//
// Configure em painel/.env.local (SEM prefixo NEXT_PUBLIC_):
//   HUB_API_URL=http://localhost:8787
//   NEXTAUTH_SECRET=<valor longo e aleatório>
// ---------------------------------------------------------------------------

// A barra final é removida de propósito. Colar a URL do Worker terminando em
// "/" é fácil demais, e o resultado vira ".../api//auth/login" — barra dupla,
// que o Hono não casa com rota nenhuma e devolve 404. O sintoma é o painel
// recusando todo login sem dizer por quê.
const API = (process.env.HUB_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/**
 * Chamada SEM sessão, para as rotas públicas do Worker (esqueci-senha,
 * definir-senha). Existe separada de propósito: assim nenhuma rota autenticada
 * pode virar pública por engano ao esquecer de passar o token.
 */
export async function chamarHubPublico(
  caminho: string,
  init?: { method?: string; body?: string }
): Promise<NextResponse> {
  try {
    const res = await fetch(`${API}${caminho}`, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: init?.body,
      cache: "no-store",
    });

    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    console.error(`[hub] sem resposta de ${API}${caminho}`);
    return NextResponse.json(
      { erro: "Serviço indisponível no momento. Tente novamente." },
      { status: 502 }
    );
  }
}

export async function chamarHub(
  req: NextRequest,
  caminho: string,
  init?: { method?: string; body?: string }
): Promise<NextResponse> {
  const sessao = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const hubToken = sessao?.hubToken;
  if (!hubToken) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  try {
    const res = await fetch(`${API}${caminho}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${hubToken}`,
        "Content-Type": "application/json",
      },
      body: init?.body,
      cache: "no-store",
    });

    // Repassa corpo e status como vieram — o painel precisa distinguir
    // 401 (sessão expirada) de 404 de 409 (cotação vencida) de 502.
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Detalhe técnico vai para o log do servidor; a tela recebe linguagem de
    // negócio — quem lê é o atendente no meio do turno.
    console.error(`[hub] sem resposta de ${API}${caminho}`);
    return NextResponse.json(
      { erro: "Serviço de entregas indisponível no momento. Tente novamente." },
      { status: 502 }
    );
  }
}
