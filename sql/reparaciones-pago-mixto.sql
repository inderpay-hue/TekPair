-- reparaciones-pago-mixto.sql - Pago final mixto al entregar una reparacion (TekPair)
--
-- Si lo que queda por cobrar se paga, por ejemplo, 50 con tarjeta y 30 en
-- efectivo: pago_final = 'Mixto' y el desglose en pagos_final
-- ([{"metodo":"Tarjeta","importe":50},{"metodo":"Efectivo","importe":30}]).
-- Ademas se crea un registro en pagos_reparacion por cada forma de pago, que es
-- lo que usan la caja y los reportes. Null = todo con la forma de pago_final.
-- Se puede ejecutar dos veces sin problema. ASCII puro a proposito.

alter table reparaciones add column if not exists pagos_final jsonb;

comment on column reparaciones.pagos_final is 'Desglose del pago final mixto: [{metodo, importe}]. Null = todo con pago_final.';

-- Comprobacion. Esperado: 1.
select count(*) as columna_pagos_final from information_schema.columns where table_name = 'reparaciones' and column_name = 'pagos_final';
