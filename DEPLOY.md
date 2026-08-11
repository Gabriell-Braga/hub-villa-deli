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

O ambiente de produção é **novo e separado**: banco próprio, cache próprio,
segredos próprios, projeto próprio na Vercel. Nada é compartilhado com
homologação — é o que garante que um teste nunca toque em venda real.

> **Os passos 6.1 a 6.6 já foram executados** em 11/08/2026. O Worker de
> produção está no ar em `https://hub-logistico.hub-villa-deli.workers.dev`.
> O que falta é a Vercel (6.7), o `PAINEL_ORIGIN` (6.8) e os webhooks (6.9).
> As seções continuam aqui porque servem para o próximo cliente.

---

### 6.0 Antes de começar: o que depende de terceiros

**1. O raio do Uber é de 5 km em linha reta.**
Acima disso ele recusa o endereço e só o motoboy próprio atende. É limite da
conta, não do Hub, e aparece na mensagem de recusa deles com o número exato.
Para ampliar, fale com o gerente (uberdirect@uber.com).

**2. Rotacione os segredos quando puder.**
O Client Secret do Uber e o token do Cardápio Web passaram por conversa. Gere
novos nos painéis dos parceiros e cadastre com `wrangler secret put`.

O token do Cardápio Web é o mesmo nos dois ambientes (a conta só tem um), então
trocar exige atualizar HML e produção juntos, senão homologação para de ler
pedidos.

> **O que NÃO é problema, apesar de já ter parecido.** A conta de produção do
> Uber tem sim o produto de entregas. Conferido em 11/08/2026 contra a API:
> pedindo `direct.organizations eats.deliveries` o OAuth concede os dois, e uma
> cotação real na conta de produção volta 200 com preço.
>
> Houve um período em que ela respondia `403 customer_blocked` e a conclusão
> registrada aqui era de que faltava o produto. Era engano, ou a situação
> mudou — de todo modo, `UBER_SCOPE` em produção precisa pedir **os dois**
> escopos. Pedir menos limita o Hub sozinho, e a falha só apareceria na hora
> de despachar.

---

### 6.1 Criar banco e cache de produção

```bash
cd worker
npx wrangler d1 create hub-logistico
```

Copie o `database_id` que ele imprime.

```bash
npx wrangler kv namespace create HUB_KV_PROD
```

Copie o `id` que ele imprime.

### 6.2 Preencher o `wrangler.toml`

No bloco `[env.producao]`, troque os dois marcadores:

```toml
[[env.producao.d1_databases]]
database_id = "<o database_id do passo 6.1>"

[[env.producao.kv_namespaces]]
id = "<o id do KV do passo 6.1>"
```

E em `[env.producao.vars]`, a origem do painel. Deixe como está por enquanto;
você volta aqui no passo 6.8 com a URL real da Vercel.

> **Cuidado com o lugar.** `database_id` vai dentro de
> `[[env.producao.d1_databases]]`, não no `[vars]` do topo. Colar no lugar
> errado faz o deploy falhar com uma mensagem que não explica o motivo.

### 6.3 Criar as tabelas

O `schema.sql` já está completo — ele traz tudo o que as sete migrações
construíram. **Não rode as migrações num banco novo**, só o schema:

```bash
npx wrangler d1 execute hub-logistico --remote --env producao --file=./schema.sql
```

Confira:

```bash
npx wrangler d1 execute hub-logistico --remote --env producao \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Devem aparecer sete tabelas: `config`, `deliveries`, `eventos_cardapio`,
`eventos_entrega`, `pedidos`, `tokens_senha`, `usuarios`.

> **Nunca rode `seed.sql` em produção.** Ele cria pedidos de demonstração.

### 6.4 Cadastrar os segredos

Cada comando pede o valor e não deixa rastro no repositório:

```bash
npx wrangler secret put JWT_SECRET          --env producao
npx wrangler secret put WEBHOOK_SECRET      --env producao
npx wrangler secret put CARDAPIO_WEB_TOKEN  --env producao
npx wrangler secret put UBER_CLIENT_ID      --env producao
npx wrangler secret put UBER_CLIENT_SECRET  --env producao
npx wrangler secret put UBER_WEBHOOK_SECRET --env producao
```

O que é cada um:

| Segredo | O que é | Onde consegue |
|---|---|---|
| `JWT_SECRET` | assina a sessão do painel | invente um valor longo e aleatório, **diferente do de HML** |
| `WEBHOOK_SECRET` | token que o Cardápio Web manda no header | você define; cola igual no painel deles (passo 6.9) |
| `CARDAPIO_WEB_TOKEN` | chave para o Hub **ler** os pedidos | Cardápio Web → Configurações → Integrações → API |
| `UBER_CLIENT_ID` / `UBER_CLIENT_SECRET` | conta real do Uber | direct.uber.com → Developer |
| `UBER_WEBHOOK_SECRET` | assinatura do webhook do Uber | gerada ao cadastrar o webhook (passo 6.9) |

Opcionais, se for usar: `UBER_CLIENT_ID_TESTE`, `UBER_CLIENT_SECRET_TESTE` e
`UBER_WEBHOOK_SECRET_TESTE` — permitem validar o Worker de produção contra o
sandbox antes de virar a chave. Recomendado.

### 6.5 Publicar o Worker

```bash
npx wrangler deploy --env producao
```

Anote a URL que ele imprime (algo como
`https://hub-logistico.<sua-conta>.workers.dev`). Confira que respondeu:

```bash
curl https://hub-logistico.<sua-conta>.workers.dev
```

Deve voltar `{"ok":true,...,"ambiente":"producao",...}`.

### 6.6 Criar o primeiro administrador

Sem isto ninguém entra no painel.

```bash
node scripts/hash-senha.mjs "uma-senha-forte" "Seu Nome" seu@email.com admin
```

Ele imprime um `INSERT` pronto. Cole no comando abaixo, entre aspas:

```bash
npx wrangler d1 execute hub-logistico --remote --env producao --command "<o INSERT>"
```

> Não monte esse comando por partes no terminal. O hash tem `$` e `+`, e o
> shell os interpreta — foi assim que uma senha ficou inválida em homologação.
> Cole o `INSERT` inteiro de uma vez.

### 6.7 Projeto do painel na Vercel

Um **projeto novo**, apontando para o mesmo repositório.

1. vercel.com → **Add New → Project** → importe `hub-cardapio-web`
2. **Root Directory**: `painel`
3. **Environment Variables**:

| Nome | Valor |
|---|---|
| `HUB_API_URL` | a URL do Worker do passo 6.5, **sem barra no final** |
| `NEXTAUTH_SECRET` | valor longo e aleatório, diferente do de HML |
| `NEXTAUTH_URL` | a URL que a Vercel te der (preencha depois do primeiro deploy) |
| `NEXT_PUBLIC_MARCA_NOME` | `Villa Deli` |
| `NEXT_PUBLIC_MARCA_TAGLINE` | `Pizza & Burger` |

4. **Deploy**

> A barra no final do `HUB_API_URL` já derrubou todos os logins uma vez:
> vira `//api/auth/login`, e o Hono devolve 404 sem explicar.

### 6.8 Fechar o círculo

Agora que você tem a URL do painel, volte ao `wrangler.toml`:

```toml
[env.producao.vars]
PAINEL_ORIGIN = "https://<sua-url>.vercel.app"
```

E publique de novo:

```bash
npx wrangler deploy --env producao
```

Entre no painel e faça login com o usuário do passo 6.6.

### 6.9 Ligar os webhooks

**Uber Direct** — direct.uber.com → Developer → Webhooks:

- URL: `https://hub-logistico.<sua-conta>.workers.dev/api/webhook/uber`
- Eventos: `delivery_status` e `courier_update`
- Copie a signing key e grave em `UBER_WEBHOOK_SECRET` (passo 6.4)

**Cardápio Web** — Configurações → Integrações → API:

- URL: `https://hub-logistico.<sua-conta>.workers.dev/api/webhook/cardapio-web`
- Token: o mesmo valor de `WEBHOOK_SECRET`
- Marque **Webhook ativado**

> **ATENÇÃO: só existe um webhook por loja.** Ao apontar para produção,
> homologação **para de receber pedidos**. Faça isso num horário de movimento
> baixo, e não tente manter os dois — um pedido não chega em dois lugares.

### 6.10 Conferir antes de valer dinheiro

O Worker de produção **sobe em modo teste**, de propósito: ele já recebe os
pedidos reais da loja, mas despacha contra o sandbox do Uber e **marca tudo
como teste**, fora dos Relatórios. É a janela para validar sem gastar.

No painel, vá em **Configurações** e confira que está tudo verde. Depois faça
um pedido de verdade na loja e acompanhe: ele tem que aparecer na fila com o
valor do frete correto e cotações nos dois parceiros.

Percorra também:

- [ ] Pedido chega na fila em segundos
- [ ] Frete cobrado bate com o que o cliente pagou
- [ ] Cotação sai nos dois parceiros
- [ ] Despacho pelo motoboy próprio funciona
- [ ] Histórico e CSV mostram a entrega
- [ ] Marcar em lote como "outra plataforma" tira da fila

### 6.11 Virar a chave

Só depois do 6.10.

**Configurações → Modo de operação → Produção.** Exige digitar `PRODUCAO` para
confirmar.

A partir daí **toda corrida despachada é real e cobrada**, e os pedidos param
de ser marcados como teste. A faixa amarela no topo do painel desaparece.

### 6.12 Se der errado

Voltar é imediato e não exige deploy: **Configurações → Modo de operação →
Teste**. As corridas já criadas continuam válidas — quem cancela é o painel do
parceiro — mas nenhuma nova é cobrada.

Se o problema for no código, `wrangler rollback --env producao` volta para a
versão anterior do Worker. Na Vercel, **Deployments → ... → Promote to
Production** na versão que funcionava.

---

### Checklist final

Feito em 11/08/2026:

- [x] Banco D1 e KV de produção criados, `wrangler.toml` preenchido
- [x] Schema aplicado (sete tabelas), `seed.sql` **não** rodado
- [x] Nove segredos cadastrados, `JWT_SECRET` diferente do de HML
- [x] `UBER_SCOPE` de produção pedindo os dois escopos, conferido contra a API
- [x] Worker publicado e respondendo
- [x] Primeiro admin criado sem senha, com link de convite

Falta:

- [ ] Projeto do painel na Vercel, com `NEXTAUTH_SECRET` próprio
- [ ] `PAINEL_ORIGIN` preenchido e Worker republicado
- [ ] Primeiro login pelo link de convite
- [ ] Webhook do Uber apontando para o Worker de produção
- [ ] Webhook do Cardápio Web repontado (homologação para de receber)
- [ ] Tabela de raio do motoboy conferida contra as Regiões do Cardápio Web
- [ ] Configurações 100% verde
- [ ] Um pedido real validado ponta a ponta ainda em modo teste
- [ ] Só então trocar o modo para produção
- [ ] Client Secret do Uber e token do Cardápio Web rotacionados (pode ser depois)

---

## Vender para outro restaurante

O mesmo código serve. Por cliente:

1. `[env.cliente2]` no `wrangler.toml`, com D1, KV e segredos próprios.
2. Projeto novo na Vercel apontando para o **mesmo repositório**, mudando só as
   variáveis `NEXT_PUBLIC_MARCA_*` e o logo em `public/marca/`.
3. `RESTAURANTE_*` e a tabela de raio do motoboy daquele cliente.

Nenhuma linha de componente muda. **Não forke o repositório por cliente** — é a
armadilha que mata produto white-label.
