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
import { useToast } from "@/components/Toast";
import { brlOuGratis, dataHora } from "@/lib/formato";
import {
  Skeleton,
  SkeletonCartoesCotacao,
  SkeletonResumoPedido,
} from "@/components/Skeleton";

// De onde o atendente veio, para o botão Voltar devolver ao lugar certo.
//
// A origem vem na URL (`?de=`) e não de router.back(): o histórico do
// navegador quebra quando a pessoa recarrega a página, abre o link direto ou
// chega por um atalho — e aí "voltar" jogaria para fora do painel.
const ORIGENS = {
  historico: { href: "/historico", rotulo: "Voltar para o histórico" },
  abertos: { href: "/pedidos", rotulo: "Voltar para a fila" },
} as const;

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

  const cotar = useCallback(async () => {
    setCarregando(true);
    setErroCarregar(null);
    try {
      const res = await fetch(`/api/cotacao/${encodeURIComponent(idPedido)}`);
      const json = await res.json();

      if (!res.ok) {
        setDados(null);
        setErroCarregar(json.erro ?? `Erro ${res.status} ao cotar.`);
        return;
      }

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

  async function despachar(provider: ProviderId, nome: string) {
    setDespachando(provider);
    try {
      const res = await fetch("/api/despachar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idPedido, provider }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast.erro(json.erro ?? `Falha ao despachar (${res.status}).`);
        return;
      }

      setDespacho(json);
      toast.sucesso(
        json.jaDespachado
          ? "Este pedido já havia sido despachado — nenhuma corrida nova foi criada."
          : `Despachado via ${nome}.`
      );
    } catch {
      toast.erro("Erro de rede ao despachar.");
    } finally {
      setDespachando(null);
    }
  }

  async function concluir(status: "delivered" | "canceled") {
    setConcluindo(true);
    try {
      const res = await fetch(
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
  // Cancelado no Cardápio Web também trava a tela: o servidor recusa o
  // despacho, e deixar o botão ativo só produziria um erro depois do clique.
  const cancelado = /cancel/i.test(pedido?.statusCardapio ?? "");
  const travado = despacho !== null || cancelado;

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
            {pedido?.teste && <SeloTeste tamanho="grande" />}
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

      {/* Cancelado no Cardápio Web: fica na tela, não é toast. É um estado do
          pedido, e o atendente pode chegar aqui muito depois do aviso sumir.
          O botão de despachar já é recusado pelo servidor de qualquer forma. */}
      {cancelado && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <strong className="font-semibold">Pedido cancelado.</strong> A loja
          cancelou este pedido no Cardápio Web — não acione entregador para ele.
        </div>
      )}

      {despacho && (
        <CardEntrega
          despacho={despacho}
          entrega={entrega}
          concluindo={concluindo}
          onConcluir={concluir}
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
                          <span className="text-2xl font-semibold tracking-tight text-gray-900">
                            {brlOuGratis(c.preco)}
                          </span>
                          <span className="text-sm text-gray-500">
                            {c.etaMinutos ? `~${c.etaMinutos} min` : "ETA n/d"}
                          </span>
                        </div>

                        {c.detalhe && (
                          <p className="mt-1 text-xs text-gray-400">{c.detalhe}</p>
                        )}

                        <div className="mt-auto pt-4">
                          <button
                            onClick={() => despachar(c.provider, c.nome)}
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
                      <p className="mt-4 text-sm text-red-600">
                        Indisponível{c.erro ? `: ${c.erro}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!carregando && (dados?.cotacoes?.length ?? 0) === 0 && !erroCarregar && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              Nenhuma cotação. Confira se o pedido chegou pelo webhook e se há
              provedor ativo.
            </div>
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
                <dd className="text-gray-500">{pedido.cliente.telefone}</dd>
              </div>

              <div>
                <dt className="text-gray-500">Endereço</dt>
                <dd className="text-gray-900">
                  {pedido.endereco.logradouro}, {pedido.endereco.numero}
                  {pedido.endereco.complemento ? ` — ${pedido.endereco.complemento}` : ""}
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

              <div className="border-t border-gray-100 pt-3">
                <div className="flex justify-between font-medium text-gray-900">
                  <span>Total do pedido</span>
                  <span>{brlOuGratis(pedido.total)}</span>
                </div>
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
    </div>
  );
}
