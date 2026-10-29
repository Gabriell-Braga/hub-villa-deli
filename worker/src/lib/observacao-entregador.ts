import type { Pedido } from "../types";

/** Instrução operacional enviada em todo despacho. */
const INSTRUCAO_BAG =
  "Levar Bag/Pizza Box para transporte do pedido.";

/**
 * Monta as observações que vão para o entregador.
 *
 * A instrução da bag/box é sempre incluída; a observação do cliente (Cardápio
 * Web) e o complemento do endereço entram depois, quando existirem.
 */
export function observacaoParaEntregador(pedido: Pedido): string {
  const partes = [INSTRUCAO_BAG];

  // Logo depois da bag: a 99 corta a nota em 127 caracteres, e sem este
  // número o entregador não tem como falar com o cliente do iFood.
  if (pedido.contatoCliente) partes.push(`Cliente: ligar ${pedido.contatoCliente}`);

  const obs = pedido.observacao?.trim();
  if (obs) partes.push(obs);

  const complemento = pedido.endereco.complemento?.trim();
  if (complemento) partes.push(`Complemento: ${complemento}`);

  return partes.join(" · ");
}
