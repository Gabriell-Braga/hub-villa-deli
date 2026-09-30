"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { LogoComNome } from "./Logo";

// ---------------------------------------------------------------------------
// Navegação principal, no padrão do Cardápio Web: fundo branco, item ativo no
// tom da marca, ícones simples. Nada de menu sanfonado — o atendente precisa
// alcançar qualquer tela em um clique durante o pico do almoço.
//
// No celular vira gaveta sobre o conteúdo (o mesmo componente, só muda o
// posicionamento). Antes ela simplesmente sumia abaixo de md e o celular
// ficava sem NENHUMA navegação.
//
// Nome, logo e cores vêm de config/marca.ts. Nada aqui é específico de cliente.
// ---------------------------------------------------------------------------

interface ItemMenu {
  href: string;
  rotulo: string;
  icone: JSX.Element;
  /** Só aparece para admin. */
  somenteAdmin?: boolean;
  /** Seção do menu. Operação = o dia a dia do balcão; Gestão = o dono. */
  grupo: "Operação" | "Gestão";
}

const icone = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[18px] w-[18px] shrink-0"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const MENU: ItemMenu[] = [
  {
    href: "/pedidos",
    rotulo: "Pedidos em Aberto",
    grupo: "Operação",
    icone: icone(
      "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0"
    ),
  },
  {
    href: "/historico",
    rotulo: "Histórico",
    grupo: "Operação",
    icone: icone("M12 8v4l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.5 4M3 4v4h4"),
  },
  {
    href: "/relatorios",
    rotulo: "Relatórios",
    grupo: "Gestão",
    icone: icone("M3 3v18h18M8 17V9m4 8V5m4 12v-6"),
    somenteAdmin: true,
  },
  {
    href: "/usuarios",
    rotulo: "Usuários",
    grupo: "Gestão",
    icone: icone(
      "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
    ),
    somenteAdmin: true,
  },
  {
    href: "/configuracoes",
    rotulo: "Configurações",
    grupo: "Gestão",
    icone: icone(
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
    ),
    somenteAdmin: true,
  },
];

export default function Sidebar({
  papel,
  aberto = false,
  onFechar,
}: {
  papel?: string;
  aberto?: boolean;
  onFechar?: () => void;
}) {
  const caminho = usePathname();

  // Navegou? Fecha a gaveta. Sem isso, no celular o menu continuaria aberto
  // por cima da tela que o atendente acabou de abrir.
  useEffect(() => {
    onFechar?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caminho]);

  // Esc fecha — teclado físico acontece em tablet com capa.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar?.();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, onFechar]);

  return (
    <>
      {/* Fundo escurecido — só existe no celular, com a gaveta aberta. */}
      <div
        onClick={onFechar}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          aberto ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          aberto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-gray-100 px-4">
          <LogoComNome tamanho={30} />

          {/* Fechar — só no celular; no desktop a sidebar é fixa. */}
          <button
            onClick={onFechar}
            aria-label="Fechar menu"
            className="-mr-2 ml-auto rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-900 md:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {(["Operação", "Gestão"] as const).map((grupo) => {
            const itens = MENU.filter(
              (i) => i.grupo === grupo && (!i.somenteAdmin || papel === "admin")
            );
            if (itens.length === 0) return null;

            return (
              <div key={grupo} className="mb-5 last:mb-0">
                <p className="mb-1.5 px-2.5 text-[11px] font-medium text-gray-400">{grupo}</p>
                <div className="space-y-0.5">
                  {itens.map((item) => {
                    const ativo =
                      caminho === item.href || caminho.startsWith(`${item.href}/`);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={ativo ? "page" : undefined}
                        className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition sm:py-2 ${
                          ativo
                            ? "bg-gray-100 font-medium text-gray-900"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                      >
                        <span
                          className={
                            ativo ? "text-gray-900" : "text-gray-400 group-hover:text-gray-600"
                          }
                        >
                          {item.icone}
                        </span>
                        {item.rotulo}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-gray-100 px-5 py-4">
          <p className="text-xs font-medium text-gray-500">Hub Logístico</p>
          <p className="text-[11px] text-gray-400">Cotação e despacho de entregas</p>
        </div>
      </aside>
    </>
  );
}
