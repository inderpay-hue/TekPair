-- ════════════════════════════════════════════════════════════════════
-- Referidos entre tiendas · Fase 1 — "Trae un amigo, 1 mes gratis ambos"
-- Distinto de Comisiones (comerciales externos, 20% cash). Esto es cliente→cliente:
-- una tienda invita a otra; cuando la invitada PAGA su 1ª factura, ambas reciben
-- 1 mes gratis (cupón Stripe, Fase 2). Fase 1 = infra de tracking + códigos + UI.
-- ════════════════════════════════════════════════════════════════════

-- Código de invitación por tienda (corto y único). Se genera la 1ª vez que el
-- dueño abre "Invita amigos".
ALTER TABLE tiendas
  ADD COLUMN IF NOT EXISTS referral_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tiendas_referral_code
  ON tiendas (referral_code) WHERE referral_code IS NOT NULL;

-- Registro de invitaciones. status: pending (registrada, sin pagar) → qualified
-- (pagó, premio aplicable) → rewarded (cupón aplicado) → refunded (canceló <60d).
CREATE TABLE IF NOT EXISTS referrals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_tienda_id  text NOT NULL,            -- quien invita (A)
  referred_tienda_id  text,                     -- la nueva tienda (B), null hasta crearse
  referred_email      text,
  referred_nombre     text,
  codigo              text NOT NULL,            -- el referral_code usado
  status              text NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  qualified_at        timestamptz,
  rewarded_at         timestamptz,
  nota                text
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_tienda_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals (referred_tienda_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals (status) WHERE status = 'pending';

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
-- El dueño ve solo las invitaciones que ÉL ha hecho (su tienda activa = JWT).
DROP POLICY IF EXISTS "tienda_ve_sus_referidos" ON referrals;
CREATE POLICY "tienda_ve_sus_referidos" ON referrals
  FOR SELECT USING (referrer_tienda_id = (auth.jwt() ->> 'tienda_id'));
-- Las escrituras las hace el backend con SERVICE_KEY (registro/webhook), no el cliente.
