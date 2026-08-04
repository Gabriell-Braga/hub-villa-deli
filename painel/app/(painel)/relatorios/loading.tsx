import { SkeletonCabecalho, SkeletonRelatorios } from "@/components/Skeleton";

export default function Carregando() {
  return (
    <div className="mx-auto max-w-6xl">
      <SkeletonCabecalho acao />
      <SkeletonRelatorios />
    </div>
  );
}
