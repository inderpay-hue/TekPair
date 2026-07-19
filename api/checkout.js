// api/checkout.js
// Crea una sesión de Stripe Checkout para que el usuario se suscriba a un plan.
//
// Fixes aplicados:
//   CHK-1: usar SERVICE_KEY para chequear email (no anon), filtrar solo cuentas activas
//   CHK-2: NO pasar datos personales en URL (solo session_id; el resto lo lee del backend)
//   CHK-3: validar formato de email con regex
//   CHK-7: mensajes de error genéricos al cliente (sin filtrar info Stripe interna)
//   CHK-8: aceptar tanto 'top' como 'premium' como ID de plan para consistencia

// CHK-RATE: rate limiting — máx 10 peticiones por IP cada hora (distribuido vía api/_lib/ratelimit.js).
// Previene creación masiva de sesiones Stripe.
import { rateLimit } from './_lib/ratelimit.js';

function _getIpChk(req) {
  return ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim() || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const _rl = await rateLimit('checkout:' + _getIpChk(req), 10, 60 * 60);
  if (!_rl.ok) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
  }
  // #B13: honeypot anti-bot. El campo 'website' está oculto en el formulario; si viene
  // relleno, es un bot → cortamos sin crear sesión de pago.
  if (req.body && typeof req.body.website === 'string' && req.body.website.trim() !== '') {
    return res.status(400).json({ error: 'Solicitud no válida.' });
  }

  // ═══ MULTI-TIENDA Fase 2 · ADD-ON: tienda extra para un dueño YA registrado ═══
  // Cobra al MISMO customer Stripe (suscripción add-on). El webhook crea la tienda
  // y el enlace usuario_tiendas al completarse el pago. Requiere env STRIPE_ADDON_PRICE_ID.
  if (req.body && req.body.action === 'addon') {
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    // Acepta el nombre canónico o el alias _EXTRA_TIENDA (por si la env se nombró así en Vercel).
    const ADDON_PRICE = process.env.STRIPE_ADDON_PRICE_ID || process.env.STRIPE_ADDON_PRICE_ID_EXTRA_TIENDA;
    const token = req.body.token;
    const tiendaNombre = String(req.body.tienda_nombre || '').trim();
    if (!token || !tiendaNombre) return res.status(400).json({ error: 'Faltan datos' });
    if (tiendaNombre.length > 100) return res.status(400).json({ error: 'Nombre demasiado largo' });
    if (!ADDON_PRICE) { console.error('Falta STRIPE_ADDON_PRICE_ID'); return res.status(500).json({ error: 'Add-on no configurado (falta STRIPE_ADDON_PRICE_ID)' }); }
    try {
      const sR = await fetch(`${SUPABASE_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=usuario_id,expires_at&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      const ses = await sR.json();
      if (!Array.isArray(ses) || !ses.length) return res.status(401).json({ error: 'Sesión inválida' });
      if (ses[0].expires_at && new Date(ses[0].expires_at) < new Date()) return res.status(401).json({ error: 'Sesión caducada' });
      const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(ses[0].usuario_id)}&select=id,rol,activo,tienda_id,email&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      const us = await uR.json();
      const u = us && us[0];
      if (!u || u.activo === false || u.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede añadir tiendas' });
      const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(u.tienda_id)}&select=stripe_customer_id,plan&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      const tA = await tR.json();
      const customerId = tA && tA[0] && tA[0].stripe_customer_id;
      const planDueno = (tA && tA[0] && tA[0].plan) || 'pro';
      if (!customerId) return res.status(400).json({ error: 'Tu cuenta no tiene método de pago activo. Completa tu suscripción primero.' });
      const params = new URLSearchParams();
      params.append('mode', 'subscription');
      params.append('payment_method_types[]', 'card');
      params.append('line_items[0][price]', ADDON_PRICE);
      params.append('line_items[0][quantity]', '1');
      params.append('customer', customerId);
      params.append('success_url', 'https://www.tekpair.tech/dashboard.html?tienda_creada=1');
      params.append('cancel_url', 'https://www.tekpair.tech/dashboard.html');
      params.append('metadata[tipo]', 'addon');
      params.append('metadata[owner_usuario_id]', u.id);
      params.append('metadata[tienda_nombre]', tiendaNombre);
      params.append('metadata[plan]', planDueno);
      params.append('subscription_data[metadata][tipo]', 'addon');
      params.append('subscription_data[metadata][owner_usuario_id]', u.id);
      const stripeR = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { 'Authorization': `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      const session = await stripeR.json();
      if (!stripeR.ok) { console.error('Stripe addon checkout error:', stripeR.status, session); return res.json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' }); }
      return res.json({ ok: true, url: session.url });
    } catch (e) {
      console.error('Addon checkout error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }

  const { plan, nombre, email, tienda_nombre } = req.body;
  if (!plan || !email || !nombre) return res.status(400).json({ error: 'Faltan datos' });

  // CHK-3: validar formato email server-side (el frontend solo valida @)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'Email no válido' });
  }
  // Validar longitud razonable
  if (String(nombre).length > 100 || String(email).length > 100 || String(tienda_nombre || '').length > 100) {
    return res.status(400).json({ error: 'Datos demasiado largos' });
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  // CHK-1: usar SERVICE_KEY para bypasar RLS (la antigua ANON_KEY no debería poder leer usuarios)
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const PLANES = {
    basico: 'price_1TUEadKE1FTbu0p7OtHUDVnP',
    pro: 'price_1TUEbPKE1FTbu0p78X80WKAH',
    // CHK-8: aceptar tanto 'top' (como dice el form) como 'premium' (como dice webhook.js)
    top: 'price_1TUEbqKE1FTbu0p7U1y90BZF',
    premium: 'price_1TUEbqKE1FTbu0p7U1y90BZF'
  };
  // Precios ANUALES (opcionales): se activan cuando configures en Vercel estas env vars con los
  // price_id anuales creados en Stripe. Mientras estén vacías, el ciclo 'anual' cae a mensual.
  const PLANES_ANUAL = {
    basico: process.env.STRIPE_PRICE_BASICO_ANUAL || '',
    pro: process.env.STRIPE_PRICE_PRO_ANUAL || '',
    top: process.env.STRIPE_PRICE_PREMIUM_ANUAL || '',
    premium: process.env.STRIPE_PRICE_PREMIUM_ANUAL || ''
  };
  const ciclo = (req.body.ciclo === 'anual') ? 'anual' : 'mensual';
  // Anual si lo piden Y hay price anual configurado; si no, mensual (fallback seguro).
  const priceId = (ciclo === 'anual' && PLANES_ANUAL[plan]) ? PLANES_ANUAL[plan] : PLANES[plan];
  if (!priceId) return res.status(400).json({ error: 'Plan inválido' });

  try {
    // CHK-1: verificar email existente, solo cuentas activas, con SERVICE_KEY
    const checkR = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&select=id&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!checkR.ok) {
      console.error('Check email failed:', checkR.status, await checkR.text());
      return res.status(500).json({ error: 'Error del servidor al validar email' });
    }
    const existing = await checkR.json();
    if (existing.length) {
      return res.json({ error: 'Este email ya tiene una cuenta activa. Inicia sesión en su lugar.' });
    }

    // Create Stripe checkout session
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', email);
    // CHK-2: success_url SIN datos personales en la URL.
    // Antes: ?session_id=...&email=user@...&nombre=Juan&tienda=...&plan=basico
    // Ahora: solo session_id. register.js recupera el resto desde session.metadata.
    params.append('success_url', `https://www.tekpair.tech/registro-ok.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', 'https://www.tekpair.tech/registro.html');
    // Los metadata se quedan en Stripe y se leen desde register.js
    params.append('metadata[nombre]', nombre);
    params.append('metadata[email]', email);
    params.append('metadata[tienda_nombre]', tienda_nombre || nombre);
    // AUD-fix: normalizar alias 'top' → canónico 'premium' (la app compara === 'premium';
    // si no, según qué webhook llegue último la tienda queda con plan='top' y no desbloquea Premium).
    const planCanonico = plan === 'top' ? 'premium' : plan;
    params.append('metadata[plan]', planCanonico);
    params.append('metadata[ciclo]', ciclo);
    params.append('metadata[lang]', req.body.lang || 'es');
    // #B10: registro del consentimiento (timestamp + versión) para RGPD.
    if (req.body.consent_ts) params.append('metadata[consent_ts]', String(req.body.consent_ts).slice(0, 40));
    if (req.body.consent_ver) params.append('metadata[consent_ver]', String(req.body.consent_ver).slice(0, 40));
    // Referidos: código de invitación (lo lee register.js para registrar la invitación).
    const refCode = String(req.body.ref || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    if (refCode) { params.append('metadata[ref]', refCode); params.append('subscription_data[metadata][ref]', refCode); }
    params.append('allow_promotion_codes', 'true');
    params.append('subscription_data[trial_period_days]', '15');
    // Pasar metadata también a la subscription para que el webhook tenga acceso
    params.append('subscription_data[metadata][plan]', planCanonico);
    params.append('subscription_data[metadata][email]', email);

    const stripeR = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeR.json();
    if (!stripeR.ok) {
      // CHK-7: log detallado en backend, mensaje genérico al cliente
      console.error('Stripe checkout error:', stripeR.status, session);
      return res.json({ error: 'No se pudo iniciar el pago. Intenta de nuevo en unos minutos.' });
    }

    return res.json({ ok: true, url: session.url });

  } catch(e) {
    console.error('Checkout error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
