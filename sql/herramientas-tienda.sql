-- herramientas-tienda.sql - Herramientas y licencias de la tienda (TekPair)
--
-- Dos tipos en la misma tabla:
--   equipo   = maquinaria y herramienta (estacion de soldadura, separadora,
--              microscopio, ordenador...): compra, garantia, estado, ubicacion.
--   licencia = suscripciones de software y dongles/boxes: fecha de caducidad,
--              coste y periodicidad de la renovacion, si se renueva sola.
-- La app avisa en Notificaciones de lo que caduca en 30 dias o ya caduco.
-- Mismo aislamiento por tienda que el resto (tienda_id del JWT).
-- Se puede ejecutar dos veces sin problema. ASCII puro a proposito.

create table if not exists herramientas_tienda (
  id               uuid primary key default gen_random_uuid(),
  tienda_id        uuid not null,
  tipo             text not null default 'equipo',      -- equipo | licencia
  nombre           text not null,
  categoria        text,
  marca            text,
  modelo           text,
  num_serie        text,
  proveedor        text,
  fecha_compra     date,
  precio           numeric(12,2),
  garantia_hasta   date,
  caduca           date,                                -- licencias
  coste_renovacion numeric(12,2),
  periodicidad     text,                                -- mensual | anual | unico
  renovacion_auto  boolean not null default false,
  cuenta           text,                                -- usuario o cuenta de la licencia
  estado           text not null default 'operativa',   -- operativa | reparacion | baja
  ubicacion        text,
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_herrtienda_tienda on herramientas_tienda(tienda_id);
create index if not exists idx_herrtienda_caduca on herramientas_tienda(tienda_id, caduca);

alter table herramientas_tienda enable row level security;
drop policy if exists herramientas_tienda_select on herramientas_tienda;
create policy herramientas_tienda_select on herramientas_tienda for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists herramientas_tienda_insert on herramientas_tienda;
create policy herramientas_tienda_insert on herramientas_tienda for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists herramientas_tienda_update on herramientas_tienda;
create policy herramientas_tienda_update on herramientas_tienda for update using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists herramientas_tienda_delete on herramientas_tienda;
create policy herramientas_tienda_delete on herramientas_tienda for delete using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

-- Sincronizacion al instante entre dispositivos (como el resto de tablas).
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.herramientas_tienda'; exception when others then null; end;
end $$;

-- Comprobacion. Esperado: 22 columnas y 4 politicas.
select (select count(*) from information_schema.columns where table_name = 'herramientas_tienda') as columnas,
       (select count(*) from pg_policies where tablename = 'herramientas_tienda') as politicas;
