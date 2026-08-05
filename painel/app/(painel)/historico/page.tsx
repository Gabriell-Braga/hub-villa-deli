import HistoricoEntregas from "@/components/HistoricoEntregas";

export const metadata = { title: "Histórico · Hub Logístico" };

// O cabeçalho vive dentro do HistoricoEntregas porque o seletor de período
// fica nele e precisa do estado dos filtros — mesmo arranjo da tela de
// Relatórios.
export default function PaginaHistorico() {
  return (
    <div className="mx-auto max-w-6xl">
      <HistoricoEntregas />
    </div>
  );
}
