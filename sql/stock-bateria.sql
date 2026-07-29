-- ================================================================
-- Campo BATERIA (%) opcional en productos de stock (seminuevos).
-- Idempotente. Solo anade 1 columna. Ejecutar en el SQL Editor de Supabase.
-- ================================================================

alter table stock add column if not exists bateria smallint;
