// ---------------------------------------------------------------------------
// Ícones de interface usados em mais de uma tela.
//
// SVG no lugar de caracteres ("←", "✕"): o caractere depende da fonte, fica
// desalinhado do texto ao lado e não tem a mesma espessura dos outros ícones.
// Todos no mesmo traço (1.75) e em currentColor, para herdar a cor do texto.
// ---------------------------------------------------------------------------

function Icone({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const IconeVoltar = ({ className }: { className?: string }) => (
  <Icone d="M19 12H5M12 19l-7-7 7-7" className={className} />
);

export const IconeFechar = ({ className }: { className?: string }) => (
  <Icone d="M18 6 6 18M6 6l12 12" className={className} />
);

export const IconeCheck = ({ className }: { className?: string }) => (
  <Icone d="M20 6 9 17l-5-5" className={className} />
);
