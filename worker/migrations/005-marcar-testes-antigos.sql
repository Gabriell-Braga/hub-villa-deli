-- ---------------------------------------------------------------------------
-- MIGRAÇÃO 005 — marca como TESTE tudo o que já existia em homologação.
--
-- Rodar SÓ em hml/dev. Em produção não faz sentido: lá não deve haver nada
-- antes do primeiro pedido real.
--
--   npx wrangler d1 execute hub-logistico-hml --remote --env hml \
--     --file=./migrations/005-marcar-testes-antigos.sql
--
-- Por que existe: os pedidos que já estavam no banco de homologação foram
-- todos gerados à mão durante o desenvolvimento, antes da coluna `teste`
-- existir — então nasceram com o padrão 0 e apareceriam como venda real no
-- Histórico e no Relatórios. Marcar é mais seguro que apagar: o histórico de
-- como o sistema se comportou continua disponível, só deixa de contar como
-- dinheiro gasto pela loja.
--
-- A marca vai em DOIS lugares de propósito: na coluna (usada pelos filtros e
-- relatórios) e dentro do JSON `dados` (que é de onde a lista de pedidos lê).
-- ---------------------------------------------------------------------------

UPDATE pedidos
   SET teste = 1,
       dados = json_set(dados, '$.teste', json('true'));

UPDATE deliveries SET teste = 1;

-- Eventos apontando para um pedido que não existe (id de exemplo da
-- documentação). Encerrados para o cron parar de tentar de 5 em 5 minutos.
UPDATE eventos_cardapio
   SET processado_em = datetime('now'),
       erro = 'encerrado na migração 005: pedido de exemplo, não existe na loja'
 WHERE processado_em IS NULL
   AND order_id = '7637461';
