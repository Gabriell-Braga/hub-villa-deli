import { SkeletonListaPedidos } from "@/components/Skeleton";

export default function Carregando() {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Histórico</h1>
        <p className="mt-1 text-sm text-gray-500">
          Entregas já despachadas, com a plataforma escolhida e o frete pago.
        </p>
      </header>

      <SkeletonListaPedidos />
    </div>
  );
}
