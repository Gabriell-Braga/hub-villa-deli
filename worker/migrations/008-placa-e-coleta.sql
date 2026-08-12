-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 008 — placa do entregador e previsão de chegada na loja
--
--   npx wrangler d1 execute hub-logistico-hml --remote --env hml \
--     --file=./migrations/008-placa-e-coleta.sql
--   npx wrangler d1 execute hub-logistico --remote --env producao \
--     --file=./migrations/008-placa-e-coleta.sql
--
-- Os dois campos já vinham nos webhooks do Uber e estavam sendo descartados.
-- Conferido em evento real: `data.courier.vehicle_license_plate` e
-- `data.pickup_eta` existem no payload deles.
-- ---------------------------------------------------------------------------

-- PLACA. Duas motos pretas param na porta ao mesmo tempo e ninguém sabe qual é
-- a do pedido. É o dado que resolve a confusão no balcão em um segundo.
ALTER TABLE deliveries ADD COLUMN courier_placa TEXT;

-- QUANDO O ENTREGADOR CHEGA NA LOJA. Diferente de `dropoff_eta`, que é quando
-- ele chega no CLIENTE. Sem isto a cozinha não sabe se embala agora ou espera,
-- e comida pronta cedo demais esfria no balcão.
ALTER TABLE deliveries ADD COLUMN pickup_eta TEXT;
