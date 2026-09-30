import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // IDENTIDADE VISUAL — a base neutra do painel.
      //
      // `gray` é redefinido como a escala zinc: um cinza mais frio e contido
      // que o gray padrão (levemente azulado), que é o que dá cara de
      // "template" a um painel Tailwind. Redefinir aqui troca o tom de TODAS
      // as telas sem tocar em classe nenhuma.
      colors: {
        gray: colors.zinc,
      },
      fontFamily: {
        // Inter, carregada em app/layout.tsx via next/font (sem requisição a
        // terceiro em tempo de uso: o arquivo é servido pelo próprio painel).
        sans: ["var(--fonte-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--fonte-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        // Sombra de cartão: quase imperceptível. Separa o card do fundo sem
        // parecer que ele está flutuando.
        cartao: "0 1px 2px 0 rgb(24 24 27 / 0.04), 0 1px 3px 0 rgb(24 24 27 / 0.03)",
        sm: "0 1px 2px 0 rgb(24 24 27 / 0.05)",
      },
      keyframes: {
        // Faixa clara varrendo a barra da etapa em andamento, da esquerda
        // para a direita, com uma pausa no fim de cada volta. Ver Trilha, em
        // components/CardEntrega.tsx.
        trilha: {
          "0%": { transform: "translateX(0)" },
          "60%, 100%": { transform: "translateX(200%)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
