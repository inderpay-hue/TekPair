-- Sprint A · #17 Consentimiento RGPD de marketing en clientes
-- Columna para registrar si el cliente autoriza recibir avisos/promociones (WhatsApp/email).
-- Prerrequisito legal para campañas de marketing (evita sanción por SPAM, RGPD/LSSI).
-- Por defecto FALSE (sin consentimiento) = no se le puede enviar promo hasta que marque la casilla.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;

-- (opcional, recomendado) índice para segmentar campañas solo a quienes consintieron:
CREATE INDEX IF NOT EXISTS idx_clientes_marketing_consent
  ON clientes (tienda_id) WHERE marketing_consent = true;
