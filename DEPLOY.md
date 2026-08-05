# Deploy — passo a passo

```
Cardápio Web ──webhook──▶ Cloudflare Worker (Hono)   ← backend
Uber Direct  ──webhook──▶      D1 + KV
                                  ▼
                            Painel Next.js            ← frontend (Vercel)
```

Duas plataformas: **Worker na Cloudflare**, **painel na Vercel**. Um
repositório só serve os dois — a Vercel aponta para a subpasta `painel/` e o
wrangler roda de dentro de `worker/`.

> **Ordem importa.** O Worker precisa saber a URL do painel (`PAINEL_ORIGIN`) e
> o painel precisa saber a URL do Worker (`HUB_API_URL`). Um depende do outro,
> então o Worker é publicado duas vezes. Se você já tem domínio decidido
> (`painel.villadeli.com.br`), dá para pular a segunda publicação preenchendo
> `PAINEL_ORIGIN` de antemão.

---

## Parte 1 — Worker na Cloudflare (homologação)

```bash
cd worker
npm install
npx wrangler login
```

### 1.1 Criar banco e cache

```bash
npx wrangler d1 create hub-logistico-hml
# copie o "database_id" para [[env.hml.d1_databases]] no wrangler.toml

npx wrangler kv namespace create HUB_KV_HML
# copie o "id" para [[env.hml.kv_namespaces]]
```

### 1.2 Criar as tabelas

Banco **novo** precisa só do `schema.sql` — ele já traz tudo:

```bash
npx wrangler d1 execute hub-logistico-hml --remote --file=./schema.sql
```

As pastas `migrations/` só servem para bancos que **já existem** e precisam
acompanhar mudanças de schema. Numa instalação nova, ignore.

> **Nunca rode `seed.sql` nem `seed-demo.sql` fora da sua máquina.** O primeiro
> cria usuários com senha fraca e pública; o segundo enche o relatório com 72
> entregas fictícias.

### 1.3 Segredos

Cada ambiente tem os seus. Nenhum vai para arquivo versionado.

```bash
npx wrangler secret put WEBHOOK_SECRET            --env hml   # o mesmo do Cardápio Web
npx wrangler secret put JWT_SECRET                --env hml   # openssl rand -base64 48
npx wrangler secret put UBER_CLIENT_ID_TESTE      --env hml
npx wrangler secret put UBER_CLIENT_SECRET_TESTE  --env hml
npx wrangler secret put UBER_WEBHOOK_SECRET_TESTE --env hml   # signing key do webhook
```

`JWT_SECRET` **precisa ser diferente** entre HML e produção — senão um token de
homologação vale em produção.

### 1.4 Conferir o wrangler.toml

No bloco `[env.hml.vars]`, os dados da loja já estão preenchidos. Falta só:

```toml
PAINEL_ORIGIN = "https://SEU-PAINEL-HML.vercel.app"   # ajusta no passo 3
UBER_CUSTOMER_ID_TESTE = "c1cc78e9-6147-5db8-82be-1b0f45446e09"
```

`PAINEL_ORIGIN` faz duas coisas: libera o CORS e é a **base dos links de
definição de senha**. Errado, os convites apontam para o lugar errado.

### 1.5 Publicar

```bash
npx wrangler deploy --env hml
```

Anote a URL: `https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev`

### 1.6 Criar o primeiro admin

Ele nasce fora do painel — é o ovo e a galinha da autenticação. Os demais são
criados pela tela de Usuários.

```bash
node scripts/hash-senha.mjs "sua-senha-forte" "Seu Nome" voce@villadeli.com.br admin
npx wrangler d1 execute hub-logistico-hml --remote --command "<o INSERT impresso>"
```

---

## Parte 2 — Painel na Vercel

### 2.1 Importar o repositório

Em vercel.com → **Add New → Project** → importe
`Gabriell-Braga/hub-cardapio-web`, com:

| Campo | Valor |
|---|---|
| **Root Directory** | `painel` |
| Framework | Next.js (detecta sozinho) |
| Build / Install | deixe o padrão |

O **Root Directory** é o passo que as pessoas erram. Sem ele a Vercel tenta
buildar a raiz do repositório e falha.

### 2.2 Variáveis de ambiente

```
HUB_API_URL      = https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev
NEXTAUTH_URL     = https://SEU-PAINEL-HML.vercel.app
NEXTAUTH_SECRET  = <gere abaixo>

NEXT_PUBLIC_MARCA_NOME     = Villa Deli
NEXT_PUBLIC_MARCA_TAGLINE  = Pizza & Burger
NEXT_PUBLIC_MARCA_LOGO     = /marca/logo.svg
NEXT_PUBLIC_MARCA_FAVICON  = /marca/favicon.svg
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

`NEXTAUTH_URL` você só sabe depois do primeiro deploy — publique, copie a URL
que a Vercel deu, preencha e faça **Redeploy**.

As cores da marca não precisam ir: os padrões de `config/marca.ts` já são os do
Villa Deli. Se for definir, **use aspas** — em `.env`, `#` inicia comentário.

### 2.3 Não rebuildar à toa

Settings → Git → **Ignored Build Step**:

```bash
git diff --quiet HEAD^ HEAD -- painel/
```

Assim commit que mexeu só no Worker não dispara build do painel.

---

## Parte 3 — Fechar o círculo

Com a URL do painel em mãos, volte ao `wrangler.toml`, corrija
`PAINEL_ORIGIN` em `[env.hml.vars]` e republique:

```bash
cd worker && npx wrangler deploy --env hml
```

---

## Parte 4 — Ligar os webhooks

### Cardápio Web

No painel deles, cadastre:

```
URL:    https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev/api/webhook/cardapio-web
Header: x-webhook-secret
Valor:  <o WEBHOOK_SECRET do passo 1.3>
```

Se usarem outro nome de header, ajuste `CARDAPIO_WEB_HEADER` no `wrangler.toml`.
O Hub também aceita `Authorization: Bearer` sem configuração.

### Uber Direct

Em **direct.uber.com → Developer → Webhooks → novo endpoint**:

```
URL:     https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev/api/webhook/uber
Eventos: delivery_status  e  courier_update
```

A **signing key** que eles geram vai em `UBER_WEBHOOK_SECRET_TESTE` (passo 1.3).
Sem ela o despacho funciona, mas o painel nunca fica sabendo que o entregador
chegou.

---

## Parte 5 — Conferir

Entre no painel como admin e abra **Configurações**. A tela testa de verdade
banco, cache, segredos, telefone, coordenadas, e autentica no Uber.

O esperado é **tudo verde**, com o modo em **teste** (faixa amarela no topo).

Teste o fluxo inteiro:

1. Dispare um pedido no webhook do Cardápio Web (exemplo no README).
2. Veja aparecer em **Pedidos em Aberto**.
3. Abra, cote, despache.
4. Confira o status ao vivo chegando pelo webhook do Uber.
5. Crie um atendente em **Usuários** e passe pelo link de definição de senha.

---

## Parte 6 — Produção

Só depois de HML validado.

### 6.1 Repetir a Parte 1 com `--env producao`

Recursos próprios (`hub-logistico`, `HUB_KV`), **segredos diferentes**, e mais
o conjunto de credenciais reais do Uber:

```bash
npx wrangler secret put UBER_CLIENT_ID      --env producao
npx wrangler secret put UBER_CLIENT_SECRET  --env producao
npx wrangler secret put UBER_WEBHOOK_SECRET --env producao
```

Em `[env.producao.vars]`:

```toml
PAINEL_ORIGIN = "https://painel.villadeli.com.br"
UBER_CUSTOMER_ID = "<customer id de produção>"
UBER_SCOPE = "direct.organizations eats.deliveries"   # se a conta real tiver a permissão
```

### 6.2 Segundo projeto na Vercel

Mesmo repositório, `HUB_API_URL` apontando para o Worker de produção.

### 6.3 Virar a chave

O Worker de produção **sobe em modo teste**, de propósito. Depois de conferir a
tela de Configurações, um admin troca em **Configurações → Modo de operação**
(exige digitar `PRODUCAO`).

A partir daí toda entrega despachada é real e cobrada.

### Checklist final

- [ ] Client Secret do Uber e token do Cardápio Web **rotacionados** (os atuais
      passaram por chat)
- [ ] `JWT_SECRET` de produção diferente do de HML
- [ ] Credenciais **de produção** do Uber cadastradas (as de hoje no bloco de
      produção são antigas e sem permissão de entregas)
- [ ] Webhook do Uber apontando para o Worker de produção
- [ ] `seed.sql` **não** rodado em produção
- [ ] Tabela de raio do motoboy conferida contra as Regiões do Cardápio Web
- [ ] Configurações 100% verde
- [ ] Só então trocar o modo para produção

---

## Vender para outro restaurante

O mesmo código serve. Por cliente:

1. `[env.cliente2]` no `wrangler.toml`, com D1, KV e segredos próprios.
2. Projeto novo na Vercel apontando para o **mesmo repositório**, mudando só as
   variáveis `NEXT_PUBLIC_MARCA_*` e o logo em `public/marca/`.
3. `RESTAURANTE_*` e a tabela de raio do motoboy daquele cliente.

Nenhuma linha de componente muda. **Não forke o repositório por cliente** — é a
armadilha que mata produto white-label.
