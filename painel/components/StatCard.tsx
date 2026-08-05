// Card de estatística do topo do relatório. Card branco sobre fundo cinza —
// o contraste é o que separa os blocos, não bordas pesadas.
export default function StatCard({
  rotulo,
  valor,
  detalhe,
  cor,
  carregando,
}: {
  /** Aceita nó, não só texto, para caber a marca do parceiro ao lado do nome. */
  rotulo: React.ReactNode;
  valor: string;
  detalhe?: string;
  /** Cor da barrinha lateral. Use a cor da plataforma quando fizer sentido. */
  cor?: string;
  carregando?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {cor && (
        <span
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: cor }}
          aria-hidden="true"
        />
      )}

      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
        {rotulo}
      </div>

      {carregando ? (
        <div
          aria-hidden="true"
          className="mt-2 h-8 w-28 rounded bg-gray-200/80 motion-safe:animate-pulse"
        />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">
          {valor}
        </p>
      )}

      {detalhe && !carregando && (
        <p className="mt-1 text-xs text-gray-400">{detalhe}</p>
      )}
    </div>
  );
}
