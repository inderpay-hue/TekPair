-- presupuesto-opcionales.sql - Extras opcionales en el presupuesto (TekPair)
--
-- Lineas que el taller ofrece y el cliente elige al aceptar el presupuesto
-- online (protector, funda, bateria...). Van APARTE de `servicios` a proposito:
-- asi el resguardo, la factura, los reportes y el stock no las ven hasta que
-- el cliente las acepta; entonces pasan a `servicios` y se recalcula el total.
-- Formato: [{"nombre":"Protector de cristal","precio":9.9,"estado":"pendiente|aceptado|rechazado"}]
-- Se puede ejecutar dos veces sin problema. ASCII puro.
alter table reparaciones add column if not exists opcionales jsonb not null default '[]'::jsonb;
select count(*) as columnas_opcionales from information_schema.columns
 where table_name = 'reparaciones' and column_name = 'opcionales';
