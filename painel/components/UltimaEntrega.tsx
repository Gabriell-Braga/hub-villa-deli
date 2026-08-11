"use client";

import { useState } from "react";
import type { EntregaAnterior } from "@/lib/tipos";
import { COR_STATUS_ENTREGA, ROTULO_PROVEDOR, ROTULO_STATUS_ENTREGA } from "@/lib/tipos";
import { brl, brlOuGratis, dataHora, telefone } from "@/lib/formato";
import LogoProvedor from "./LogoProvedor";

// ---------------------------------------------------------------------------
// A corrida que já aconteceu, quando o pedido foi reenviado.
//
// Aparece embaixo das cotações: primeiro o atendente resolve o que fazer
// agora, depois consulta o que já foi feito. Vem fechada, porque na maioria
// das vezes basta saber que existiu e quanto custou.
//
// O corpo detalhado fica atrás de um acordeão de propósito. Aberto por padrão,
// empurraria as cotações para fora da tela justamente no momento em que a
// decisão é escolher a próxima corrida.
// ---------------------------------------------------------------------------

function Linha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-gray-500">{rotulo}</dt>
      <dd className="text-right text-gray-900">{children}</dd>
    </div>
  );
}

export default function UltimaEntrega({ entrega }: { entrega: EntregaAnterior }) {
  const [aberto, setAberto] = useState(false);

  const entregue = entrega.status === "delivered";
  const rotuloStatus = ROTULO_STATUS_ENTREGA[entrega.status] ?? entrega.status;

  // Resultado da corrida ANTERIOR. O reenvio é sempre custo extra: a loja paga
  // duas corridas e cobrou um frete só, então a segunda entrega nasce no
  // prejuízo. Mostrar aqui evita a surpresa no fim do mês.
  const saldo = Math.round((entrega.freteCobrado - entrega.valorPago) * 100) / 100;

  return (
    <section
      className={`mt-6 overflow-hidden rounded-xl border ${
        entregue ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-gray-50"
      }`}
    >
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={`flex w-full items-center gap-3 px-5 py-4 text-left transition ${
          entregue ? "hover:bg-emerald-100" : "hover:bg-gray-100"
        }`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            entregue ? "bg-emerald-200 text-emerald-800" : "bg-gray-200 text-gray-600"
          }`}
        >
          {entregue ? <IconeCheck /> : <IconeAlerta />}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`font-semibold ${
              entregue ? "text-emerald-900" : "text-gray-900"
            }`}
          >
            {/* A sequência responde "qual entrega é esta?" sem obrigar a abrir.
                Numa segunda tentativa, "1ª entrega" é mais claro que "anterior". */}
            {entrega.sequencia}ª entrega · {rotuloStatus}
          </p>
          <p
            className={`mt-0.5 truncate text-sm ${
              entregue ? "text-emerald-700" : "text-gray-500"
            }`}
          >
            {ROTULO_PROVEDOR[entrega.provider] ?? entrega.provider} ·{" "}
            {brlOuGratis(entrega.valorPago)} · {dataHora(entrega.dataCriacao)}
          </p>
        </div>

        <LogoProvedor provider={entrega.provider} tamanho={20} />

        <IconeChevron aberto={aberto} />
      </button>

      {aberto && (
        <div className="border-t border-gray-200 bg-white px-5 py-4">
          <dl className="divide-y divide-gray-100 text-sm">
            <Linha rotulo="Situação">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  COR_STATUS_ENTREGA[entrega.status] ??
                  "bg-gray-100 text-gray-700 ring-gray-300"
                }`}
              >
                {rotuloStatus}
              </span>
            </Linha>

            <Linha rotulo="Despachada em">{dataHora(entrega.dataCriacao)}</Linha>

            {entrega.statusAtualizadoEm && (
              <Linha rotulo="Última atualização">
                {dataHora(entrega.statusAtualizadoEm)}
              </Linha>
            )}

            {entrega.etaMinutos != null && (
              <Linha rotulo="Tempo estimado">{entrega.etaMinutos} min</Linha>
            )}

            <Linha rotulo="Custo da entrega">
              {brlOuGratis(entrega.valorPago)}
            </Linha>

            <Linha rotulo="Frete cobrado do cliente">
              {brlOuGratis(entrega.freteCobrado)}
            </Linha>

            <Linha rotulo="Resultado desta corrida">
              <span
                className={`font-semibold ${
                  saldo >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {saldo >= 0 ? "+" : "−"}
                {brl(Math.abs(saldo))}
              </span>
            </Linha>

            {entrega.courierNome && (
              <Linha rotulo="Entregador">
                {entrega.courierNome}
                {entrega.courierVeiculo && (
                  <span className="text-gray-500"> · {entrega.courierVeiculo}</span>
                )}
              </Linha>
            )}

            {entrega.courierTelefone && (
              <Linha rotulo="Telefone do entregador">
                <a
                  href={`tel:${entrega.courierTelefone}`}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  {telefone(entrega.courierTelefone)}
                </a>
              </Linha>
            )}

            {entrega.codigoEntrega && (
              <Linha rotulo="Código de entrega">
                <span className="font-mono font-bold tracking-[0.2em]">
                  {entrega.codigoEntrega}
                </span>
              </Linha>
            )}

            {entrega.despachadoPor && (
              <Linha rotulo="Despachada por">{entrega.despachadoPor}</Linha>
            )}
          </dl>

          {(entrega.trackingUrl || entrega.deliveryIdExterno) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
              {entrega.trackingUrl && (
                <a
                  href={entrega.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-emerald-700 hover:underline"
                >
                  Abrir rastreamento
                </a>
              )}
              {/* Só é consultado quando alguém abre chamado com o parceiro. */}
              {entrega.deliveryIdExterno && (
                <span className="break-all font-mono text-xs text-gray-400">
                  {entrega.deliveryIdExterno}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Ícones em SVG, não emoji: emoji muda de desenho conforme o sistema
// operacional e não herda a cor do texto.
function IconeCheck() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IconeAlerta() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M10 2.5a.9.9 0 0 1 .78.45l7.1 12.3a.9.9 0 0 1-.78 1.35H2.9a.9.9 0 0 1-.78-1.35l7.1-12.3A.9.9 0 0 1 10 2.5Zm0 4.6a.75.75 0 0 0-.75.79l.2 3.9a.55.55 0 0 0 1.1 0l.2-3.9A.75.75 0 0 0 10 7.1Zm0 6.1a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z" />
    </svg>
  );
}

function IconeChevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${
        aberto ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
  );
}
