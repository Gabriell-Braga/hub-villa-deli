import "./globals.css";
import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import { MARCA, VARIAVEIS_CSS } from "@/config/marca";

export const metadata: Metadata = {
  title: `Hub Logístico · ${MARCA.nome}`,
  description: `Cotação e despacho de entregas · ${MARCA.nome}`,

  // Favicon vem da marca, então acompanha a troca de cliente sem mexer em
  // código. Não usamos app/favicon.ico justamente porque aquele caminho é
  // estático e obrigaria um arquivo diferente por restaurante.
  icons: {
    icon: [{ url: MARCA.favicon, type: "image/svg+xml" }],
    shortcut: [{ url: MARCA.favicon }],
    apple: [{ url: MARCA.favicon }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sem maximumScale/userScalable: travar o zoom quebra a acessibilidade e o
  // atendente pode precisar ampliar um endereço na tela do celular.
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      {/* As cores da marca entram como CSS custom properties. Os componentes
          usam bg-[var(--marca-primaria)], então trocar de cliente não exige
          recompilar o Tailwind — só mudar as variáveis de ambiente. */}
      <body
        className="bg-gray-50 text-gray-900 antialiased"
        style={VARIAVEIS_CSS as React.CSSProperties}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
