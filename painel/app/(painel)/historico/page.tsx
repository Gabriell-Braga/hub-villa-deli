import HistoricoEntregas from "@/components/HistoricoEntregas";

export const metadata = { title: "Histórico · Hub Logístico" };

export default function PaginaHistorico() {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Histórico</h1>
        <p className="mt-1 text-sm text-gray-500">
          Entregas despachadas, com a transportadora e o frete pago. Filtre e
          exporte para o Excel.
        </p>
      </header>

      <HistoricoEntregas />
    </div>
  );
}
