-- ============================================================
-- TekPair · Limpieza de DATOS DE PRUEBA (test-claude, test30, "prueba test", DEMO…)
-- ============================================================
-- Ejecuta en el SQL Editor de Supabase. Pasos SEGUROS:
--   1) Pon tu TIENDA_ID en el \set de abajo (lo ves en la tabla `tiendas`,
--      o en el navegador: localStorage 'tk_sess' → usuario.tienda_id).
--   2) Ejecuta SOLO los SELECT de PREVISUALIZACIÓN. Revisa qué saldría.
--   3) Si estás de acuerdo, ejecuta el bloque BEGIN…; mira los recuentos y haz COMMIT.
--      Si algo no cuadra, ROLLBACK y no se borra nada.
--
-- ⚠️  "inder" NO se incluye por defecto (parece tu propio nombre/cuenta). Si quieres
--     borrarlo, añade  or cliente_nombre ilike 'inder %inder%'  a mano.
-- ⚠️  Verifica los nombres de tabla (cajas/cierres) por si difieren en tu esquema.
-- ============================================================

-- >>> CONFIGURA AQUÍ tu tienda <<<
\set tid 'TU_TIENDA_ID'

-- Patrón de prueba reutilizado (clientes): empieza por "test", o contiene "prueba"/"test-claude".
-- ───────────────────────────── 1) PREVISUALIZACIÓN ─────────────────────────────

-- Clientes de prueba
select id, nombre, apellidos, tel, dni from clientes
where tienda_id = :'tid'
  and (nombre ilike 'test%' or nombre ilike '%prueba%' or nombre ilike '%test-claude%' or nombre ilike 'test30%');

-- Reparaciones/Presupuestos cuyo cliente parece de prueba
select id, cliente_nombre, marca, modelo, averia, estado, fecha from reparaciones
where tienda_id = :'tid'
  and (cliente_nombre ilike 'test%' or cliente_nombre ilike '%prueba%' or cliente_nombre ilike '%test-claude%');

-- Ventas cuyo cliente parece de prueba
select id, cliente_nombre, modelo, total, fecha from ventas
where tienda_id = :'tid'
  and (cliente_nombre ilike 'test%' or cliente_nombre ilike '%prueba%' or cliente_nombre ilike '%test-claude%');

-- Cajas DEMO/prueba (ajusta el nombre de tabla si en tu esquema es 'cajas_sesiones' o similar)
select id, nombre, fecha from cajas
where tienda_id = :'tid' and (nombre ilike '%demo%' or nombre ilike '%prueba%');

-- ───────────────────────────── 2) BORRADO (revisa antes de COMMIT) ─────────────────────────────
begin;

-- Pagos asociados a reparaciones de prueba (evita huérfanos)
delete from pagos_reparacion
where reparacion_id in (
  select id from reparaciones where tienda_id = :'tid'
    and (cliente_nombre ilike 'test%' or cliente_nombre ilike '%prueba%' or cliente_nombre ilike '%test-claude%')
);

delete from ventas
where tienda_id = :'tid'
  and (cliente_nombre ilike 'test%' or cliente_nombre ilike '%prueba%' or cliente_nombre ilike '%test-claude%');

delete from reparaciones
where tienda_id = :'tid'
  and (cliente_nombre ilike 'test%' or cliente_nombre ilike '%prueba%' or cliente_nombre ilike '%test-claude%');

delete from clientes
where tienda_id = :'tid'
  and (nombre ilike 'test%' or nombre ilike '%prueba%' or nombre ilike '%test-claude%' or nombre ilike 'test30%');

-- Cajas DEMO (descomenta si aplica y el nombre de tabla es correcto)
-- delete from cajas where tienda_id = :'tid' and (nombre ilike '%demo%' or nombre ilike '%prueba%');

-- ───────────────────────────── 3) NORMALIZAR MARCAS (#3 informe: "Generico" vs "Genérico") ─────
-- El display ya deduplica por acentos, pero conviene unificar el dato. Previsualiza:
--   select marca, count(*) from stock where tienda_id = :'tid' and lower(marca) like '%gen_rico%' group by marca;
-- Unificar a "Genérico":
update stock set marca = 'Genérico'
where tienda_id = :'tid' and marca is not null
  and lower(translate(marca,'áéíóúÁÉÍÓÚ','aeiouAEIOU')) = 'generico' and marca <> 'Genérico';
-- (repite para pedidos si guardan marca:)
-- update pedidos set marca = 'Genérico' where tienda_id = :'tid' and lower(translate(marca,'áéíóúÁÉÍÓÚ','aeiouAEIOU')) = 'generico' and marca <> 'Genérico';

-- Revisa los recuentos de filas borradas. Si todo bien:
--   commit;
-- Si NO:
--   rollback;
