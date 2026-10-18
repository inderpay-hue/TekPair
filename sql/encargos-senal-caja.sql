-- =============================================================
-- encargos-senal-caja.sql
-- La señal del encargo entra en la caja el día que se cobra (como una venta de
-- señal). El encargo guarda cuánto ya está en caja y qué venta es.
-- =============================================================
alter table public.encargos add column if not exists senal_registrada numeric(12,2) default 0;
alter table public.encargos add column if not exists senal_venta_id text;

-- Comprobación: debe salir 2
select count(*) as columnas from information_schema.columns
 where table_schema = 'public' and table_name = 'encargos' and column_name in ('senal_registrada', 'senal_venta_id');
