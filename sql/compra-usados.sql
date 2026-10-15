-- compra-usados.sql - Compra de moviles usados a particulares (TekPair)
--
-- Cada compra a un particular deja:
--   - una fila en compras_usados: es a la vez el CONTRATO (lo que firmo el
--     vendedor) y el asiento del REGISTRO de compras de usados que piden en
--     muchos paises (libro registro, registre de police...).
--   - una unidad en stock con stock.compra_id apuntando aqui. Con eso el TPV
--     sabe el precio de compra y puede cobrar el impuesto solo sobre el margen.
--
-- Las anotaciones NO se borran (no hay politica de DELETE): un error se
-- corrige marcando la fila como anulada, con motivo, fecha y quien lo hizo.
-- Pasado el plazo de conservacion la app borra los datos del vendedor
-- (anonimizada = true) pero deja el asiento.
--
-- El numero es correlativo POR TIENDA y lo pone Postgres en el INSERT (la app
-- no lo manda): dos dependientes comprando a la vez no pueden repetirlo.
-- Se puede ejecutar dos veces sin problema. ASCII puro a proposito.

create table if not exists compras_usados (
  id                 uuid primary key default gen_random_uuid(),
  tienda_id          uuid not null,
  numero             integer,
  fecha              timestamptz not null default now(),
  -- Vendedor (particular)
  vendedor_nombre    text,
  vendedor_doc_tipo  text,
  vendedor_doc       text,
  vendedor_dir       text,
  vendedor_tel       text,
  vendedor_email     text,
  -- Telefono
  categoria          text,
  marca              text,
  modelo             text,
  imei               text,
  imei2              text,
  capacidad          text,
  color              text,
  estado             text,
  notas              text,
  -- Pago
  precio             numeric(12,2) not null default 0,
  moneda             text,
  metodo_pago        text,
  -- Firma y lo que declaro el vendedor
  firma              text,
  declaraciones      jsonb,
  idioma             text,
  comprado_por       text,
  -- Enlaces
  stock_id           text,
  gasto_id           text,
  venta_id           text,
  venta_fecha        date,
  venta_cliente      text,
  -- Correcciones y plazo de conservacion
  anulada            boolean not null default false,
  anulada_motivo     text,
  anulada_at         timestamptz,
  anulada_por        text,
  anonimizada        boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists idx_compras_usados_tienda on compras_usados(tienda_id, numero desc);
create index if not exists idx_compras_usados_imei on compras_usados(tienda_id, imei);

-- Numero correlativo por tienda.
create or replace function compras_usados_numero() returns trigger
language plpgsql as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext('compras_usados:' || new.tienda_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from compras_usados where tienda_id = new.tienda_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_compras_usados_numero on compras_usados;
create trigger trg_compras_usados_numero before insert on compras_usados
  for each row execute function compras_usados_numero();

alter table compras_usados enable row level security;
drop policy if exists compras_usados_select on compras_usados;
create policy compras_usados_select on compras_usados for select using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists compras_usados_insert on compras_usados;
create policy compras_usados_insert on compras_usados for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
drop policy if exists compras_usados_update on compras_usados;
create policy compras_usados_update on compras_usados for update using (tienda_id = (auth.jwt() ->> 'tienda_id')::uuid);
-- Sin politica de DELETE a proposito: el registro no se borra.

-- El stock comprado a un particular apunta a su compra.
alter table stock add column if not exists compra_id text;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.compras_usados'; exception when others then null; end;
end $$;

-- Comprobacion. Esperado: 37 columnas, 3 politicas, stock_compra_id = 1.
select (select count(*) from information_schema.columns where table_name = 'compras_usados') as columnas,
       (select count(*) from pg_policies where tablename = 'compras_usados') as politicas,
       (select count(*) from information_schema.columns where table_name = 'stock' and column_name = 'compra_id') as stock_compra_id;
