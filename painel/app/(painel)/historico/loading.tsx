import {
  Skeleton,
  SkeletonCabecalho,
  SkeletonListaPedidos,
} from "@/components/Skeleton";

// Espelha o layout real: cabeçalho com o seletor de período à direita, cartão
// de filtros e a lista. Sem isso a tela salta quando os dados chegam.
export default function Carregando() {
  return (
    <div className="mx-auto max-w-6xl">
      <SkeletonCabecalho acao />

      {/* Cartão de filtros */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-1.5 h-10 w-full" />
            </div>
          ))}
        </div>
      </section>

      {/* Resumo + botão de exportar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-9 w-32" />
      </div>

      <SkeletonListaPedidos />
    </div>
  );
}
