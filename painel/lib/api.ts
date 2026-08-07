"use client";

import { signOut } from "next-auth/react";

// ---------------------------------------------------------------------------
// Chamada às rotas do painel que exigem sessão.
//
// A diferença para o `fetch` puro é o tratamento do 401: em vez de devolver a
// resposta para a tela mostrar "sessão inválida ou expirada", desloga e manda
// para o login.
//
// "Sessão expirada" não é informação acionável. A pessoa não pode consertar
// aquilo lendo — o que ela precisa é entrar de novo, e cada tela que mostrava
// a frase deixava a decisão de como sair para o atendente, no meio do turno.
//
// POR QUE ISSO ACONTECE: são dois prazos independentes. O cookie do painel e
// o JWT do Worker nascem juntos e valem 8 h cada, mas o Worker pode ser
// reimplantado com outro segredo, ou o relógio pode divergir, e aí o cookie
// continua válido com um token que o Worker já não aceita.
//
// Não usar nas telas públicas (esqueci-senha, definir-senha): lá um 401 quer
// dizer "token do link inválido", e deslogar quem nem está logado só produz um
// redirecionamento sem sentido.
// ---------------------------------------------------------------------------

/**
 * Trava contra chamadas simultâneas.
 *
 * A tela de pedidos revalida sozinha a cada 15 s e há componentes buscando em
 * paralelo. Sem isto, um token vencido dispararia vários signOut ao mesmo
 * tempo e a navegação competiria consigo mesma.
 */
let saindo = false;

export async function apiFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;

  if (!saindo) {
    saindo = true;
    signOut({ callbackUrl: "/login?expirou=1" });
  }

  // Promise que nunca resolve, de propósito: a navegação para o login já está
  // a caminho, e devolver a resposta faria a tela piscar um erro antes de
  // sumir. Quem chamou fica no estado "carregando" até a página trocar, que é
  // exatamente o que está acontecendo.
  return new Promise<Response>(() => {});
}
