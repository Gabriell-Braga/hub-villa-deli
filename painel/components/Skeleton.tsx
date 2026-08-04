// ---------------------------------------------------------------------------
// Skeletons de carregamento.
//
// Regra que guia todos eles: o esqueleto tem a MESMA estrutura do conteúdo
// real. Um bloco cinza genérico avisa que algo está carregando, mas a tela
// "pula" quando os dados chegam — e o atendente perde a referência de onde
// estava olhando.
//
// Cada tela tem seu esqueleto exportado aqui e usado em DOIS lugares:
//   1. no loading.tsx da rota  -> aparece durante a navegação, antes do JS
//   2. no estado `carregando`  -> aparece enquanto o fetch não volta
// Assim a transição entre os dois é invisível: é o mesmo desenho.
//
// `motion-safe:` respeita quem desativou animações no sistema.
// ---------------------------------------------------------------------------

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded bg-gray-200/80 motion-safe:animate-pulse ${className}`}
    />
  );
}

/** Cabeçalho de página: título + linha de apoio. */
export function SkeletonCabecalho({ acao = false }: { acao?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="w-full max-w-md">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-full max-w-sm" />
      </div>
      {acao && <Skeleton className="h-10 w-full sm:w-36" />}
    </div>
  );
}

/** Cartão branco com barrinhas dentro — base dos stat cards e afins. */
function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Lista de pedidos (telas Aberto e Histórico)
// ---------------------------------------------------------------------------
export function SkeletonListaPedidos({ linhas = 4 }: { linhas?: number }) {
  const itens = Array.from({ length: linhas }, (_, i) => i);

  return (
    <>
      {/* Celular: cartões, iguais aos do ListaPedidos */}
      <ul className="space-y-3 sm:hidden">
        {itens.map((i) => (
          <li key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-5 w-32 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet e desktop: linhas de tabela */}
      <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white sm:block">
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="divide-y divide-gray-100">
          {itens.map((i) => (
            <div key={i} className="flex items-center gap-5 px-5 py-4">
              <div className="w-32 shrink-0">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-1.5 h-3 w-16" />
              </div>
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-1.5 h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-28 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-16 shrink-0" />
              <Skeleton className="h-7 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detalhe do pedido / cotação
// ---------------------------------------------------------------------------
/** Só os cartões de cotação — a página usa esta peça sozinha. */
export function SkeletonCartoesCotacao({ cartoes = 2 }: { cartoes?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: cartoes }, (_, i) => (
        <Cartao key={i}>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="mt-4 flex items-end justify-between">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-4 h-10 w-full" />
        </Cartao>
      ))}
    </div>
  );
}

/** Painel lateral com os dados da entrega. */
export function SkeletonResumoPedido() {
  return (
    <aside className="rounded-xl border border-gray-200 bg-white p-5">
      <Skeleton className="h-3 w-20" />
      <div className="mt-4 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="mt-1.5 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </aside>
  );
}

export function SkeletonCotacao() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section>
        <Skeleton className="mb-3 h-3 w-24" />
        <SkeletonCartoesCotacao />
      </section>
      <SkeletonResumoPedido />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

/**
 * Fantasma de gráfico: barras de alturas variadas, com a mesma altura total do
 * Recharts (256px). Lê como "vem um gráfico aqui", não como um bloco cinza.
 * As alturas são fixas de propósito — sortear mudaria a cada render.
 */
export function SkeletonGraficoBarras() {
  const alturas = [45, 70, 35, 85, 55, 95, 60, 40, 75, 50];

  return (
    <div className="flex h-64 items-end gap-2" aria-hidden="true">
      {alturas.map((altura, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-gray-200/80 motion-safe:animate-pulse"
          style={{ height: `${altura}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonRelatorios() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Cartao key={i}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-28" />
          </Cartao>
        ))}
      </div>

      <Skeleton className="mb-3 mt-8 h-3 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Cartao key={i}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-7 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
          </Cartao>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Cartao key={i}>
            <Skeleton className="h-4 w-40" />
            <div className="mt-4">
              <SkeletonGraficoBarras />
            </div>
          </Cartao>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
export function SkeletonUsuarios({ linhas = 3 }: { linhas?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: linhas }, (_, i) => (
        <li key={i} className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="mt-2 h-3 w-52" />
              <div className="mt-3 flex gap-2">
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Skeleton className="h-9 flex-1 sm:w-24 sm:flex-none" />
              <Skeleton className="h-9 flex-1 sm:w-28 sm:flex-none" />
              <Skeleton className="h-9 flex-1 sm:w-20 sm:flex-none" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Configurações / diagnóstico
// ---------------------------------------------------------------------------
export function SkeletonDiagnostico({ linhas = 5 }: { linhas?: number }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="flex gap-4 p-5">
            <Skeleton className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-2 h-3 w-full max-w-md" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Bloco da marca, no topo de Configurações. */
export function SkeletonMarca() {
  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <Skeleton className="h-3 w-16" />
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      </div>
    </section>
  );
}
