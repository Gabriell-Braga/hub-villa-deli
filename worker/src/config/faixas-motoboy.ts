// ---------------------------------------------------------------------------
// Tabela de frete do MOTOBOY PRÓPRIO — espelho exato das "Regiões" (raio)
// configuradas no Cardápio Web.
//
// IMPORTANTE: esta tabela precisa ser IDÊNTICA à do Cardápio Web. O cliente vê
// o preço do cardápio; se o Hub calcular diferente, a conta do restaurante não
// fecha. Sempre que mexer nas regiões lá, atualize aqui.
//
// Como o Cardápio Web cobra: por FAIXA (anel), não proporcional à distância.
// O cliente cai na MENOR faixa cujo raio >= distância em linha reta da loja.
//   Ex.: 2,3 km -> cai na faixa de 2,5 km -> R$ 10,99
//        1,4 km -> não existe faixa de 1,5 km -> cai na de 2 km -> R$ 9,99
// ---------------------------------------------------------------------------

export interface FaixaMotoboy {
  /** Raio do anel em km (limite SUPERIOR da faixa, inclusive). */
  raioKm: number;
  /** Preço em reais. 0 = grátis. */
  preco: number;
  /** ETA em minutos. Se ausente, cai no cálculo por km (ver abaixo). */
  etaMinutos?: number;
  /** false = região desativada no Cardápio Web (bolinha vermelha). */
  ativa?: boolean;
}

export const FAIXAS_MOTOBOY: FaixaMotoboy[] = [
  { raioKm: 1.0, preco: 0.0, etaMinutos: 35 }, // "Grátis · 35 min"
  { raioKm: 2.0, preco: 9.99, etaMinutos: 39 },
  { raioKm: 2.5, preco: 10.99 },
  { raioKm: 3.0, preco: 11.99 },
  { raioKm: 3.5, preco: 12.99 },
  { raioKm: 4.0, preco: 13.99 },
  { raioKm: 4.5, preco: 14.99 },
  { raioKm: 5.0, preco: 15.99 },
  { raioKm: 5.5, preco: 16.99 },
  { raioKm: 6.0, preco: 17.99 },
  { raioKm: 6.5, preco: 18.99 },
  { raioKm: 7.0, preco: 19.99 },
  { raioKm: 7.5, preco: 20.99 },
  { raioKm: 8.0, preco: 21.99 },
  { raioKm: 8.5, preco: 22.99 },
  // ATENÇÃO: no Cardápio Web existem DUAS faixas de 8,5 km (R$ 22,99).
  // A duplicata é inofensiva no preço, mas empurrou a numeração — é o motivo
  // de 9 km custar o mesmo que 8,5 km daqui pra frente. Ver README.
  { raioKm: 9.0, preco: 22.99 },
  { raioKm: 9.5, preco: 23.99 },
  { raioKm: 10.0, preco: 24.99 },

  // --- Desativadas no Cardápio Web (bolinha vermelha) ---
  // Deixe `ativa: false` em vez de apagar: se reativar lá, é só trocar aqui.
  { raioKm: 10.5, preco: 27.99, ativa: false }, // fora de ordem no painel (< 11 km)
  { raioKm: 11.0, preco: 26.99, ativa: false },
  { raioKm: 11.5, preco: 27.99, ativa: false },
  { raioKm: 12.0, preco: 28.99, ativa: false },
];

// ETA para faixas sem tempo definido. Calibrado pelos dois valores que o
// Cardápio Web mostra: 35 min @ 1 km e 39 min @ 2 km -> 31 + 4 * km.
export const ETA_BASE_MIN = 31;
export const ETA_MIN_POR_KM = 4;

/**
 * Margem de segurança no limite da faixa, em km.
 *
 * A distância vem de geocodificação (CEP -> lat/lng), que erra de 50 a 300 m
 * em rua longa. Sem margem, um cliente na fronteira pode ser cobrado uma faixa
 * a mais do que o Cardápio Web cobrou dele. 0.05 km = 50 m de tolerância a
 * favor do cliente. Coloque 0 para casar 100% com o raio geométrico.
 */
export const TOLERANCIA_KM = 0.05;

/** Faixas ativas, do menor raio para o maior. */
export function faixasAtivas(): FaixaMotoboy[] {
  return FAIXAS_MOTOBOY.filter((f) => f.ativa !== false).sort(
    (a, b) => a.raioKm - b.raioKm
  );
}

/** Menor faixa ativa que cobre a distância. null = fora da área de entrega. */
export function faixaPara(km: number): FaixaMotoboy | null {
  return faixasAtivas().find((f) => km <= f.raioKm + TOLERANCIA_KM) ?? null;
}

/** Maior raio ativo — usado só para a mensagem de "fora do raio". */
export function raioMaximoKm(): number {
  const ativas = faixasAtivas();
  return ativas.length ? ativas[ativas.length - 1].raioKm : 0;
}
