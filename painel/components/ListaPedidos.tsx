"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PedidoResumo, StatusPedido } from "@/lib/tipos";
import { ROTULO_PROVEDOR } from "@/lib/tipos";
import LogoProvedor from "./LogoProvedor";
import SeloTeste from "./SeloTeste";
import { brl, brlOuGratis, dataHora, desde } from "@/lib/formato";
import { SkeletonListaPedidos } from "./Skeleton";

// ---------------------------------------------------------------------------
// Lista de pedidos. Serve as duas telas (Aberto e Histórico) — a diferença é
// só a aba pedida ao Worker e os rótulos.
//
// Duas montagens pelo mesmo dado:
//   celular -> cartões empilhados, o pedido inteiro é o alvo do toque
//   sm+     -> tabela
//
// A tabela não vira "tabela com rolagem lateral" no celular de propósito:
// rolar de lado para descobrir o preço é justamente o que trava o atendente
// quando ele está com o telefone numa mão e o pedido na outra.
// ---------------------------------------------------------------------------

const CORES_STATUS: Record<StatusPedido, string> = {
  recebido: "bg-amber-50 text-amber-700 ring-amber-200",
  cotado: "bg-blue-50 text-blue-700 ring-blue-200",
  despachando: "bg-gray-100 text-gray-700 ring-gray-300",
  despachado: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const ROTULO_STATUS: Record<StatusPedido, string> = {
  recebido: "Aguardando cotação",
  cotado: "Cotado",
  despachando: "Despachando",
  despachado: "Despachado",
};

function Selo({ status }: { status: StatusPedido }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CORES_STATUS[status]}`}
    >
      {ROTULO_STATUS[status]}
    </span>
  );
}

/**
 * Coluna da direita.
 *
 * Sempre CUSTO da entrega — nunca o total do pedido. Misturar os dois era o
 * que fazia parecer que o frete somava no preço dos produtos. O frete que o
 * cliente pagou aparece embaixo, como referência, para a comparação ser
 * possível sem abrir o pedido.
 */
function Valor({ p }: { p: PedidoResumo }) {
  const custo = p.despacho ? p.despacho.valorPago : p.melhorPreco;
  if (custo == null) return <span className="text-gray-400">—</span>;

  const saldo = Math.round((p.freteCobrado - custo) * 100) / 100;

  return (
    <div>
      <p className="font-semibold text-gray-900">{brlOuGratis(custo)}</p>

      {p.despacho ? (
        <p className="flex items-center justify-end gap-1.5 text-xs text-gray-400">
          <LogoProvedor provider={p.despacho.provider} tamanho={14} />
          {ROTULO_PROVEDOR[p.despacho.provider]}
        </p>
      ) : (
        <p className="text-xs text-gray-400">melhor cotação</p>
      )}

      <p
        className={`text-xs font-medium ${
          saldo >= 0 ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {saldo >= 0 ? "+" : "−"}
        {brl(Math.abs(saldo))}
      </p>
    </div>
  );
}

export default function ListaPedidos({ aba }: { aba: "abertos" | "historico" }) {
  const [pedidos, setPedidos] = useState<PedidoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const res = await fetch(`/api/pedidos?aba=${aba}&limite=100`);
      const json = await res.json();
      if (!res.ok) {
        setErro(json.erro ?? `Erro ${res.status} ao carregar pedidos.`);
        setPedidos([]);
        return;
      }
      setPedidos(json.pedidos ?? []);
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [aba]);

  useEffect(() => {
    carregar();

    // Pedidos novos chegam por webhook, sem avisar o painel. Enquanto não há
    // WebSocket, um refresh a cada 15 s mantém a fila viva sem pesar.
    if (aba !== "abertos") return;
    const t = setInterval(carregar, 15_000);
    return () => clearInterval(t);
  }, [carregar, aba]);

  if (carregando) return <SkeletonListaPedidos />;

  if (erro) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {erro}
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center sm:p-12">
        <p className="text-3xl">📭</p>
        <p className="mt-3 font-medium text-gray-900">
          {aba === "abertos" ? "Nenhum pedido na fila" : "Nada no histórico ainda"}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {aba === "abertos"
            ? "Assim que o Cardápio Web enviar um pedido, ele aparece aqui."
            : "Os pedidos despachados aparecem aqui."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ---------------- Celular: cartões ---------------- */}
      <ul className="space-y-3 sm:hidden">
        {pedidos.map((p) => (
          <li key={p.id}>
            <Link
              // `de` carrega de qual tela veio, para o botão Voltar do detalhe
              // devolver o atendente ao lugar certo.
              href={`/pedidos/${encodeURIComponent(p.id)}?de=${aba}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 transition active:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">
                    {p.clienteNome}
                  </p>
                  <p className="truncate text-xs text-gray-400">
                    #{p.id} ·{" "}
                    {aba === "abertos" ? `há ${desde(p.criadoEm)}` : dataHora(p.criadoEm)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <Valor p={p} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.teste && <SeloTeste />}
                <Selo status={p.status} />
                {!p.pago && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300">
                    Aguardando pagamento
                  </span>
                )}
                {p.bairro && (
                  <span className="text-xs text-gray-500">{p.bairro}</span>
                )}
                <span className="text-xs text-gray-400">
                  {p.itens} {p.itens === 1 ? "item" : "itens"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* ---------------- Tablet e desktop: tabela ---------------- */}
      <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3 font-medium">Pedido</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="hidden px-5 py-3 font-medium lg:table-cell">
                  Bairro
                </th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">
                  {aba === "abertos" ? "Melhor cotação" : "Custo da entrega"}
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {pedidos.map((p) => (
                <tr key={p.id} className="transition hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">#{p.id}</p>
                      {p.teste && <SeloTeste />}
                    </div>
                    <p className="text-xs text-gray-400">
                      {aba === "abertos"
                        ? `há ${desde(p.criadoEm)}`
                        : dataHora(p.criadoEm)}
                    </p>
                  </td>

                  <td className="px-5 py-3">
                    <p className="text-gray-900">{p.clienteNome}</p>
                    <p className="text-xs text-gray-400">
                      {p.itens} {p.itens === 1 ? "item" : "itens"}
                    </p>
                  </td>

                  <td className="hidden px-5 py-3 text-gray-600 lg:table-cell">
                    {p.bairro || "—"}
                  </td>

                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Selo status={p.status} />
                      {!p.pago && (
                        <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300">
                          Aguardando pagamento
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-5 py-3 text-right">
                    <Valor p={p} />
                  </td>

                  <td className="px-5 py-3 text-right">
                    <Link
                      // `de` carrega de qual tela veio, para o botão Voltar do detalhe
              // devolver o atendente ao lugar certo.
              href={`/pedidos/${encodeURIComponent(p.id)}?de=${aba}`}
                      className="inline-block whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                    >
                      {aba === "abertos" ? "Cotar" : "Ver"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
