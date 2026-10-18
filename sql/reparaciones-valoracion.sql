-- =============================================================
-- reparaciones-valoracion.sql
-- Encuesta de satisfacción al entregar (valorar.html): nota 1–5, comentario y fecha.
-- =============================================================
alter table public.reparaciones add column if not exists valoracion smallint check (valoracion between 1 and 5);
alter table public.reparaciones add column if not exists valoracion_comentario text;
alter table public.reparaciones add column if not exists valoracion_at timestamptz;

-- Comprobación: debe salir 3
select count(*) as columnas from information_schema.columns
 where table_schema = 'public' and table_name = 'reparaciones'
   and column_name in ('valoracion', 'valoracion_comentario', 'valoracion_at');
