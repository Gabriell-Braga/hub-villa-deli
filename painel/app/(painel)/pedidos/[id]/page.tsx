"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  CotacaoResponse,
  Despacho,
  EntregaAoVivo,
  ProviderId,
} from "@/lib/tipos";
import { COR_STATUS_ENTREGA, ROTULO_STATUS_ENTREGA } from "@/lib/tipos";
import LogoProvedor from "@/components/LogoProvedor";
import { brlOuGratis, dataHora, hora } from "@/lib/formato";
import {
  Skeleton,
  SkeletonCartoesCotacao,
  SkeletonResumoPedido,
} from "@/components/Skeleton";

type Aviso = { tipo: "ok" | "erro"; texto: string };

export default function PaginaCotacao({ params }: { params: { id: string } }) {
  const idPedido = decodeURIComponent(params.id);

  const [dados, setDados] = useState<CotacaoResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [despachando, setDespachando] = useState<ProviderId | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [despacho, setDespacho] = useState<Despacho | null>(null);
  const [entrega, setEntrega] = useState<EntregaAoVivo | null>(null);

  const cotar = useCallback(async () => {
    setCarregando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/cotacao/${encodeURIComponent(idPedido)}`);
      const json = await res.json();

      if (!res.ok) {
        setDados(null);
        setAviso({ tipo: "erro", texto: json.erro ?? `Erro ${res.status} ao cotar.` });
        return;
      }

      setDados(json);
      if (json.despacho) setDespacho(json.despacho);
      setEntrega(json.entrega ?? null);
    } catch {
      setDados(null);
      setAviso({ tipo: "erro", texto: "Não foi possível falar com o servidor." });
    } finally {
      setCarregando(false);
    }
  }, [idPedido]);

  async function despachar(provider: ProviderId, nome: string) {
    setDespachando(provider);
    setAviso(null);
    try {
      const res = await fetch("/api/despachar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idPedido, provider }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setAviso({
          tipo: "erro",
          texto: json.erro ?? `Falha ao despachar (${res.status}).`,
        });
        return;
      }

      setDespacho(json);
      setAviso({
        tipo: "ok",
        texto: json.jaDespachado
          ? "Este pedido já havia sido despachado — nenhuma corrida nova foi criada."
          : `Despachado via ${nome}.`,
      });
    } catch {
      setAviso({ tipo: "erro", texto: "Erro de rede ao despachar." });
    } finally {
      setDespachando(null);
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

  const travado = despacho !== null;
  const pedido = dados?.pedido;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/pedidos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-900"
      >
        ← Voltar para a fila
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedido #{idPedido}</h1>
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

      {aviso && (
        <div
          role="alert"
          className={`mb-4 rounded-xl border p-4 text-sm ${
            aviso.tipo === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {aviso.texto}
        </div>
      )}

      {despacho && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-emerald-700">✅ Entrega despachada</p>

            {/* Status ao vivo vem dos webhooks do parceiro. Sem webhook
                configurado, `entrega.status` fica no valor do despacho. */}
            {entrega?.status && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  COR_STATUS_ENTREGA[entrega.status] ??
                  "bg-gray-100 text-gray-700 ring-gray-300"
                }`}
              >
                {ROTULO_STATUS_ENTREGA[entrega.status] ?? entrega.status}
              </span>
            )}

            {/* Aviso que evita confundir simulação com corrida real. */}
            {entrega?.liveMode === false && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                Ambiente de teste
              </span>
            )}
          </div>

          {entrega?.courierNome && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-gray-700">
              <LogoProvedor provider={despacho.provider} tamanho={20} />
              {entrega.courierNome}
              {entrega.courierVeiculo && ` · ${entrega.courierVeiculo}`}
              {entrega.courierTelefone && (
                <>
                  {" · "}
                  <a
                    href={`tel:${entrega.courierTelefone}`}
                    className="font-medium text-emerald-700 underline"
                  >
                    {entrega.courierTelefone}
                  </a>
                </>
              )}
            </p>
          )}

          {entrega?.dropoffEta && (
            <p className="mt-1 text-sm text-gray-500">
              Previsão de entrega: {hora(entrega.dropoffEta)}
            </p>
          )}

          <p className="mt-1 text-sm text-gray-500">
            Código da entrega{" "}
            {/* IDs de parceiro são longos e sem espaço: sem break-all eles
                empurram a largura da página no celular. */}
            <span className="break-all font-mono">{despacho.deliveryId}</span>
          </p>

          {entrega?.statusAtualizadoEm && (
            <p className="mt-1 text-xs text-gray-400">
              Atualizado às {hora(entrega.statusAtualizadoEm)}
            </p>
          )}
          {/* O tracking_url pode chegar/mudar pelo webhook — o do webhook vence. */}
          {(entrega?.trackingUrl ?? despacho.trackingUrl) && (
            <a
              href={entrega?.trackingUrl ?? despacho.trackingUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-700 sm:inline-block sm:py-2"
            >
              Acompanhar entrega
            </a>
          )}
        </div>
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

          {!carregando && (dados?.cotacoes?.length ?? 0) === 0 && !aviso && (
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
