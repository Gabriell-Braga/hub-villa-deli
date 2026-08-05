"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import AvisoModo from "./AvisoModo";

// ---------------------------------------------------------------------------
// Casca das telas internas.
//
// Existe para segurar UM estado: o menu lateral aberto no celular. O layout do
// grupo (painel) é server component (faz a checagem de sessão), e server
// component não tem estado — por isso a casca é um client component separado
// em vez de tudo virar "use client".
//
// Comportamento por tamanho de tela:
//   celular  -> a página inteira rola; o cabeçalho fica grudado no topo e o
//               menu vira gaveta sobre o conteúdo
//   md+      -> altura fixa da janela; a sidebar fica parada e só o conteúdo
//               rola, que é o que se espera de um painel de operação
// ---------------------------------------------------------------------------
export default function Shell({
  papel,
  children,
}: {
  papel?: string;
  children: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      <Sidebar
        papel={papel}
        aberto={menuAberto}
        onFechar={() => setMenuAberto(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AvisoModo ehAdmin={papel === "admin"} />
        <Header onAbrirMenu={() => setMenuAberto(true)} />

        <main className="flex-1 p-4 sm:p-6 md:overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
