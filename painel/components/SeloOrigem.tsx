import { PATH_IFOOD } from "./marcas";

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
      width="12"
      height="12"
      role="img"
      aria-label="iFood"
      fill="#EA1D2C"
      className="shrink-0"
    >
      <path d={PATH_IFOOD} />
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
}: {
  canal?: string;
  /** Não é mais exibido; aceito para as chamadas continuarem iguais. */
  numeroExterno?: string;
}) {
  const c = canal ? CANAIS[canal] : undefined;
  if (!c) return null;

  const Marca = c.marca;

  // Mesma altura e mesmo arredondado do selo "Teste", para os dois ficarem
  // alinhados lado a lado. Com marca, só o ícone: o nome vai no title e no
  // leitor de tela. Sem marca (portal), o nome escrito.
  return (
    <span
      title={`Pedido do ${c.rotulo}`}
      aria-label={`Pedido do ${c.rotulo}`}
      className={`inline-flex h-5 items-center whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium ring-1 ring-inset ${c.classe}`}
    >
      {Marca ? <Marca /> : <span>{c.rotulo}</span>}
    </span>
  );
}
