import Logo from "./Logo";
import LogoProvedor from "./LogoProvedor";
import { IconeCheck } from "./Icones";
import { MARCA } from "@/config/marca";

// ---------------------------------------------------------------------------
// Moldura das telas de acesso: login, esqueci a senha e definir senha.
//
// Tela dividida. À esquerda, o painel escuro da marca diz o que o sistema faz
// e mostra os parceiros integrados; à direita, só o formulário, sem caixa em
// volta. No celular o painel da marca some e fica o logo acima do formulário.
//
// Nome e logo vêm de config/marca.ts, como no resto do painel.
// ---------------------------------------------------------------------------

const PONTOS = [
  "Cotação simultânea em todas as transportadoras",
  "Despacho em um clique, com o custo de cada opção",
  "Acompanhamento da entrega até a porta do cliente",
];

export default function LayoutAcesso({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-[#111113] p-12 text-white lg:flex lg:flex-col">
        {/* Trama discreta de pontos: dá textura ao bloco escuro sem desenhar
            nada que dispute atenção com o texto. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <Logo tamanho={40} className="ring-1 ring-white/20" />
          <div className="leading-tight">
            <p className="font-semibold">{MARCA.nome}</p>
            <p className="text-xs text-white/50">Hub Logístico</p>
          </div>
        </div>

        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Todas as entregas do restaurante em um só lugar.
          </h2>
          <ul className="mt-8 space-y-3.5">
            {PONTOS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-sm text-white/70">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10">
                  <IconeCheck className="h-3 w-3 text-white" />
                </span>
                {p}
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-center gap-3 border-t border-white/10 pt-6">
            <span className="text-xs text-white/40">Integrado com</span>
            <div className="flex items-center gap-2">
              <LogoProvedor provider="uber" tamanho={24} className="rounded-[7px] ring-1 ring-white/15" />
              <LogoProvedor provider="ifood" tamanho={24} className="rounded-[7px] ring-1 ring-white/15" />
              <LogoProvedor provider="99" tamanho={24} className="rounded-[7px] ring-1 ring-white/15" />
            </div>
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Logo tamanho={40} />
            <div className="leading-tight">
              <p className="font-semibold text-gray-900">{MARCA.nome}</p>
              <p className="text-xs text-gray-500">Hub Logístico</p>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
