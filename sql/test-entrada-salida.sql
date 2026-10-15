-- test-entrada-salida.sql - Test funcional de entrada y de salida (TekPair)
--
-- test_entrada: lo que funcionaba al recibir el equipo (opcional).
-- test_salida:  lo que se comprobo al entregarlo + firma de conformidad del
--               cliente. Es lo que protege a la tienda ante una reclamacion
--               ("me lo disteis con la camara rota").
-- Formato: {"items":[{"k":"faceid","estado":"ok|falla|na"}],"nota":"","firma":"data:image/png;base64,...","fecha":"...","por":"..."}
-- Se puede ejecutar dos veces sin problema. ASCII puro.
alter table reparaciones add column if not exists test_entrada jsonb;
alter table reparaciones add column if not exists test_salida jsonb;
select count(*) as columnas_test from information_schema.columns
 where table_name = 'reparaciones' and column_name in ('test_entrada', 'test_salida');
