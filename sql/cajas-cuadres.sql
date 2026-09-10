-- ================================================================
-- CUADRE PERIODICO DE ENVIOS Y RECARGAS
-- El admin mete lo que dice el sistema del proveedor para un rango de fechas y
-- se compara con lo que tiene TekPair, para cazar lineas olvidadas, importes mal
-- tecleados o una compania apuntada donde no era.
--
-- Idempotente. Solo crea tablas nuevas: no toca nada de lo que ya existe.
-- Ejecutar en el SQL Editor de Supabase.
-- ================================================================

create extension if not exists pgcrypto;


-- Cabecera: un cuadre = una caja + un rango de fechas ---------------------
create table if not exists cajas_cuadres (
  id uuid primary key default gen_random_uuid(),
  tienda_id uuid not null,
  caja_id uuid not null references cajas(id) on delete cascade,
  desde date not null,
  hasta date not null,

  -- Total que dice el sistema del proveedor. Puede venir solo aqui (informe con
  -- un unico total) o desglosado por compania en cajas_cuadre_lineas.
  total_externo numeric(12,2),

  -- FOTO del total de TekPair en el momento de firmar el cuadre. Se guarda en
  -- vez de recalcularlo al vuelo a proposito: si alguien retoca un cierre viejo
  -- el mes que viene, el cuadre ya firmado NO debe cambiar. Perder eso seria
  -- perder la trazabilidad justo en lo que se quiere vigilar.
  total_tekpair numeric(12,2) not null default 0,
  diferencia numeric(12,2) not null default 0,

  -- Cuantos dias entraron y cuantos seguian en borrador al firmar. Sin esto, un
  -- descuadre por dias sin cerrar parece un descuadre de verdad.
  dias_cerrados int not null default 0,
  dias_borrador int not null default 0,

  estado text not null default 'borrador',   -- borrador | cerrado
  nota text,                                  -- obligatoria si hay diferencia
  creado_por text,
  creado_at timestamptz default now(),
  cerrado_at timestamptz
);

-- Un solo cuadre por caja y rango: evita duplicados si se pulsa dos veces.
create unique index if not exists idx_cajas_cuadres_unico
  on cajas_cuadres(caja_id, desde, hasta);
create index if not exists idx_cajas_cuadres_tienda on cajas_cuadres(tienda_id);


-- Detalle por compania ----------------------------------------------------
create table if not exists cajas_cuadre_lineas (
  id uuid primary key default gen_random_uuid(),
  tienda_id uuid not null,
  cuadre_id uuid not null references cajas_cuadres(id) on delete cascade,
  compania_id uuid references cajas_companias(id) on delete set null,

  -- Se guarda el nombre ademas del id: si mañana se borra o se renombra la
  -- compania, el cuadre firmado tiene que seguir siendo legible.
  compania_nombre text,

  total_externo numeric(12,2),
  total_tekpair numeric(12,2) not null default 0,
  diferencia numeric(12,2) not null default 0
);

create index if not exists idx_cajas_cuadre_lineas_cuadre on cajas_cuadre_lineas(cuadre_id);
create index if not exists idx_cajas_cuadre_lineas_tienda on cajas_cuadre_lineas(tienda_id);


-- RLS: mismo patron que el resto de cajas_* -------------------------------
alter table cajas_cuadres enable row level security;
alter table cajas_cuadre_lineas enable row level security;

drop policy if exists cajas_cuadres_select on cajas_cuadres;
create policy cajas_cuadres_select on cajas_cuadres for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuadres_insert on cajas_cuadres;
create policy cajas_cuadres_insert on cajas_cuadres for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuadres_update on cajas_cuadres;
create policy cajas_cuadres_update on cajas_cuadres for update using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuadres_delete on cajas_cuadres;
create policy cajas_cuadres_delete on cajas_cuadres for delete using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);

drop policy if exists cajas_cuadre_lineas_select on cajas_cuadre_lineas;
create policy cajas_cuadre_lineas_select on cajas_cuadre_lineas for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuadre_lineas_insert on cajas_cuadre_lineas;
create policy cajas_cuadre_lineas_insert on cajas_cuadre_lineas for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuadre_lineas_update on cajas_cuadre_lineas;
create policy cajas_cuadre_lineas_update on cajas_cuadre_lineas for update using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists cajas_cuadre_lineas_delete on cajas_cuadre_lineas;
create policy cajas_cuadre_lineas_delete on cajas_cuadre_lineas for delete using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);


-- ================================================================
-- VISTO BUENO DEL ADMIN sobre un cierre diario
-- El admin marca "revisado y correcto" para que se sepa que ese dia ya paso
-- por sus ojos. Va en cajas_cierres porque es un atributo del cierre, no una
-- entidad aparte.
-- ================================================================

alter table cajas_cierres add column if not exists revisado_por text;
alter table cajas_cierres add column if not exists revisado_at timestamptz;

comment on column cajas_cierres.revisado_por is 'Email del admin que dio el visto bueno; null = sin revisar';


-- ================================================================
-- ENLACE DE UN COBRO PARCIAL CON SU ORIGINAL
-- Un cobro parcial crea una fila nueva 'cobrado' y reduce el importe de la
-- original. Sin este enlace no habia forma de deshacerlo: la fila nueva es
-- indistinguible de un cobro entero, y devolverla a 'pendiente' dejaria la
-- deuda contada dos veces. Con el enlace, deshacer un parcial borra la fila y
-- le devuelve el importe a la original.
-- ================================================================

alter table cajas_fiados add column if not exists parcial_de uuid references cajas_fiados(id) on delete set null;

comment on column cajas_fiados.parcial_de is 'Si es un abono parcial, id del pendiente original del que salio';

create index if not exists idx_cajas_fiados_parcial_de on cajas_fiados(parcial_de);


-- Comprobacion ------------------------------------------------------------
select 'cajas_cuadres' as que, count(*) as columnas from information_schema.columns where table_name = 'cajas_cuadres'
union all
select 'cajas_cuadre_lineas', count(*) from information_schema.columns where table_name = 'cajas_cuadre_lineas'
union all
select 'cierres.revisado_por', count(*) from information_schema.columns where table_name = 'cajas_cierres' and column_name = 'revisado_por'
union all
select 'fiados.parcial_de', count(*) from information_schema.columns where table_name = 'cajas_fiados' and column_name = 'parcial_de';
