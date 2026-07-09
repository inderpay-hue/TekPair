-- ═══════════════════════════════════════════════════════════════════════════
-- PEDIR PIEZA AL PROVEEDOR DESDE LA REPARACIÓN
-- Vincula un Pedido con la reparación que originó la petición de pieza.
--
-- Sin estas columnas, los pedidos creados desde una reparación se guardan en
-- local (DB.pedidos) pero fallan al sincronizar con Supabase. Ejecuta este SQL
-- en el proyecto de Supabase (SQL Editor) para activar la sincronización.
-- Es idempotente: se puede correr varias veces sin efecto adverso.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS rep_id  text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS rep_ref text;

-- Índice para localizar rápido las piezas pendientes de una reparación.
CREATE INDEX IF NOT EXISTS idx_pedidos_rep_id ON pedidos (rep_id);
