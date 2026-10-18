-- =============================================================
-- errores-sync.sql
-- Registro de los fallos al guardar/leer en la nube desde el panel (los manda
-- api/ayuda.js?action=sync-error). Sirve para enterarse cuando una tienda está
-- perdiendo datos sin saberlo. tienda_id es TEXTO, como en el resto de TekPair.
-- =============================================================
create table if not exists public.errores_sync (
  id            bigserial primary key,
  tienda_id     text not null,
  tienda_nombre text,
  usuario       text,
  metodo        text,
  tabla         text,
  status        int,
  codigo        text,
  mensaje       text,
  pantalla      text,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_errores_sync_fecha on public.errores_sync (created_at desc);
create index if not exists idx_errores_sync_tienda on public.errores_sync (tienda_id, created_at desc);
-- Solo el servidor (service role) escribe y lee.
alter table public.errores_sync enable row level security;

-- Comprobación: debe salir 1
select count(*) as tabla_creada from information_schema.tables where table_schema = 'public' and table_name = 'errores_sync';
