export const brl = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Igual ao brl, mas mostra "Grátis" no lugar de R$ 0,00. */
export const brlOuGratis = (v: number | null | undefined) =>
  v === 0 ? "Grátis" : brl(v);

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "2026-08-04" -> "04/08" (para o eixo X do gráfico). */
export const diaCurto = (dia: string) => {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
};

/** Quanto tempo faz, em texto curto: "agora", "12 min", "2 h". */
export function desde(iso: string): string {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
