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
}

const icone = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5 shrink-0"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const MENU: ItemMenu[] = [
  {
    href: "/pedidos",
    rotulo: "Pedidos em Aberto",
    icone: icone(
      "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0"
    ),
  },
  {
    href: "/historico",
    rotulo: "Histórico",
    icone: icone("M12 8v4l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.5 4M3 4v4h4"),
  },
  {
    href: "/relatorios",
    rotulo: "Relatórios",
    icone: icone("M3 3v18h18M8 17V9m4 8V5m4 12v-6"),
    somenteAdmin: true,
  },
  {
    href: "/usuarios",
    rotulo: "Usuários",
    icone: icone(
      "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
    ),
    somenteAdmin: true,
  },
  {
    href: "/configuracoes",
    rotulo: "Configurações",
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
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
          <LogoComNome tamanho={36} />

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

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {MENU.filter((i) => !i.somenteAdmin || papel === "admin").map((item) => {
            const ativo =
              caminho === item.href || caminho.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition sm:py-2.5 ${
                  ativo
                    ? "bg-[var(--marca-suave)] text-[var(--marca-suave-texto)]"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.icone}
                {item.rotulo}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <p className="text-xs text-gray-400">
            Hub Logístico · cotação simultânea e despacho em um clique.
          </p>
        </div>
      </aside>
    </>
  );
}
