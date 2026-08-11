import { Hono } from "hono";
import { cors } from "hono/cors";
import type {
  Cotacao,
  Env,
  FiltroHistorico,
  Papel,
  PreferenciaVeiculo,
  Pedido,
  ProviderId,
  ResultadoDespacho,
  TipoTokenSenha,
  UsuarioSessao,
} from "./types";
import {
  salvarPedidoNovo,
  obterPedido,
  salvarCotacoes,
  obterCotacoes,
  obterDespacho,
  reservarDespacho,
  liberarDespacho,
  concluirDespacho,
  limparPedidosAntigos,
  registrarDelivery,
  listarPedidos,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  contarAdminsAtivos,
  salvarTokenSenha,
  lerTokenSenha,
  consumirTokenEDefinirSenha,
  invalidarTokensDoUsuario,
  limparTokensAntigos,
  obterEntregaAoVivo,
  obterEntregaAnterior,
  marcarEntregaManual,
  marcarEntregasEmLote,
  proximaSequenciaEntrega,
  prepararReenvio,
  enfileirarEventoCardapio,
  eventosCardapioPendentes,
} from "./lib/store";
import {
  cancelado,
  processarEventoCardapio,
  revalidarPedido,
} from "./services/cardapio-web";
import { historicoCsv, listarHistorico, nomeArquivoCsv } from "./lib/historico";
import { assinaturaValida } from "./lib/assinatura";
import { processarWebhookUber } from "./services/uber-webhook";
import {
  entregarLink,
  gerarTokenCru,
  hashToken,
  montarLink,
  validadeHoras,
} from "./lib/tokens-senha";
import { gerarHash } from "./lib/senha";
import { garantirCoordenadas } from "./lib/geocode";
import { distanciaKm } from "./lib/geo";
import { faixaPara } from "./config/faixas-motoboy";
import { provedoresAtivos, provedorAtivo, nomeProvedor } from "./config/provedores";
import { tokenDoRequest, validarToken } from "./lib/auth";
import { conferirSenha } from "./lib/senha";
import { emitirToken, exigirAdmin, exigirLogin, VALIDADE_SEGUNDOS } from "./lib/sessao";
import { calcularEstatisticas } from "./lib/estatisticas";
import { rodarDiagnostico } from "./lib/diagnostico";
import { ambiente, credenciaisUber } from "./config/ambiente";
import { definirModo, modoAtual, podeUsarProducao, quemTrocouModo } from "./config/modo";

type Contexto = {
  Bindings: Env;
  Variables: { usuario: UsuarioSessao };
};

const app = new Hono<Contexto>();

// ---------------------------------------------------------------------------
// CORS — restrito. PAINEL_ORIGIN no wrangler.toml define quem pode chamar.
// O painel Next.js chama o Worker pelo servidor (route handler), não pelo
// browser, então na prática o CORS aqui é só uma segunda linha de defesa.
// ---------------------------------------------------------------------------
app.use("/api/*", (c, next) => {
  const permitido = c.env.PAINEL_ORIGIN?.split(",").map((s) => s.trim()) ?? [];
  return cors({
    origin: (origem) => (permitido.includes(origem) ? origem : null),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  })(c, next);
});

// ---------------------------------------------------------------------------
// Rotas do painel exigem JWT de atendente logado.
// O webhook NÃO entra aqui — ele é máquina-a-máquina e usa WEBHOOK_SECRET.
// ---------------------------------------------------------------------------
app.use("/api/cotacao/*", exigirLogin);
app.use("/api/despachar", exigirLogin);
app.use("/api/pedidos", exigirLogin);
app.use("/api/historico", exigirLogin);
app.use("/api/historico/*", exigirLogin);
app.use("/api/entrega/*", exigirLogin);
app.use("/api/estatisticas", exigirLogin);
app.use("/api/auth/eu", exigirLogin);

// Diagnóstico expõe QUAIS credenciais faltam — só admin.
app.use("/api/diagnostico", exigirLogin, exigirAdmin);

// Gestão de usuários — só admin.
app.use("/api/usuarios", exigirLogin, exigirAdmin);
app.use("/api/usuarios/*", exigirLogin, exigirAdmin);

// Pedido simulado — só admin. Não é uma venda, é ferramenta de teste.
app.use("/api/pedidos/simular", exigirLogin, exigirAdmin);

// Modo de operação: ler exige login; TROCAR exige admin.
app.use("/api/modo", exigirLogin);
app.use("/api/modo/trocar", exigirLogin, exigirAdmin);

// Healthcheck — público de propósito, não devolve nada sensível.
app.get("/", (c) =>
  c.json({
    ok: true,
    service: "hub-logistico",
    ambiente: ambiente(c.env),
    provedoresAtivos: provedoresAtivos(c.env).map((p) => p.id),
  })
);

// ---------------------------------------------------------------------------
// 0) Autenticação
//    POST /api/auth/login  { email, senha }  ->  { token, usuario }
//
// O Worker é a autoridade de identidade: ele valida a senha contra o D1 e
// emite o JWT. O NextAuth do painel só guarda o token na sessão.
// ---------------------------------------------------------------------------
app.post("/api/auth/login", async (c) => {
  const body = await c.req
    .json<{ email?: string; senha?: string }>()
    .catch(() => null);

  const email = body?.email?.trim().toLowerCase();
  const senha = body?.senha;

  if (!email || !senha) {
    return c.json({ erro: "e-mail e senha são obrigatórios" }, 400);
  }

  const usuario = await buscarUsuarioPorEmail(c.env, email);

  // Mesma mensagem para todos os casos — inexistente, inativo, sem senha
  // definida ou senha errada. Distinguir entrega ao atacante uma lista de
  // e-mails válidos do restaurante.
  //
  // `senhaHash` nulo = usuário criado pelo admin que ainda não definiu senha.
  // Ele precisa usar o link de acesso, não o login.
  const podeTentar = !!usuario && usuario.ativo && !!usuario.senhaHash;

  const senhaOk = podeTentar
    ? await conferirSenha(senha, usuario!.senhaHash!)
    : // Gasta o mesmo tempo de qualquer jeito, para não vazar por timing.
      await conferirSenha(senha, "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");

  if (!podeTentar || !senhaOk) {
    return c.json({ erro: "e-mail ou senha inválidos" }, 401);
  }

  const token = await emitirToken(c.env, usuario);

  return c.json({
    token,
    expiraEmSegundos: VALIDADE_SEGUNDOS,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
    },
  });
});

/** Confere se a sessão ainda vale (o painel usa para revalidar). */
app.get("/api/auth/eu", (c) => c.json({ usuario: c.get("usuario") }));

// ---------------------------------------------------------------------------
// 0b) Definição e recuperação de senha — rotas PÚBLICAS
//
// O usuário criado pelo admin nasce SEM senha e define a dele por aqui. É o
// mesmo caminho do "esqueci minha senha": muda só a validade do link.
// Ninguém além do dono jamais conhece a senha, nem quem cadastrou.
// ---------------------------------------------------------------------------

/** Gera o token, salva o hash e devolve o link pronto. */
async function emitirLinkDeAcesso(
  env: Env,
  usuario: { id: string; email: string },
  tipo: TipoTokenSenha
): Promise<{ link: string; expiraEm: string; enviadoPorEmail: boolean }> {
  const token = gerarTokenCru();
  const expiraEm = new Date(
    Date.now() + validadeHoras(tipo) * 3600_000
  ).toISOString();

  await salvarTokenSenha(env, await hashToken(token), usuario.id, tipo, expiraEm);

  const link = montarLink(env, token);
  const { enviadoPorEmail } = await entregarLink(env, usuario.email, link, tipo);

  return { link, expiraEm, enviadoPorEmail };
}

/**
 * POST /api/auth/esqueci-senha  { email }
 *
 * Responde 200 SEMPRE, exista o e-mail ou não. Dizer "esse e-mail não está
 * cadastrado" entrega ao atacante uma lista de contas válidas do restaurante.
 */
app.post("/api/auth/esqueci-senha", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => null);
  const email = body?.email?.trim().toLowerCase();

  const resposta = {
    ok: true,
    mensagem:
      "Se este e-mail estiver cadastrado, o link de acesso foi gerado. Procure o administrador do restaurante para recebê-lo.",
  };

  if (!email) return c.json(resposta);

  const usuario = await buscarUsuarioPorEmail(c.env, email);
  if (!usuario || !usuario.ativo) return c.json(resposta);

  await emitirLinkDeAcesso(c.env, usuario, "recuperacao");
  return c.json(resposta);
});

/** GET /api/auth/token/:token — a tela de definir senha usa para saber de quem é. */
app.get("/api/auth/token/:token", async (c) => {
  const info = await lerTokenSenha(c.env, await hashToken(c.req.param("token")));

  if (!info) {
    return c.json({ erro: "Link inválido ou expirado." }, 404);
  }

  return c.json({ nome: info.nome, email: info.email, tipo: info.tipo });
});

/** POST /api/auth/definir-senha  { token, senha } */
app.post("/api/auth/definir-senha", async (c) => {
  const body = await c.req
    .json<{ token?: string; senha?: string }>()
    .catch(() => null);

  const token = body?.token?.trim();
  const senha = body?.senha ?? "";

  if (!token) return c.json({ erro: "Link inválido." }, 400);
  if (senha.length < 8) {
    return c.json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
  }

  const ok = await consumirTokenEDefinirSenha(
    c.env,
    await hashToken(token),
    await gerarHash(senha)
  );

  if (!ok) {
    return c.json(
      { erro: "Link inválido, expirado ou já utilizado. Peça um novo." },
      400
    );
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 0c) Gestão de usuários — só admin
// ---------------------------------------------------------------------------

app.get("/api/usuarios", async (c) => {
  return c.json({ usuarios: await listarUsuarios(c.env) });
});

app.post("/api/usuarios", async (c) => {
  const body = await c.req
    .json<{ nome?: string; email?: string; papel?: Papel }>()
    .catch(() => null);

  const nome = body?.nome?.trim();
  const email = body?.email?.trim().toLowerCase();
  const papel: Papel = body?.papel === "admin" ? "admin" : "atendente";

  if (!nome || !email) {
    return c.json({ erro: "Nome e e-mail são obrigatórios." }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ erro: "E-mail inválido." }, 400);
  }

  const usuario = await criarUsuario(c.env, { nome, email, papel });
  if (!usuario) {
    return c.json({ erro: "Já existe um usuário com esse e-mail." }, 409);
  }

  // Convite emitido junto com a criação: não existe estado "usuário criado sem
  // como entrar".
  const acesso = await emitirLinkDeAcesso(c.env, usuario, "convite");

  return c.json({ ok: true, usuario, ...acesso }, 201);
});

app.patch("/api/usuarios/:id", async (c) => {
  const id = c.req.param("id");
  const eu = c.get("usuario");

  const body = await c.req
    .json<{ nome?: string; papel?: Papel; ativo?: boolean }>()
    .catch(() => null);
  if (!body) return c.json({ erro: "Dados inválidos." }, 400);

  const alvo = await buscarUsuarioPorId(c.env, id);
  if (!alvo) return c.json({ erro: "Usuário não encontrado." }, 404);

  // Trava contra tiro no pé: o admin logado não se desativa nem se rebaixa.
  // Sem isso, um clique errado tranca o próprio dono para fora do painel.
  if (id === eu.sub && (body.ativo === false || body.papel === "atendente")) {
    return c.json(
      { erro: "Você não pode desativar nem rebaixar a própria conta." },
      400
    );
  }

  // Trava contra ficar sem dono: o último admin ativo não pode sair.
  const perdendoAdmin =
    alvo.papel === "admin" && (body.ativo === false || body.papel === "atendente");
  if (perdendoAdmin && (await contarAdminsAtivos(c.env)) <= 1) {
    return c.json(
      { erro: "É preciso manter pelo menos um administrador ativo." },
      400
    );
  }

  const alterado = await atualizarUsuario(c.env, id, {
    nome: body.nome,
    papel: body.papel,
    ativo: body.ativo,
  });
  if (!alterado) return c.json({ erro: "Nada para alterar." }, 400);

  // Desativou? Os links de acesso pendentes morrem junto.
  if (body.ativo === false) await invalidarTokensDoUsuario(c.env, id);

  return c.json({ ok: true });
});

/** Gera um link novo — para reenviar convite ou resetar a senha de alguém. */
app.post("/api/usuarios/:id/link-acesso", async (c) => {
  const alvo = await buscarUsuarioPorId(c.env, c.req.param("id"));
  if (!alvo) return c.json({ erro: "Usuário não encontrado." }, 404);

  const acesso = await emitirLinkDeAcesso(c.env, alvo, "recuperacao");
  return c.json({ ok: true, ...acesso });
});

// ---------------------------------------------------------------------------
// 1) Webhook de entrada do Cardápio Web
//    POST /api/webhook/cardapio-web
//
// O QUE ELES MANDAM (não é o pedido!):
//   { event_id, event_type, merchant_id, order_id, order_status, created_at }
//   event_type: ORDER_CREATED | ORDER_STATUS_UPDATED
//   header de autenticação: X-Webhook-Token (token simples, não é assinatura)
//
// O CONTRATO DURO: HTTP 200 em até 5 SEGUNDOS. Se estourar, eles reenviam
// (15 s, 30 s, 60 s… até 900 s, no máximo 15 vezes) e depois PAUSAM o webhook e
// DESCARTAM as notificações até alguém reativar na mão. Ou seja: uma lentidão
// nossa não atrasa um pedido, ela derruba a entrada de pedidos da loja inteira.
//
// Por isso esta rota não faz nada além de gravar o evento e responder. Buscar
// o pedido na API deles e geocodificar — que juntos passam dos 5 s com
// facilidade — acontece em waitUntil, depois da resposta já ter saído.
// ---------------------------------------------------------------------------

interface EventoCW {
  event_id?: string;
  event_type?: string;
  merchant_id?: number | string;
  order_id?: number | string;
  order_status?: string;
  created_at?: string;
}

app.post("/api/webhook/cardapio-web", async (c) => {
  const env = c.env;

  // Eles usam X-Webhook-Token. A variável existe porque o header já mudou uma
  // vez e trocar configuração é mais barato que fazer deploy.
  const header = env.CARDAPIO_WEB_HEADER || "x-webhook-token";
  const auth = validarToken(
    env.WEBHOOK_SECRET,
    tokenDoRequest(c.req.raw.headers, header),
    "WEBHOOK_SECRET"
  );
  if (!auth.ok) return c.json({ erro: auth.erro }, auth.status);

  const bruto = await c.req.text();
  const body = (() => {
    try {
      return JSON.parse(bruto) as EventoCW;
    } catch {
      return null;
    }
  })();

  if (!body?.order_id) {
    // 400 aqui é seguro: eles reenviam, mas um corpo que não muda vai falhar
    // igual das 15 vezes. Melhor recusar visivelmente do que engolir calado.
    return c.json({ erro: "payload sem order_id" }, 400);
  }

  // Se o merchant não for o nosso, alguém apontou o webhook errado para cá.
  const nosso = env.CARDAPIO_WEB_MERCHANT_ID?.trim();
  if (nosso && body.merchant_id != null && String(body.merchant_id) !== nosso) {
    console.warn(`[cardapio-web] merchant inesperado: ${body.merchant_id}`);
    return c.json({ erro: "merchant não reconhecido" }, 403);
  }

  const evento = {
    // Sem event_id (não é obrigatório na doc) a chave de idempotência vira
    // pedido+tipo+status, que é o que basta para não processar duas vezes.
    eventId:
      body.event_id ??
      `${body.order_id}:${body.event_type ?? "?"}:${body.order_status ?? "?"}`,
    tipo: body.event_type ?? "ORDER_CREATED",
    orderId: String(body.order_id),
    merchantId: body.merchant_id != null ? String(body.merchant_id) : null,
    payload: bruto,
  };

  // false = reenvio, já temos esse evento. Responde 200 do mesmo jeito: um
  // erro aqui só faria eles reenviarem de novo e chegarem mais perto da pausa.
  const novo = await enfileirarEventoCardapio(env, evento);

  if (novo) {
    c.executionCtx.waitUntil(processarEventoCardapio(env, evento));
  }

  return c.json({ ok: true, recebido: true });
});

// ---------------------------------------------------------------------------
// 1a) Pedido SIMULADO — POST /api/pedidos/simular (admin)
//
// Existe porque o webhook agora só aceita o formato do Cardápio Web (um
// `order_id` que a gente vai buscar na API deles). Não dá mais para injetar um
// pedido inteiro por lá, e nem deveria: aquela porta é da integração.
//
// Todo pedido criado aqui nasce com `teste: true`, com o TELEFONE DE TESTE no
// lugar do informado, e já pago. O painel mostra o selo de teste na tela.
// ---------------------------------------------------------------------------
app.post("/api/pedidos/simular", async (c) => {
  const env = c.env;
  const body = await c.req.json<Partial<Pedido>>().catch(() => null);

  if (!body?.cliente?.nome || !body?.endereco?.cep) {
    return c.json({ erro: "Informe o nome do cliente e o CEP de entrega." }, 400);
  }

  const endereco = await garantirCoordenadas(env, body.endereco);

  // O frete de um pedido simulado sai da MESMA tabela de raio do Cardápio Web
  // que o cliente pagaria de verdade. Inventar um número aqui faria a margem
  // na tela ser ficção, que é justamente o que se está testando.
  const km =
    endereco.lat != null && endereco.lng != null
      ? distanciaKm(
          parseFloat(env.RESTAURANTE_LAT),
          parseFloat(env.RESTAURANTE_LNG),
          endereco.lat,
          endereco.lng
        )
      : null;
  const freteCobrado =
    body.freteCobrado ?? (km == null ? 0 : faixaPara(km)?.preco ?? 0);

  const subtotal =
    body.subtotal ??
    (body.itens ?? []).reduce((s, i) => s + (i.preco ?? 0), 0);

  const pedido: Pedido = {
    id: body.id || `TESTE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    criadoEm: new Date().toISOString(),
    cliente: {
      nome: body.cliente.nome,
      // NUNCA o telefone informado. O Uber manda SMS para o número do destino,
      // e teste nosso não pode virar mensagem no celular de outra pessoa.
      telefone: env.TELEFONE_TESTE || env.RESTAURANTE_TELEFONE,
    },
    endereco,
    itens: body.itens ?? [],
    total: Math.round((subtotal + freteCobrado) * 100) / 100,
    freteCobrado,
    subtotal: Math.round(subtotal * 100) / 100,
    pago: true,
    formaPagamento: "Pix",
    observacao: body.observacao,
    status: "recebido",
    teste: true,
  };

  const novo = await salvarPedidoNovo(env, pedido);
  if (!novo) return c.json({ erro: "Já existe um pedido com este número." }, 409);

  return c.json({
    ok: true,
    idPedido: pedido.id,
    telefone: pedido.cliente.telefone,
    freteCobrado,
    distanciaKm: km == null ? null : Math.round(km * 100) / 100,
  });
});

// ---------------------------------------------------------------------------
// 1b) Webhook do Uber Direct — status da entrega e posição do entregador
//     POST /api/webhook/uber
//
// Configurar em direct.uber.com > Developer > Webhooks, apontando para esta
// URL e marcando os eventos delivery_status e courier_update. A signing key
// que eles geram vai no segredo UBER_WEBHOOK_SECRET.
//
// Autenticação é por ASSINATURA, não por login: a Uber calcula HMAC-SHA256 do
// corpo cru com a signing key e manda em x-uber-signature.
//
// Responder 2xx sempre que o evento tiver sido recebido, mesmo que não haja
// nada a fazer com ele. Um 4xx faz a Uber reenviar 3 vezes à toa; um 5xx
// também. Só devolvemos erro quando a assinatura não confere.
// ---------------------------------------------------------------------------
app.post("/api/webhook/uber", async (c) => {
  // CORPO CRU, antes de qualquer parse: a assinatura é sobre estes bytes
  // exatos. Reserializar o JSON muda espaçamento e quebra o hash.
  const corpoBruto = await c.req.text();

  const recebida =
    c.req.header("x-uber-signature") ?? c.req.header("x-postmates-signature");

  // Aceita a chave dos DOIS modos. Uma entrega criada em teste continua
  // mandando eventos depois de virar a chave para produção — validar só contra
  // o modo atual descartaria esses eventos e a entrega ficaria congelada no
  // painel. Ambas as chaves são nossas, então não afrouxa a segurança.
  const chaves = [
    credenciaisUber(c.env, await modoAtual(c.env)).webhookSecret,
    c.env.UBER_WEBHOOK_SECRET,
    c.env.UBER_WEBHOOK_SECRET_TESTE,
  ].filter((k): k is string => !!k && k.trim() !== "");

  if (chaves.length === 0) {
    // Falha fechada. Sem a signing key não há como distinguir um evento real
    // de alguém forjando "entrega concluída".
    console.warn("[uber-webhook] nenhuma signing key configurada");
    return c.json({ erro: "webhook não configurado" }, 500);
  }

  let autenticado = false;
  for (const chave of chaves) {
    if (await assinaturaValida(chave, corpoBruto, recebida ?? null)) {
      autenticado = true;
      break;
    }
  }

  if (!autenticado) {
    console.warn("[uber-webhook] assinatura inválida");
    return c.json({ erro: "assinatura inválida" }, 401);
  }

  try {
    const r = await processarWebhookUber(c.env, corpoBruto);
    if (!r.ok) {
      // Payload malformado: registrar e aceitar. Reenviar não vai consertar.
      console.warn(`[uber-webhook] ${r.motivo}`);
      return c.json({ ok: true, ignorado: r.motivo });
    }
    return c.json({ ok: true, duplicado: r.duplicado, detalhe: r.detalhe });
  } catch (e) {
    // Aqui sim vale 500: foi falha nossa, e o reenvio da Uber tem chance de
    // funcionar depois.
    console.error(
      `[uber-webhook] falha ao processar: ${e instanceof Error ? e.message : e}`
    );
    return c.json({ erro: "falha ao processar" }, 500);
  }
});

// ---------------------------------------------------------------------------
// 2) Listagem de pedidos
//    GET /api/pedidos?aba=abertos|historico&limite=50
// ---------------------------------------------------------------------------
app.get("/api/pedidos", async (c) => {
  const aba = c.req.query("aba") === "historico" ? "historico" : "abertos";
  const limite = Number(c.req.query("limite") ?? 50);

  const pedidos = await listarPedidos(c.env, {
    abertos: aba === "abertos",
    limite: Number.isFinite(limite) ? limite : 50,
  });

  return c.json({ aba, pedidos });
});

// ---------------------------------------------------------------------------
// 2b) Histórico de entregas, com filtros
//     GET /api/historico?de=&ate=&plataforma=&status=&busca=&limite=&offset=
//     GET /api/historico/csv  (mesmos filtros)
//
// Base é `deliveries`, não `pedidos`: o cron limpa pedidos com mais de 30 dias
// e um histórico montado sobre eles se esvaziaria sozinho.
// ---------------------------------------------------------------------------
function filtrosDaQuery(c: {
  req: { query: (k: string) => string | undefined };
}): FiltroHistorico {
  const teste = c.req.query("teste");

  return {
    de: c.req.query("de"),
    ate: c.req.query("ate"),
    plataforma: c.req.query("plataforma"),
    status: c.req.query("status"),
    busca: c.req.query("busca"),
    teste: teste === "sim" || teste === "nao" ? teste : undefined,
    limite: Number(c.req.query("limite") ?? 100),
    offset: Number(c.req.query("offset") ?? 0),
  };
}

app.get("/api/historico", async (c) => {
  return c.json(await listarHistorico(c.env, filtrosDaQuery(c)));
});

app.get("/api/historico/csv", async (c) => {
  const filtros = filtrosDaQuery(c);
  const csv = await historicoCsv(c.env, filtros);

  return new Response(csv, {
    headers: {
      // charset explícito: sem isso o Excel ignora o BOM em algumas versões.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeArquivoCsv(filtros)}"`,
      "Cache-Control": "no-store",
    },
  });
});

// ---------------------------------------------------------------------------
// 2c) Confirmar entrega do motoboy próprio
//     POST /api/entrega/:idPedido/concluir  { status: "delivered" | "canceled" }
//
// O motoboy não tem webhook — sem isto o status dele fica "Acionado" para
// sempre e o histórico nunca reflete o que aconteceu.
// ---------------------------------------------------------------------------
app.post("/api/entrega/:idPedido/concluir", async (c) => {
  const body = await c.req.json<{ status?: string }>().catch(() => null);
  const status = body?.status === "canceled" ? "canceled" : "delivered";

  const r = await marcarEntregaManual(
    c.env,
    c.req.param("idPedido"),
    status,
    c.get("usuario").email
  );

  if (!r.ok) return c.json({ erro: r.erro }, 400);
  return c.json({ ok: true, status });
});

// ---------------------------------------------------------------------------
// 2c-bis) Fechar vários pedidos como entregues por OUTRA plataforma
//         POST /api/entrega/concluir-lote  { ids: [...] }
//
// O caminho tem DOIS segmentos de propósito. A primeira versão era
// /api/entrega/lotes/concluir, que tem o mesmo formato de
// /api/entrega/:idPedido/concluir — e o Hono casava a rota de parâmetro
// primeiro, com idPedido="lotes". A rota de lote nunca era alcançada, e o erro
// que voltava vinha da outra função.
// ---------------------------------------------------------------------------
app.post("/api/entrega/concluir-lote", async (c) => {
  const body = await c.req.json<{ ids?: string[] }>().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];

  if (ids.length === 0) {
    return c.json({ erro: "Selecione pelo menos um pedido." }, 400);
  }

  const r = await marcarEntregasEmLote(c.env, ids, c.get("usuario").email);

  if (!r.ok) return c.json({ erro: r.erro }, 400);
  return c.json({ ok: true, processados: r.processados, ignorados: r.ignorados });
});

// ---------------------------------------------------------------------------
// 2d) Solicitar novo envio — quando faltou item e precisa de outra corrida
//     POST /api/entrega/:idPedido/reenviar
// ---------------------------------------------------------------------------
app.post("/api/entrega/:idPedido/reenviar", async (c) => {
  const r = await prepararReenvio(
    c.env,
    c.req.param("idPedido"),
    c.get("usuario").email
  );

  if (!r.ok) return c.json({ erro: r.erro }, 400);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 3) Cotação simultânea nos provedores LIGADOS
//    GET /api/cotacao/:idPedido
// ---------------------------------------------------------------------------
app.get("/api/cotacao/:idPedido", async (c) => {
  const env = c.env;
  const idPedido = c.req.param("idPedido");

  let pedido = await obterPedido(env, idPedido);
  if (!pedido) return c.json({ erro: "pedido não encontrado" }, 404);

  // Antes de recusar por falta de pagamento, PERGUNTA de novo ao Cardápio Web.
  //
  // O pedido no Pix entra com o pagamento pendente e compensa segundos depois.
  // O normal é o webhook de status avisar, mas se ele falhar o pedido fica
  // preso na fila para sempre. A releitura acontece só neste caso — pedido já
  // pago não gera chamada nenhuma.
  if (pedido.pago === false) {
    pedido = (await revalidarPedido(env, pedido)) ?? pedido;
  }

  // SÓ COTAMOS PEDIDO PAGO.
  //
  // Cotar já custa: o Uber cria uma cotação real e o atendente vê um botão
  // pronto para clicar. Se o pagamento cair depois, o pedido volta a aparecer
  // pelo webhook de status e a cotação acontece normalmente.
  //
  // `pago !== false` porque pedido antigo, de antes deste campo existir, não
  // tem a informação — e travar a fila que já estava lá seria pior.
  //
  // O pedido vai junto na resposta de recusa: sem ele a tela ficaria vazia, e
  // o atendente não conseguiria nem conferir de qual pedido se trata.
  const recusa = { idPedido, pedido, cotacoes: [], maisBarato: null, despacho: null, entrega: null };

  // Cancelamento é checado ANTES do pagamento. Um pedido cancelado que também
  // está sem pagamento não tem duas pendências: o cancelamento encerra o
  // assunto, e responder "aguardando pagamento" mandaria o atendente esperar
  // por algo que nunca vai acontecer.
  if (cancelado(pedido.statusCardapio)) {
    return c.json(
      {
        ...recusa,
        erro: "Este pedido foi cancelado no Cardápio Web.",
        bloqueio: "cancelado" as const,
      },
      409
    );
  }

  if (pedido.pago === false) {
    return c.json(
      {
        ...recusa,
        erro: "Pagamento ainda não confirmado no Cardápio Web.",
        bloqueio: "pagamento" as const,
      },
      409
    );
  }

  const ativos = provedoresAtivos(env);
  if (ativos.length === 0) {
    return c.json(
      { erro: "Nenhuma transportadora ativa. Veja em Configurações." },
      503
    );
  }

  // Fetch paralelo. allSettled para que a falha de UM provedor não derrube a
  // cotação dos demais — o painel mostra o que respondeu.
  // O modo decide QUAIS credenciais do parceiro serão usadas.
  const modo = await modoAtual(env);

  const resultados = await Promise.allSettled(
    ativos.map((p) => p.cotar(env, pedido, modo))
  );

  const cotacoes: Cotacao[] = resultados.map((r, i) => {
    const p = ativos[i];
    if (r.status === "fulfilled") return r.value;
    return {
      provider: p.id,
      nome: p.nome,
      disponivel: false,
      preco: null,
      moeda: "BRL",
      etaMinutos: null,
      quoteId: null,
      expiraEm: null,
      erro: r.reason instanceof Error ? r.reason.message : "falha na cotação",
    };
  });

  // Ordena: disponíveis primeiro, mais barato no topo.
  cotacoes.sort((a, b) => {
    if (a.disponivel !== b.disponivel) return a.disponivel ? -1 : 1;
    return (a.preco ?? Infinity) - (b.preco ?? Infinity);
  });

  await salvarCotacoes(env, idPedido, cotacoes);

  const maisBarato = cotacoes.find((x) => x.disponivel)?.provider ?? null;
  const despacho = await obterDespacho(env, idPedido);
  // Estado ao vivo vindo dos webhooks do parceiro (entregador, ETA, status).
  const entrega = await obterEntregaAoVivo(env, idPedido);

  // Sem despacho atual mas com entrega no histórico = o pedido foi reenviado.
  // A corrida que já aconteceu continua na tela, agora vinda do banco.
  const entregaAnterior = despacho ? null : await obterEntregaAnterior(env, idPedido);

  return c.json({
    idPedido,
    pedido,
    maisBarato,
    cotacoes,
    despacho,
    entrega,
    entregaAnterior,
  });
});

// ---------------------------------------------------------------------------
// 4) Despacho — cria a corrida no provedor escolhido
//    POST /api/despachar  { idPedido, provider, veiculo? }
// ---------------------------------------------------------------------------
app.post("/api/despachar", async (c) => {
  const env = c.env;
  const atendente = c.get("usuario");

  const body = await c.req
    .json<{ idPedido?: string; provider?: ProviderId; veiculo?: string }>()
    .catch(() => null);

  const idPedido = body?.idPedido;
  const provider = body?.provider;

  // Valor desconhecido cai em "moto" em vez de recusar o despacho: a
  // preferência é uma dica para a transportadora, não uma trava — travar a
  // corrida por causa dela seria trocar um problema pequeno por um grande.
  const veiculo: PreferenciaVeiculo = body?.veiculo === "carro" ? "carro" : "moto";
  if (!idPedido || !provider) {
    return c.json({ erro: "idPedido e provider são obrigatórios" }, 400);
  }

  // Trava 1 — provedor desligado não despacha, nem via chamada direta na API.
  const prov = provedorAtivo(env, provider);
  if (!prov) {
    return c.json(
      { erro: `provedor "${nomeProvedor(provider as ProviderId)}" está desativado` },
      403
    );
  }

  const pedido = await obterPedido(env, idPedido);
  if (!pedido) return c.json({ erro: "pedido não encontrado" }, 404);

  // Trava 1b — cancelado no Cardápio Web. Sem isto, um pedido cancelado que
  // ainda está na tela do atendente vira uma corrida cobrada por nada.
  if (cancelado(pedido.statusCardapio)) {
    return c.json({ erro: "Este pedido foi cancelado no Cardápio Web." }, 409);
  }

  // Trava 1c — não pago. Repetida aqui de propósito: a cotação pode ter sido
  // feita antes de alguém cancelar o pagamento, e é o despacho que gasta.
  if (pedido.pago === false) {
    return c.json(
      { erro: "Pagamento ainda não confirmado no Cardápio Web." },
      409
    );
  }

  // Trava 2 — já despachado? Devolve o resultado antigo em vez de cobrar outra
  // corrida. Cliques repetidos e F5 viram no-op.
  const jaFeito = await obterDespacho(env, idPedido);
  if (jaFeito) {
    return c.json({ ok: true, jaDespachado: true, ...jaFeito });
  }

  const cotacoes = await obterCotacoes(env, idPedido);
  const cotacao = cotacoes?.find((x) => x.provider === provider);
  if (!cotacao || !cotacao.disponivel) {
    return c.json({ erro: "Cotação inexistente. Cote novamente." }, 409);
  }

  // Trava 3 — cotação vencida. Uber/iFood expiram em minutos; sem esta checagem
  // o erro só aparecia depois de bater no parceiro.
  if (cotacao.expiraEm && Date.parse(cotacao.expiraEm) <= Date.now()) {
    return c.json({ erro: "Cotação expirada. Clique em Recotar." }, 409);
  }

  // Trava 4 — reserva atômica. Dois cliques simultâneos: só um passa daqui.
  if (!(await reservarDespacho(env, idPedido))) {
    const concorrente = await obterDespacho(env, idPedido);
    if (concorrente) return c.json({ ok: true, jaDespachado: true, ...concorrente });
    return c.json({ erro: "despacho já em andamento para este pedido" }, 409);
  }

  try {
    const modo = await modoAtual(env);
    const sequencia = await proximaSequenciaEntrega(env, idPedido);
    const resultado: ResultadoDespacho = await prov.despachar(
      env,
      pedido,
      cotacao,
      modo,
      veiculo,
      sequencia
    );

    await concluirDespacho(env, idPedido, resultado);
    // Histórico para o relatório. Guarda quem clicou e se foi teste.
    await registrarDelivery(env, pedido, cotacao, resultado, atendente.email, modo);

    return c.json({ ok: true, ...resultado });
  } catch (e) {
    // Parceiro recusou: solta a trava para o atendente poder tentar de novo.
    await liberarDespacho(env, idPedido);
    return c.json({ erro: e instanceof Error ? e.message : "falha ao despachar" }, 502);
  }
});

// ---------------------------------------------------------------------------
// 5) Estatísticas — tela de Relatórios
//    GET /api/estatisticas?dias=30
// ---------------------------------------------------------------------------
app.get("/api/estatisticas", async (c) => {
  const dias = Number(c.req.query("dias") ?? 30);
  const janela = Number.isFinite(dias) ? Math.min(Math.max(dias, 1), 365) : 30;

  const estatisticas = await calcularEstatisticas(c.env, janela);
  return c.json(estatisticas);
});

// ---------------------------------------------------------------------------
// 5b) MODO DE OPERAÇÃO — teste × produção
//     GET  /api/modo          (qualquer usuário logado — o painel usa no aviso)
//     POST /api/modo/trocar   { modo }  (admin)
//
// Decide QUAIS credenciais do parceiro são usadas. Em teste nada é cobrado.
// Ver config/modo.ts para a trava que impede dev/hml de operar em produção.
// ---------------------------------------------------------------------------
app.get("/api/modo", async (c) => {
  const modo = await modoAtual(c.env);
  const cred = credenciaisUber(c.env, modo);

  return c.json({
    modo,
    ambiente: ambiente(c.env),
    /** false = este Worker está travado em teste e nem oferece a troca. */
    podeTrocarParaProducao: podeUsarProducao(c.env),
    ultimaTroca: await quemTrocouModo(c.env),
    uber: {
      // Só o suficiente para o admin conferir que trocou de conta mesmo.
      // Nunca o secret.
      baseUrl: cred.baseUrl,
      customerId: cred.customerId ? `…${cred.customerId.slice(-6)}` : null,
      clientIdConfigurado: !!cred.clientId,
      webhookConfigurado: !!cred.webhookSecret,
    },
  });
});

app.post("/api/modo/trocar", async (c) => {
  const body = await c.req.json<{ modo?: string }>().catch(() => null);
  const alvo = body?.modo;

  if (alvo !== "teste" && alvo !== "producao") {
    return c.json({ erro: 'modo deve ser "teste" ou "producao"' }, 400);
  }

  // Não deixa virar a chave para produção sem as credenciais reais no lugar:
  // o resultado seria toda cotação falhando com o restaurante achando que
  // está no ar.
  if (alvo === "producao") {
    const cred = credenciaisUber(c.env, "producao");
    if (!cred.clientId || !cred.clientSecret || !cred.customerId) {
      return c.json(
        {
          erro:
            "Faltam credenciais de produção do Uber. Cadastre-as antes de trocar de modo.",
        },
        400
      );
    }
  }

  const r = await definirModo(c.env, alvo, c.get("usuario").email);
  if (!r.ok) return c.json({ erro: r.erro }, 400);

  console.log(`[modo] ${c.get("usuario").email} trocou para ${alvo}`);
  return c.json({ ok: true, modo: alvo });
});

// ---------------------------------------------------------------------------
// 6) Diagnóstico de configuração — tela de Configurações (admin)
//    GET /api/diagnostico
//
// Testa de verdade o que dá para testar sem gastar dinheiro: conexão com D1/KV,
// segredos preenchidos e autenticação OAuth2 nos parceiros ligados.
// ---------------------------------------------------------------------------
app.get("/api/diagnostico", async (c) => {
  return c.json(await rodarDiagnostico(c.env));
});

export default {
  fetch: app.fetch,

  // Dois crons (wrangler.toml), com trabalhos bem diferentes.
  async scheduled(evt: ScheduledController, env: Env, ctx: ExecutionContext) {
    // A limpeza é diária e pesada; a fila do Cardápio Web roda de 5 em 5 min.
    // Rodar tudo junto a cada 5 minutos seria varrer o banco 288× por dia.
    if (evt.cron === "0 4 * * *") {
      ctx.waitUntil(
        Promise.all([limparPedidosAntigos(env, 30), limparTokensAntigos(env)])
      );
      return;
    }

    ctx.waitUntil(reprocessarEventosCardapio(env));
  },
};

/**
 * Rede de segurança da fila do Cardápio Web.
 *
 * O waitUntil do webhook cobre o caso normal. Aqui é para quando ele falhou —
 * a API deles fora do ar, o pedido ainda não visível no momento da consulta —
 * e o pedido ficaria invisível para a loja. Não dá para contar com o reenvio
 * deles: são só 15 tentativas e depois o webhook é pausado.
 */
async function reprocessarEventosCardapio(env: Env): Promise<void> {
  const pendentes = await eventosCardapioPendentes(env, 20);
  for (const evento of pendentes) {
    await processarEventoCardapio(env, evento);
  }
};
