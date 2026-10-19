-- =============================================================
-- tarifas.sql — Tarifa de reparaciones por modelo y avería (19-oct-2026)
-- tienda_id es TEXTO como en el resto de tablas (ver fix-tienda-id-texto.sql).
-- =============================================================
create table if not exists public.tarifas (
  id text primary key,
  tienda_id text not null,
  marca text,
  modelo text not null,
  averia text not null,
  precio numeric not null,
  coste numeric,
  updated_at timestamptz not null default now()
);
create index if not exists tarifas_tienda_idx on public.tarifas (tienda_id);
alter table public.tarifas enable row level security;
drop policy if exists tarifas_select on public.tarifas;
drop policy if exists tarifas_insert on public.tarifas;
drop policy if exists tarifas_update on public.tarifas;
drop policy if exists tarifas_delete on public.tarifas;
create policy tarifas_select on public.tarifas for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy tarifas_insert on public.tarifas for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy tarifas_update on public.tarifas for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy tarifas_delete on public.tarifas for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- Comprobación: debe salir 1
select count(*) as tabla_creada from information_schema.tables where table_schema = 'public' and table_name = 'tarifas';
