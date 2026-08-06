"use client";

import { useState } from "react";
import { MARCA, MONOGRAMA } from "@/config/marca";

// ---------------------------------------------------------------------------
// Logo da marca.
//
// O monograma (iniciais nas cores da marca) é SEMPRE desenhado, e a imagem
// entra por cima. Não é enfeite: significa que o painel nunca mostra ícone
// quebrado. Se o arquivo faltar, se o caminho estiver errado, se a rede
// falhar no meio — o que aparece são as iniciais, e ninguém percebe defeito.
//
// A versão anterior renderizava só o <img> e trocava para o monograma no
// onError. Funcionava, mas o navegador já tinha desenhado o ícone quebrado
// antes do evento chegar, e a troca acontecia a cada navegação porque o
// estado morria junto com o componente.
//
// Daí as duas decisões abaixo:
//   - a falha fica num módulo, não no estado do componente: uma vez que se
//     sabe que não há arquivo, nenhuma outra instância tenta de novo;
//   - a imagem começa invisível e só aparece no onLoad.
//
// É client component só por causa desses dois eventos.
// ---------------------------------------------------------------------------

/**
 * Lembrança entre montagens. O logo é o MESMO arquivo para o painel inteiro:
 * se ele falhou uma vez, falhou para todo mundo, e reencomendar a cada troca
 * de tela só produz 404 repetido no console do cliente.
 */
let arquivoFalhou = false;

export default function Logo({
  tamanho = 40,
  className = "",
}: {
  tamanho?: number;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(arquivoFalhou);
  const [carregou, setCarregou] = useState(false);

  const mostrarImagem = !!MARCA.logo && !falhou;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold tracking-tight ${className}`}
      style={{
        width: tamanho,
        height: tamanho,
        backgroundColor: "var(--marca-primaria)",
        color: "var(--marca-contraste)",
        fontSize: tamanho * 0.36,
      }}
      // O nome já aparece escrito ao lado em todos os usos (ver LogoComNome),
      // então repetir aqui só faria o leitor de tela dizer duas vezes.
      aria-hidden="true"
    >
      {MONOGRAMA}

      {mostrarImagem && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={MARCA.logo}
          alt=""
          width={tamanho}
          height={tamanho}
          onLoad={() => setCarregou(true)}
          onError={() => {
            arquivoFalhou = true;
            setFalhou(true);
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
            carregou ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
  );
}

/** Logo + nome + tagline. Usado na sidebar e na tela de login. */
export function LogoComNome({
  tamanho = 40,
  empilhado = false,
}: {
  tamanho?: number;
  empilhado?: boolean;
}) {
  if (empilhado) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Logo tamanho={tamanho} />
        <div className="text-center">
          <p className="text-lg font-semibold tracking-tight text-gray-900">
            {MARCA.nome}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">
            {MARCA.tagline}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo tamanho={tamanho} />
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight text-gray-900">
          {MARCA.nome}
        </p>
        <p className="truncate text-[10px] uppercase leading-tight tracking-[0.18em] text-gray-400">
          {MARCA.tagline}
        </p>
      </div>
    </div>
  );
}
