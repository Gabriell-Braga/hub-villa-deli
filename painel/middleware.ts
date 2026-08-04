import { withAuth } from "next-auth/middleware";

// ---------------------------------------------------------------------------
// Primeira barreira: sem sessão, o Next redireciona para /login antes mesmo de
// renderizar a página. As rotas /api/* também passam por aqui, mas cada route
// handler revalida o token por conta própria em lib/hub.ts — middleware sozinho
// não é garantia suficiente para algo que gasta dinheiro.
// ---------------------------------------------------------------------------
export default withAuth({
  pages: { signIn: "/login" },
});

// Lista explícita, não regex de exclusão: com "tudo menos X" um caminho novo
// nasce protegido por acidente ou desprotegido por acidente, dependendo do
// padrão. Aqui cada rota entra de propósito.
//
// FORA daqui, de propósito (precisam funcionar sem sessão):
//   /login  /esqueci-senha  /definir-senha  /api/auth/*  /api/senha/*
export const config = {
  matcher: [
    "/",
    "/pedidos/:path*",
    "/historico/:path*",
    "/relatorios/:path*",
    "/usuarios/:path*",
    "/configuracoes/:path*",
    "/api/cotacao/:path*",
    "/api/despachar",
    "/api/pedidos",
    "/api/estatisticas",
    "/api/diagnostico",
    "/api/usuarios/:path*",
    "/api/usuarios",
  ],
};
