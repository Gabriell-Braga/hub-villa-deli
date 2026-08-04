# Onde colocar cada credencial

> ⚠️ **Rotacione antes de produção.** As credenciais atuais do Villa Deli
> (Client Secret do Uber e token do Cardápio Web) foram transmitidas por chat.
> Gere novas nos respectivos portais antes de publicar em produção — o
> `.dev.vars` é local e git-ignorado, mas o canal por onde elas passaram não é.

Regra que vale para tudo: **segredo nunca entra em arquivo versionado.**
`wrangler.toml` e `config/marca.ts` vão para o git; `.dev.vars` e `.env.local`
não (estão no `.gitignore`).

| Onde | O que vai | Vai pro git? |
|---|---|---|
| `worker/wrangler.toml` | URLs, IDs públicos, nome da loja, coordenadas | ✅ sim |
| `worker/.dev.vars` | segredos **de desenvolvimento** | ❌ não |
| `wrangler secret put --env hml/producao` | segredos de HML e produção | ❌ ficam na Cloudflare |
| `painel/.env.local` | URL do Worker, `NEXTAUTH_SECRET`, marca | ❌ não |
| `painel/config/marca.ts` | padrões da marca (nome, cores) | ✅ sim |

---

## 1. Uber Direct

No portal `developer.uber.com`, na sua aplicação Direct, você tem **dois
conjuntos**: sandbox e produção. Eles não se misturam — client_id de sandbox
não funciona em produção e vice-versa.

| Valor do portal | Onde colocar |
|---|---|
| Client ID | segredo `UBER_CLIENT_ID` |
| Client Secret | segredo `UBER_CLIENT_SECRET` |
| Customer ID (sandbox) | `UBER_CUSTOMER_ID_HML` no `wrangler.toml` |
| Customer ID (produção) | `UBER_CUSTOMER_ID` no `wrangler.toml` |

O Customer ID **não é segredo** (vai na URL de toda requisição), por isso mora
no `wrangler.toml`. Client ID e Secret são segredos.

**Desenvolvimento** — edite `worker/.dev.vars`:
```
UBER_CLIENT_ID=<client id de sandbox>
UBER_CLIENT_SECRET=<client secret de sandbox>
```
e o customer id de sandbox no `wrangler.toml`, bloco `[vars]`:
```toml
UBER_CUSTOMER_ID_HML = "<customer id de sandbox>"
```

**Homologação:**
```bash
cd worker
npx wrangler secret put UBER_CLIENT_ID     --env hml
npx wrangler secret put UBER_CLIENT_SECRET --env hml
# e edite [env.hml.vars] no wrangler.toml:
#   UBER_CUSTOMER_ID_HML = "<customer id de sandbox>"
```

**Produção:**
```bash
npx wrangler secret put UBER_CLIENT_ID     --env producao
npx wrangler secret put UBER_CLIENT_SECRET --env producao
# e em [env.producao.vars]:
#   UBER_CUSTOMER_ID = "<customer id de produção>"
```

### Escopo OAuth2 — atenção

`UBER_SCOPE` no `wrangler.toml` está como **`direct.organizations`**, testado
contra a conta do Villa Deli em 04/08/2026.

O ponto que engana: o servidor de autenticação do Uber **não ignora** um escopo
que a aplicação não possui — ele derruba a requisição inteira com
`invalid_scope`, mesmo com Client ID e Secret corretos. Vários exemplos na
internet mandam pedir `direct.organizations eats.deliveries`; nessa conta isso
falha. Peça só o que a aplicação tem.

Quando o Uber liberar o produto de entregas para a aplicação, troque para:

```toml
UBER_SCOPE = "direct.organizations eats.deliveries"
```

### Estado atual da conta do Villa Deli (04/08/2026)

| Verificação | Resultado |
|---|---|
| Client ID + Secret | ✅ aceitos, token de 177 caracteres |
| Escopo `direct.organizations` | ✅ concedido |
| Escopo de entregas (`eats.deliveries`) | ❌ **não concedido** |
| Criar cotação / entrega | ❌ bloqueado: `401 This endpoint requires at least one of the following scopes: eats.deliveries` |

Testado nos dois hosts (`api.uber.com` e `sandbox-api.uber.com`) — mesmo
resultado, então não é questão de ambiente.

**Ação necessária:** pedir ao gerente de conta Uber para habilitar o produto
Direct/Deliveries nessa aplicação. Nada muda no código quando isso acontecer —
só o `UBER_SCOPE` acima. A tela de Configurações detecta e vira verde sozinha.

> **Confirme também o host de sandbox** (`UBER_BASE_URL_HML`) com o gerente de
> conta. `https://sandbox-api.uber.com` responde e é reconhecido pelo Uber, mas
> não deu para validar se é o sandbox correto do seu contrato enquanto a
> permissão de entregas não sai.

Como o código escolhe: enquanto `AMBIENTE != "producao"`, ele usa
`UBER_BASE_URL_HML` + `UBER_CUSTOMER_ID_HML`. Ver
[`worker/src/config/ambiente.ts`](worker/src/config/ambiente.ts).

---

## 2. Cardápio Web

O Cardápio Web **chama o Hub**, não o contrário. Então o que importa é o segredo
que ele envia no webhook.

| Valor | Onde colocar |
|---|---|
| Segredo/token do webhook | segredo `WEBHOOK_SECRET` |
| Nome do header que ele usa | `CARDAPIO_WEB_HEADER` no `wrangler.toml` |
| ID da loja / merchant | `CARDAPIO_WEB_MERCHANT_ID` no `wrangler.toml` |
| Token de API deles (se houver) | segredo `CARDAPIO_WEB_TOKEN` |

**O valor de `WEBHOOK_SECRET` é o mesmo dos dois lados.** Você define no Hub e
cadastra igual no painel do Cardápio Web, ou copia o que eles geraram.

Se o Cardápio Web usa outro nome de header (`x-signature`, `x-api-key`…),
ajuste `CARDAPIO_WEB_HEADER`. O Hub também aceita `Authorization: Bearer <token>`
automaticamente, sem configuração.

**URL para cadastrar no Cardápio Web:**
```
dev   http://localhost:8787/api/webhook/cardapio-web      (use ngrok para expor)
hml   https://hub-logistico-hml.SEU-SUBDOMINIO.workers.dev/api/webhook/cardapio-web
prod  https://hub-logistico.SEU-SUBDOMINIO.workers.dev/api/webhook/cardapio-web
```

---

## 3. Segredos internos do Hub

| Segredo | Para que serve | Como gerar |
|---|---|---|
| `WEBHOOK_SECRET` | valida o webhook | `openssl rand -base64 32` |
| `JWT_SECRET` | assina a sessão dos atendentes | `openssl rand -base64 48` |
| `NEXTAUTH_SECRET` | criptografa o cookie do painel | `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |

`NEXTAUTH_SECRET` vai em `painel/.env.local`, não no worker. Os outros dois vão
no worker.

**Nunca reutilize o mesmo `JWT_SECRET` entre HML e produção** — um token de
homologação passaria a valer em produção.

---

## 4. Dados da loja

No `wrangler.toml`, em cada bloco de ambiente:

```toml
RESTAURANTE_NOME = "Villa Deli"
RESTAURANTE_CEP = "30140-071"
RESTAURANTE_LAT = "-19.9386"      # coordenada da PORTA da loja
RESTAURANTE_LNG = "-43.9386"
RESTAURANTE_TELEFONE = "+5531999999999"
```

A coordenada é usada em duas coisas que custam dinheiro: o ponto de coleta
enviado ao Uber e o centro dos anéis de preço do motoboy próprio. Errar 200 m
muda a faixa de quem estiver na fronteira. Pegue no Google Maps: botão direito
sobre a porta da loja → o primeiro número é a latitude.

---

## 5. Marca (white-label)

Trocar o Hub de restaurante = **um arquivo de logo + um bloco de variáveis**.
Nenhuma linha de componente muda.

1. Salve o logo em `painel/public/marca/logo.png` (quadrado, 256 px ou mais).
   Se o arquivo não existir, o painel desenha um monograma com as iniciais.

2. Em `painel/.env.local`. **Cores precisam de aspas** — em arquivo `.env`, `#`
   começa um comentário, então `COR_PRIMARIA=#D97706` sem aspas chega vazio e o
   painel usa o padrão. Aceita também sem o `#` (`COR_PRIMARIA=D97706`):

```bash
NEXT_PUBLIC_MARCA_NOME="Villa Deli"
NEXT_PUBLIC_MARCA_TAGLINE="Pizza & Burger"
NEXT_PUBLIC_MARCA_LOGO="/marca/logo.png"
NEXT_PUBLIC_MARCA_COR_PRIMARIA="#1C1C1C"
NEXT_PUBLIC_MARCA_COR_PRIMARIA_HOVER="#000000"
NEXT_PUBLIC_MARCA_COR_CONTRASTE="#FFFFFF"
NEXT_PUBLIC_MARCA_COR_SUAVE="#F3F4F6"
NEXT_PUBLIC_MARCA_COR_SUAVE_TEXTO="#111827"
```

3. No worker, ajuste `RESTAURANTE_NOME` e a tabela de raio do motoboy
   (`worker/src/config/faixas-motoboy.ts`) para as regiões daquele cliente.

Os padrões ficam em [`painel/config/marca.ts`](painel/config/marca.ts) — as
variáveis de ambiente sempre vencem, então o **mesmo build serve todos os
clientes**. Não precisa forkar o código por restaurante.

---

## 6. Testando antes do primeiro pedido real

Entre no painel como **admin** e abra **Configurações**. A tela chama
`GET /api/diagnostico`, que verifica de verdade:

- ambiente em uso (dev / hml / **PRODUÇÃO** em vermelho)
- D1 e KV respondendo
- `WEBHOOK_SECRET` e `JWT_SECRET` preenchidos
- coordenadas da loja válidas
- **autenticação real no Uber** — pede o token OAuth2 e diz se as credenciais
  foram aceitas, sem criar nenhuma corrida

Cada pendência mostra o comando exato para resolver. Nenhum valor de segredo é
exibido — só se existe e se funcionou.

Rodando HML localmente:
```bash
cd worker
npx wrangler dev --env hml
```

Fluxo recomendado: **dev → hml → produção**, e só publique em produção com a
tela de Configurações inteira sem pendências em HML.
