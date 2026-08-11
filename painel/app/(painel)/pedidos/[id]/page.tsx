"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  CotacaoResponse,
  Despacho,
  EntregaAoVivo,
  ProviderId,
} from "@/lib/tipos";
import LogoProvedor from "@/components/LogoProvedor";
import CardEntrega from "@/components/CardEntrega";
import SeloTeste from "@/components/SeloTeste";
import SeloOrigem from "@/components/SeloOrigem";
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
function Resultado({ cobrado, custo }: { cobrado: number; custo: number }) {
  const saldo = Math.round((cobrado - custo) * 100) / 100;
  const positivo = saldo >= 0;

  return (
    <div
      className={`mt-3 rounded-lg px-3 py-2 text-xs ${
        positivo ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
      }`}
    >
      <span className="font-semibold">
        {positivo ? "Sobra " : "A loja banca "}
        {brl(Math.abs(saldo))}
      </span>
      <span className="opacity-75">
        {" "}
        · cliente pagou {brlOuGratis(cobrado)} de frete
      </span>
    </div>
  );
}

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
  const [despachando, setDespachando] = useState<ProviderId | null>(null);
  // Erro de CARREGAMENTO fica inline: some junto com o toast e a pessoa
  // ficaria sem entender por que a tela está vazia. Resultado de AÇÃO vai
  // para o toast.
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const toast = useToast();
  const [despacho, setDespacho] = useState<Despacho | null>(null);
  const [entrega, setEntrega] = useState<EntregaAoVivo | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  // Motivo pelo qual o servidor se recusou a cotar. Estado do pedido, não erro
  // de sistema — por isso não vai para o toast nem para o alerta vermelho.
  const [bloqueio, setBloqueio] = useState<"pagamento" | "cancelado" | null>(null);
  // Cotação que está esperando a escolha de veículo no modal. Só o Uber usa:
  // é o único parceiro em que declarar o volume muda quem vem buscar.
  const [pedindoVeiculo, setPedindoVeiculo] = useState<{
    provider: ProviderId;
    nome: string;
  } | null>(null);

  const cotar = useCallback(async () => {
    setCarregando(true);
    setErroCarregar(null);
    try {
      const res = await apiFetch(`/api/cotacao/${encodeURIComponent(idPedido)}`);
      const json = await res.json();

      if (!res.ok) {
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
      if (json.despacho) setDespacho(json.despacho);
      setEntrega(json.entrega ?? null);
    } catch {
      setDados(null);
      setErroCarregar("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [idPedido]);

  async function despachar(provider: ProviderId, nome: string, veiculo?: Veiculo) {
    setDespachando(provider);
    try {
      const res = await apiFetch("/api/despachar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idPedido, provider, veiculo }),
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

    const t = setInterval(cotar, 20_000);
    return () => clearInterval(t);
  }, [despacho, entrega?.status, cotar]);

  const pedido = dados?.pedido;
  // Cancelado ou não pago também travam a tela: o servidor recusa o despacho,
  // e deixar o botão ativo só produziria um erro depois do clique.
  const cancelado = bloqueio === "cancelado" || /cancel/i.test(pedido?.statusCardapio ?? "");
  const travado = despacho !== null || bloqueio !== null || cancelado;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={voltar.href}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-900"
      >
        ← {voltar.rotulo}
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold text-gray-900">Pedido #{idPedido}</h1>
            {pedido?.teste && <SeloTeste />}
            <SeloOrigem canal={pedido?.canal} numeroExterno={pedido?.numeroExterno} />
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
          onClick={cotar}
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

      {/* Estado do pedido, não erro de sistema: fica na tela, não é toast. O
          atendente pode chegar aqui muito depois de um aviso ter sumido, e o
          que ele precisa saber é POR QUE não dá para despachar. */}
      {cancelado && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <strong className="font-semibold">Pedido cancelado.</strong> A loja
          cancelou este pedido no Cardápio Web. Não acione entregador para ele.
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

      {despacho && (
        <CardEntrega
          despacho={despacho}
          entrega={entrega}
          concluindo={concluindo}
          onConcluir={concluir}
          reenviando={reenviando}
          onReenviar={reenviar}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Cotações */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Cotações
          </h2>

          {carregando ? (
            <SkeletonCartoesCotacao />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(dados?.cotacoes ?? []).map((c) => {
                const barato = dados?.maisBarato === c.provider && !travado;

                return (
                  // flex-col + o mt-auto no rodapé mantêm o botão na mesma
                  // altura em todos os cards. Sem isso, um provedor que tem
                  // linha de detalhe (o motoboy mostra a faixa de raio) empurra
                  // o próprio botão para baixo e a fileira fica desalinhada.
                  <div
                    key={c.provider}
                    className={`flex flex-col rounded-xl border bg-white p-5 transition ${
                      barato ? "border-[var(--marca-primaria)] ring-2 ring-gray-200" : "border-gray-200"
                    } ${!c.disponivel || travado ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <LogoProvedor provider={c.provider} tamanho={28} />
                        <span className="truncate font-medium text-gray-900">
                          {c.nome}
                        </span>
                      </div>
                      {barato && (
                        <span className="rounded-full bg-[var(--marca-primaria)] px-2 py-0.5 text-xs font-semibold text-[var(--marca-contraste)]">
                          Mais barato
                        </span>
                      )}
                    </div>

                    {c.disponivel ? (
                      <>
                        <div className="mt-4 flex items-end justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-400">
                              Custo da entrega
                            </p>
                            <span className="text-2xl font-semibold tracking-tight text-gray-900">
                              {brlOuGratis(c.preco)}
                            </span>
                          </div>
                          <span className="text-sm text-gray-500">
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
                          cobrado={pedido?.freteCobrado ?? 0}
                          custo={c.preco ?? 0}
                        />

                        <div className="mt-auto pt-4">
                          <button
                            onClick={() =>
                              // Só o Uber pergunta o veículo. Nos outros a
                              // escolha não existe, e um modal a mais entre o
                              // clique e a corrida seria só atrito.
                              c.provider === "uber"
                                ? setPedindoVeiculo({ provider: c.provider, nome: c.nome })
                                : despachar(c.provider, c.nome)
                            }
                            disabled={despachando !== null || travado}
                            className="w-full rounded-lg bg-[var(--marca-primaria)] py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-50"
                          >
                            {despachando === c.provider
                              ? "Despachando..."
                              : travado
                              ? "Já despachado"
                              : "Despachar"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-4 text-sm text-red-600">
                          Indisponível{c.erro ? `: ${c.erro}` : ""}
                        </p>
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

          {!carregando &&
            (dados?.cotacoes?.length ?? 0) === 0 &&
            !erroCarregar &&
            !bloqueio && (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
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
          <aside className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
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
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      pedido.pago
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-amber-50 text-amber-800 ring-amber-300"
                    }`}
                  >
                    {pedido.pago ? "Pago" : "Aguardando"}
                  </span>
                </dd>
              </div>

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
        onConfirmar={(veiculo) =>
          pedindoVeiculo &&
          despachar(pedindoVeiculo.provider, pedindoVeiculo.nome, veiculo)
        }
      />
    </div>
  );
}
