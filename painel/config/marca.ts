// ---------------------------------------------------------------------------
// MARCA — identidade visual do cliente (white-label).
//
// Este é o ÚNICO arquivo que muda quando o Hub é vendido para outro
// restaurante. Nenhum componente tem nome, cor ou logo escrito no meio do
// código: todos leem daqui.
//
// Duas formas de trocar, da mais rápida para a mais definitiva:
//
//   1) VARIÁVEIS DE AMBIENTE (recomendado em produção) — o mesmo build serve
//      qualquer cliente, só muda o .env.local do deploy:
//
//        NEXT_PUBLIC_MARCA_NOME="Villa Deli"
//        NEXT_PUBLIC_MARCA_TAGLINE="Pizza & Burger"
//        NEXT_PUBLIC_MARCA_COR_PRIMARIA="#1C1C1C"
//        NEXT_PUBLIC_MARCA_COR_PRIMARIA_HOVER="#000000"
//        NEXT_PUBLIC_MARCA_COR_SUAVE="#F3F4F6"
//        NEXT_PUBLIC_MARCA_COR_SUAVE_TEXTO="#111827"
//
//   2) Editando os PADRÕES abaixo (para forkar por cliente, se um dia precisar).
//
// O CAMINHO DAS IMAGENS NÃO É CONFIGURÁVEL, de propósito — ver ARQUIVOS abaixo.
//
// O logo é opcional: se o arquivo não existir, o painel desenha um monograma
// com as iniciais nas cores da marca. Ver components/Logo.tsx.
// ---------------------------------------------------------------------------

function env(chave: string, padrao: string): string {
  const v = process.env[chave];
  return v && v.trim() ? v.trim() : padrao;
}

/**
 * Lê uma cor do ambiente com duas proteções:
 *
 *  1) Em arquivo .env, `#` COMEÇA UM COMENTÁRIO. Escrever
 *     `COR_PRIMARIA=#D97706` sem aspas faz o valor chegar vazio. Por isso
 *     aceitamos também `D97706` (sem #) e completamos aqui.
 *  2) Valor inválido cai no padrão em vez de pintar a tela de transparente.
 *
 * O jeito certo no .env continua sendo com aspas: COR_PRIMARIA="#D97706".
 */
function cor(chave: string, padrao: string): string {
  const bruto = process.env[chave]?.trim();
  if (!bruto) return padrao;

  const comHash = /^[0-9a-f]{3,8}$/i.test(bruto) ? `#${bruto}` : bruto;

  const valida =
    /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(comHash) ||
    /^(rgb|hsl)a?\(/i.test(comHash);

  return valida ? comHash : padrao;
}

// ---------------------------------------------------------------------------
// ARQUIVOS DA MARCA — caminho FIXO, não configurável.
//
// Já foi variável de ambiente e deu problema em produção: basta alguém salvar
// "marca/logo.svg" sem a barra inicial que o navegador trata como caminho
// RELATIVO. Em /pedidos/14279 ele vai buscar /pedidos/14279/marca/logo.svg,
// dá 404, e o logo aparece quebrado em todas as telas menos a raiz — com a
// configuração parecendo perfeitamente correta.
//
// Trocar o logo de um cliente é trocar o ARQUIVO, não a configuração. Basta
// sobrescrever public/marca/logo.svg. Não há ganho nenhum em deixar o caminho
// aberto, e há esta classe inteira de bug em jogo.
// ---------------------------------------------------------------------------

/** Logo do painel. Substitua o arquivo; não mexa no caminho. */
export const CAMINHO_LOGO = "/marca/logo.svg";

/**
 * Ícone da aba do navegador. Separado do logo de propósito: o favicon precisa
 * funcionar em fundo claro E escuro e ser legível a 16px, o que costuma pedir
 * uma versão própria da arte.
 */
export const CAMINHO_FAVICON = "/marca/favicon.svg";

export interface Marca {
  nome: string;
  tagline: string;
  logo: string;
  favicon: string;
  /** Iniciais do monograma de fallback. */
  monograma: string;
  cores: {
    /** Botões primários, item ativo, destaque de gráfico. */
    primaria: string;
    primariaHover: string;
    /** Texto sobre a cor primária. */
    contraste: string;
    /** Fundo de estado ativo/selecionado (tom suave da marca). */
    suave: string;
    /** Texto sobre o tom suave. */
    suaveTexto: string;
  };
}

/**
 * Padrões: Villa Deli — Pizza & Burger.
 * Paleta tirada do logo: círculo quase preto, tipografia off-white.
 */
export const MARCA: Marca = {
  nome: env("NEXT_PUBLIC_MARCA_NOME", "Villa Deli"),
  tagline: env("NEXT_PUBLIC_MARCA_TAGLINE", "Pizza & Burger"),
  logo: CAMINHO_LOGO,
  favicon: CAMINHO_FAVICON,
  monograma: env("NEXT_PUBLIC_MARCA_MONOGRAMA", ""),
  cores: {
    primaria: cor("NEXT_PUBLIC_MARCA_COR_PRIMARIA", "#1C1C1C"),
    primariaHover: cor("NEXT_PUBLIC_MARCA_COR_PRIMARIA_HOVER", "#000000"),
    contraste: cor("NEXT_PUBLIC_MARCA_COR_CONTRASTE", "#FFFFFF"),
    suave: cor("NEXT_PUBLIC_MARCA_COR_SUAVE", "#F3F4F6"),
    suaveTexto: cor("NEXT_PUBLIC_MARCA_COR_SUAVE_TEXTO", "#111827"),
  },
};

/** "Villa Deli" -> "VD". Usado quando não há arquivo de logo. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export const MONOGRAMA = MARCA.monograma || iniciais(MARCA.nome);

/**
 * CSS custom properties injetadas no <body>. Os componentes usam
 * `bg-[var(--marca-primaria)]` em vez de uma cor fixa do Tailwind, então trocar
 * a marca NÃO exige recompilar o Tailwind.
 */
export const VARIAVEIS_CSS: Record<string, string> = {
  "--marca-primaria": MARCA.cores.primaria,
  "--marca-primaria-hover": MARCA.cores.primariaHover,
  "--marca-contraste": MARCA.cores.contraste,
  "--marca-suave": MARCA.cores.suave,
  "--marca-suave-texto": MARCA.cores.suaveTexto,
};
