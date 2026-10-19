-- =============================================================
-- fix-descuadre-pendientes-cobrados.sql (19-oct-2026)
-- Al cobrar un pendiente, el servidor recalculaba el día en que se fió quitándolo,
-- y ese día pasaba a "falta" por el importe cobrado. Aquí se recalcula cada uno de
-- esos días contando el pendiente (cobrado o no) con el teórico con que se cerró.
-- Solo cajas de envíos/recargas cerradas con algún pendiente ya cobrado.
-- =============================================================
with x as (
  select cc.id,
    round((cc.saldo_real_final + cc.importe_tpv - cc.saldo_teorico
      + (select coalesce(sum(f.importe), 0) from cajas_fiados f
          where f.caja_id::text = cc.caja_id::text and f.fecha = cc.fecha and f.estado in ('pendiente', 'cobrado')))::numeric, 2) nuevo
  from cajas_cierres cc
  join cajas c on c.id::text = cc.caja_id::text and c.tipo in ('envios', 'recargas')
  where cc.estado not in ('abierto', 'festivo')
    and exists (select 1 from cajas_fiados f where f.caja_id::text = cc.caja_id::text and f.fecha = cc.fecha and f.estado = 'cobrado')
)
update cajas_cierres cc
   set descuadre = x.nuevo,
       estado = case when abs(x.nuevo) <= 0.5 then 'cerrado' else 'descuadre' end
  from x
 where cc.id = x.id and cc.descuadre <> x.nuevo
returning cc.fecha, cc.descuadre, cc.estado;
