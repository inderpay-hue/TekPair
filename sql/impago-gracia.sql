-- ===========================================================================
-- DIA DEL IMPAGO (para contar bien los 7 dias de gracia)
-- ===========================================================================
-- Hasta ahora la gracia del impago se deducia de plan_until, y cuando esa fecha
-- venia vacia se caia al fin del trial —que puede ser de hace meses—, asi que el
-- cliente quedaba cortado el MISMO dia del recibo devuelto, justo cuando lo que
-- interesa es que actualice la tarjeta.
--
-- Con esta columna la referencia es el dia exacto en que Stripe aviso del primer
-- recibo devuelto. La escribe el webhook (invoice.payment_failed) y la limpia al
-- cobrar (invoice.payment_succeeded).
--
-- Sin acentos a proposito: pegar SQL con caracteres no ASCII en el editor ha dado
-- problemas de codificacion otras veces.
--
-- Se puede ejecutar mas de una vez sin romper nada.
-- ===========================================================================


-- 1. La columna ------------------------------------------------------------
alter table tiendas add column if not exists impago_desde timestamptz;

comment on column tiendas.impago_desde is 'Fecha del primer recibo devuelto. Referencia de los 7 dias de gracia; null = al corriente';


-- 2. Rellenar lo que ya esta en impago -------------------------------------
-- Las tiendas que fallaron ANTES de existir esta columna no tienen fecha. Sin
-- esto seguirian usando el respaldo viejo (trial_until, de hace meses) y
-- continuarian cortadas. Se les da como referencia su fin de periodo pagado y,
-- si tampoco lo tienen, HOY: empiezan su gracia ahora, que es lo que habria
-- pasado si la columna hubiera existido el dia del fallo.
--
-- Solo toca filas en past_due que aun no tengan fecha, asi que repetirlo no
-- reabre el plazo a nadie.

update tiendas
   set impago_desde = coalesce(plan_until, now())
 where plan_status = 'past_due'
   and impago_desde is null;


-- 3. Comprobacion ----------------------------------------------------------
-- Para cada impagado: cuando empezo la gracia y cuantos dias le quedan.
-- Negativo = ya agotada (sigue cortado, correctamente).

select nombre,
       plan,
       plan_until,
       impago_desde,
       7 - floor(extract(epoch from (now() - impago_desde)) / 86400) as dias_de_gracia_restantes
  from tiendas
 where plan_status = 'past_due'
 order by impago_desde desc;
