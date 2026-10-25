-- cobrado-por.sql - Quién cobró cada venta y cada pago de reparación (TekPair)
--
-- Para el informe «Cobrado por empleado» (Reportes). La app guarda el nombre de quien
-- abrió la caja con su código o, si no, el del usuario que ha entrado. Texto libre y
-- opcional: lo anterior queda vacío («Sin asignar»). La app solo manda la columna si
-- existe, así que se puede aplicar en cualquier momento. Se puede ejecutar dos veces.

alter table ventas add column if not exists cobrado_por text;
alter table pagos_reparacion add column if not exists cobrado_por text;

-- Comprobación. Esperado: 2
select count(*) as columnas from information_schema.columns
 where column_name = 'cobrado_por' and table_name in ('ventas', 'pagos_reparacion');
