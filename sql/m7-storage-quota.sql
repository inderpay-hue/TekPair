-- M7 · Cuota de almacenamiento de fotos por tienda.
-- Lleva la cuenta de los bytes usados en el bucket 'gastos-adjuntos' por la tienda.
-- El cliente la incrementa al subir una foto y la decrementa al quitarla;
-- el cron de retención (scripts/retencion-fotos.cjs) la RECALCULA de forma exacta
-- cada mes a partir del almacenamiento real (auto-corrige cualquier deriva).
-- Ejecutar en el SQL Editor de Supabase. Idempotente.

ALTER TABLE tiendas ADD COLUMN IF NOT EXISTS storage_usado_bytes bigint NOT NULL DEFAULT 0;
