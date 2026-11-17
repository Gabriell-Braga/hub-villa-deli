"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  CotacaoResponse,
  Despacho,
  EntregaAoVivo,
  MotivoCancelamentoIfood,
  ProviderId,
} from "@/lib/tipos";
import ModalCancelamentoIfood from "@/components/ModalCancelamentoIfood";
import LogoProvedor from "@/components/LogoProvedor";
import CardEntrega from "@/components/CardEntrega";
import SeloTeste from "@/components/SeloTeste";
import SeloOrigem from "@/components/SeloOrigem";
import { IconeVoltar } from "@/components/Icones";
import ModalVeiculo, { type Veiculo } from "@/components/ModalVeiculo";
import UltimaEntrega from "@/components/UltimaEntrega";
import { useToast } from "@/components/Toast";
import { brl, brlOuGratis, dataHora } from "@/lib/formato";
import {
  Skeleton,
  SkeletonCartoesCotacao,
  SkeletonResumoPedido,
} from "@/components/Skeleton";
import { apiFetch } from "@/lib/api";

// De onde o atendente veio, para o botão Voltar devolver ao lugar certo.
//
// A origem vem na URL (`?de=`) e não de router.back(): o histórico do
// navegador quebra quando a pessoa recarrega a página, abre o link direto ou
// chega por um atalho — e aí "voltar" jogaria para fora do painel.
const ORIGENS = {
  historico: { href: "/historico", rotulo: "Voltar para o histórico" },
  abertos: { href: "/pedidos", rotulo: "Voltar para a fila" },
} as const;

/**
 * Quanto a loja ganha ou perde nesta entrega.
 *
 * O frete que o cliente pagou é definido pela tabela de raio do cardápio e já
 * foi cobrado — escolher Uber ou motoboy não muda um centavo para o cliente.
 * Muda só o custo. Por isso o número que decide a escolha não é o preço do
 * card, é a diferença; e é ele que fica colorido.
 */
function Resultado({
  cobrado,
  custo,
  reenvio,
}: {
  cobrado: number;
  custo: number;
  /** true = já houve uma corrida antes; o frete cobrado foi gasto nela. */
  reenvio: boolean;
}) {
  // NUM REENVIO NÃO HÁ RECEITA A CONSIDERAR.
  //
  // O cliente pagou o frete uma vez, e ele já foi consumido pela primeira
  // corrida. Continuar descontando o mesmo valor aqui mostraria "sobra R$ 0,00"
  // numa entrega que custa o preço cheio à loja — o card diria empate onde há
  // prejuízo, exatamente na hora de escolher quanto gastar.
  const receita = reenvio ? 0 : cobrado;
  const saldo = Math.round((receita - custo) * 100) / 100;
  const positivo = saldo >= 0;

  return (
    // Só o VALOR leva cor. A caixa inteira vermelha em quase todo card (é o
    // caso comum: frete grátis) gritava "erro" numa situação normal.
    <div className="mt-4 flex items-baseline justify-between gap-2 border-t border-gray-100 pt-3 text-xs">
      <span className="text-gray-500">
        {reenvio
          ? "Frete já cobrado na entrega anterior"
          : `Cliente pagou ${brlOuGratis(cobrado)} de frete`}
      </span>
      <span className={`whitespace-nowrap font-semibold ${positivo ? "text-emerald-700" : "text-red-700"}`}>
        {positivo ? "Sobra " : "Loja banca "}
        {brl(Math.abs(saldo))}
      </span>
    </div>
  );
}

const NOMES_APP: Partial<Record<ProviderId, string>> = {
  uber: "Uber",
  ifood: "iFood",
  "99": "99",
  lalamove: "Lalamove",
};
const nomeApp = (p: ProviderId) => NOMES_APP[p] ?? p;

export default function PaginaCotacao({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { de?: string };
}) {
  const idPedido = decodeURIComponent(params.id);
  const voltar =
    searchParams.de === "historico" ? ORIGENS.historico : ORIGENS.abertos;

  const [dados, setDados] = useState<CotacaoResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  /** Card em despacho: provider, ou provider:veiculo quando há um card por veículo. */
  const [despachando, setDespachando] = useState<string | null>(null);
  // Erro de CARREGAMENTO fica inline: some junto com o toast e a pessoa
  // ficaria sem entender por que a tela está vazia. Resultado de AÇÃO vai
  // para o toast.
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const toast = useToast();
  const [despacho, setDespacho] = useState<Despacho | null>(null);
  const [entrega, setEntrega] = useState<EntregaAoVivo | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  // Motivos de cancelamento do iFood. Não-null = janela de escolha aberta.
  const [motivosIfood, setMotivosIfood] = useState<MotivoCancelamentoIfood[] | null>(null);
  const [respondendoEndereco, setRespondendoEndereco] = useState(false);
  const [solicitandoEndereco, setSolicitandoEndereco] = useState(false);
  const [validandoColeta, setValidandoColeta] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  // Motivo pelo qual o servidor se recusou a cotar. Estado do pedido, não erro
  // de sistema — por isso não vai para o toast nem para o alerta vermelho.
  const [bloqueio, setBloqueio] = useState<"pagamento" | "cancelado" | "confirmacao" | null>(null);
  // Pedido que veio direto do iFood: confirmar e cancelar o PEDIDO (não a corrida).
  const [confirmandoPedido, setConfirmandoPedido] = useState(false);
  const [cancelandoPedido, setCancelandoPedido] = useState(false);
  const [motivosPedido, setMotivosPedido] = useState<MotivoCancelamentoIfood[] | null>(null);
  // Cotação que está esperando a escolha de veículo no modal. Só o Uber usa:
  // é o único parceiro em que declarar o volume muda quem vem buscar.
  // Cards marcados para pedir em vários apps ao mesmo tempo (chave do card).
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  // Modo "vários apps": os cards viram seleção e a ação fica na barra de baixo.
  // Separado do modo normal de propósito — os dois juntos no mesmo card
  // (Despachar + marcar) confundiam qual botão fazia o quê.
  const [modoVarios, setModoVarios] = useState(false);
  const [pedindoVeiculo, setPedindoVeiculo] = useState<{
    provider: ProviderId;
    nome: string;
  } | null>(null);

  // `silencioso` = a revalidação automática do acompanhamento. Ela NÃO mostra
  // o esqueleto de carregamento: trocar os cards por placeholder a cada 20 s,
  // para devolver os mesmos cards, fazia a tela piscar sem nada ter mudado.
  // E se falhar, mantém o que está na tela — uma oscilação de rede não pode
  // apagar o pedido diante do atendente.
  const cotar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) {
      setCarregando(true);
      setErroCarregar(null);
    }
    try {
      const res = await apiFetch(`/api/cotacao/${encodeURIComponent(idPedido)}`);
      const json = await res.json();

      if (!res.ok) {
        // A volta automática também lê a recusa: é ela que percebe que o
        // pedido foi confirmado ou cancelado por fora (Gestor de Pedidos,
        // cliente) enquanto a tela estava aberta.
        if (silencioso && !json.bloqueio) return;
        // Recusa por regra de negócio (não pago, cancelado) vem COM o pedido:
        // dá para manter o resumo na tela em vez de deixar o atendente diante
        // de uma página em branco com uma frase.
        if (json.bloqueio) {
          setDados(json);
          setBloqueio(json.bloqueio);
          setErroCarregar(null);
          return;
        }
        setDados(null);
        setErroCarregar(json.erro ?? `Erro ${res.status} ao cotar.`);
        return;
      }

      setBloqueio(null);
      setDados(json);
      // Espelha o servidor, inclusive quando ele diz que NÃO há despacho: depois
      // de "Solicitar outro envio" a corrida antiga deixa de ser a atual, e
      // manter o estado velho travava a tela em "Já despachado" até um F5.
      setDespacho(json.despacho ?? null);
      setEntrega(json.entrega ?? null);
    } catch {
      if (silencioso) return;
      setDados(null);
      setErroCarregar("Não foi possível falar com o servidor.");
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }, [idPedido]);

  async function despachar(
    provider: ProviderId,
    nome: string,
    veiculo?: Veiculo,
    prontoEmMin = 0
  ) {
    setDespachando(veiculo ? `${provider}:${veiculo}` : provider);
    try {
      const res = await apiFetch("/api/despachar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idPedido, provider, veiculo, prontoEmMin }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast.erro(json.erro ?? `Falha ao despachar (${res.status}).`);
        return;
      }

      setDespacho(json);
      toast.sucesso(
        json.jaDespachado
          ? "Este pedido já havia sido despachado. Nenhuma corrida nova foi criada."
          : `Despachado via ${nome}.`
      );
    } catch {
      toast.erro("Erro de rede ao despachar.");
    } finally {
      setDespachando(null);
      setPedindoVeiculo(null);
    }
  }

  // Pede em todos os apps marcados de uma vez. O primeiro que achar motorista
  // fica; o servidor cancela os outros sozinho.
  async function despacharVarios() {
    const opcoes = (dados?.cotacoes ?? [])
      .filter((c) => selecionadas.includes(c.veiculo ? `${c.provider}:${c.veiculo}` : c.provider))
      .map((c) => ({ provider: c.provider, veiculo: c.veiculo }));
    if (opcoes.length < 2) return;
    setDespachando("varios");
    try {
      const res = await apiFetch("/api/despachar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idPedido, opcoes }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.erro(json.erro ?? `Falha ao despachar (${res.status}).`);
        return;
      }
      setSelecionadas([]);
      setModoVarios(false);
      if (json.jaDespachado) {
        toast.sucesso("Este pedido já havia sido despachado. Nenhuma corrida nova foi criada.");
      } else if (json.falhas?.length) {
        toast.erro(`Pedido nos outros apps. Não deu em: ${json.falhas.join(" · ")}`);
      } else {
        toast.sucesso(`Procurando motorista em ${opcoes.length} apps ao mesmo tempo.`);
      }
      await cotar();
    } catch {
      toast.erro("Erro de rede ao despachar.");
    } finally {
      setDespachando(null);
    }
  }

  async function cancelarCorrida(codigoMotivo?: string) {
    setCancelando(true);
    try {
      const res = await apiFetch(
        `/api/entrega/${encodeURIComponent(idPedido)}/cancelar`,
        codigoMotivo
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ codigoMotivo }),
            }
          : { method: "POST" }
      );
      const json = await res.json();

      if (!res.ok) {
        // A recusa do Uber vira a mensagem: "o entregador já coletou" é o que
        // o atendente precisa saber para ligar para o cliente.
        toast.erro(json.erro ?? "Não foi possível cancelar.");
        return;
      }

      setMotivosIfood(null);
      toast.sucesso(
        despacho?.disputa
          ? "Corridas canceladas em todos os apps."
          : `Corrida cancelada ${despacho?.provider === "ifood" ? "no iFood" : despacho?.provider === "99" ? "na 99" : despacho?.provider === "lalamove" ? "na Lalamove" : "no Uber"}.`
      );
      await cotar();
    } catch {
      toast.erro("Erro de rede ao cancelar.");
    } finally {
      setCancelando(false);
    }
  }

  // No iFood o cancelamento pede motivo, e a lista vem do iFood na hora. Os
  // outros parceiros cancelam direto.
  async function pedirCancelamento() {
    // Em vários apps o servidor cancela todas, com motivo automático no iFood.
    if (despacho?.disputa || despacho?.provider !== "ifood") return cancelarCorrida();

    setCancelando(true);
    let json: { erro?: string; precisaMotivo?: boolean; motivos?: MotivoCancelamentoIfood[] };
    try {
      const res = await apiFetch(
        `/api/entrega/${encodeURIComponent(idPedido)}/ifood/motivos`
      );
      json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível consultar os motivos de cancelamento.");
        return;
      }
    } catch {
      toast.erro("Erro de rede ao consultar os motivos de cancelamento.");
      return;
    } finally {
      setCancelando(false);
    }

    // Entrega pedida com requestDriver: a rota cancela só o entregador e não
    // recebe motivo.
    if (!json.precisaMotivo) return cancelarCorrida();
    if (!json.motivos?.length) {
      toast.erro("O iFood não aceita mais cancelar esta entrega: o entregador provavelmente já coletou.");
      return;
    }
    setMotivosIfood(json.motivos);
  }

  async function responderEndereco(aceitar: boolean) {
    setRespondendoEndereco(true);
    try {
      const res = await apiFetch(
        `/api/entrega/${encodeURIComponent(idPedido)}/ifood/endereco`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aceitar }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível responder ao iFood.");
        return;
      }
      toast.sucesso(aceitar ? "Novo endereço aceito." : "Mudança de endereço recusada.");
      await cotar({ silencioso: true });
    } catch {
      toast.erro("Erro de rede ao responder ao iFood.");
    } finally {
      setRespondendoEndereco(false);
    }
  }

  async function solicitarEndereco(endereco: Record<string, string>): Promise<boolean> {
    setSolicitandoEndereco(true);
    try {
      const res = await apiFetch(
        `/api/entrega/${encodeURIComponent(idPedido)}/ifood/endereco/solicitar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(endereco),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "O iFood não aceitou o novo endereço.");
        return false;
      }
      toast.sucesso("Novo endereço enviado. Aguarde o iFood pedir a confirmação.");
      await cotar({ silencioso: true });
      return true;
    } catch {
      toast.erro("Erro de rede ao enviar o novo endereço.");
      return false;
    } finally {
      setSolicitandoEndereco(false);
    }
  }

  async function validarColeta(codigo: string) {
    setValidandoColeta(true);
    try {
      const res = await apiFetch(
        `/api/entrega/${encodeURIComponent(idPedido)}/ifood/coleta`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível conferir o código.");
        return;
      }
      toast.sucesso("Código confere. Pedido liberado para o entregador.");
      await cotar({ silencioso: true });
    } catch {
      toast.erro("Erro de rede ao conferir o código.");
    } finally {
      setValidandoColeta(false);
    }
  }

  async function confirmarPedido() {
    setConfirmandoPedido(true);
    try {
      const res = await apiFetch(`/api/pedido-ifood/${encodeURIComponent(idPedido)}/confirmar`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível confirmar o pedido no iFood.");
        return;
      }
      toast.sucesso("Pedido confirmado no iFood.");
      await cotar();
    } catch {
      toast.erro("Erro de rede ao confirmar o pedido.");
    } finally {
      setConfirmandoPedido(false);
    }
  }

  async function abrirCancelamentoPedido() {
    setCancelandoPedido(true);
    try {
      const res = await apiFetch(`/api/pedido-ifood/${encodeURIComponent(idPedido)}/motivos`);
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível consultar os motivos de cancelamento.");
        return;
      }
      if (!json.motivos?.length) {
        toast.erro("O iFood não aceita mais cancelar este pedido.");
        return;
      }
      setMotivosPedido(json.motivos);
    } catch {
      toast.erro("Erro de rede ao consultar os motivos de cancelamento.");
    } finally {
      setCancelandoPedido(false);
    }
  }

  async function cancelarPedido(codigoMotivo: string) {
    setCancelandoPedido(true);
    try {
      const res = await apiFetch(`/api/pedido-ifood/${encodeURIComponent(idPedido)}/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigoMotivo }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível cancelar o pedido.");
        return;
      }
      setMotivosPedido(null);
      toast.sucesso("Cancelamento enviado ao iFood. O pedido sai da fila quando ele confirmar.");
      await cotar({ silencioso: true });
    } catch {
      toast.erro("Erro de rede ao cancelar o pedido.");
    } finally {
      setCancelandoPedido(false);
    }
  }

  async function concluir(status: "delivered" | "canceled") {
    setConcluindo(true);
    try {
      const res = await apiFetch(
        `/api/entrega/${encodeURIComponent(idPedido)}/concluir`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const json = await res.json();

      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível salvar.");
        return;
      }

      toast.sucesso(
        status === "delivered"
          ? "Entrega confirmada. Já aparece no histórico."
          : "Entrega marcada como cancelada."
      );
      await cotar();
    } catch {
      toast.erro("Erro de rede ao salvar.");
    } finally {
      setConcluindo(false);
    }
  }

  async function reenviar() {
    setReenviando(true);
    try {
      const res = await apiFetch(`/api/entrega/${encodeURIComponent(idPedido)}/reenviar`, {
        method: "POST",
      });
      const json = await res.json();

      if (!res.ok) {
        toast.erro(json.erro ?? "Não foi possível solicitar outro envio.");
        return;
      }

      toast.sucesso("Outro envio preparado. O pedido voltou para cotação.");
      await cotar();
    } catch {
      toast.erro("Erro de rede ao solicitar outro envio.");
    } finally {
      setReenviando(false);
    }
  }

  useEffect(() => {
    cotar();
  }, [cotar]);

  // Depois de despachado, o status muda por webhook — sem aviso ao painel.
  // Enquanto a entrega não termina, revalida a cada 20 s.
  useEffect(() => {
    if (!despacho) return;
    const terminou =
      entrega?.status === "delivered" ||
      entrega?.status === "canceled" ||
      entrega?.status === "returned";
    if (terminou) return;

    const t = setInterval(() => cotar({ silencioso: true }), 20_000);
    return () => clearInterval(t);
  }, [despacho, entrega?.status, cotar]);

  // Pedido do iFood ainda sem corrida: revalida a cada 15 s para refletir o
  // que terceiros fizerem (confirmar no Gestor de Pedidos, cliente cancelar).
  const pedidoIfoodAberto =
    !!dados?.pedido?.daApiIfood && !despacho && dados?.pedido?.statusIfood !== "CANCELLED";
  useEffect(() => {
    if (!pedidoIfoodAberto) return;
    const t = setInterval(() => cotar({ silencioso: true }), 15_000);
    return () => clearInterval(t);
  }, [pedidoIfoodAberto, cotar]);

  const pedido = dados?.pedido;
  // Há uma corrida anterior guardada = este pedido está sendo reenviado. O
  // servidor só devolve `entregaAnterior` quando não existe despacho atual,
  // que é exatamente esse estado.
  const anterior = dados?.entregaAnterior ?? null;
  const ehReenvio = anterior !== null;
  // Cancelado ou não pago também travam a tela: o servidor recusa o despacho,
  // e deixar o botão ativo só produziria um erro depois do clique.
  const cancelado =
    bloqueio === "cancelado" ||
    /cancel/i.test(pedido?.statusCardapio ?? "") ||
    pedido?.statusIfood === "CANCELLED";
  // Fechado como "outra plataforma": saiu por fora do Hub.
  const porFora = !despacho && entrega?.provider === "outra";
  const travado = despacho !== null || bloqueio !== null || cancelado || porFora;
  const aguardandoConfirmacao =
    !!pedido?.daApiIfood && (pedido.statusIfood ?? "PLACED") === "PLACED";

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={voltar.href}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-900"
      >
        <IconeVoltar />
        {voltar.rotulo}
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Pedido #{idPedido}</h1>
            {pedido?.teste && <SeloTeste />}
            <SeloOrigem canal={pedido?.canal} numeroExterno={pedido?.numeroExterno} />
            {/* Junto do número do pedido, não no meio da tela: é a primeira
                coisa que se lê, e muda o significado de tudo o que vem depois. */}
            {anterior && (
              <span className="inline-flex items-center whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300">
                {anterior.sequencia + 1}º envio
              </span>
            )}
          </div>
          {pedido ? (
            <p className="mt-1 text-sm text-gray-500">
              {pedido.cliente.nome} · {pedido.endereco.bairro}, {pedido.endereco.cidade} ·
              recebido {dataHora(pedido.criadoEm)}
            </p>
          ) : (
            carregando && <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          )}
        </div>

        <button
          onClick={() => cotar()}
          disabled={carregando || travado}
          className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 sm:w-auto sm:py-2"
        >
          {carregando ? "Cotando..." : "Recotar"}
        </button>
      </header>

      {erroCarregar && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {erroCarregar}
        </div>
      )}

      {/* REENVIO: a conta muda, e a tela precisa dizer isso antes dos preços.
          Sem este aviso, um card marcado "Sobra R$ 0,00" passa por empate,
          quando na verdade a loja vai pagar a corrida inteira do próprio
          bolso — o frete do cliente já foi gasto na entrega anterior. */}
      {anterior && !travado && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <strong className="font-semibold">
            Este é o {anterior.sequencia + 1}º envio deste pedido.
          </strong>{" "}
          O frete de {brlOuGratis(pedido?.freteCobrado ?? 0)} já foi cobrado do
          cliente na {anterior.sequencia}ª entrega. Esta corrida sai por conta
          da loja, e o valor cheio entra como prejuízo no relatório.
        </div>
      )}

      {/* Estado do pedido, não erro de sistema: fica na tela, não é toast. O
          atendente pode chegar aqui muito depois de um aviso ter sumido, e o
          que ele precisa saber é POR QUE não dá para despachar. */}
      {cancelado && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <strong className="font-semibold">Pedido cancelado.</strong>{" "}
          {pedido?.daApiIfood
            ? "Este pedido foi cancelado no iFood."
            : "A loja cancelou este pedido no Cardápio Web."}{" "}
          Não acione entregador para ele.
        </div>
      )}

      {/* Status do PEDIDO no iFood, separado do status da corrida: o iFood
          fecha o pedido (CONCLUDED) por conta própria, e a loja precisa ver. */}
      {pedido?.daApiIfood && pedido.statusIfood === "CONCLUDED" && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <LogoProvedor provider="ifood" tamanho={24} />
          <span>
            <strong className="font-semibold">Pedido concluído no iFood.</strong> Status do
            pedido na plataforma: Concluído.
          </span>
        </div>
      )}

      {/* PEDIDO DIRETO DO iFOOD — confirmar e cancelar o pedido. Fica no topo:
          enquanto não for confirmado, não há corrida a escolher. */}
      {pedido?.daApiIfood && !cancelado && !despacho && (
        <div
          role="status"
          className={`mb-4 flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${
            aguardandoConfirmacao
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <LogoProvedor provider="ifood" tamanho={24} />
            {aguardandoConfirmacao ? (
              <span>
                <strong className="font-semibold">Pedido novo do iFood.</strong> Confira
                o endereço e os itens e confirme para liberar a entrega.
              </span>
            ) : (
              <span>
                <strong className="font-semibold">Pedido confirmado no iFood.</strong>{" "}
                Escolha a entrega abaixo.
              </span>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={abrirCancelamentoPedido}
              disabled={cancelandoPedido || confirmandoPedido}
              className="rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {cancelandoPedido ? "Aguarde..." : "Cancelar pedido"}
            </button>
            {aguardandoConfirmacao && (
              <button
                onClick={confirmarPedido}
                disabled={confirmandoPedido || cancelandoPedido}
                className="rounded-lg bg-[var(--marca-primaria)] px-4 py-2 text-sm font-semibold text-[var(--marca-contraste)] shadow-sm transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-50"
              >
                {confirmandoPedido ? "Confirmando..." : "Confirmar pedido"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Observação de entrega do cliente (iFood): em destaque, porque é
          instrução para quem entrega — portaria, ponto de referência, horário. */}
      {pedido?.observacaoEntrega && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="font-semibold">Observação de entrega:</strong>{" "}
          {pedido.observacaoEntrega}
        </div>
      )}

      {/* `!cancelado` porque os dois podem ser verdade ao mesmo tempo, e aí só
          o cancelamento importa: mandar esperar o pagamento de um pedido
          cancelado é mandar esperar por algo que não vem. */}
      {bloqueio === "pagamento" && !cancelado && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <strong className="font-semibold">Aguardando pagamento.</strong> Só
          cotamos depois que o Cardápio Web confirma o pagamento. Assim que ele
          confirmar, o pedido volta sozinho para a fila, ou clique em Recotar.
        </div>
      )}

      {porFora && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
        >
          <strong className="font-semibold">Entregue por fora do Hub.</strong> O pedido saiu para
          entrega por outra plataforma (ex.: pedido de entregador pelo Cardápio Web). Corrida
          que estivesse procurando motorista aqui foi cancelada.
        </div>
      )}

      {despacho?.disputa && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5 shadow-cartao">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Procurando motorista em {despacho.disputa.length} apps
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                O primeiro que achar motorista fica com a entrega; os outros são cancelados
                sozinhos. Se o pedido sair para entrega pelo Cardápio Web, todos são cancelados.
              </p>
            </div>
            <button
              onClick={pedirCancelamento}
              disabled={cancelando}
              className="rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {cancelando ? "Cancelando..." : "Cancelar todas"}
            </button>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {despacho.disputa.map((d) => {
              const st = dados?.disputa?.find((x) => x.deliveryId === d.deliveryId)?.status ?? d.status;
              const rotulo =
                st === "pending"
                  ? "Procurando motorista..."
                  : st === "canceled"
                  ? "Cancelada pelo app"
                  : st === "returned"
                  ? "Devolvida"
                  : "Motorista encontrado";
              return (
                <li
                  key={d.deliveryId}
                  className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                >
                  <LogoProvedor provider={d.provider} tamanho={24} />
                  <span className="font-medium text-gray-900">{nomeApp(d.provider)}</span>
                  <span className={`ml-auto text-xs ${st === "pending" ? "animate-pulse text-amber-700" : "text-gray-500"}`}>
                    {rotulo}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {despacho && !despacho.disputa && (
        <CardEntrega
          despacho={despacho}
          entrega={entrega}
          concluindo={concluindo}
          onConcluir={concluir}
          reenviando={reenviando}
          onReenviar={reenviar}
          cancelando={cancelando}
          onCancelar={pedirCancelamento}
          pendenciasIfood={dados?.pendenciasIfood ?? null}
          respondendoEndereco={respondendoEndereco}
          validandoColeta={validandoColeta}
          onValidarColeta={validarColeta}
          onResponderEndereco={responderEndereco}
          solicitandoEndereco={solicitandoEndereco}
          onSolicitarEndereco={solicitarEndereco}
          semTelefoneDoCliente={pedido?.semTelefoneDoCliente}
        />
      )}

      <ModalCancelamentoIfood
        alvo="pedido"
        motivos={motivosPedido}
        ocupado={cancelandoPedido}
        onFechar={() => setMotivosPedido(null)}
        onConfirmar={(codigo) => cancelarPedido(codigo)}
      />

      <ModalCancelamentoIfood
        motivos={motivosIfood}
        ocupado={cancelando}
        onFechar={() => setMotivosIfood(null)}
        onConfirmar={(codigo) => cancelarCorrida(codigo)}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Cotações */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Cotações</h2>
            {!travado && (dados?.cotacoes ?? []).length > 0 && (
              <div role="group" aria-label="Como pedir" className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
                {[
                  { varios: false, rotulo: "Um app" },
                  { varios: true, rotulo: "Vários apps" },
                ].map((o) => (
                  <button
                    key={o.rotulo}
                    type="button"
                    aria-pressed={modoVarios === o.varios}
                    onClick={() => {
                      setModoVarios(o.varios);
                      setSelecionadas([]);
                    }}
                    className={`rounded-md px-3 py-1.5 font-medium transition ${
                      modoVarios === o.varios
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {o.rotulo}
                  </button>
                ))}
              </div>
            )}
          </div>

          {modoVarios && !travado && (
            <p className="mb-3 text-sm text-gray-500">
              Escolha os apps. O primeiro que achar motorista fica com a entrega, e os outros são
              cancelados sozinhos.
            </p>
          )}

          {carregando ? (
            <SkeletonCartoesCotacao />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(dados?.cotacoes ?? []).map((c) => {
                // Vem ordenado: o primeiro disponível é o mais barato. Por
                // objeto, não por provider — a Lalamove tem dois cards.
                const barato = dados?.cotacoes.find((x) => x.disponivel) === c && !travado;
                const chave = c.veiculo ? `${c.provider}:${c.veiculo}` : c.provider;
                const selecionada = modoVarios && selecionadas.includes(chave);
                // O motoboy não entra: não dá para cancelá-lo sozinho quando
                // outro app achar motorista.
                const foraDoModo = modoVarios && c.provider === "motoboy";

                return (
                  // flex-col + o mt-auto no rodapé mantêm o botão na mesma
                  // altura em todos os cards. Sem isso, um provedor que tem
                  // linha de detalhe (o motoboy mostra a faixa de raio) empurra
                  // o próprio botão para baixo e a fileira fica desalinhada.
                  <div
                    key={chave}
                    className={`flex flex-col rounded-xl border bg-white p-5 shadow-cartao transition ${
                      selecionada
                        ? "border-[var(--marca-primaria)] ring-2 ring-[var(--marca-primaria)]"
                        : barato && !modoVarios
                        ? "border-gray-900 ring-1 ring-gray-900"
                        : "border-gray-200"
                    } ${!c.disponivel ? "bg-gray-50/60 shadow-none" : ""} ${travado || foraDoModo ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <LogoProvedor provider={c.provider} tamanho={28} />
                        <span className="truncate font-medium text-gray-900">
                          {c.nome}
                        </span>
                      </div>
                      {barato && (
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          Mais barato
                        </span>
                      )}
                    </div>

                    {c.disponivel ? (
                      <>
                        <div className="mt-4 flex items-end justify-between">
                          <div>
                            <p className="text-xs text-gray-500">
                              Custo da entrega
                            </p>
                            <span className="mt-0.5 block text-[26px] font-semibold leading-tight tracking-tight text-gray-900">
                              {brlOuGratis(c.preco)}
                            </span>
                          </div>
                          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                            {c.etaMinutos ? `~${c.etaMinutos} min` : "ETA n/d"}
                          </span>
                        </div>

                        {c.detalhe && (
                          <p className="mt-1 text-xs text-gray-400">{c.detalhe}</p>
                        )}

                        {/* O que muda de um card para o outro NÃO é o preço do
                            pedido — é quanto sobra para a loja. É essa a
                            comparação que o atendente precisa fazer. */}
                        <Resultado
                          reenvio={ehReenvio}
                          cobrado={pedido?.freteCobrado ?? 0}
                          custo={c.preco ?? 0}
                        />

                        <div className="mt-auto pt-4">
                          {modoVarios && !travado ? (
                            // Mesmo lugar e mesmo tamanho do Despachar: o card
                            // não muda de forma, só o que o botão faz.
                            <button
                              type="button"
                              aria-pressed={selecionada}
                              disabled={foraDoModo || despachando !== null}
                              onClick={() =>
                                // Um card por app: marcar o carro da Lalamove
                                // desmarca a moto.
                                setSelecionadas((atual) => {
                                  const sem = atual.filter((k) => k.split(":")[0] !== c.provider);
                                  return selecionada ? sem : [...sem, chave];
                                })
                              }
                              className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition disabled:cursor-not-allowed ${
                                selecionada
                                  ? "bg-[var(--marca-primaria)] text-[var(--marca-contraste)] shadow-sm hover:bg-[var(--marca-primaria-hover)]"
                                  : "border border-gray-300 bg-white text-gray-800 hover:border-gray-900"
                              }`}
                            >
                              {foraDoModo ? (
                                "Não entra em vários apps"
                              ) : selecionada ? (
                                <>
                                  <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                                  </svg>
                                  Incluído
                                </>
                              ) : (
                                "Incluir"
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                // Só o Uber pergunta o veículo. Nos outros a
                                // escolha não existe, e um modal a mais entre o
                                // clique e a corrida seria só atrito.
                                c.provider === "uber"
                                  ? setPedindoVeiculo({ provider: c.provider, nome: c.nome })
                                  : despachar(c.provider, c.nome, c.veiculo)
                              }
                              disabled={despachando !== null || travado}
                              className="w-full rounded-lg bg-[var(--marca-primaria)] py-2.5 text-sm font-medium text-[var(--marca-contraste)] shadow-sm transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-50"
                            >
                              {despachando === chave
                                ? "Despachando..."
                                : travado
                                ? "Já despachado"
                                : "Despachar"}
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-4 text-sm font-medium text-gray-700">Indisponível</p>
                        {c.erro && <p className="mt-0.5 text-sm text-gray-500">{c.erro}</p>}
                        {/* A distância também aparece na recusa: sem ela,
                            "fora da área de cobertura" não diz se faltaram
                            200 metros ou 3 km. */}
                        {c.detalhe && (
                          <p className="mt-1 text-xs text-gray-400">{c.detalhe}</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Ação do modo "vários apps": presa no rodapé da tela, para estar à
              mão em qualquer ponto da lista, e dizendo o que vai acontecer. */}
          {modoVarios && !travado && !carregando && (
            <div className="sticky bottom-4 z-10 mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {selecionadas.length > 0 && (
                  <div className="flex shrink-0 -space-x-1.5">
                    {selecionadas.map((k) => (
                      <span key={k} className="rounded-md ring-2 ring-white">
                        <LogoProvedor provider={k.split(":")[0] as ProviderId} tamanho={24} />
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm text-gray-700">
                  {selecionadas.length === 0
                    ? "Nenhum app escolhido."
                    : selecionadas.length === 1
                    ? "Escolha mais um app."
                    : `${selecionadas.length} apps vão procurar motorista ao mesmo tempo.`}
                </p>
              </div>
              <button
                onClick={despacharVarios}
                disabled={selecionadas.length < 2 || despachando !== null}
                className="shrink-0 rounded-lg bg-[var(--marca-primaria)] px-4 py-2.5 text-sm font-semibold text-[var(--marca-contraste)] shadow-sm transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-50"
              >
                {despachando === "varios"
                  ? "Pedindo..."
                  : selecionadas.length < 2
                  ? "Pedir em vários apps"
                  : `Pedir nos ${selecionadas.length} apps`}
              </button>
            </div>
          )}

          {!carregando &&
            (dados?.cotacoes?.length ?? 0) === 0 &&
            !erroCarregar &&
            !bloqueio && (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-cartao">
                Nenhuma cotação disponível para este endereço no momento.
              </div>
            )}

          {/* Detalhes da última entrega (quando há reenvio) */}
          {dados?.entregaAnterior && (
            <UltimaEntrega entrega={dados.entregaAnterior} />
          )}
        </section>

        {/* Resumo do pedido */}
        {!pedido && carregando && <SkeletonResumoPedido />}

        {pedido && (
          <aside className="rounded-xl border border-gray-200 bg-white p-5 shadow-cartao">
            <h2 className="text-sm font-semibold text-gray-900">
              Entrega
            </h2>

            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Cliente</dt>
                <dd className="text-gray-900">{pedido.cliente.nome}</dd>
                {/* Pedido de marketplace não traz o contato do cliente. O
                    telefone da loja continua indo para a transportadora, que
                    exige um número para criar a corrida, mas não aparece aqui:
                    exibi-lo faria alguém ligar para o próprio restaurante
                    achando que falava com o cliente. Não mostrar diz a verdade
                    com menos palavras que um aviso explicando o engano. */}
                {!pedido.semTelefoneDoCliente && (
                  <dd className="text-gray-500">{pedido.cliente.telefone}</dd>
                )}
              </div>

              <div>
                <dt className="text-gray-500">Endereço</dt>
                <dd className="text-gray-900">
                  {pedido.endereco.logradouro}, {pedido.endereco.numero}
                  {pedido.endereco.complemento ? `, ${pedido.endereco.complemento}` : ""}
                </dd>
                <dd className="text-gray-500">
                  {pedido.endereco.bairro} · {pedido.endereco.cidade}/{pedido.endereco.uf}
                </dd>
                <dd className="text-gray-500">CEP {pedido.endereco.cep}</dd>
              </div>

              <div>
                <dt className="text-gray-500">Itens</dt>
                <dd>
                  <ul className="mt-1 space-y-1">
                    {pedido.itens.map((i, idx) => (
                      <li key={idx} className="flex justify-between text-gray-900">
                        <span>
                          {i.quantidade}× {i.nome}
                        </span>
                        <span className="text-gray-500">{brlOuGratis(i.preco)}</span>
                      </li>
                    ))}
                    {pedido.itens.length === 0 && (
                      <li className="text-gray-400">Sem itens no payload</li>
                    )}
                  </ul>
                </dd>
              </div>

              {/* A soma tem que fechar na tela.
                  Antes só aparecia "Total do pedido", que já inclui o frete —
                  e como a lista de itens não inclui, os números não batiam e
                  parecia erro. Agora as três linhas fecham a conta. */}
              <div className="space-y-1.5 border-t border-gray-100 pt-3">
                <div className="flex justify-between text-gray-600">
                  <span>Produtos</span>
                  <span>{brl(pedido.subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Frete pago pelo cliente</span>
                  <span>{brlOuGratis(pedido.freteCobrado)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-1.5 font-medium text-gray-900">
                  <span>Total do pedido</span>
                  <span>{brl(pedido.total)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Pagamento</dt>
                <dd className="flex items-center gap-2">
                  {pedido.formaPagamento && (
                    <span className="text-gray-900">{pedido.formaPagamento}</span>
                  )}
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      pedido.pago
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-amber-50 text-amber-800 ring-amber-300"
                    }`}
                  >
                    {pedido.pago ? "Pago" : "Aguardando"}
                  </span>
                </dd>
              </div>

              {(dados?.pendenciasIfood?.codigoColeta ?? pedido.codigoColeta) && (
                <div>
                  <dt className="text-gray-500">Código de coleta (pickupCode)</dt>
                  <dd className="font-mono text-base font-semibold tracking-widest text-gray-900">
                    {dados?.pendenciasIfood?.codigoColeta ?? pedido.codigoColeta}
                  </dd>
                  <dd className="text-xs text-gray-500">
                    Confira pelo campo no card da entrega, digitando o que o entregador informar.
                  </dd>
                </div>
              )}


              {pedido.observacao && (
                <div>
                  <dt className="text-gray-500">Observação</dt>
                  <dd className="text-gray-900">{pedido.observacao}</dd>
                </div>
              )}
            </dl>
          </aside>
        )}
      </div>

      <ModalVeiculo
        aberto={pedindoVeiculo !== null}
        ocupado={despachando !== null}
        onCancelar={() => setPedindoVeiculo(null)}
        onConfirmar={(veiculo, prontoEmMin) =>
          pedindoVeiculo &&
          despachar(
            pedindoVeiculo.provider,
            pedindoVeiculo.nome,
            veiculo,
            prontoEmMin
          )
        }
      />
    </div>
  );
}
