-- ventas-pago-mixto.sql - Cobro cruzado / pago mixto en el TPV (TekPair)
--
-- Una venta de 150 que se paga 100 con tarjeta y 50 en efectivo se guarda con
-- pago = 'Mixto' y el desglose en pagos = [{"metodo":"Tarjeta","importe":100},
-- {"metodo":"Efectivo","importe":50}]. Las ventas normales dejan pagos en null
-- y siguen usando solo la columna pago, como hasta ahora.
-- Se puede ejecutar dos veces sin problema. ASCII puro a proposito.

alter table ventas add column if not exists pagos jsonb;

comment on column ventas.pagos is 'Desglose de un pago mixto: [{metodo, importe}]. Null = todo con la forma de pago de la columna pago.';

-- Comprobacion. Esperado: 1.
select count(*) as columna_pagos from information_schema.columns where table_name = 'ventas' and column_name = 'pagos';
