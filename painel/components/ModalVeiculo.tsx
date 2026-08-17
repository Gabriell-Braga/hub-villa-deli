"use client";

import { useEffect, useRef, useState } from "react";
import LogoProvedor from "./LogoProvedor";

// ---------------------------------------------------------------------------
// Escolha do veículo, no clique de despachar pelo Uber.
//
// Por que um modal e não um seletor fixo na tela: a escolha só faz sentido no
// instante em que se decide acionar o Uber, e só para ele. Um controle
// permanente acima dos cards ficava ali pedindo atenção em todos os pedidos,
// inclusive nos que vão de motoboy próprio, onde não significa nada.
//
// O texto é a parte mais importante deste arquivo. A palavra "escolher" cria
// uma expectativa que a API não sustenta: não existe campo de veículo no Uber
// Direct. O que existe é declarar o volume do pedido, e a Uber decide a partir
// disso. Se a tela prometer escolha, o atendente vai achar que o sistema
// falhou quando chegar uma moto.
// ---------------------------------------------------------------------------

export type Veiculo = "moto" | "carro";

const OPCOES: Array<{
  id: Veiculo;
  titulo: string;
  descricao: string;
  icone: JSX.Element;
}> = [
  {
    id: "moto",
    titulo: "Moto",
    descricao: "Pedido comum, cabe numa sacola de entrega",
    icone: (
      <svg viewBox="0 0 32 32" className="h-7 w-7" fill="currentColor" aria-hidden="true">
        <circle cx="8.5" cy="21.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="23.5" cy="21.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M8.5 21.5 L13 13.5 H21.5 L23.5 21.5 M21.5 13.5 L23.4 9.8 M20 9.8 H26"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "carro",
    titulo: "Carro",
    descricao: "Pedido volumoso, não sobe numa garupa",
    // Perfil de carro, não uma caixa com rodas. O desenho anterior era um
    // trapézio simétrico que lia como caminhão ou vagão. O que faz o olho
    // reconhecer um carro é a assimetria: capô baixo na frente, para-brisa
    // inclinado, teto curto, traseira caindo — e a linha de cintura separando
    // a cabine da carroceria.
    icone: (
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.4 20.2v-2.7c0-.7.45-1.32 1.12-1.53l3.4-1.06 2.9-3.4c.38-.45.94-.71 1.53-.71h6.7c.62 0 1.2.28 1.58.77l2.72 3.46 3.4 1c.68.2 1.15.83 1.15 1.54v2.63" />
          <path d="M8.1 15.1h13.4" />
          <circle cx="9.4" cy="20.6" r="2.9" />
          <circle cx="22.6" cy="20.6" r="2.9" />
        </g>
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Quando a comida fica pronta.
//
// A queixa era demora para achar entregador. Medindo a cotação daqui, o Uber
// estima 13 minutos entre criar a corrida e o entregador encostar na porta.
// Despachando com a comida pronta, esses 13 minutos são de comida esfriando.
//
// Avisando o horário, a busca corre junto com o preparo. A documentação da
// Uber é explícita: "the courier will arrive around the pickup_ready_dt". E o
// preço não muda — testado, mesma cotação com e sem horário marcado.
//
// "Agora" é o padrão e é exatamente o que o sistema sempre fez. Os degraus
// começam em 10 porque abaixo disso a API recusa a janela.
// ---------------------------------------------------------------------------
const PRONTO: Array<{ min: number; rotulo: string }> = [
  { min: 0, rotulo: "Agora" },
  { min: 10, rotulo: "10 min" },
  { min: 15, rotulo: "15 min" },
  { min: 20, rotulo: "20 min" },
  { min: 30, rotulo: "30 min" },
];

export default function ModalVeiculo({
  aberto,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  aberto: boolean;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (v: Veiculo, prontoEmMin: number) => void;
}) {
  const [escolhido, setEscolhido] = useState<Veiculo>("moto");
  const [prontoEm, setProntoEm] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  // Esc fecha. Sem isso o único jeito de sair é achar o botão — e o modal
  // aparece no meio de uma operação com pressa.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ocupado) onCancelar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, ocupado, onCancelar]);

  // Volta para "moto" a cada abertura: a escolha é por pedido, e herdar a do
  // pedido anterior faria alguém despachar de carro sem perceber. Mesma razão
  // para o horário: herdar "30 min" de um pedido grande faria o próximo, já
  // pronto, esperar meia hora na bancada.
  useEffect(() => {
    if (aberto) {
      setEscolhido("moto");
      setProntoEm(0);
    }
  }, [aberto]);

  useEffect(() => {
    if (aberto) caixa.current?.focus();
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      // Clicar fora cancela — menos enquanto está despachando, quando fechar
      // deixaria a pessoa sem saber se a corrida foi criada.
      onClick={() => !ocupado && onCancelar()}
    >
      <div
        ref={caixa}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-veiculo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl outline-none sm:p-6"
      >
        {/* A marca no título responde de imediato "isto vale para quem?". Sem
            ela, o modal aparece no clique de um card e não diz de qual. */}
        <div className="flex items-center gap-2.5">
          <LogoProvedor provider="uber" tamanho={26} />
          <h2 id="titulo-veiculo" className="text-lg font-semibold text-gray-900">
            Despachar pelo Uber
          </h2>
        </div>

        <p className="mt-4 text-sm font-medium text-gray-900">
          A comida fica pronta em
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          O entregador é chamado agora e chega perto desse horário.
        </p>

        <div className="mt-2.5 flex flex-wrap gap-2">
          {PRONTO.map((p) => {
            const ativo = prontoEm === p.min;
            return (
              <button
                key={p.min}
                type="button"
                onClick={() => setProntoEm(p.min)}
                aria-pressed={ativo}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition ${
                  ativo
                    ? "border-[var(--marca-primaria)] bg-gray-50 text-gray-900 ring-2 ring-gray-200"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p.rotulo}
              </button>
            );
          })}
        </div>

        {/* Só aparece quando há o que avisar. Em "Agora" não existe espera
            possível, e um aviso permanente vira ruído que ninguém lê. */}
        {prontoEm > 0 && (
          <p className="mt-2.5 text-xs leading-relaxed text-gray-500">
            Se a comida atrasar e o entregador esperar mais de 10 minutos na
            loja, a Uber cobra pela espera.
          </p>
        )}

        <p className="mt-5 text-sm font-medium text-gray-900">
          Preferência de veículo
        </p>

        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          {OPCOES.map((o) => {
            const ativo = escolhido === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setEscolhido(o.id)}
                aria-pressed={ativo}
                className={`rounded-xl border p-4 text-left transition ${
                  ativo
                    ? "border-[var(--marca-primaria)] bg-gray-50 ring-2 ring-gray-200"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span
                  className={ativo ? "text-[var(--marca-primaria)]" : "text-gray-400"}
                >
                  {o.icone}
                </span>
                <p className="mt-2 font-medium text-gray-900">{o.titulo}</p>
                <p className="mt-0.5 text-xs text-gray-500">{o.descricao}</p>
              </button>
            );
          })}
        </div>

        {/* O aviso não é letra miúda: é o que evita a reclamação de "pedi carro
            e veio moto". Fica antes dos botões, no caminho da leitura. */}
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <strong className="font-semibold">Isto é uma preferência, não uma
          garantia.</strong>{" "}
          Quem escolhe o entregador é a Uber. O pedido vai marcado para dar
          preferência ao veículo selecionado, e na maioria das vezes é o que
          vem, mas pode vir outro. O preço continua sendo o da cotação.
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancelar}
            disabled={ocupado}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(escolhido, prontoEm)}
            disabled={ocupado}
            className="rounded-lg bg-[var(--marca-primaria)] px-4 py-2.5 text-sm font-semibold text-[var(--marca-contraste)] transition hover:bg-[var(--marca-primaria-hover)] disabled:opacity-50"
          >
            {ocupado ? "Despachando..." : "Despachar"}
          </button>
        </div>
      </div>
    </div>
  );
}
