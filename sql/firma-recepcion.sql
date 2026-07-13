-- ═══════════════════════════════════════════════════════════════════════════
-- FIRMA DEL CLIENTE EN RECEPCIÓN (vía QR)
-- Guarda la firma manuscrita del cliente al entregar el equipo en el taller,
-- con evidencia legal: imagen (path en Storage), fecha, hash del contenido
-- firmado (avería + presupuesto + condiciones + IDs de fotos) y UA/IP.
--
-- Idempotente. Ejecutar en el SQL Editor de Supabase. Sin esto, las acciones
-- firma-* de api/parte.js fallan al escribir (la firma no se persiste).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS firma_recep        text;         -- path en bucket gastos-adjuntos
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS firma_recep_fecha  timestamptz;  -- momento exacto de la firma
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS firma_recep_hash   text;         -- sha256 del contenido firmado
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS firma_recep_ip     text;         -- IP del dispositivo que firmó
ALTER TABLE reparaciones ADD COLUMN IF NOT EXISTS firma_recep_ua     text;         -- user-agent del dispositivo
