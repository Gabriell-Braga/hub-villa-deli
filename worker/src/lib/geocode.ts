import type { Endereco, Env } from "../types";
import { enderecoFormatado } from "./geo";

// ---------------------------------------------------------------------------
// Geocodificação de endereços.
//
// Fluxo em garantirCoordenadas():
//   1) Se o endereço já tem lat/lng, não faz nada (Cardápio Web já geocodificou).
//   2) Se faltam campos (só veio CEP), enriquece via ViaCEP.
//   3) Resolve lat/lng: usa Google se GOOGLE_MAPS_API_KEY estiver setada,
//      senão cai no Nominatim (OpenStreetMap) — grátis, sem chave.
//
// A função nunca lança: se não conseguir geocodificar, devolve o endereço
// como está (sem coords). O motoboy simplesmente ficará "indisponível", mas
// Uber/iFood/99 seguem cotando normalmente.
//
// CACHE: o resultado vai pro KV por 30 dias, chaveado por CEP+número. Sem isso
// cada pedido gastava uma chamada de ViaCEP + uma de geocoder. O Nominatim
// limita por IP e Workers saem de IPs compartilhados — sem cache, 429 na cara.
// ---------------------------------------------------------------------------

const GEO_TTL = 60 * 60 * 24 * 30; // 30 dias

const chaveGeo = (e: Endereco) =>
  `geo:${e.cep.replace(/\D/g, "")}:${(e.numero || "s-n").trim().toLowerCase()}`;

interface ViaCepResposta {
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string; // cidade
  uf?: string;
  erro?: boolean;
}

// Consulta o ViaCEP e preenche apenas os campos que estiverem vazios.
async function enriquecerViaCep(endereco: Endereco): Promise<Endereco> {
  const cep = endereco.cep.replace(/\D/g, "");
  if (cep.length !== 8) return endereco;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return endereco;
    const d = (await res.json()) as ViaCepResposta;
    if (d.erro) return endereco;

    return {
      ...endereco,
      logradouro: endereco.logradouro || d.logradouro || "",
      bairro: endereco.bairro || d.bairro || "",
      cidade: endereco.cidade || d.localidade || "",
      uf: endereco.uf || d.uf || "",
    };
  } catch {
    return endereco;
  }
}

// --- Geocoders ---------------------------------------------------------------

async function geocodeGoogle(
  env: Env,
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("region", "br");
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const d = (await res.json()) as {
    status: string;
    results: { geometry: { location: { lat: number; lng: number } } }[];
  };
  const loc = d.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function geocodeNominatim(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");

  const res = await fetch(url.toString(), {
    // Nominatim EXIGE um User-Agent identificável (política de uso).
    headers: { "User-Agent": "HubLogistico/1.0 (contato@seudominio.com.br)" },
  });
  if (!res.ok) return null;
  const arr = (await res.json()) as { lat: string; lon: string }[];
  const hit = arr?.[0];
  return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
}

// --- API pública -------------------------------------------------------------

export async function garantirCoordenadas(
  env: Env,
  endereco: Endereco
): Promise<Endereco> {
  // 1) Já tem coordenadas? Nada a fazer — é o caminho mais preciso e rápido.
  if (endereco.lat != null && endereco.lng != null) return endereco;

  const chave = chaveGeo(endereco);

  // 2) Cache.
  const cache = await env.HUB_KV.get<Endereco>(chave, "json").catch(() => null);
  if (cache?.lat != null && cache?.lng != null) {
    // Mantém os campos que vieram no pedido; só aproveita o que foi resolvido.
    return {
      ...endereco,
      logradouro: endereco.logradouro || cache.logradouro,
      bairro: endereco.bairro || cache.bairro,
      cidade: endereco.cidade || cache.cidade,
      uf: endereco.uf || cache.uf,
      lat: cache.lat,
      lng: cache.lng,
    };
  }

  // 3) Enriquece campos faltantes com ViaCEP.
  const completo = await enriquecerViaCep(endereco);

  // 4) Geocodifica. Se o Google falhar (cota, chave inválida), tenta Nominatim
  //    antes de desistir — desistir aqui deixa o motoboy sem preço.
  const query = enderecoFormatado(completo);
  let coords: { lat: number; lng: number } | null = null;
  try {
    coords = env.GOOGLE_MAPS_API_KEY ? await geocodeGoogle(env, query) : null;
  } catch {
    coords = null;
  }
  if (!coords) {
    try {
      coords = await geocodeNominatim(query);
    } catch {
      coords = null;
    }
  }

  if (!coords) return completo;

  const resolvido: Endereco = { ...completo, lat: coords.lat, lng: coords.lng };
  await env.HUB_KV.put(chave, JSON.stringify(resolvido), {
    expirationTtl: GEO_TTL,
  }).catch(() => {
    /* cache é best-effort — falhar aqui não pode derrubar o pedido */
  });

  return resolvido;
}
