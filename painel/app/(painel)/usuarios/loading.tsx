import { SkeletonCabecalho, SkeletonUsuarios } from "@/components/Skeleton";

export default function Carregando() {
  return (
    <div className="mx-auto max-w-4xl">
      <SkeletonCabecalho acao />
      <SkeletonUsuarios />
    </div>
  );
}
