import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
