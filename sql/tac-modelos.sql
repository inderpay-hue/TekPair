-- tac-modelos.sql - Reconocer marca y modelo por el IMEI (TekPair)
--
-- Las 8 primeras cifras del IMEI (TAC) identifican el modelo. La base oficial
-- (GSMA) es de pago, asi que TekPair APRENDE de lo que guardan las tiendas:
-- cada telefono guardado con IMEI + marca + modelo suma un voto a ese TAC, y la
-- proxima vez que alguien teclee un IMEI que empiece igual se rellena solo.
-- Complemento: una lista publica (MIT) servida como ficheros estaticos /tac/*.json
-- que se consulta solo si aqui no hay nada.
--
-- Solo se guarda "estas 8 cifras = este modelo": nunca el IMEI completo, ni la
-- tienda, ni el cliente. La tabla se toca SOLO por las dos funciones (RLS
-- activada y sin politicas). Se puede ejecutar dos veces. ASCII puro.

create table if not exists tac_modelos (
  tac         text not null check (tac ~ '^[0-9]{8}$'),
  marca       text not null,
  modelo      text not null,
  n           int  not null default 1,
  actualizado timestamptz not null default now()
);
create unique index if not exists ux_tac_modelos on tac_modelos (tac, (lower(marca)), (lower(modelo)));
alter table tac_modelos enable row level security;

-- El modelo mas votado para ese TAC (o nada).
create or replace function tac_buscar(p_tac text)
returns table (marca text, modelo text, n int)
language sql security definer stable set search_path = public as $$
  select t.marca, t.modelo, t.n from tac_modelos t
   where t.tac = p_tac
   order by t.n desc, t.actualizado desc
   limit 1;
$$;

-- Un voto para "este TAC es esta marca y modelo".
create or replace function tac_aprender(p_tac text, p_marca text, p_modelo text)
returns void language plpgsql security definer set search_path = public as $$
declare m text := left(btrim(coalesce(p_marca, '')), 40);
        o text := left(btrim(coalesce(p_modelo, '')), 80);
begin
  if p_tac is null or p_tac !~ '^[0-9]{8}$' or p_tac = '00000000' then return; end if;
  if length(m) < 2 or length(o) < 1 then return; end if;
  insert into tac_modelos (tac, marca, modelo) values (p_tac, m, o)
  on conflict (tac, (lower(marca)), (lower(modelo)))
  do update set n = tac_modelos.n + 1, actualizado = now();
end;
$$;

revoke all on function tac_buscar(text) from public;
revoke all on function tac_aprender(text, text, text) from public;
grant execute on function tac_buscar(text) to authenticated;
grant execute on function tac_aprender(text, text, text) to authenticated;

-- Arranque: lo que las tiendas YA tienen guardado (reparaciones, ventas, stock).
-- Solo IMEI de 15 cifras; si una tabla no tiene esas columnas se salta.
do $$
declare tb text;
begin
  foreach tb in array array['reparaciones', 'ventas', 'stock'] loop
    begin
      execute format($q$
        insert into tac_modelos (tac, marca, modelo, n)
        select left(d, 8),
               (array_agg(btrim(marca) order by (btrim(marca) ~ '^[A-Z]') desc, (btrim(marca) <> upper(btrim(marca))) desc))[1],
               (array_agg(btrim(modelo) order by (btrim(modelo) <> upper(btrim(modelo))) desc, (btrim(modelo) <> lower(btrim(modelo))) desc))[1],
               count(*)
          from (select regexp_replace(coalesce(imei, ''), '\D', '', 'g') as d, marca, modelo from %I) s
         where length(d) = 15 and left(d, 8) <> '00000000'
           and length(btrim(coalesce(marca, ''))) >= 2 and length(btrim(coalesce(modelo, ''))) >= 1
         group by left(d, 8), lower(btrim(marca)), lower(btrim(modelo))
        on conflict (tac, (lower(marca)), (lower(modelo)))
        do update set n = greatest(tac_modelos.n, excluded.n)
      $q$, tb);
    exception when others then raise notice 'tabla % saltada: %', tb, sqlerrm;
    end;
  end loop;
end $$;

-- Comprobacion: cuantos modelos ha aprendido ya de tus datos.
select count(distinct tac) as tacs_aprendidos, coalesce(sum(n), 0) as telefonos_contados from tac_modelos;
