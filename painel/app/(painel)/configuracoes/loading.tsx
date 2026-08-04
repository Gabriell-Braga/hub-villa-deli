import {
  SkeletonCabecalho,
  SkeletonDiagnostico,
  SkeletonMarca,
} from "@/components/Skeleton";

export default function Carregando() {
  return (
    <div className="mx-auto max-w-4xl">
      <SkeletonCabecalho acao />
      <SkeletonMarca />
      <SkeletonDiagnostico />
    </div>
  );
}
