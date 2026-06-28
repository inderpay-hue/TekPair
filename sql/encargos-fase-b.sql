-- ════════════════════════════════════════════════════════════════
-- ENCARGOS DE CLIENTES (Fase B) — lista de espera de lo que pide el cliente
-- (≠ pedidos: pedidos = lo que compras al proveedor; encargos = lo que te pide el cliente)
-- Ejecutar en el SQL Editor de Supabase. Idempotente (se puede correr varias veces).
-- ════════════════════════════════════════════════════════════════

create table if not exists encargos (
  id             uuid primary key default gen_random_uuid(),
  tienda_id      uuid not null,
  producto       text not null,
  cliente_id     uuid,
  cliente_nombre text,
  cliente_tel    text,
  senal          numeric(12,2) default 0,
  pvp            numeric(12,2) default 0,
  estado         text not null default 'Pendiente',  -- Pendiente|Pedido|Llego|Avisado|Entregado
  proveedor      text,
  nota           text,
  fecha          date default current_date,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_encargos_tienda on encargos(tienda_id);

-- RLS multi-tenant (mismo patrón que el resto de tablas de la app: por tienda_id del JWT)
alter table encargos enable row level security;

drop policy if exists encargos_select on encargos;
create policy encargos_select on encargos
  for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

drop policy if exists encargos_insert on encargos;
create policy encargos_insert on encargos
  for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

drop policy if exists encargos_update on encargos;
create policy encargos_update on encargos
  for update using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

drop policy if exists encargos_delete on encargos;
create policy encargos_delete on encargos
  for delete using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

-- (Opcional) Realtime: si usas la publicación supabase_realtime para sync instantánea
-- entre dispositivos, añade la tabla (descomenta):
-- alter publication supabase_realtime add table encargos;
-- alter table encargos replica identity full;
