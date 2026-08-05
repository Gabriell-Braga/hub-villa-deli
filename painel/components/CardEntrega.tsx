"use client";

import type { Despacho, EntregaAoVivo } from "@/lib/tipos";
import { ROTULO_STATUS_ENTREGA } from "@/lib/tipos";
import { faltam, hora, telefone } from "@/lib/formato";
import LogoProvedor from "./LogoProvedor";

// ---------------------------------------------------------------------------
// Card da entrega em andamento.
//
// A ordem é a das perguntas que o atendente responde ao telefone:
//   1. em que pé está?        -> status grande + trilha das etapas
//   2. chega que horas?       -> horário E quanto falta, em destaque
//   3. quem está levando?     -> nome e telefone, com o telefone clicável
//   4. onde acompanho?        -> botão
//   5. qual o código?         -> rodapé discreto, só serve para suporte
//
// Antes tudo isso era uma pilha de linhas com o mesmo peso, e a previsão de
// entrega — a informação mais pedida — ficava no meio, indistinguível do
// código da entrega.
// ---------------------------------------------------------------------------

/** Etapas do ciclo de vida, para quem tem rastreio por webhook. */
const ETAPAS = [
  { rotulo: "Procurando", status: ["pending"] },
  { rotulo: "Na loja", status: ["pickup", "pickup_complete"] },
  { rotulo: "A caminho", status: ["dropoff"] },
  { rotulo: "Entregue", status: ["delivered"] },
];

const ENCERRADO = ["delivered", "canceled", "returned"];

function etapaAtual(status: string | null): number {
  if (!status) return 0;
  const i = ETAPAS.findIndex((e) => e.status.includes(status));
  return i === -1 ? 0 : i;
}

function Trilha({ status }: { status: string }) {
  const atual = etapaAtual(status);

  return (
    <ol className="mt-4 flex items-center gap-1" aria-label="Progresso da entrega">
      {ETAPAS.map((e, i) => {
        const feito = i <= atual;
        return (
          <li key={e.rotulo} className="flex flex-1 flex-col gap-1.5">
            <span
              aria-hidden="true"
              className={`h-1.5 rounded-full transition ${
                feito ? "bg-emerald-500" : "bg-gray-200"
              }`}
            />
            <span
              className={`text-[11px] leading-tight ${
                i === atual ? "font-semibold text-gray-900" : "text-gray-400"
              }`}
            >
              {e.rotulo}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function CardEntrega({
  despacho,
  entrega,
  concluindo,
  onConcluir,
}: {
  despacho: Despacho;
  entrega: EntregaAoVivo | null;
  concluindo: boolean;
  onConcluir: (status: "delivered" | "canceled") => void;
}) {
  const status = entrega?.status ?? despacho.status;
  const rotulo = ROTULO_STATUS_ENTREGA[status] ?? status;
  const cancelado = status === "canceled" || status === "returned";
  const entregue = status === "delivered";
  const ehMotoboy = despacho.provider === "motoboy";

  // A trilha só faz sentido para quem manda status por webhook. O motoboy tem
  // dois estados (acionado -> entregue) e uma barra de 4 passos mentiria.
  const temTrilha = !ehMotoboy && !cancelado;
  const link = entrega?.trackingUrl ?? despacho.trackingUrl;

  return (
    <section
      className={`mb-6 overflow-hidden rounded-xl border bg-white ${
        cancelado ? "border-red-200" : entregue ? "border-emerald-300" : "border-gray-200"
      }`}
    >
      {/* Faixa de status — o título do card é o ESTADO, não "Entrega despachada",
          que é sempre verdade e não informa nada. */}
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 ${
          cancelado
            ? "bg-red-50"
            : entregue
            ? "bg-emerald-50"
            : "bg-gray-50"
        }`}
      >
        <span
          className={`text-base font-semibold ${
            cancelado ? "text-red-800" : entregue ? "text-emerald-800" : "text-gray-900"
          }`}
        >
          {entregue ? "✅ " : cancelado ? "⚠️ " : ""}
          {rotulo}
        </span>

        <span className="flex items-center gap-1.5 text-sm text-gray-500">
          <LogoProvedor provider={despacho.provider} tamanho={16} />
          via {despacho.provider === "motoboy" ? "motoboy próprio" : "parceiro"}
        </span>

        {entrega?.liveMode === false && (
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Ambiente de teste
          </span>
        )}
      </div>

      <div className="p-5">
        {temTrilha && <Trilha status={status} />}

        {/* Previsão e entregador lado a lado: as duas coisas que o cliente
            pergunta. */}
        <dl
          className={`grid gap-5 sm:grid-cols-2 ${temTrilha ? "mt-6" : ""}`}
        >
          {entrega?.dropoffEta && !entregue && !cancelado && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Previsão de entrega
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">
                {hora(entrega.dropoffEta)}
              </dd>
              <dd className="text-sm text-gray-500">{faltam(entrega.dropoffEta)}</dd>
            </div>
          )}

          {entrega?.courierNome && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Entregador
              </dt>
              <dd className="mt-0.5 font-medium text-gray-900">
                {entrega.courierNome}
              </dd>
              {entrega.courierVeiculo && (
                <dd className="text-sm text-gray-500">{entrega.courierVeiculo}</dd>
              )}
              {entrega.courierTelefone && (
                <dd className="mt-1.5">
                  <a
                    href={`tel:${entrega.courierTelefone}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <span aria-hidden="true">📞</span>
                    {telefone(entrega.courierTelefone)}
                  </a>
                </dd>
              )}
            </div>
          )}
        </dl>

        {/* Ações */}
        {link && !cancelado && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-700 sm:inline-block"
          >
            Acompanhar entrega
          </a>
        )}

        {/* Confirmação manual — só motoboy, que não tem webhook. */}
        {ehMotoboy && !entregue && !cancelado && (
          <div className="mt-5 rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">
              O motoboy já entregou este pedido?
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              O motoboy próprio não envia status automático — confirme aqui para
              o histórico ficar correto.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => onConcluir("delivered")}
                disabled={concluindo}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 sm:py-2"
              >
                {concluindo ? "Salvando..." : "Marcar como entregue"}
              </button>
              <button
                onClick={() => onConcluir("canceled")}
                disabled={concluindo}
                className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 sm:py-2"
              >
                Cancelar entrega
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Rodapé técnico: só é consultado quando alguém abre chamado. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-5 py-2.5 text-xs text-gray-400">
        <span className="break-all font-mono">{despacho.deliveryId}</span>
        {entrega?.statusAtualizadoEm && (
          <span>· atualizado às {hora(entrega.statusAtualizadoEm)}</span>
        )}
      </div>
    </section>
  );
}
