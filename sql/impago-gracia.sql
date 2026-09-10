-- ===========================================================================
-- DIA DEL IMPAGO (para contar bien los 7 dias de gracia)
-- ===========================================================================
-- Hasta ahora la gracia se deducia de plan_until, y cuando esa fecha venia vacia
-- se caia al fin del trial --que puede ser de hace meses--, asi que el cliente
-- quedaba cortado el MISMO dia del recibo devuelto, justo cuando lo que interesa
-- es que actualice la tarjeta.
--
-- Con esta columna la referencia es el dia exacto en que Stripe aviso del primer
-- recibo devuelto. La escribe el webhook (invoice.payment_failed, solo el primer
-- intento) y la limpia al cobrar (invoice.payment_succeeded).
--
-- Sin acentos a proposito: pegar SQL con caracteres no ASCII en el editor ha dado
-- problemas de codificacion otras veces.
--
-- Se puede ejecutar mas de una vez sin romper nada.
-- ===========================================================================


-- 1. La columna ------------------------------------------------------------
alter table tiendas add column if not exists impago_desde timestamptz;

comment on column tiendas.impago_desde is 'Fecha del primer recibo devuelto. Referencia de los 7 dias de gracia; null = al corriente';


-- 2. Las dos tiendas que ya estaban en impago -------------------------------
-- YA EJECUTADO el 10-sep-2026. Se deja como registro. Volver a correrlo es
-- inofensivo: los dos guardas (plan_status = 'past_due' y impago_desde is null)
-- ya no casan con nadie.
--
-- Como acabo: aleem pago y volvio a 'active' (plan hasta el 4-oct, impago_desde
-- limpio). ZONA MOBIL agoto los reintentos de Stripe y quedo 'cancelled' sin
-- acceso, que es lo correcto: nunca llego a pagar.
-- NO se rellenan con una regla generica: los dos casos son distintos y una misma
-- formula acierta en uno y se equivoca en el otro.
--
--   aleem ullah  -> pagaba desde julio. Su renovacion del 4-sep fallo y se quedo
--                   fuera ESE MISMO DIA por culpa del bug. Su plan_until real era
--                   4-sep-2026 antes de que el webhook lo vaciara.
--                   Con esta fecha recupera los dias de gracia que le quedan.
--
--   ZONA MOBIL   -> nunca llego a pagar: el primer cobro fallo al acabar la
--                   prueba (27-ago). Su gracia corrio del 27-ago al 3-sep y ya
--                   esta agotada. Se le pone su fecha real, no una nueva: con
--                   ella SIGUE cortado, que es lo correcto.
--
-- Se identifican por stripe_sub_id, que no cambia (el nombre o el email si).
-- El "and impago_desde is null" hace que repetir el script no reabra el plazo.

-- Se identifican por el PREFIJO del stripe_sub_id (unico entre las 3 subs que
-- hay) y no por el id completo: pegado en el editor, el literal largo se partia
-- a mitad de comilla y daba error de sintaxis. El plan_status = 'past_due' es un
-- seguro extra para no tocar a nadie mas.

update tiendas
   set impago_desde = '2026-09-04T00:00:00Z'      -- aleem ullah
 where plan_status = 'past_due'
   and stripe_sub_id like 'sub_1Tk5%'
   and impago_desde is null;

update tiendas
   set impago_desde = '2026-08-27T08:50:00Z'      -- ZONA MOBIL
 where plan_status = 'past_due'
   and stripe_sub_id like 'sub_1U3X%'
   and impago_desde is null;


-- 3. Comprobacion ----------------------------------------------------------
-- Para cada impagado: desde cuando corre la gracia y cuantos dias le quedan.
-- Negativo = agotada (sigue cortado, correctamente).
--
-- Lo esperado: aleem con dias POSITIVOS (vuelve a entrar, su gracia arranco el
-- 4-sep) y ZONA MOBIL en NEGATIVO (sigue fuera, la suya vencio el 3-sep).

select nombre,
       plan,
       plan_until,
       impago_desde,
       round(7 - extract(epoch from (now() - impago_desde)) / 86400) as dias_de_gracia_restantes
  from tiendas
 where plan_status = 'past_due'
 order by impago_desde desc;
