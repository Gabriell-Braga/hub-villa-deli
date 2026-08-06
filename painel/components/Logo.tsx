"use client";

import { useEffect, useRef, useState } from "react";
import { MARCA, MONOGRAMA } from "@/config/marca";

// ---------------------------------------------------------------------------
// Logo da marca.
//
// O monograma (iniciais nas cores da marca) fica SEMPRE desenhado no fundo, e
// a imagem cobre ele. Se o arquivo faltar, o caminho estiver errado ou a rede
// falhar, o que sobra na tela são as iniciais — nunca um ícone quebrado.
//
// A imagem NÃO espera onLoad para aparecer, e isso é deliberado. Já foi assim
// e dava justamente o defeito oposto: o <img> vem no HTML do servidor, o
// navegador termina de baixar antes do React hidratar, o onLoad se perde, e a
// imagem ficava carregada porém invisível — só o monograma aparecia, mesmo com
// tudo funcionando.
//
// Com `alt=""` o navegador não desenha placeholder de imagem quebrada, então
// deixá-la visível desde o começo é seguro: enquanto carrega, aparece o
// monograma por baixo, que é exatamente o que se quer.
//
// O onError e a checagem de `naturalWidth` são rede de segurança para
// navegador que insista em desenhar algo. A falha é lembrada no módulo, não no
// estado do componente, para não repetir o 404 a cada navegação.
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
  const img = useRef<HTMLImageElement>(null);

  // Rede de segurança para navegador que desenha placeholder de imagem
  // quebrada mesmo com alt vazio.
  //
  // O onError sozinho não bastava: o <img> vem no HTML do servidor, o
  // navegador já terminou de baixar antes do React hidratar, e o evento se
  // perde. `complete` diz que a requisição acabou; `naturalWidth === 0`
  // separa "deu 404" de "carregou".
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) {
      arquivoFalhou = true;
      setFalhou(true);
    }
  }, []);

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
          ref={img}
          src={MARCA.logo}
          alt=""
          width={tamanho}
          height={tamanho}
          onError={() => {
            arquivoFalhou = true;
            setFalhou(true);
          }}
          className="absolute inset-0 h-full w-full object-cover"
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
