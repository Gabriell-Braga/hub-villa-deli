import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Shell from "@/components/Shell";

// ---------------------------------------------------------------------------
// Layout das telas internas.
//
// A checagem de sessão aqui é a segunda barreira (o middleware.ts já bloqueia
// antes). Duas barreiras porque middleware é fácil de furar com um matcher mal
// escrito, e este layout envolve TODAS as páginas do grupo.
//
// A montagem visual fica no Shell, que é client component por causa do menu
// lateral no celular.
// ---------------------------------------------------------------------------
export default async function LayoutPainel({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessao = await getServerSession(authOptions);
  if (!sessao) redirect("/login");

  return <Shell papel={sessao.user?.papel}>{children}</Shell>;
}
