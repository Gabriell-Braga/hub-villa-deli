import type { Endereco } from "../types";

// Distância Haversine em km entre dois pontos (lat/lng em graus).
export function distanciaKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // raio da Terra em km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Monta endereço em uma linha (útil para payloads de API que pedem string).
export function enderecoFormatado(e: Endereco): string {
  const compl = e.complemento ? `, ${e.complemento}` : "";
  return `${e.logradouro}, ${e.numero}${compl} - ${e.bairro}, ${e.cidade} - ${e.uf}, ${e.cep}`;
}
