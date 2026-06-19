-- ════════════════════════════════════════════════════════════════════
-- Financiación · Sprint 1 — Link de cobro Modelo C (sin Stripe)
-- El dinero va DIRECTO del cliente a la tienda (Bizum/IBAN/PayPal).
-- TekPair solo hace de mensajero. Ver memoria tekpair-financiacion-cobro.
-- ════════════════════════════════════════════════════════════════════

-- ── Parte A · Datos de cobro de la tienda ──
-- jsonb con { bizum_on, bizum, transfer_on, iban, paypal_on, paypal, mensaje }
-- Se rellena en Ajustes → Mi Tienda → "💳 Datos de cobro online".
ALTER TABLE tiendas
  ADD COLUMN IF NOT EXISTS cobro_datos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Parte C · Intentos de pago declarados por el cliente ──
-- El cliente, en /cobrar, pulsa "He pagado" → fila aquí en 'pendiente_confirmacion'.
-- NO marca la cuota como pagada: eso lo hace el dueño tras verificar el ingreso.
-- La cuota vive como JSON en reparaciones.cuotas → referenciamos (reparacion_id, cuota_idx).
-- IMPORTANTE: tienda_id y reparacion_id son TEXT (ids tipo 'tienda_…' / 'r…'), no uuid.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tienda_id        text NOT NULL,
  reparacion_id    text NOT NULL,
  cuota_idx        int  NOT NULL,
  importe          numeric,
  metodo_declarado text NOT NULL,
  comentario       text,
  estado           text NOT NULL DEFAULT 'pendiente_confirmacion',
                   -- pendiente_confirmacion | confirmado | rechazado
  ip               inet,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resuelto_por     text,
  resuelto_at      timestamptz,
  motivo_rechazo   text
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_tienda_pend
  ON payment_attempts (tienda_id) WHERE estado = 'pendiente_confirmacion';
CREATE INDEX IF NOT EXISTS idx_payment_attempts_rep
  ON payment_attempts (reparacion_id, cuota_idx, created_at DESC);

-- RLS: la inserción la hace el endpoint público con SERVICE_KEY (token de la reparación
-- ya validado), así que NO hace falta policy de insert para anon. La tienda (JWT) solo
-- ve/actualiza lo suyo. El claim tienda_id va en el primer nivel del JWT (auth.jwt()->>'tienda_id').
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tienda_ve_sus_intentos" ON payment_attempts;
CREATE POLICY "tienda_ve_sus_intentos" ON payment_attempts
  FOR SELECT USING (tienda_id = (auth.jwt() ->> 'tienda_id'));

DROP POLICY IF EXISTS "tienda_actualiza_sus_intentos" ON payment_attempts;
CREATE POLICY "tienda_actualiza_sus_intentos" ON payment_attempts
  FOR UPDATE USING (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- (Realtime opcional: para que el dueño reciba el aviso al instante sin recargar.
--  Solo si usas la publicación de Realtime; descomenta si la tienes configurada.)
-- ALTER PUBLICATION supabase_realtime ADD TABLE payment_attempts;
