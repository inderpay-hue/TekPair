-- ═══════════════════════════════════════════════════════════════════════════
-- ACEPTACIÓN DE CONDICIONES DE REPARACIÓN (dos vías)
-- Vía 1 (mostrador): casilla en el formulario → aceptacion_mostrador + quién + cuándo + hash.
-- Vía 2 (cliente por link): botón "Acepto" en el parte público → aceptacion_cliente +
--   cuándo + hash + IP + user-agent + teléfono al que se envió el link.
-- El hash es del texto de condiciones vigente (garantía + política) → prueba qué versión
-- se aceptó aunque luego cambies las condiciones.
--
-- Idempotente. Ejecutar en el SQL Editor de Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

-- Vía 1 — mostrador
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_mostrador       boolean DEFAULT false;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_mostrador_por   text;         -- usuario que marcó la casilla
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_mostrador_fecha timestamptz;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_mostrador_hash  text;

-- Vía 2 — cliente por link (parte público)
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_cliente         boolean DEFAULT false;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_cliente_fecha   timestamptz;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_cliente_hash    text;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_cliente_ip      text;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_cliente_ua      text;
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS aceptacion_cliente_tel     text;
