// ---------------------------------------------------------------------------
// Marca visível de "isto não é uma venda".
//
// Pedido simulado e pedido real ficam lado a lado na mesma fila, e a diferença
// entre acionar um entregador de verdade e um de mentira não pode depender de
// alguém lembrar qual pedido criou. O selo é âmbar e escrito por extenso de
// propósito: precisa saltar aos olhos antes do clique, não depois.
// ---------------------------------------------------------------------------

// Um tamanho só. Havia uma variante "grande" para o cabeçalho do pedido, mas
// ali ele fica ao lado do chip de origem, e dois chips vizinhos com alturas
// diferentes desalinham a linha inteira.
export default function SeloTeste() {
  return (
    <span
      title="Pedido simulado para testes. Não é uma venda da loja."
      className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      Teste
    </span>
  );
}
