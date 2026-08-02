-- ================================================================
-- Columnas EN OFERTA / PRECIO ANTERIOR en productos de stock.
-- El codigo (guardarStock / mapStock) ya escribe y lee en_oferta y
-- precio_antes, pero faltaba la migracion. Si estas columnas no
-- existen, PostgREST rechaza el alta/edicion simple con 400 y el
-- producto NO sube a la nube (se queda solo en local).
-- Idempotente. Solo anade 2 columnas. Ejecutar en el SQL Editor de Supabase.
-- ================================================================

alter table stock add column if not exists en_oferta boolean default false;
alter table stock add column if not exists precio_antes numeric;
