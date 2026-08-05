# Deploy

Arquitetura publicada, seguindo o plano inicial:

```
Cardápio Web ──webhook──▶ Cloudflare Worker (Hono)  ← backend
                              │  D1 + KV
                              ▼
                         Painel Next.js             ← frontend
```

O **Worker vai para a Cloudflare** (era o plano). O **painel Next.js** não teve
hospedagem definida no plano — a recomendação está em [Onde hospedar o
painel](#onde-hospedar-o-painel).

---

## Antes de qualquer coisa: 4 bloqueios

| # | Bloqueio | Sem resolver |
|---|---|---|
| 1 | **Uber não liberou o produto de entregas** para a aplicação | O Hub sobe e loga, mas **nenhuma cotação funciona** |
| 2 | `RESTAURANTE_TELEFONE` ainda é `PREENCHER_TELEFONE_DA_LOJA` | O Uber exige telefone do ponto de coleta |
| 3 | Client Secret do Uber e token do Cardápio Web passaram por chat | Precisam ser rotacionados nos portais |
| 4 | O projeto **não é um repositório git** | Vercel/Pages precisam de repo (ou deploy por CLI) |

O item 1 atrasa só o Uber. O **motoboy próprio está ligado e funciona sozinho**,
então o Hub já é útil sem ele: recebe pedido, cota o motoboy, despacha e entra
no relatório. Se o restaurante tem entregador próprio, dá para ir a produção sem
esperar o Uber.

---

## Parte 1 — Worker na Cloudflare (homologação)

```bash
cd worker
npx wrangler login
```

### 1.1 Criar banco e cache

```bash
npx wrangler d1 create hub-logistico-hml
# copie o database_id para [[env.hml.d1_databases]] no wrangler.toml

npx wrangler kv namespace create HUB_KV_HML
# copie o id para [[env.hml.kv_namespaces]]
```

### 1.2 Criar as tabelas

```bash
npx wrangler d1 execute hub-logistico-hml --remote --file=./schema.sql
```

> **Não rode `seed.sql` nem `seed-demo.sql` fora do seu computador.** O primeiro
> cria usuários de teste com senha fraca e pública; o segundo suja o relatório
> com 72 entregas fictícias.

### 1.3 Segredos

Cada ambiente tem os seus. Nenhum vai para o `wrangler.toml`.

```bash
npx wrangler secret put WEBHOOK_SECRET     --env hml   # o mesmo do Cardápio Web
npx wrangler secret put JWT_SECRET         --env hml   # openssl rand -base64 48
npx wrangler secret put UBER_CLIENT_ID_TESTE      --env hml
npx wrangler secret put UBER_CLIENT_SECRET_TESTE  --env hml
npx wrangler secret put UBER_WEBHOOK_SECRET_TESTE --env hml
```

`JWT_SECRET` **precisa ser diferente** entre HML e produção — senão um token de
homologação vale em produção.

### 1.4 Ajustar o wrangler.toml

Em `[env.hml.vars]`:

```toml
RESTAURANTE_TELEFONE = "+5531XXXXXXXXX"          # obrigatório para o Uber
PAINEL_ORIGIN = "https://SEU-PAINEL-HML.vercel.app"
```

`PAINEL_ORIGIN` faz duas coisas: libera o CORS e é a **base dos links de
definição de senha**. Se estiver errado, os convites apontam para o lugar errado.

> **Ovo e galinha:** você só sabe a URL do painel depois de publicá-lo. Ou você
> decide o domínio antes (recomendado), ou publica o painel primeiro, volta aqui
> e faz `deploy` de novo.

### 1.5 Publicar

```bash
npx wrangler deploy --env hml
```

Sai algo como `https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev`. Guarde.

### 1.6 Criar o primeiro admin

O primeiro admin nasce fora do painel — é o ovo e a galinha da autenticação.
Todos os outros são criados pela tela de Usuários.

```bash
node scripts/hash-senha.mjs "sua-senha-forte" "Seu Nome" voce@villadeli.com.br admin
npx wrangler d1 execute hub-logistico-hml --remote --command "<o INSERT impresso>"
```

---

## Parte 2 — Painel

### Onde hospedar o painel

| | Vercel | Cloudflare Pages |
|---|---|---|
| Mudanças no código | **nenhuma** | `runtime = "edge"` em ~12 arquivos + adaptador `@cloudflare/next-on-pages` |
| NextAuth v4 | funciona direto | funciona, com atrito conhecido |
| Custo | grátis nesse volume | grátis |
| Tudo num provedor só | não | sim |

**Recomendo Vercel agora.** O plano inicial fixou a Cloudflare só para o
backend; o painel ficou em aberto. Migrar para Pages depois é possível, mas é
trabalho que não entrega nada ao restaurante hoje.

### 2.0 Um repositório só, não dois

Painel e Worker ficam **no mesmo repositório**. Eles mudam juntos: quase toda
rota nova no Worker exige a rota-proxy correspondente no painel. Em repositórios
separados isso vira dois PRs para cada funcionalidade, e os tipos espelhados à
mão (`painel/lib/tipos.ts` × `worker/src/types.ts`) saem de sincronia sem
ninguém perceber.

Repositórios separados só compensam quando os times são separados — por exemplo,
se você contratar um freelancer de frontend e não quiser dar acesso às
credenciais do Worker.

Isso não atrapalha o deploy: a Vercel aponta para uma subpasta (`painel`) e o
wrangler roda de dentro de `worker/`. Cada um publica o seu lado, do mesmo
commit.

**Ajuste na Vercel para não rebuildar à toa:** em Settings → Git → Ignored Build
Step, coloque

```bash
git diff --quiet HEAD^ HEAD -- painel/
```

Assim um commit que mexeu só no Worker não dispara build do painel.

> **Não forke o repositório por cliente.** É a armadilha que mata produto
> white-label: seis meses depois você tem seis cópias divergentes e uma correção
> de bug para aplicar em todas. Um repositório, N projetos na Vercel, N
> ambientes no wrangler — ver [Vender para outro
> restaurante](#vender-para-outro-restaurante).

### 2.1 Colocar no git

```bash
cd ..                     # raiz do projeto
git init
git add .
git commit -m "Hub Logístico"
```

O `.gitignore` já protege `.dev.vars` e `.env.local`. **Confira antes de
publicar:**

```bash
git status --short | grep -E "\.dev\.vars|\.env\.local"   # não pode retornar nada
```

Depois crie o repositório no GitHub e faça o push.

### 2.2 Publicar na Vercel

Import do repositório, com:

- **Root Directory:** `painel`
- **Framework:** Next.js (detecta sozinho)

Variáveis de ambiente:

```
HUB_API_URL      = https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev
NEXTAUTH_URL     = https://SEU-PAINEL-HML.vercel.app
NEXTAUTH_SECRET  = <node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">

NEXT_PUBLIC_MARCA_NOME     = Villa Deli
NEXT_PUBLIC_MARCA_TAGLINE  = Pizza & Burger
NEXT_PUBLIC_MARCA_LOGO     = /marca/logo.svg
NEXT_PUBLIC_MARCA_FAVICON  = /marca/favicon.svg
```

As cores não precisam ir — os padrões de `config/marca.ts` já são os do Villa
Deli. Se for definir, **use aspas**: em `.env`, `#` inicia comentário.

### 2.3 Fechar o círculo

Com a URL do painel em mãos, volte ao `wrangler.toml`, corrija `PAINEL_ORIGIN`
e republique:

```bash
cd worker && npx wrangler deploy --env hml
```

---

## Parte 3 — Ligar o Cardápio Web

No painel do Cardápio Web, cadastre o webhook:

```
URL:    https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev/api/webhook/cardapio-web
Header: x-webhook-secret
Valor:  <o mesmo WEBHOOK_SECRET do passo 1.3>
```

Se o Cardápio Web usar outro nome de header, ajuste `CARDAPIO_WEB_HEADER` no
`wrangler.toml`. O Hub também aceita `Authorization: Bearer` sem configuração.

---

## Parte 4 — Conferir

Entre no painel como admin e abra **Configurações**. A tela testa de verdade
banco, cache, segredos, coordenadas e autentica no Uber.

Enquanto o Uber não liberar entregas, o resultado esperado é:

```
[ OK ] tudo o mais
[ERRO] Uber Direct — Credenciais aceitas, mas a conta ainda não tem permissão
                     para criar entregas.
```

Teste o fluxo ponta a ponta que **não** depende do Uber:

1. Dispare um pedido de teste no webhook (exemplo no README).
2. Veja aparecer em **Pedidos em Aberto**.
3. Crie um atendente em **Usuários** e passe pelo link de definição de senha.

O **motoboy próprio já está ligado** e cota offline pela tabela de raio, sem
depender de parceiro nenhum. Dá para validar cotação e despacho ponta a ponta
em HML antes de o Uber liberar.

---

## Parte 5 — Produção

Só depois de HML validado **e** do Uber liberar o produto de entregas.

Repita a Parte 1 trocando `--env hml` por `--env producao`, com recursos
próprios (`hub-logistico`, `HUB_KV`) e **segredos diferentes**. Mais:

```toml
# [env.producao.vars]
UBER_SCOPE = "direct.organizations eats.deliveries"   # depois da liberação

# E os segredos de PRODUÇÃO (conjunto separado do de teste):
#   npx wrangler secret put UBER_CLIENT_ID      --env producao
#   npx wrangler secret put UBER_CLIENT_SECRET  --env producao
#   npx wrangler secret put UBER_WEBHOOK_SECRET --env producao
PAINEL_ORIGIN = "https://painel.villadeli.com.br"
```

Checklist final:

- [ ] Client Secret do Uber **rotacionado** (o atual passou por chat)
- [ ] Token do Cardápio Web **rotacionado**
- [ ] `JWT_SECRET` de produção diferente do de HML
- [ ] `RESTAURANTE_TELEFONE` preenchido
- [ ] Coordenada da loja conferida na porta (hoje é o centroide da Rua da Mata)
- [ ] `seed.sql` **não** rodado em produção
- [ ] Tabela de raio do motoboy conferida contra as Regiões do Cardápio Web
- [ ] Configurações 100% verde antes do primeiro pedido real
- [ ] Só então trocar o **modo de operação** para produção, na tela de
      Configurações (o Worker sobe em modo teste de propósito)

---

## Vender para outro restaurante

O mesmo código serve. Por cliente:

1. Um Worker novo: `[env.cliente2]` no `wrangler.toml` com D1, KV e segredos
   próprios.
2. Um projeto Vercel novo apontando para o mesmo repositório, mudando só as
   variáveis `NEXT_PUBLIC_MARCA_*` e o logo em `public/marca/`.
3. `RESTAURANTE_*` e a tabela de raio do motoboy daquele cliente.

Nenhuma linha de componente muda — ver [Marca](README.md#marca-white-label).
