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
 * Marca do iFood no tamanho de chip.
 *
 * Desenhada aqui, como as dos parceiros em LogoProvedor: nada de hotlink para
 * servidor de terceiro nem binário de marca alheia no repositório. É uso
 * nominativo — identifica de onde veio o pedido, na cor deles.
 *
 * O bloco vermelho com o nome funciona melhor que um símbolo isolado num chip
 * de 16px: a palavra "iFood" é lida de relance, um glifo pequeno não.
 */
function MarcaIfood() {
  return (
    <svg
      viewBox="0 0 40 16"
      width="30"
      height="12"
      role="img"
      aria-label="iFood"
      className="shrink-0"
    >
      <rect width="40" height="16" rx="4" fill="#EA1D2C" />
      <text
        x="20"
        y="8.6"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        letterSpacing="-0.3"
        fill="#FFFFFF"
      >
        iFood
      </text>
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-1 pr-2.5 text-xs font-medium ring-1 ring-inset ${c.classe}`}
    >
      {/* Com a marca desenhada o nome vira redundância; sem ela, o rótulo é
          tudo o que o chip tem. */}
      {Marca ? <Marca /> : <span className="pl-1.5">{c.rotulo}</span>}

      {numeroExterno && (
        // O número do pedido no app do cliente. É por ele que o atendente
        // acha o pedido no tablet do marketplace.
        <span className="font-mono opacity-80">#{numeroExterno}</span>
      )}
    </span>
  );
}
