// Card de estatística do topo do relatório. Card branco sobre fundo cinza —
// o contraste é o que separa os blocos, não bordas pesadas.
export default function StatCard({
  rotulo,
  valor,
  detalhe,
  cor,
  tom,
  carregando,
}: {
  /** Aceita nó, não só texto, para caber a marca do parceiro ao lado do nome. */
  rotulo: React.ReactNode;
  valor: string;
  detalhe?: string;
  /** Cor da barrinha lateral. Use a cor da plataforma quando fizer sentido. */
  cor?: string;
  /**
   * Colore o VALOR quando ele é um resultado que pode ser negativo. Só para
   * isso: número neutro colorido de verde vira decoração e some o significado.
   */
  tom?: "positivo" | "negativo";
  carregando?: boolean;
}) {
  const corDoValor =
    tom === "positivo"
      ? "text-emerald-700"
      : tom === "negativo"
      ? "text-red-700"
      : "text-gray-900";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-cartao">
      {/* A cor vira um ponto ao lado do rótulo. A barra lateral colorida
          anterior pesava e fazia cada card parecer de um sistema diferente. */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        {cor && (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} aria-hidden="true" />
        )}
        {rotulo}
      </div>

      {carregando ? (
        <div
          aria-hidden="true"
          className="mt-2 h-8 w-28 rounded bg-gray-200/80 motion-safe:animate-pulse"
        />
      ) : (
        <p className={`mt-2 text-[26px] font-semibold leading-none tracking-tight ${corDoValor}`}>
          {valor}
        </p>
      )}

      {detalhe && !carregando && (
        <p className="mt-2 text-xs text-gray-500">{detalhe}</p>
      )}
    </div>
  );
}
