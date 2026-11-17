import type { Env, ModoOperacao, Pedido, ProviderId } from "../types";
import { modoAtual } from "../config/modo";
import {
  corridasDoPedido,
  descartarCorrida,
  encerrarComoOutra,
  fecharDisputa,
  obterDespacho,
  obterPedido,
  pedidosParaReconciliar,
  type CorridaAberta,
} from "../lib/store";
import { cancelarUber } from "./uber";
import { cancelarIfood, motivosCancelamentoIfood } from "./ifood";
import { cancelar99 } from "./noventa99";
import { cancelarLalamove } from "./lalamove";

// ---------------------------------------------------------------------------
// PEDIR EM VÁRIOS APLICATIVOS AO MESMO TEMPO
//
// Esperar um app só às vezes não compensa: ele não acha motorista e o tempo
// passa. O atendente pede em vários de uma vez (POST /api/despachar com
// `opcoes`), e o despacho do pedido guarda todas em `disputa`.
//
// Quem resolve é `reconciliarPedido`, chamada depois de todo webhook de
// entrega, de todo evento do Cardápio Web, pelo cron de minuto em minuto e
// pela tela de acompanhamento:
//
//   1. O primeiro app que tiver entregador (status saiu de "pending") vence.
//      Vira o despacho do pedido e as outras corridas são canceladas.
//   2. Se o Cardápio Web disser que o pedido saiu para entrega por fora
//      (ex.: a loja pediu entregador do iFood pelo próprio Cardápio Web), toda
//      corrida daqui que AINDA PROCURA motorista é cancelada e o pedido fecha
//      como "outra plataforma". Corrida com entregador já a caminho NÃO é
//      tocada: ela é a entrega de verdade.
// ---------------------------------------------------------------------------

/** Parceiros que o Hub consegue cancelar sozinho. O motoboy não entra. */
export const PROVEDORES_CANCELAVEIS: ProviderId[] = ["uber", "ifood", "99", "lalamove"];

const ENCERRADA = new Set(["delivered", "canceled", "returned"]);

/**
 * Status do Cardápio Web que querem dizer "o pedido já saiu". Conferido nos
 * eventos de produção (nov/2026): `released` é o "Saiu para entrega" deles;
 * `delivered` e `closed` vêm depois.
 */
const SAIU_NO_CARDAPIO = new Set(["released", "delivered", "closed"]);

const NOMES: Record<string, string> = { uber: "Uber", ifood: "iFood", "99": "99", lalamove: "Lalamove" };

/**
 * Cancela a corrida no parceiro.
 *
 * iFood sem motivo informado (cancelamento automático): usa um motivo da lista
 * que o próprio iFood devolve agora, preferindo o que fala de desistência.
 */
export async function cancelarNoParceiro(
  env: Env,
  pedido: Pedido,
  provider: ProviderId,
  deliveryId: string,
  modo: ModoOperacao,
  codigoMotivo?: string
): Promise<{ ok: boolean; erro?: string }> {
  switch (provider) {
    case "uber":
      return cancelarUber(env, deliveryId, modo);
    case "99":
      return cancelar99(env, pedido.id, deliveryId, modo);
    case "lalamove":
      return cancelarLalamove(env, deliveryId, modo);
    case "ifood": {
      // undefined = automático. String vazia = o atendente não escolheu, e
      // aí o iFood recusa como sempre recusou.
      if (codigoMotivo === undefined) {
        const r = await motivosCancelamentoIfood(env, pedido, deliveryId, modo);
        if ("precisaMotivo" in r && r.precisaMotivo && r.motivos.length > 0) {
          codigoMotivo = (
            r.motivos.find((m) => /desist|outro|não precisa|nao precisa/i.test(m.descricao)) ?? r.motivos[0]
          ).codigo;
        }
      }
      return cancelarIfood(env, pedido, deliveryId, modo, codigoMotivo);
    }
    default:
      return { ok: false, erro: "Este parceiro não tem cancelamento automático." };
  }
}

/** Cancela e descarta cada corrida. true = todas canceladas. */
async function cancelarCorridas(
  env: Env,
  pedido: Pedido,
  corridas: CorridaAberta[],
  modo: ModoOperacao,
  motivo: string
): Promise<boolean> {
  const r = await Promise.all(
    corridas.map(async (c) => {
      const x = await cancelarNoParceiro(env, pedido, c.provider, c.deliveryId, modo).catch((e) => ({
        ok: false,
        erro: e instanceof Error ? e.message : String(e),
      }));
      if (x.ok) {
        await descartarCorrida(env, pedido.id, c.provider, c.deliveryId, motivo);
      } else {
        // Corrida que não cancelou continua visível no pedido: pode haver um
        // segundo entregador a caminho, e a loja precisa ver isso.
        console.error(`[disputa] pedido ${pedido.id}: falha ao cancelar ${c.provider} ${c.deliveryId}: ${x.erro}`);
      }
      return x.ok;
    })
  );
  return r.every(Boolean);
}

/** Aplica as duas regras ao pedido. Devolve o que fez, para o log. */
export async function reconciliarPedido(env: Env, idPedido: string): Promise<string | null> {
  const pedido = await obterPedido(env, idPedido);
  if (!pedido || pedido.status !== "despachado") return null;
  const despacho = await obterDespacho(env, idPedido);
  if (!despacho) return null;

  const ids = new Set((despacho.disputa ?? [despacho]).map((d) => d.deliveryId));
  const abertas = (await corridasDoPedido(env, idPedido)).filter(
    (c) => ids.has(c.deliveryId) && !ENCERRADA.has(c.status)
  );
  if (abertas.length === 0) return null;
  const modo = await modoAtual(env);

  // Regra 1 — alguém achou motorista.
  if (despacho.disputa) {
    const vencedora = abertas
      .filter((c) => c.status !== "pending")
      .sort((a, b) => (a.atualizadoEm ?? "").localeCompare(b.atualizadoEm ?? ""))[0];
    if (vencedora) {
      const resultado = despacho.disputa.find((d) => d.deliveryId === vencedora.deliveryId);
      if (!resultado || !(await fecharDisputa(env, idPedido, resultado, [...ids]))) return null;
      const perdedoras = abertas.filter((c) => c !== vencedora);
      await cancelarCorridas(env, pedido, perdedoras, modo, `${NOMES[vencedora.provider]} achou motorista primeiro`);
      return `disputa: ${vencedora.provider} venceu, ${perdedoras.length} cancelada(s)`;
    }
  }

  // Regra 2 — o pedido saiu por fora, e daqui só tem corrida procurando.
  const saiu = SAIU_NO_CARDAPIO.has((pedido.statusCardapio ?? "").toLowerCase());
  if (
    saiu &&
    abertas.every((c) => c.status === "pending" && PROVEDORES_CANCELAVEIS.includes(c.provider))
  ) {
    const motivo = `pedido saiu para entrega pelo Cardápio Web (${pedido.statusCardapio})`;
    if (await cancelarCorridas(env, pedido, abertas, modo, motivo)) {
      await encerrarComoOutra(env, pedido, "cardapio-web");
    }
    return `saiu por fora: ${abertas.length} corrida(s) cancelada(s)`;
  }

  return null;
}

/** Varre os pedidos que podem precisar de ação. Nunca lança. */
export async function reconciliarAbertos(env: Env): Promise<void> {
  try {
    for (const id of await pedidosParaReconciliar(env)) {
      const r = await reconciliarPedido(env, id).catch((e) => {
        console.error(`[disputa] pedido ${id}: ${e instanceof Error ? e.message : e}`);
        return null;
      });
      if (r) console.log(`[disputa] pedido ${id}: ${r}`);
    }
  } catch (e) {
    console.error(`[disputa] varredura: ${e instanceof Error ? e.message : e}`);
  }
}
