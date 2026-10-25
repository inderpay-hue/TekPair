-- gestiones-citas.sql - Citas que la tienda consigue PARA sus clientes (TekPair)
--
-- Cita previa de extranjeria, DNI, pasaporte... La tienda busca la cita, la
-- consigue y se la entrega al cliente. El pago va aparte del estado: unos
-- pagan antes y otros al recoger la cita. Cada cobro entra en la caja como una
-- venta (gestiones.pagos guarda fecha, importe, metodo y venta_id).
--
-- gestion_tipos: los tipos que gestiona cada tienda, con precio opcional (sin
-- precio, la app lo pregunta al crear la cita).
-- tienda_id es TEXTO (ver fix-tienda-id-texto.sql). Se puede ejecutar dos veces.

create table if not exists gestion_tipos (
  id          text primary key,
  tienda_id   text not null,
  nombre      text not null,
  precio      numeric(12,2),
  activo      boolean not null default true,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gestion_tipos_tienda on gestion_tipos(tienda_id);

create table if not exists gestiones (
  id                text primary key,
  tienda_id         text not null,
  tipo_id           text,
  tipo_nombre       text,
  precio            numeric(12,2) not null default 0,
  cobrado           numeric(12,2) not null default 0,
  pagos             jsonb not null default '[]'::jsonb,
  cliente_id        text,
  cliente_nombre    text,
  cliente_tel       text,
  cliente_doc       text,
  oficina           text,
  preferencias      text,
  estado            text not null default 'buscando',  -- buscando | conseguida | entregada | cancelada
  cita_fecha        date,
  cita_hora         text,
  cita_lugar        text,
  justificante      text,
  nota              text,
  fecha             date not null default current_date,
  fecha_conseguida  date,
  fecha_entregada   date,
  creado_por        text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_gestiones_tienda on gestiones(tienda_id, estado);

alter table gestion_tipos enable row level security;
drop policy if exists gestion_tipos_select on gestion_tipos;
drop policy if exists gestion_tipos_insert on gestion_tipos;
drop policy if exists gestion_tipos_update on gestion_tipos;
drop policy if exists gestion_tipos_delete on gestion_tipos;
create policy gestion_tipos_select on gestion_tipos for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy gestion_tipos_insert on gestion_tipos for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy gestion_tipos_update on gestion_tipos for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy gestion_tipos_delete on gestion_tipos for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));

alter table gestiones enable row level security;
drop policy if exists gestiones_select on gestiones;
drop policy if exists gestiones_insert on gestiones;
drop policy if exists gestiones_update on gestiones;
drop policy if exists gestiones_delete on gestiones;
create policy gestiones_select on gestiones for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy gestiones_insert on gestiones for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy gestiones_update on gestiones for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy gestiones_delete on gestiones for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- Comprobacion. Esperado: tipos 7 columnas, gestiones 24 columnas, 8 politicas.
select (select count(*) from information_schema.columns where table_name = 'gestion_tipos') as tipos_cols,
       (select count(*) from information_schema.columns where table_name = 'gestiones') as gestiones_cols,
       (select count(*) from pg_policies where tablename in ('gestion_tipos', 'gestiones')) as politicas;
