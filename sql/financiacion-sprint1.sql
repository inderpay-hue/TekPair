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

-- (La tabla payment_attempts y su RLS llegan en la Parte C del Sprint,
--  cuando se construya la página pública /cobrar y el endpoint.)
