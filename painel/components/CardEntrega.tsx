"use client";

import type { Despacho, EntregaAoVivo, PendenciasIfood } from "@/lib/tipos";
import { ROTULO_PROVEDOR, ROTULO_STATUS_ENTREGA } from "@/lib/tipos";
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

/**
 * Etapas do ciclo de vida, para quem tem rastreio.
 *
 * "A caminho da loja" é etapa própria: juntar com "Na loja" fazia a trilha
 * dizer "Na loja" com o entregador ainda do outro lado da cidade.
 */
const ETAPAS = [
  { rotulo: "Procurando", status: ["pending"] },
  { rotulo: "Indo à loja", status: ["pickup"] },
  { rotulo: "Na loja", status: ["at_pickup", "pickup_complete"] },
  { rotulo: "Saiu para entrega", status: ["dropoff"] },
  { rotulo: "Entregue", status: ["delivered"] },
];

/** "faltam 12 min" até o prazo. `faltam()` fala de chegada ("chegando"), não de prazo. */
function prazoRestante(iso: string): string {
  const min = Math.ceil((Date.parse(iso) - Date.now()) / 60000);
  return min <= 1 ? "falta menos de 1 min" : `faltam ${min} min`;
}

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
    <ol className="flex items-start" aria-label="Progresso da entrega">
      {ETAPAS.map((e, i) => {
        const feito = i < atual || (!ativo && i === atual);
        const agora = ativo && i === atual;

        return (
          <li key={e.rotulo} className="relative flex flex-1 flex-col items-center text-center">
            {/* Traço até a etapa anterior. Verde quando já foi cumprido; na
                etapa atual, a faixa clara varre o verde — "é aqui que estamos". */}
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-3 h-1 w-full -translate-y-1/2 overflow-hidden ${
                  i <= atual ? "bg-emerald-500" : "bg-gray-200"
                }`}
              >
                {agora && (
                  <span className="absolute inset-y-0 -left-full w-full bg-emerald-200/90 motion-safe:animate-[trilha_1.6s_ease-in-out_infinite]" />
                )}
              </span>
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                feito
                  ? "bg-emerald-500 text-white"
                  : agora
                    ? "bg-white text-emerald-700 ring-[3px] ring-emerald-500"
                    : "bg-white text-gray-400 ring-2 ring-gray-200"
              }`}
            >
              {feito ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 5 5 9-10" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span
              className={`mt-2 px-1 text-[11px] leading-tight sm:text-xs ${
                agora ? "font-semibold text-gray-900" : feito ? "text-gray-600" : "text-gray-400"
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

/** Iniciais do entregador para o avatar ("sandbox driver name" -> "SD"). */
function iniciais(nome: string): string {
  const p = nome.trim().split(/s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
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
  pendenciasIfood,
  respondendoEndereco,
  onResponderEndereco,
}: {
  despacho: Despacho;
  entrega: EntregaAoVivo | null;
  concluindo: boolean;
  onConcluir: (status: "delivered" | "canceled") => void;
  reenviando?: boolean;
  onReenviar?: () => void;
  cancelando?: boolean;
  onCancelar?: () => void;
  pendenciasIfood?: PendenciasIfood | null;
  respondendoEndereco?: boolean;
  onResponderEndereco?: (aceitar: boolean) => void;
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

  const emAndamento = !entregue && !cancelado;
  const mostraChegadaLoja =
    !!entrega?.pickupEta && emAndamento && (status === "pending" || status === "pickup");
  const mostraPrevisao = !!entrega?.dropoffEta && emAndamento;
  // O código que o iFood mandou no evento vale mais que o calculado no despacho.
  const codigoEntrega = pendenciasIfood?.codigoEntrega ?? despacho.codigoEntrega;
  const mostraCodigo = !!codigoEntrega && emAndamento;
  // CÓDIGO DE COLETA (iFood). Só até a coleta: depois, o pedido já saiu.
  const codigoColeta = pendenciasIfood?.codigoColeta ?? null;
  const mostraCodigoColeta =
    !!codigoColeta && emAndamento && ["pending", "pickup", "at_pickup"].includes(status);
  const mostraLink = !!link && emAndamento;
  const temPainelLateral =
    mostraChegadaLoja || mostraPrevisao || mostraCodigo || mostraCodigoColeta || mostraLink;
  const mudanca = emAndamento ? pendenciasIfood?.mudancaEndereco : undefined;
  const cancelarRotulo =
    despacho.provider === "ifood"
      ? "Cancelar corrida no iFood"
      : despacho.provider === "99"
        ? "Cancelar corrida na 99"
        : "Cancelar corrida no Uber";

  return (
    <section
      className={`mb-6 overflow-hidden rounded-xl border bg-white shadow-sm ${
        cancelado ? "border-red-200" : entregue ? "border-emerald-300" : "border-gray-200"
      }`}
    >
      {/* CABEÇALHO — quem leva e em que pé está. O título é o ESTADO, não
          "Entrega despachada", que é sempre verdade e não informa nada. */}
      <header
        className={`flex flex-wrap items-center gap-3 px-5 py-4 ${
          cancelado ? "bg-red-50" : entregue ? "bg-emerald-50" : "bg-gray-50/70"
        }`}
      >
        <LogoProvedor provider={despacho.provider} tamanho={36} />
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">
            {ROTULO_PROVEDOR[despacho.provider] ?? despacho.provider}
          </p>
          <h2
            className={`flex items-center gap-1.5 text-lg font-semibold leading-tight ${
              cancelado ? "text-red-800" : entregue ? "text-emerald-800" : "text-gray-900"
            }`}
          >
            {entregue && <IconeEntregue />}
            {cancelado && <IconeAlerta />}
            {rotulo}
          </h2>
        </div>

        {entrega?.liveMode === false && (
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            Ambiente de teste
          </span>
        )}
      </header>

      <div className="space-y-6 p-5">
        {/* MUDANÇA DE ENDEREÇO (iFood). Primeiro do card porque tem prazo: em
            15 minutos o iFood recusa sozinho, e o cliente fica sem resposta. */}
        {mudanca && onResponderEndereco && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="alert">
            <p className="text-sm font-semibold text-amber-900">
              O cliente pediu para mudar o endereço de entrega
            </p>
            <p className="mt-1 text-sm text-amber-900">
              {mudanca.novoEndereco ?? "O novo endereço aparece no rastreio do iFood."}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Responda até {hora(mudanca.prazo)} ({prazoRestante(mudanca.prazo)}). Depois disso
              o iFood recusa sozinho. O iFood só aceita até 500 m do endereço original.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => onResponderEndereco(true)}
                disabled={respondendoEndereco}
                className={`${BOTAO} bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50`}
              >
                {respondendoEndereco ? "Enviando..." : "Aceitar novo endereço"}
              </button>
              <button
                onClick={() => onResponderEndereco(false)}
                disabled={respondendoEndereco}
                className={`${BOTAO} border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50`}
              >
                Recusar
              </button>
            </div>
          </div>
        )}

        {temTrilha && <Trilha status={status} ativo={emAndamento} />}

        {(entrega?.courierNome || temPainelLateral || (emAndamento && !ehMotoboy)) && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* ENTREGADOR — quem vai parar na porta. */}
            {entrega?.courierNome ? (
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-medium text-gray-500">
                  Entregador
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white"
                  >
                    {iniciais(entrega.courierNome)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold capitalize text-gray-900">
                      {entrega.courierNome}
                    </p>
                    {entrega.courierVeiculo && (
                      <p className="text-sm text-gray-500">{entrega.courierVeiculo}</p>
                    )}
                  </div>
                </div>

                {(entrega.courierPlaca || entrega.courierTelefone) && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {/* PLACA. Duas motos pretas param na porta ao mesmo tempo, e o
                        balcão precisa saber qual é a do pedido. Monoespaçada e com
                        respiro: é lida de longe, pela janela. */}
                    {entrega.courierPlaca && (
                      <span
                        title="Placa do veículo"
                        className="inline-flex h-10 items-center rounded-lg border-2 border-gray-800 bg-white px-3 font-mono text-sm font-bold tracking-[0.18em] text-gray-900"
                      >
                        {entrega.courierPlaca}
                      </span>
                    )}
                    {entrega.courierTelefone && (
                      <a
                        href={`tel:${entrega.courierTelefone}`}
                        className={`${BOTAO} h-10 border border-gray-200 bg-white py-0 text-gray-700 hover:bg-gray-50`}
                      >
                        <IconeTelefone className="h-4 w-4 text-gray-400" />
                        {telefone(entrega.courierTelefone)}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : (
              emAndamento &&
              !ehMotoboy && (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  Aguardando um entregador aceitar a corrida.
                </div>
              )
            )}

            {temPainelLateral && (
              <div className="flex flex-col gap-4 rounded-xl border border-gray-200 p-4">
                {(mostraChegadaLoja || mostraPrevisao) && (
                  <dl className="grid grid-cols-2 gap-4">
                    {/* CHEGADA NA LOJA. Enquanto o entregador não chegou, é o
                        horário que a cozinha usa para decidir se embala agora. */}
                    {mostraChegadaLoja && (
                      <div>
                        <dt className="text-xs font-medium text-gray-500">
                          Chega na loja
                        </dt>
                        <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">
                          {hora(entrega!.pickupEta!)}
                        </dd>
                        <dd className="text-sm text-gray-500">{faltam(entrega!.pickupEta!)}</dd>
                      </div>
                    )}
                    {mostraPrevisao && (
                      <div>
                        <dt className="text-xs font-medium text-gray-500">
                          Previsão de entrega
                        </dt>
                        <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">
                          {hora(entrega!.dropoffEta!)}
                        </dd>
                        <dd className="text-sm text-gray-500">{faltam(entrega!.dropoffEta!)}</dd>
                      </div>
                    )}
                  </dl>
                )}

                {/* CÓDIGO DE ENTREGA. O entregador só fecha a entrega depois que o
                    cliente diz este número na porta. Grande e espaçado: é ditado
                    por telefone, e um dígito lido errado é entrega que não fecha. */}
                {mostraCodigo && (
                  <div
                    title="O cliente informa este número ao entregador na porta. Sem ele a entrega não é concluída."
                    className="flex items-center justify-between gap-3 rounded-lg bg-indigo-50 px-4 py-3 ring-1 ring-indigo-100"
                  >
                    <div>
                      <p className="text-xs font-medium text-indigo-600">
                        Código de entrega
                      </p>
                      <p className="text-xs text-indigo-400">O cliente informa na porta</p>
                    </div>
                    <span className="font-mono text-2xl font-bold tracking-[0.3em] text-indigo-900">
                      {codigoEntrega}
                    </span>
                  </div>
                )}

                {/* CÓDIGO DE COLETA. O entregador do iFood diz este número no
                    balcão; o pedido só sai se bater. A entrega só vira
                    "coletado" quando o iFood confirma a coleta pelo app dele. */}
                {mostraCodigoColeta && (
                  <div
                    title="O entregador informa este número no balcão. Só entregue o pedido se o código bater."
                    className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-amber-100"
                  >
                    <div>
                      <p className="text-xs font-medium text-amber-700">Código de coleta</p>
                      <p className="text-xs text-amber-500">O entregador informa no balcão</p>
                    </div>
                    <span className="font-mono text-2xl font-bold tracking-[0.3em] text-amber-900">
                      {codigoColeta}
                    </span>
                  </div>
                )}

                {/* Rastreio só enquanto a entrega está em andamento. */}
                {mostraLink && (
                  <a
                    href={link!}
                    target="_blank"
                    rel="noreferrer"
                    className={`${BOTAO} bg-emerald-600 text-white hover:bg-emerald-700`}
                  >
                    Acompanhar entrega
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Confirmação manual — só motoboy, que não tem webhook. */}
        {ehMotoboy && emAndamento && (
          <div className="rounded-xl bg-gray-50 p-4">
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

        {onReenviar && encerrada && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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

      {/* RODAPÉ — id técnico (só serve para suporte) e o cancelamento, discreto
          e longe dos botões de uso: é a ação que dá errado com clique acidental.
          Quem decide é o parceiro; depois da coleta ele recusa, e a mensagem
          que volta diz isso ao atendente. */}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
        <span>
          ID <span className="break-all font-mono text-gray-500">{despacho.deliveryId}</span>
        </span>
        {entrega?.statusAtualizadoEm && <span>atualizado às {hora(entrega.statusAtualizadoEm)}</span>}

        {onCancelar && !ehMotoboy && !encerrada && (
          <div className="ml-auto text-right">
            <button
              onClick={onCancelar}
              disabled={cancelando}
              className="text-sm font-medium text-red-700 underline-offset-2 transition hover:underline disabled:opacity-50"
            >
              {cancelando ? "Cancelando..." : cancelarRotulo}
            </button>
            {/* Cláusula 6.2 do contrato do Uber Direct: R$ 5,00 depois de o
                entregador chegar na loja. No iFood, o cancelamento com
                entregador designado veio marcado FRETE_PARCIAL (24/09/2026). */}
            {despacho.provider === "uber" && (
              <p className="mt-0.5">Após a chegada na loja, a Uber cobra R$ 5,00.</p>
            )}
            {despacho.provider === "ifood" && (
              <p className="mt-0.5">Com entregador designado, o iFood cobra parte do frete.</p>
            )}
          </div>
        )}
      </footer>
    </section>
  );
}
