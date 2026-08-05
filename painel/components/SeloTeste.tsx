// ---------------------------------------------------------------------------
// Marca visível de "isto não é uma venda".
//
// Pedido simulado e pedido real ficam lado a lado na mesma fila, e a diferença
// entre acionar um entregador de verdade e um de mentira não pode depender de
// alguém lembrar qual pedido criou. O selo é âmbar e escrito por extenso de
// propósito: precisa saltar aos olhos antes do clique, não depois.
// ---------------------------------------------------------------------------

export default function SeloTeste({
  tamanho = "normal",
}: {
  tamanho?: "normal" | "grande";
}) {
  const escala =
    tamanho === "grande" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";

  return (
    <span
      title="Pedido simulado para testes. Não é uma venda da loja."
      className={`inline-flex items-center gap-1.5 rounded-full bg-amber-100 font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-300 ${escala}`}
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="currentColor"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M8 1.5a.9.9 0 0 1 .78.45l6.1 10.6a.9.9 0 0 1-.78 1.35H1.9a.9.9 0 0 1-.78-1.35l6.1-10.6A.9.9 0 0 1 8 1.5Zm0 3.9a.75.75 0 0 0-.75.79l.2 3.5a.55.55 0 0 0 1.1 0l.2-3.5A.75.75 0 0 0 8 5.4Zm0 5.4a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z" />
      </svg>
      Teste
    </span>
  );
}
