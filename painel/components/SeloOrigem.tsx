// ---------------------------------------------------------------------------
// De onde veio a venda.
//
// Só aparece quando NÃO é do cardápio da própria loja. Pedido do cardápio é a
// maioria esmagadora, e marcar o caso comum vira ruído — o selo tem que
// significar "presta atenção neste aqui".
//
// E há o que prestar atenção: pedido de marketplace tem um número próprio, que
// é o que o cliente cita quando liga, e não traz o telefone dele.
// ---------------------------------------------------------------------------

const CANAIS: Record<string, { rotulo: string; classe: string }> = {
  ifood: {
    rotulo: "iFood",
    // Vermelho do iFood, em tom claro — é a marca deles, não a da loja.
    classe: "bg-red-50 text-red-700 ring-red-200",
  },
  portal: {
    rotulo: "Portal",
    classe: "bg-gray-100 text-gray-700 ring-gray-300",
  },
};

export default function SeloOrigem({
  canal,
  numeroExterno,
}: {
  canal?: string;
  numeroExterno?: string;
}) {
  const c = canal ? CANAIS[canal] : undefined;
  if (!c) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${c.classe}`}
    >
      {c.rotulo}
      {numeroExterno && (
        // O número do pedido no app do cliente. É por ele que o atendente
        // acha o pedido no tablet do marketplace.
        <span className="font-mono opacity-80">#{numeroExterno}</span>
      )}
    </span>
  );
}
