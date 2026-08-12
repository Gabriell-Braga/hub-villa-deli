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

// Monta endereço em uma linha. Serve para exibir na tela e para parceiros que
// aceitam texto solto.
export function enderecoFormatado(e: Endereco): string {
  const compl = e.complemento ? `, ${e.complemento}` : "";
  return `${e.logradouro}, ${e.numero}${compl} - ${e.bairro}, ${e.cidade} - ${e.uf}, ${e.cep}`;
}

/**
 * Endereço no formato ESTRUTURADO que o Uber pede.
 *
 * A API aceita texto solto, mas a documentação deles é explícita sobre a
 * diferença: com o JSON estruturado "the benefit comes with the corresponding
 * parsing and accuracy when it is received by our booking engine".
 *
 * Isso não é detalhe de formatação. Já aconteceu de entregador ter dificuldade
 * para achar a loja porque o que ia como endereço de coleta era só o CEP. E a
 * Uber prioriza o endereço sobre a coordenada — mandar texto ambíguo faz ela
 * geocodificar por conta própria e chegar em outro lugar.
 *
 * `street_address` é um array: a segunda linha carrega complemento e bairro,
 * que é onde o entregador encontra "apto 801" e "Vila da Serra".
 */
export function enderecoUber(e: Endereco): string {
  const linha2 = [e.complemento, e.bairro].filter(Boolean).join(" - ");

  return JSON.stringify({
    street_address: [`${e.logradouro}, ${e.numero}`, ...(linha2 ? [linha2] : [])],
    city: e.cidade,
    state: e.uf,
    // Sem máscara: o CEP chega do Cardápio Web já sem traço, mas o do
    // restaurante vem do wrangler.toml com traço.
    zip_code: (e.cep || "").replace(/\D/g, ""),
    country: "BR",
  });
}
