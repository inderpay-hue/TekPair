-- ===========================================================================
-- CUENTAS PAGADAS EN EFECTIVO (alta desde el panel de admin)
-- ===========================================================================
-- El dueno visita la tienda, cobra en mano 3/6/9/12 meses y crea la cuenta
-- desde el panel. Sin pasar por Stripe no hay comision.
--
-- La tienda entra y ve los meses que le quedan. Se le pide la tarjeta como
-- garantia: un aviso al mes que puede omitir y, cuando quedan 2 meses o menos,
-- una pantalla que no se puede saltar.
--
-- Sin acentos a proposito (problemas de codificacion al pegar en el editor).
-- Se puede ejecutar mas de una vez sin romper nada.
-- ===========================================================================


-- 1. Marca de cuenta cobrada en mano ---------------------------------------
-- Sirve para que el sistema NO espere movimientos de Stripe en esta cuenta y
-- para que el panel sepa a quien hay que ir a visitar.
alter table tiendas add column if not exists cobro_manual boolean not null default false;

comment on column tiendas.cobro_manual is 'true = los meses se pagaron en mano, no por Stripe';


-- 2. Rastro de los cobros en mano ------------------------------------------
-- Cuanto se cobro, cuando y quien lo apunto. Sin esto, dentro de un ano nadie
-- se acuerda de si aquella tienda pago 6 meses o 9.
create table if not exists cobros_efectivo (
  id uuid primary key default gen_random_uuid(),
  tienda_id text not null,
  meses int not null,
  importe numeric(10,2),
  plan text,
  desde date not null,
  hasta date not null,
  nota text,
  creado_por text,
  creado_at timestamptz default now()
);

create index if not exists idx_cobros_efectivo_tienda on cobros_efectivo(tienda_id);

-- RLS SIN POLITICAS a proposito. Esta tabla dice cuanto paga en mano cada
-- tienda: es informacion del dueno, no de la tienda. Con RLS activada y ninguna
-- politica, nadie la lee con las claves anon/authenticated; solo la service key
-- del servidor (que salta RLS), que es quien la escribe desde el panel.
alter table cobros_efectivo enable row level security;

-- Nota: tienda_id va como TEXT a proposito. Los id de tienda que crea el alta
-- no son uuid ('tienda_1757...'), asi que declararlo uuid haria fallar el
-- insert justo en las cuentas que interesa registrar.


-- 3. Aviso de la tarjeta ---------------------------------------------------
-- Fecha en que la tienda dijo "ahora no" por ultima vez. El aviso vuelve a
-- salir un mes despues; en los ultimos 2 meses ya no se puede omitir.
alter table tiendas add column if not exists tarjeta_avisada_at timestamptz;

comment on column tiendas.tarjeta_avisada_at is 'Ultima vez que la tienda omitio el aviso de anadir tarjeta';


-- 4. Comprobacion ----------------------------------------------------------
select 'tiendas.cobro_manual'       as que, count(*) as existe from information_schema.columns where table_name='tiendas' and column_name='cobro_manual'
union all
select 'tiendas.tarjeta_avisada_at', count(*) from information_schema.columns where table_name='tiendas' and column_name='tarjeta_avisada_at'
union all
select 'tabla cobros_efectivo',      count(*) from information_schema.tables  where table_name='cobros_efectivo';
