-- ================================================================
-- SALDOS DE RECARGAS - monedero prepago por "cuenta" (agrupa 1+ companias)
-- Idempotente. Solo crea tablas nuevas + 1 columna. No toca datos existentes.
-- Ejecutar en el SQL Editor de Supabase.
-- ================================================================

create extension if not exists pgcrypto;

create table if not exists cajas_cuentas (
  id uuid primary key default gen_random_uuid(),
  tienda_id uuid not null,
  caja_id uuid not null references cajas(id) on delete cascade,
  nombre text not null,
  saldo numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_cajas_cuentas_tienda on cajas_cuentas(tienda_id);
create index if not exists idx_cajas_cuentas_caja on cajas_cuentas(caja_id);

alter table cajas_companias add column if not exists cuenta_id uuid references cajas_cuentas(id) on delete set null;

create table if not exists cajas_saldo_mov (
  id uuid primary key default gen_random_uuid(),
  tienda_id uuid not null,
  cuenta_id uuid not null references cajas_cuentas(id) on delete cascade,
  fecha date not null default current_date,
  tipo text not null,
  importe numeric(12,2) not null default 0,
  saldo_resultante numeric(12,2),
  nota text,
  usuario text,
  created_at timestamptz default now()
);

create index if not exists idx_cajas_saldo_mov_cuenta on cajas_saldo_mov(cuenta_id);

alter table cajas_cuentas enable row level security;
alter table cajas_saldo_mov enable row level security;

drop policy if exists cajas_cuentas_select on cajas_cuentas;
create policy cajas_cuentas_select on cajas_cuentas for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuentas_insert on cajas_cuentas;
create policy cajas_cuentas_insert on cajas_cuentas for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuentas_update on cajas_cuentas;
create policy cajas_cuentas_update on cajas_cuentas for update using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuentas_delete on cajas_cuentas;
create policy cajas_cuentas_delete on cajas_cuentas for delete using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

drop policy if exists cajas_saldo_mov_select on cajas_saldo_mov;
create policy cajas_saldo_mov_select on cajas_saldo_mov for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_saldo_mov_insert on cajas_saldo_mov;
create policy cajas_saldo_mov_insert on cajas_saldo_mov for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_saldo_mov_delete on cajas_saldo_mov;
create policy cajas_saldo_mov_delete on cajas_saldo_mov for delete using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
