import {
  Skeleton,
  SkeletonCartoesCotacao,
  SkeletonResumoPedido,
} from "@/components/Skeleton";

// Espelha a tela real: link de voltar, cabeçalho com o botão Recotar à
// direita, e o grid de cotações com o resumo ao lado. O esqueleto anterior
// desenhava um cabeçalho genérico e sem o link, e a página saltava quando os
// dados chegavam.
export default function Carregando() {
  return (
    <div className="mx-auto max-w-5xl">
      <Skeleton className="mb-4 h-4 w-36" />

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="w-full max-w-md">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-full sm:w-24" />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          <Skeleton className="mb-3 h-3 w-24" />
          <SkeletonCartoesCotacao />
        </section>
        <SkeletonResumoPedido />
      </div>
    </div>
  );
}
