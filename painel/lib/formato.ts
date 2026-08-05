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

/**
 * Telefone E.164 em formato legível: +5531988887777 -> +55 31 98888-7777.
 * O que vem do parceiro é uma sequência crua de dígitos, ilegível de relance
 * — e é um número que o atendente precisa ditar ou conferir no telefone.
 */
export function telefone(bruto: string): string {
  const d = bruto.replace(/\D/g, "");
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : bruto;
}

/**
 * Quanto falta para um horário futuro: "em 11 min", "agora", "atrasado 3 min".
 * O relógio da previsão sozinho ("19:39") obriga a fazer a conta de cabeça.
 */
export function faltam(iso: string): string {
  const min = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (min <= -1) return `atrasado ${Math.abs(min)} min`;
  if (min <= 0) return "chegando";
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  return `em ${h}h${String(min % 60).padStart(2, "0")}`;
}

/** Quanto tempo faz, em texto curto: "agora", "12 min", "2 h". */
export function desde(iso: string): string {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
