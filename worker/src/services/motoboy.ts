import type { Cotacao, Env, Pedido, ResultadoDespacho } from "../types";
import { distanciaKm } from "../lib/geo";
import {
  ETA_BASE_MIN,
  ETA_MIN_POR_KM,
  faixaPara,
  raioMaximoKm,
} from "../config/faixas-motoboy";

// ---------------------------------------------------------------------------
// Motoboy próprio — sem API externa.
//
// Preço vem da tabela de FAIXAS em config/faixas-motoboy.ts, que espelha as
// "Regiões" (raio) do Cardápio Web. Não é cálculo proporcional: é degrau.
// A distância é em LINHA RETA (Haversine) porque é assim que o Cardápio Web
// desenha os anéis no mapa — usar distância de rota daria outro valor.
// ---------------------------------------------------------------------------
export async function cotarMotoboy(env: Env, pedido: Pedido): Promise<Cotacao> {
  const base: Cotacao = {
    provider: "motoboy",
    nome: "Motoboy Próprio",
    disponivel: false,
    preco: null,
    moeda: "BRL",
    etaMinutos: null,
    quoteId: null,
    expiraEm: null,
  };

  const { lat, lng } = pedido.endereco;
  if (lat == null || lng == null) {
    return { ...base, erro: "Endereço sem coordenadas para cálculo de raio." };
  }

  const oLat = parseFloat(env.RESTAURANTE_LAT);
  const oLng = parseFloat(env.RESTAURANTE_LNG);
  // Sem isso, uma coordenada vazia/inválida vira NaN e a cotação sai com preço
  // nulo mas "disponível" — o atendente despacharia sem preço.
  // Mensagem em linguagem de negócio: quem lê é o atendente, não quem instalou.
  if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) {
    return {
      ...base,
      erro: "Localização da loja não cadastrada — veja em Configurações.",
    };
  }

  const km = distanciaKm(oLat, oLng, lat, lng);

  const faixa = faixaPara(km);
  if (!faixa) {
    return {
      ...base,
      erro: `Fora do raio de atendimento: ${km.toFixed(
        2
      )} km (máximo ativo ${raioMaximoKm()} km).`,
    };
  }

  const etaMinutos =
    faixa.etaMinutos ?? Math.round(ETA_BASE_MIN + km * ETA_MIN_POR_KM);

  return {
    ...base,
    disponivel: true,
    preco: faixa.preco,
    etaMinutos,
    quoteId: `motoboy-${pedido.id}`,
    // Motoboy próprio não expira — mantemos o campo por consistência.
    expiraEm: null,
    // Rastro do cálculo, útil para conferir contra o Cardápio Web.
    detalhe: `${km.toFixed(2)} km · faixa ${faixa.raioKm} km`,
  };
}

export async function despacharMotoboy(
  _env: Env,
  pedido: Pedido,
  _cotacao?: Cotacao // assinatura uniforme com os demais provedores
): Promise<ResultadoDespacho> {
  // Aqui você notificaria seu motoboy (WhatsApp, painel interno, etc.).
  // Como é operação manual, apenas registramos e devolvemos um "tracking" interno.
  return {
    provider: "motoboy",
    deliveryId: `motoboy-${pedido.id}`,
    trackingUrl: null,
    status: "acionado",
  };
}
