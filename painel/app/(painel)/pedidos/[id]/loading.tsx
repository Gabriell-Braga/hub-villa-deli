import { SkeletonCabecalho, SkeletonCotacao } from "@/components/Skeleton";

export default function Carregando() {
  return (
    <div className="mx-auto max-w-5xl">
      <SkeletonCabecalho acao />
      <SkeletonCotacao />
    </div>
  );
}
