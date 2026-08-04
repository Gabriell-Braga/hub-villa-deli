# Hub Logístico B2B

Middleware que recebe pedidos do **Cardápio Web**, cota frete em vários provedores
em paralelo (Uber Direct, iFood Entrega Fácil, 99 Entregas, Motoboy próprio),
despacha com um clique e guarda o histórico para relatório.

**White-label:** o mesmo build serve qualquer restaurante. Trocar de cliente é
um arquivo de logo + um bloco de variáveis — ver [Marca](#marca-white-label).
Instalação atual: **Villa Deli — Pizza & Burger**.

> **Provedores ligados: Uber Direct + Motoboy Próprio.** Ver [Trava de provedores](#trava-de-provedores).
>
> **Credenciais (Uber, Cardápio Web, HML × produção): [CREDENCIAIS.md](CREDENCIAIS.md).**
>
> **Publicar na Cloudflare + Vercel: [DEPLOY.md](DEPLOY.md).**

```
Cardápio Web ──webhook──▶ Worker (Hono) ──cotação paralela──▶ [Uber · Motoboy]
                              │                                     │
                    D1 (pedidos + deliveries + usuários)            ▼
                    KV (cache de token e geocodificação)   Painel Next.js
                              │                            login · fila ·
                              └──────────────────────────▶ histórico · relatórios
```

## Rodando pela primeira vez

Pré-requisitos: **Node 20+**. Nada mais — o D1 e o KV rodam simulados na sua
máquina, sem conta na Cloudflare.

### 1. Backend (terminal 1)

```bash
cd worker
npm install

# Segredos de desenvolvimento (WEBHOOK_SECRET e JWT_SECRET)
cp .dev.vars.example .dev.vars

# Banco local: tabelas + usuários de teste
npx wrangler d1 execute hub-logistico --local --file=./schema.sql
npx wrangler d1 execute hub-logistico --local --file=./seed.sql

# Opcional: 72 entregas fictícias para a tela de Relatórios não nascer vazia
node scripts/gerar-seed-demo.mjs
npx wrangler d1 execute hub-logistico --local --file=./seed-demo.sql

npm run dev            # http://localhost:8787
```

Os IDs `PREENCHER_...` no `wrangler.toml` **não atrapalham em dev** — o wrangler
simula D1 e KV localmente. Eles só importam no `deploy`.

### 2. Frontend (terminal 2)

```bash
cd painel
npm install
cp .env.local.example .env.local

# Gere o segredo do cookie de sessão e cole em NEXTAUTH_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

npm run dev            # http://localhost:3000
```

### 3. Entrar

Abra **http://localhost:3000** e use um dos usuários de teste:

| E-mail | Senha | Papel |
|---|---|---|
| `admin@restaurante.com` | `hub123456` | admin — vê Relatórios |
| `maria@restaurante.com` | `atende123` | atendente |

### 4. Simular um pedido do Cardápio Web

```bash
curl -X POST http://localhost:8787/api/webhook/cardapio-web \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: dev-webhook-123" \
  -d '{
    "id": "PED-1001",
    "cliente": { "nome": "João", "telefone": "+5531988887777" },
    "endereco": {
      "logradouro": "Av. Paulista", "numero": "1000", "bairro": "Bela Vista",
      "cidade": "São Paulo", "uf": "SP", "cep": "01310-100",
      "lat": -23.5613, "lng": -46.6558
    },
    "itens": [{ "nome": "Pizza", "quantidade": 1, "preco": 59.9 }],
    "total": 59.9
  }'
```

O pedido aparece em **Pedidos em Aberto** em até 15 s (a lista se atualiza sozinha).

> O **Motoboy Próprio** cota na hora, offline, pela tabela de raio — não depende
> de nenhum parceiro. O **Uber Direct** só vai cotar depois que a conta tiver o
> produto de entregas liberado (ver [CREDENCIAIS.md](CREDENCIAIS.md)); até lá ele
> aparece como indisponível ao lado do motoboy.

### Se algo não subir

| Sintoma | Causa quase certa |
|---|---|
| `wrangler dev` parece ignorar o `.dev.vars` | Processo antigo preso na porta. `netstat -ano \| findstr :8787` e `taskkill /PID <pid> /F` |
| `no such table: usuarios` | Faltou rodar `schema.sql` no D1 local |
| Login sempre recusa | Worker não está rodando, ou `HUB_API_URL` errado no `.env.local` |
| `NEXTAUTH_SECRET` missing | Faltou copiar `.env.local.example` para `.env.local` |

## Estrutura

```
worker/                 Backend — Cloudflare Worker + Hono
  schema.sql            pedidos · deliveries · usuarios
  seed.sql              usuários de teste
  scripts/
    hash-senha.mjs      gera o INSERT de um usuário novo
    gerar-seed-demo.mjs gera dados fictícios para o relatório
  src/index.ts          Rotas: login, webhook, pedidos, cotação, despacho, estatísticas
  src/config/
    provedores.ts       TRAVA: quem é cotado e pode ser despachado
    faixas-motoboy.ts   Tabela raio/preço do motoboy (espelho do Cardápio Web)
  src/services/         tokens.ts uber.ts ifood.ts noventa99.ts motoboy.ts
  src/lib/
    store.ts            Pedidos, deliveries, usuários e trava de despacho
    sessao.ts           Emissão e validação do JWT (middleware exigirLogin)
    senha.ts            PBKDF2-SHA256 via WebCrypto
    estatisticas.ts     Agregações do relatório
    auth.ts geocode.ts geo.ts

painel/                 Frontend — Next.js + Tailwind + NextAuth + Recharts
  middleware.ts              Bloqueia rota sem sessão
  lib/auth.ts                NextAuth (CredentialsProvider -> Worker)
  lib/hub.ts                 Proxy server-side que injeta o JWT
  app/login/                 Tela de login
  app/(painel)/layout.tsx    Sidebar + Header
  app/(painel)/pedidos/      Fila e detalhe/cotação
  app/(painel)/historico/    Entregas despachadas
  app/(painel)/relatorios/   Stat cards + gráficos
  components/                Sidebar · Header · StatCard · GraficoGastos · ListaPedidos
```

## Autenticação

```
Login  ─▶ NextAuth (Credentials) ─▶ POST /api/auth/login no Worker
                                     valida senha (PBKDF2) contra o D1
                                     devolve JWT HS256 (8 h)
                                        │
       cookie de sessão do NextAuth ◀───┘   (criptografado, httpOnly)
                                        │
Página ─▶ /api/... do Next ─▶ lê o JWT do cookie ─▶ Bearer ─▶ Worker
```

Três decisões que valem explicação:

- **O Worker é a autoridade de identidade**, não o painel. Quem valida senha e
  emite token é quem guarda o dinheiro.
- **O JWT do Hub nunca chega ao browser.** Ele fica só no cookie do NextAuth e é
  lido no servidor (`lib/hub.ts`). Se estivesse na `session`, apareceria no
  DevTools e daria para despachar corrida paga na mão.
- **Falha fechada.** Sem `JWT_SECRET` ou `WEBHOOK_SECRET` configurado, a rota
  recusa tudo em vez de liberar.

### Usuários e senhas

A tela **Usuários** (admin) cria, ativa/desativa e troca a permissão dos
atendentes. Ninguém digita a senha de outra pessoa:

1. O admin cadastra nome, e-mail e permissão. O usuário nasce **sem senha**.
2. O sistema gera um **link de acesso** de uso único, válido por 7 dias.
3. O usuário abre o link e define a própria senha.

"Esqueci minha senha" no login usa o mesmo caminho, com link de 2 horas.

**Ainda não há provedor de e-mail configurado**, então o link aparece na tela do
admin para ele repassar por WhatsApp (e vai também para o log do Worker). Para
enviar por e-mail de verdade, implemente o envio em `entregarLink()` de
[`worker/src/lib/tokens-senha.ts`](worker/src/lib/tokens-senha.ts) — nenhuma
outra parte do sistema muda.

Decisões que valem explicação:

- **No banco fica o SHA-256 do token**, nunca o token. Um vazamento do banco não
  entrega acesso às contas.
- **Uso único e validade curta.** Definir a senha invalida todos os outros links
  daquele usuário — um convite antigo não pode reabrir a conta depois.
- **Desativar um usuário mata os links pendentes dele.**
- **Travas contra ficar sem dono:** ninguém desativa nem rebaixa a própria conta,
  e o sistema exige ao menos um administrador ativo.
- **`/esqueci-senha` responde igual para e-mail existente e inexistente** — o
  contrário entregaria a lista de contas do restaurante.

O primeiro admin ainda precisa nascer fora do painel (é o ovo e a galinha):

```bash
cd worker
node scripts/hash-senha.mjs "senha-forte" "Seu Nome" voce@loja.com admin
# cole o INSERT impresso:
npx wrangler d1 execute hub-logistico --remote --command "<INSERT>"
```

Banco que já existe precisa da migração antes:

```bash
npx wrangler d1 execute hub-logistico --local  --file=./migrations/001-senha-e-tokens.sql
npx wrangler d1 execute hub-logistico --remote --file=./migrations/001-senha-e-tokens.sql
```

## Marca (white-label)

Nenhum componente tem nome, cor ou logo escrito no meio do código: todos leem de
[`painel/config/marca.ts`](painel/config/marca.ts), que por sua vez aceita
override por variável de ambiente. As cores viram **CSS custom properties**
injetadas no `<body>`, então trocar de cliente não recompila o Tailwind.

Para instalar em outro restaurante:

1. Salve o logo em `painel/public/marca/logo.png` (quadrado, 256 px+).
   Sem arquivo, o painel desenha um monograma com as iniciais — nada quebra.
2. Ajuste o bloco `NEXT_PUBLIC_MARCA_*` em `painel/.env.local`.
3. No worker: `RESTAURANTE_*` no `wrangler.toml` e a tabela de raio em
   `src/config/faixas-motoboy.ts`.

Detalhes e armadilhas em [CREDENCIAIS.md](CREDENCIAIS.md#5-marca-white-label).

## Ambientes: dev · hml · produção

```bash
npx wrangler dev                     # dev  — D1/KV simulados na sua máquina
npx wrangler dev --env hml           # hml  — credenciais de sandbox
npx wrangler deploy --env hml
npx wrangler deploy --env producao
```

Cada ambiente tem banco, KV e **segredos próprios**
(`wrangler secret put NOME --env hml`). O prefixo do cache no KV inclui o
ambiente, então um token de sandbox nunca é reaproveitado em produção.

Enquanto `AMBIENTE != "producao"`, o Uber usa `UBER_BASE_URL_HML` e
`UBER_CUSTOMER_ID_HML` — ver
[`worker/src/config/ambiente.ts`](worker/src/config/ambiente.ts).

## Tela de Configurações (diagnóstico)

`GET /api/diagnostico` (admin) testa de verdade o que dá para testar sem gastar
dinheiro: D1, KV, segredos preenchidos, coordenadas da loja e **autenticação
OAuth2 real no Uber** — sem criar corrida. Cada pendência mostra o comando exato
para resolver. Nenhum valor de segredo é exibido.

Abra **Configurações** no painel como admin antes de ligar qualquer ambiente novo.

## Trava de provedores

Um lugar só decide quem entra na cotação e quem pode receber despacho:
`PROVEDORES_ATIVOS` no [`worker/wrangler.toml`](worker/wrangler.toml).

```toml
PROVEDORES_ATIVOS = "uber,motoboy"           # configuração atual
# PROVEDORES_ATIVOS = "uber,motoboy"
# PROVEDORES_ATIVOS = "uber,ifood,99,motoboy"
```

Provedor desligado não é cotado, não aparece no painel e o `/api/despachar`
responde **403** mesmo se alguém chamar a API na mão. Em produção dá para trocar
sem deploy: **Cloudflare Dashboard → Workers → hub-logistico → Settings →
Variables**. Vazio = usa o padrão de `src/config/provedores.ts`.

## Rotas do Worker

| Rota | Proteção | O que faz |
|---|---|---|
| `POST /api/auth/login` | pública | Valida senha e emite o JWT |
| `GET /api/auth/eu` | JWT | Confere se a sessão ainda vale |
| `POST /api/webhook/cardapio-web` | `WEBHOOK_SECRET` | Recebe o pedido, geocodifica, grava |
| `GET /api/pedidos?aba=abertos\|historico` | JWT | Lista para as telas |
| `GET /api/cotacao/:id` | JWT | Cota em paralelo nos provedores ligados |
| `POST /api/despachar` | JWT | Cria a corrida e grava em `deliveries` |
| `GET /api/estatisticas?dias=30` | JWT | Agregações do relatório |
| `GET /api/diagnostico` | JWT + admin | Testa credenciais e integrações |
| `GET/POST /api/usuarios` | JWT + admin | Lista e cria atendentes |
| `PATCH /api/usuarios/:id` | JWT + admin | Ativa/desativa, troca permissão |
| `POST /api/usuarios/:id/link-acesso` | JWT + admin | Novo link de senha |
| `POST /api/auth/esqueci-senha` | pública | Gera link de recuperação |
| `GET /api/auth/token/:token` | pública | Valida um link de acesso |
| `POST /api/auth/definir-senha` | pública | Define a senha e queima o link |

## Relatórios

`GET /api/estatisticas` devolve, em uma ida só ao D1 (`db.batch`):

- **gasto total do mês** e número de entregas
- **quebra por plataforma** — gasto, entregas, custo médio, ETA médio
- **custo médio do frete**
- **série diária** dos últimos N dias (alimenta o gráfico de área)
- acumulado de todos os tempos

Fuso: as datas são gravadas em UTC, mas o corte de mês e o agrupamento por dia
usam **America/Sao_Paulo**. Sem isso, um pedido das 22h do dia 31 cairia no mês
seguinte. O Brasil não tem horário de verão desde 2019, então `-03:00` fixo é
seguro.

## Motoboy próprio — tabela de raio

O preço NÃO é proporcional à distância: é por **faixa (anel)**, igual ao Cardápio
Web. O cliente cai na **menor faixa ativa cujo raio >= distância em linha reta**
da loja. A tabela vive em
[`worker/src/config/faixas-motoboy.ts`](worker/src/config/faixas-motoboy.ts) e
**precisa ser idêntica** à aba "Regiões" do Cardápio Web — se divergir, o cliente
paga um valor e o restaurante calcula outro.

Distância é **Haversine (linha reta)**, de propósito: o Cardápio Web desenha
círculos no mapa. Usar distância de rota daria outro número.

Configure `RESTAURANTE_LAT` / `RESTAURANTE_LNG` no `wrangler.toml` com a
coordenada exata da loja — é a origem de todos os anéis. Errar 200 m aqui muda a
faixa de quem estiver na fronteira.

### Divergências encontradas no Cardápio Web (conferir no painel)

A tabela replica **exatamente** o que está configurado hoje, inclusive os erros:

- Existem **duas regiões de 8,5 km** (ambas R$ 22,99). A duplicata quebrou a
  progressão de R$ 1,00 a cada 500 m: de 9 km em diante tudo ficou R$ 1,00 mais
  barato do que o padrão (9 km deveria ser R$ 23,99, está R$ 22,99).
- **10,5 km (R$ 27,99) custa mais que 11 km (R$ 26,99)** — preço fora de ordem.
  Ambas estão desativadas hoje, então não afeta a operação.
- Não existe faixa de **1,5 km**: quem está entre 1,0 e 2,0 km paga R$ 9,99.
- Faixas de **10,5 km para cima estão desativadas** → raio máximo real = **10 km**.

## Deploy

```bash
cd worker
npx wrangler d1 create hub-logistico       # cole o database_id no wrangler.toml
npx wrangler kv namespace create HUB_KV    # cole o id
npx wrangler kv namespace create HUB_KV --preview

npx wrangler d1 execute hub-logistico --remote --file=./schema.sql

npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put JWT_SECRET         # openssl rand -base64 48
npx wrangler secret put UBER_CLIENT_ID
npx wrangler secret put UBER_CLIENT_SECRET

npm run deploy
```

No painel, ajuste `PAINEL_ORIGIN` no `wrangler.toml` para o domínio real e
`NEXTAUTH_URL` / `HUB_API_URL` no ambiente do Next.

## Notas de produção

- **Por que D1 e não KV para pedidos**: o KV é eventualmente consistente e aceita
  1 escrita/s por chave — o painel lê o pedido segundos depois do webhook e isso
  dava "pedido não encontrado" intermitente. O KV ficou só para cache.
- **`deliveries` não tem FK para `pedidos`**, de propósito: o cron limpa
  `pedidos` depois de 30 dias, e a FK ou faria o DELETE falhar ou levaria o
  histórico junto.
- **Despacho não duplica**: reserva atômica (`UPDATE ... WHERE status IN (...)`)
  antes de chamar o parceiro, mais `UNIQUE(id_pedido)` em `deliveries` como
  última defesa. Testado com 5 chamadas concorrentes: 1 corrida.
- **Webhook idempotente**: reenvio do mesmo `id` responde 200 com `novo: false`.
- **Cotação vencida**: o despacho recusa com 409 se `expiraEm` já passou.
- **Cache de token**: `access_token` no KV com TTL alinhado ao `expires_in`
  (menos 60 s). Evita estourar o rate limit de auth.
- **Geocodificação**: ViaCEP + Google (se houver chave) com fallback Nominatim,
  cache de 30 dias no KV por CEP+número.
- **Endpoints dos parceiros**: iFood e 99 ainda usam o padrão documentado, não
  confirmado em contrato — por isso estão desligados na trava. No Uber Direct,
  confirme `fee` (centavos) e `duration` (minutos) com a resposta real.
