-- pedidos-revision-stock.sql - Piezas de pedidos recibidos pendientes de revisar (TekPair)
-- Pedidos apuntados como recibidos SIN tocar el stock (p. ej. importados de meses
-- pasados) llevan revision_stock = 'pendiente'. En Stock/Pedidos se revisan una a
-- una: 'en_stock' (se sumaron al stock) o 'usada' (ya se usaron o vendieron).
-- null = no aplica (lo normal: al recibir, el stock ya se pregunta). Ejecutable dos veces.
alter table pedidos add column if not exists revision_stock text;
-- Comprobacion: debe salir 1
select count(*) from information_schema.columns where table_name = 'pedidos' and column_name = 'revision_stock';
