-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 006 — o resultado da entrega, e o código de segurança na porta
--
--   npx wrangler d1 execute hub-logistico-hml --remote --env hml \
--     --file=./migrations/006-economia-da-entrega.sql
--
-- POR QUE ESTAS COLUNAS EXISTEM
--
-- O frete que o cliente paga é definido pela tabela de raio configurada no
-- Cardápio Web, e é cobrado ANTES de qualquer cotação. Escolher Uber ou
-- motoboy próprio não muda um centavo do que o cliente pagou — muda só quanto
-- sobra para a loja.
--
-- Sem guardar o frete cobrado junto de cada entrega, o histórico só conseguia
-- responder "quanto gastamos", que é meia pergunta. Com ele, responde a que
-- importa: cada entrega deu lucro ou prejuízo, e quanto.
--
-- Guardamos o valor no momento do despacho em vez de buscar depois, pela mesma
-- razão de `valor_pago`: `deliveries` é registro contábil. Se o cliente mudar
-- a tabela de preços amanhã, o histórico de ontem tem que continuar contando a
-- verdade de ontem.
-- ---------------------------------------------------------------------------

ALTER TABLE deliveries ADD COLUMN frete_cobrado REAL NOT NULL DEFAULT 0;

-- PIN que o cliente informa ao entregador na porta (Uber Direct). Sem ele o
-- entregador não fecha a entrega — é o que impede o pedido de ser deixado com
-- a pessoa errada. O motoboy próprio não tem, então aceita NULL.
ALTER TABLE deliveries ADD COLUMN codigo_entrega TEXT;
