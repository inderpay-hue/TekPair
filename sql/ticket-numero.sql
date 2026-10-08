-- Numero de documento en el ticket de venta.
--
-- Para que: el ticket no llevaba ningun identificador. Sin numero no se puede
-- referenciar una venta en una devolucion, ni buscarla, ni cuadrarla con el
-- gestor. Cualquier TPV del mercado lo lleva.
--
-- POR QUE UNA SECUENCIA CON DEFAULT Y NO UNA COLUMNA QUE RELLENE LA APP:
-- el numero lo pone POSTGRES en el propio INSERT, asi que la aplicacion NO
-- manda ese campo. Eso importa por dos razones:
--   1. Concurrencia: dos cajeros cobrando a la vez no pueden repetir numero.
--      Un max(numero)+1 calculado en el navegador si lo repetiria.
--   2. Seguridad del despliegue: en jul-2026 se mando al INSERT una columna
--      que no existia (stock_id) y Supabase devolvio 400 — las ventas se
--      quedaron SOLO en local durante seis semanas. Como aqui el cliente no
--      manda el campo, correr este SQL antes o despues del deploy da igual:
--      sin la columna el ticket sale sin numero y nada se rompe.
--
-- La secuencia es global, no por tienda: cada tienda ve sus numeros con huecos
-- (1, 5, 9...) pero SIEMPRE crecientes y nunca repetidos. Un correlativo por
-- tienda sin huecos exigiria bloquear la tabla en cada venta, y el ticket de
-- TekPair no es una factura: la factura, que si necesita serie correlativa,
-- se emite aparte desde facturacion.

create sequence if not exists ventas_numero_seq;

alter table ventas add column if not exists numero bigint default nextval('ventas_numero_seq');

-- Las ventas que ya existen se numeran por orden de creacion, para que el
-- historial quede coherente con lo que se imprima a partir de ahora.
do $$
begin
  if exists (select 1 from ventas where numero is null) then
    with ordenadas as (
      select id, row_number() over (order by created_at nulls last, id) as n
      from ventas where numero is null
    )
    update ventas v set numero = o.n from ordenadas o where v.id = o.id;
    -- La secuencia arranca por encima de lo ya asignado.
    perform setval('ventas_numero_seq', coalesce((select max(numero) from ventas), 0) + 1, false);
  end if;
end $$;

create index if not exists idx_ventas_numero on ventas(tienda_id, numero desc);

comment on column ventas.numero is 'Numero de documento del ticket. Lo asigna la secuencia en el INSERT: la app nunca lo manda.';
