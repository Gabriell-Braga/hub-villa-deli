import ListaPedidos from "@/components/ListaPedidos";

export const metadata = { title: "Pedidos em Aberto · Hub Logístico" };

export default function PaginaPedidos() {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Pedidos em Aberto</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pedidos recebidos do Cardápio Web que ainda não foram despachados.
          A lista se atualiza sozinha a cada 15 segundos.
        </p>
      </header>

      <ListaPedidos aba="abertos" />
    </div>
  );
}
