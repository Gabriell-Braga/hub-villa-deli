import type { ProviderId } from "@/lib/tipos";
import { COR_PROVEDOR, ROTULO_PROVEDOR } from "@/lib/tipos";

// ---------------------------------------------------------------------------
// Marca de cada transportadora, para o atendente reconhecer o card de relance.
//
// São SVG inline, desenhados aqui — não arquivos baixados dos parceiros. Dois
// motivos: nada de hotlink para servidor de terceiro (quebra quando eles mudam
// a URL) e nada de binário de marca alheia no repositório.
//
// Uso da marca aqui é nominativo: identifica de quem é o serviço cotado, que é
// como todo agregador de entrega faz. Não é aproximação da tipografia oficial
// — é o bloco na cor da marca com o nome dela.
//
// O Motoboy Próprio não é parceiro: usa a cor da marca do restaurante e um
// ícone de moto, porque "a entrega é da casa".
// ---------------------------------------------------------------------------

// Fundo vem de COR_PROVEDOR (a mesma dos gráficos) para não haver duas versões
// da cor de cada parceiro. Só o motoboy foge: ele usa a cor do restaurante,
// porque a entrega é da casa e não de uma marca de terceiro.
const CORES: Record<ProviderId, { fundo: string; texto: string }> = {
  uber: { fundo: COR_PROVEDOR.uber, texto: "#FFFFFF" },
  ifood: { fundo: COR_PROVEDOR.ifood, texto: "#FFFFFF" },
  "99": { fundo: COR_PROVEDOR["99"], texto: "#000000" },
  motoboy: { fundo: "var(--marca-primaria)", texto: "var(--marca-contraste)" },
};

/** Wordmark de cada parceiro, já ajustado para caber no quadrado. */
const MARCA: Partial<Record<ProviderId, { texto: string; tamanho: number }>> = {
  uber: { texto: "Uber", tamanho: 11 },
  ifood: { texto: "iFood", tamanho: 9.5 },
  "99": { texto: "99", tamanho: 15 },
};

export default function LogoProvedor({
  provider,
  tamanho = 28,
  className = "",
}: {
  provider: ProviderId;
  tamanho?: number;
  className?: string;
}) {
  const cor = CORES[provider];
  const marca = MARCA[provider];

  return (
    <svg
      viewBox="0 0 32 32"
      width={tamanho}
      height={tamanho}
      role="img"
      aria-label={ROTULO_PROVEDOR[provider]}
      className={`shrink-0 ${className}`}
    >
      <rect width="32" height="32" rx="7" fill={cor.fundo} />

      {marca ? (
        <text
          x="16"
          y="16"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={marca.tamanho}
          fontWeight="700"
          fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          letterSpacing="-0.3"
          fill={cor.texto}
        >
          {marca.texto}
        </text>
      ) : (
        // Motoboy: silhueta de moto vista de lado.
        //
        // Desenhada para sobreviver a 14px, que é o tamanho usado na lista de
        // pedidos: rodas grandes e bem separadas, quadro em um traço só e
        // guidão destacado. Detalhe fino (escapamento, motor, raios) vira
        // borrão nesse tamanho e só suja o ícone.
        //
        // O conjunto ocupa de y=9.5 a y=23.6, centrado no quadrado de 32.
        <g
          fill="none"
          stroke={cor.texto}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8.5" cy="19.8" r="3.8" />
          <circle cx="23.5" cy="19.8" r="3.8" />
          {/* Quadro: cubo traseiro -> banco/tanque -> garfo dianteiro */}
          <path d="M8.5 19.8 L12.5 12.8 H21 L23.5 19.8" />
          {/* Coluna de direção e guidão */}
          <path d="M21 12.8 L22.8 9.5" />
          <path d="M19.8 9.5 H24.8" />
        </g>
      )}
    </svg>
  );
}
