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

/** Base comum dos botões do card, para todos terem a mesma altura. */
const BOTAO =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition";

// Ícones em SVG, não emoji: emoji muda de desenho conforme o sistema
// operacional, não herda a cor do texto e destoa num painel de operação.
const icone = (d: string, className: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const IconeTelefone = ({ className = "h-4 w-4" }: { className?: string }) =>
  icone(
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
    className
  );

const IconeEntregue = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <path d="m9 11 3 3L22 4" />
  </svg>
);

const IconeAlerta = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

function etapaAtual(status: string | null): number {
  if (!status) return 0;
  const i = ETAPAS.findIndex((e) => e.status.includes(status));
  return i === -1 ? 0 : i;
}

/**
 * Trilha de progresso da entrega.
 *
 * A barra da etapa ATUAL enche e esvazia continuamente. Sem isso, "etapa
 * cumprida" e "etapa acontecendo agora" eram os dois um retângulo verde
 * parado, e a única diferença era o negrito no rótulo — some no olhar rápido
 * de quem está atrás do balcão. O movimento diz "é aqui que estamos".
 *
 * A animação é uma faixa clara varrendo o verde, e não opacidade piscando:
 * piscar cansa numa tela que fica aberta o turno inteiro.
 *
 * Só a etapa atual anda. Quando a entrega termina ou é cancelada não há etapa
 * "em andamento", e aí nada se move — ver `ativo`.
 */
function Trilha({ status, ativo }: { status: string; ativo: boolean }) {
  const atual = etapaAtual(status);

  return (
    <ol className="mt-4 flex items-center gap-1" aria-label="Progresso da entrega">
      {ETAPAS.map((e, i) => {
        const feito = i <= atual;
        const andando = ativo && i === atual;

        return (
          <li key={e.rotulo} className="flex flex-1 flex-col gap-1.5">
            <span
              aria-hidden="true"
              className={`relative h-1.5 overflow-hidden rounded-full transition ${
                feito ? "bg-emerald-500" : "bg-gray-200"
              }`}
            >
              {andando && (
                <span className="absolute inset-y-0 -left-full w-full bg-emerald-200/90 motion-safe:animate-[trilha_1.6s_ease-in-out_infinite]" />
              )}
            </span>
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
  reenviando,
  onReenviar,
  cancelando,
  onCancelar,
}: {
  despacho: Despacho;
  entrega: EntregaAoVivo | null;
  concluindo: boolean;
  onConcluir: (status: "delivered" | "canceled") => void;
  reenviando?: boolean;
  onReenviar?: () => void;
  cancelando?: boolean;
  onCancelar?: () => void;
}) {
  const status = entrega?.status ?? despacho.status;
  const rotulo = ROTULO_STATUS_ENTREGA[status] ?? status;
  const cancelado = status === "canceled" || status === "returned";
  const entregue = status === "delivered";
  const encerrada = entregue || cancelado;
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
          className={`flex items-center gap-2 text-base font-semibold ${
            cancelado ? "text-red-800" : entregue ? "text-emerald-800" : "text-gray-900"
          }`}
        >
          {entregue && <IconeEntregue />}
          {cancelado && <IconeAlerta />}
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
        {temTrilha && <Trilha status={status} ativo={!entregue && !cancelado} />}

        {/* LINHA DE DADOS.
            Sem col-start fixo: o primeiro bloco existente ocupa a coluna da
            esquerda. Enquanto a Uber ainda procura entregador, a previsão é a
            única informação que existe e fica à esquerda, encostada no início
            da leitura. Quando o entregador aparece, ele assume a esquerda e a
            previsão vai para a direita — que é a ordem pedida. */}
        <dl className={`grid gap-5 sm:grid-cols-2 ${temTrilha ? "mt-6" : ""}`}>
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
              {/* PLACA. Duas motos pretas param na porta ao mesmo tempo, e o
                  balcão precisa saber qual é a do pedido. Monoespaçada e com
                  respiro entre os caracteres: é lida de longe, pela janela. */}
              {entrega.courierPlaca && (
                <dd className="mt-1">
                  <span className="inline-flex rounded border border-gray-300 bg-gray-50 px-2 py-0.5 font-mono text-sm font-bold tracking-[0.15em] text-gray-800">
                    {entrega.courierPlaca}
                  </span>
                </dd>
              )}
              {entrega.courierTelefone && (
                <dd className="mt-2">
                  {/* Mesma altura do "Acompanhar entrega" (BOTAO): dois botões
                      vizinhos com alturas diferentes ficam desalinhados. */}
                  <a
                    href={`tel:${entrega.courierTelefone}`}
                    className={`${BOTAO} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                  >
                    <IconeTelefone className="h-4 w-4 text-gray-400" />
                    {telefone(entrega.courierTelefone)}
                  </a>
                </dd>
              )}
            </div>
          )}

          {/* CHEGADA NA LOJA. Vem antes da previsão de entrega de propósito:
              enquanto o entregador não coletou, é este o horário que importa
              para a cozinha decidir se embala agora ou espera. Some depois da
              coleta, quando vira informação do passado. */}
          {entrega?.pickupEta && !entregue && !cancelado && status !== "pickup_complete" && status !== "dropoff" && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Chega na loja
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">
                {hora(entrega.pickupEta)}
              </dd>
              <dd className="text-sm text-gray-500">{faltam(entrega.pickupEta)}</dd>
            </div>
          )}

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
        </dl>

        {/* LINHA DE AÇÕES — o que o atendente USA fica junto, numa faixa só.
            O código andava solto no meio do card e o botão sozinho lá embaixo,
            com um vão entre os dois. Agrupados, o olho encontra os dois de uma
            vez, e nenhum deles muda de lugar quando o entregador é atribuído. */}
        {((link && !cancelado && !entregue) ||
          (despacho.codigoEntrega && !entregue && !cancelado)) && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {/* Rastreio só enquanto a entrega está em andamento: depois de
                entregue ou cancelada não há o que acompanhar, e o botão verde
                grande sugeria que ainda havia. */}
            {link && !cancelado && !entregue && (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className={`${BOTAO} bg-emerald-600 text-white hover:bg-emerald-700`}
              >
                Acompanhar entrega
              </a>
            )}

            {/* CÓDIGO DE ENTREGA. O entregador só fecha a entrega depois que o
                cliente diz este número na porta — é o que impede o pedido de
                ser deixado com a pessoa errada.

                Monoespaçado e com respiro entre os dígitos: é um número que o
                atendente dita por telefone, e 5499 lido errado é uma entrega
                que não fecha. Some quando a entrega termina; aí já não protege
                nada e só atrapalha quem lê o histórico. */}
            {despacho.codigoEntrega && !entregue && !cancelado && (
              <span
                title="O cliente informa este número ao entregador na porta. Sem ele a entrega não é concluída."
                className={`${BOTAO} border border-indigo-200 bg-indigo-50`}
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-indigo-500">
                  Código
                </span>
                {/* leading-5 casa a altura da linha com a do botão ao lado,
                    que é text-sm. Sem isso o número maior estica a caixa e os
                    dois ficam com alturas diferentes na mesma fileira. */}
                <span className="font-mono text-base font-bold leading-5 tracking-[0.2em] text-indigo-900">
                  {despacho.codigoEntrega}
                </span>
              </span>
            )}
          </div>
        )}

        {/* CANCELAR A CORRIDA.
            Discreto e à parte dos outros botões: é a ação que dá errado com um
            clique acidental. E some assim que a entrega encerra, porque aí não
            há o que cancelar.

            Quem decide é o Uber. Depois da coleta ele recusa, e a mensagem que
            volta diz isso ao atendente em vez de fingir que funcionou. */}
        {onCancelar && !ehMotoboy && !encerrada && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <button
              onClick={onCancelar}
              disabled={cancelando}
              className="text-sm font-medium text-red-700 underline-offset-2 transition hover:underline disabled:opacity-50"
            >
              {cancelando ? "Cancelando..." : "Cancelar esta corrida no Uber"}
            </button>
            {/* CANCELAR PODE CUSTAR DINHEIRO.
                Cláusula 6.2 do contrato brasileiro do Uber Direct: R$ 5,00 se o
                cancelamento acontecer depois de o entregador chegar na loja. O
                atendente decide melhor sabendo disso — e o custo aparece na
                fatura de qualquer forma, então esconder só adiaria a surpresa. */}
            <p className="mt-1.5 text-xs text-gray-500">
              Se o entregador já tiver chegado na loja, a Uber cobra R$ 5,00 de
              taxa de cancelamento.
            </p>
          </div>
        )}

        {/* Confirmação manual — só motoboy, que não tem webhook. */}
        {ehMotoboy && !entregue && !cancelado && (
          <div className="mt-5 rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">
              O motoboy já entregou este pedido?
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              O motoboy próprio não envia status automático. Confirme aqui para
              o histórico ficar correto.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => onConcluir("delivered")}
                disabled={concluindo}
                className={`${BOTAO} bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50`}
              >
                {concluindo ? "Salvando..." : "Marcar como entregue"}
              </button>
              <button
                onClick={() => onConcluir("canceled")}
                disabled={concluindo}
                className={`${BOTAO} border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50`}
              >
                Cancelar entrega
              </button>
            </div>
          </div>
        )}

        {onReenviar && (entregue || cancelado) && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-amber-900">
                  Precisou mandar outro envio?
                </p>
                <p className="mt-0.5 text-xs text-amber-700">
                  Libera este pedido para uma nova cotação e despacho, caso tenha
                  faltado algo na entrega anterior.
                </p>
              </div>
              <button
                onClick={onReenviar}
                disabled={reenviando}
                className={`${BOTAO} border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-50`}
              >
                {reenviando ? "Solicitando..." : "Solicitar outro envio"}
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
