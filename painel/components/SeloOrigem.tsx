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

/**
 * Símbolo oficial do iFood.
 *
 * O traçado vem do Simple Icons (simpleicons.org), a coleção de marcas usada
 * como referência para este tipo de uso. Fica INLINE, não como arquivo
 * baixado: nenhuma requisição a servidor de terceiro para desenhar a tela, e
 * nada que quebre se eles trocarem uma URL.
 *
 * Uso nominativo — identifica de onde veio o pedido. A marca é do iFood.
 */
function MarcaIfood() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      role="img"
      aria-label="iFood"
      fill="#EA1D2C"
      className="shrink-0"
    >
      <path d="M8.428 1.67c-4.65 0-7.184 4.149-7.184 6.998 0 2.294 2.2 3.299 4.25 3.299l-.006-.006c4.244 0 7.184-3.854 7.184-6.998 0-2.29-2.175-3.293-4.244-3.293zm11.328 0c-4.65 0-7.184 4.149-7.184 6.998 0 2.294 2.2 3.299 4.25 3.299l-.006-.006C21.061 11.96 24 8.107 24 4.963c0-2.29-2.18-3.293-4.244-3.293zM14.172 14.52l2.435 1.834c-2.17 2.07-6.124 3.525-9.353 3.17A8.913 8.913 0 01.23 14.541H0a9.598 9.598 0 008.828 7.758c3.814.24 7.323-.905 9.947-3.13l-.004.007 1.08 2.988 1.555-7.623-7.234-.02Z" />
    </svg>
  );
}

const CANAIS: Record<
  string,
  { rotulo: string; classe: string; marca?: () => JSX.Element }
> = {
  ifood: {
    rotulo: "iFood",
    classe: "bg-red-50 text-red-700 ring-red-200",
    marca: MarcaIfood,
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

  const Marca = c.marca;

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${c.classe}`}
    >
      {/* O número vem primeiro porque é o que se procura: o atendente já sabe
          que o pedido é do iFood pela cor do chip, e o que ele precisa ler é
          o código para achar no tablet. A marca fecha o chip à direita. */}
      {numeroExterno ? (
        <span className="font-mono">#{numeroExterno}</span>
      ) : (
        <span>{c.rotulo}</span>
      )}

      {Marca && <Marca />}
    </span>
  );
}
