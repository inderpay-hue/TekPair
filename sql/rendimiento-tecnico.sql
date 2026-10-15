-- rendimiento-tecnico.sql - Quien repara y cuanto tarda (TekPair)
--
-- tecnico_id / tecnico_nombre: el tecnico asignado. Se asigna solo a quien pasa
--   la reparacion a "En Proceso" (y se puede cambiar a mano en la ficha). El
--   nombre se guarda tambien para que el informe siga leyendose aunque se borre
--   el usuario.
-- inicio_reparacion: primera vez que pasa a "En Proceso".
-- fin_reparacion:    cuando pasa a "Por Entregar" (o se entrega directamente).
-- Con eso Reportes calcula por tecnico: terminadas, tiempo medio, facturado,
-- ticket medio y que tipo de reparacion le lleva mas.
-- Se puede ejecutar dos veces sin problema. ASCII puro.
alter table reparaciones add column if not exists tecnico_id text;
alter table reparaciones add column if not exists tecnico_nombre text;
alter table reparaciones add column if not exists inicio_reparacion timestamptz;
alter table reparaciones add column if not exists fin_reparacion timestamptz;
create index if not exists idx_reparaciones_tecnico on reparaciones (tienda_id, tecnico_id);
select count(*) as columnas_rendimiento from information_schema.columns
 where table_name = 'reparaciones' and column_name in ('tecnico_id', 'tecnico_nombre', 'inicio_reparacion', 'fin_reparacion');
