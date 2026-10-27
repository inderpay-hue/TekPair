-- Cierre de caja: efectivo que se lleva al banco ese día (informativo; no cambia el
-- descuadre, porque sale del cajón después de contarlo).
alter table public.cajas_cierres add column if not exists ingreso_banco numeric(12,2) not null default 0;
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'cajas_cierres' and column_name = 'ingreso_banco';
