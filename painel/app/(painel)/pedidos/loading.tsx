import { SkeletonListaPedidos } from "@/components/Skeleton";

// Aparece durante a navegação, antes mesmo do JS da página carregar. É o mesmo
// desenho que o ListaPedidos usa enquanto busca — a troca entre os dois é
// invisível para quem está olhando.
export default function Carregando() {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Pedidos em Aberto</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pedidos recebidos do Cardápio Web que ainda não foram despachados.
        </p>
      </header>

      <SkeletonListaPedidos />
    </div>
  );
}
