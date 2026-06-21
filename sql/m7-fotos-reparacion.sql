-- M7 — Foto-prueba legal: fotos del estado del equipo al RECIBIR y al ENTREGAR.
-- Se guardan solo los PATHS (las imágenes van al bucket privado 'gastos-adjuntos' ya existente).
-- Ejecutar en el SQL Editor de Supabase. Idempotente (IF NOT EXISTS).

ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS fotos_recepcion jsonb DEFAULT '[]'::jsonb;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS fotos_entrega   jsonb DEFAULT '[]'::jsonb;

-- (Opcional) por-tienda: exigir foto de recepción al crear reparación.
ALTER TABLE tiendas ADD COLUMN IF NOT EXISTS exigir_foto_recepcion boolean DEFAULT false;

-- El bucket 'gastos-adjuntos' ya existe y tiene RLS por tienda (mismo que adjuntos de gastos),
-- así que NO hace falta crear bucket ni políticas nuevas: las fotos van a {tienda_id}/reps/...
