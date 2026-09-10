// api/portal.js
// Crea una sesión de Stripe Customer Portal para que el usuario gestione
// su suscripción (cambiar plan, cancelar, ver facturas, actualizar tarjeta).
//
// Fixes aplicados:
//   POR-1: solo admins pueden abrir el portal (empleados no pueden cancelar plan)
//   POR-2: verificar que la sesión no esté caducada
//   POR-3: return_url dinámico según origen
//   POR-4: validación robusta de stripe_customer_id (trim de espacios)

import { rateLimit } from './_lib/ratelimit.js';

// Precio mensual por plan. Mismo mapa que webhook.js, al reves.
const PRECIO_POR_PLAN = {
  basico: 'price_1TUEadKE1FTbu0p7OtHUDVnP',
  pro: 'price_1TUEbPKE1FTbu0p78X80WKAH',
  premium: 'price_1TUEbqKE1FTbu0p7U1y90BZF'
};

// Stripe exige que trial_end quede al menos 48 h por delante.
const MARGEN_TRIAL_MS = 48 * 3600 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const { token } = req.body;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // 1. Validar sesión (POR-2: incluir expires_at en el SELECT)
    const sR = await fetch(
      `${SUPABASE_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=usuario_id,tienda_id,expires_at&limit=1`,
      { headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`} }
    );
    const sesiones = await sR.json();
    if (!sesiones.length) return res.status(401).json({ error: 'Sesión inválida' });

    const sess = sesiones[0];
    // POR-2: rechazar sesiones caducadas
    if (sess.expires_at && new Date(sess.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Sesión caducada' });
    }

    // Rate limit por usuario/tienda de la sesión: 20 peticiones / 60 s (distribuido).
    const _rl = await rateLimit('portal:' + (sess.tienda_id || sess.usuario_id || 'anon'), 20, 60);
    if (!_rl.ok) {
      return res.status(429).json({ error: 'Demasiadas peticiones. Espera un momento.' });
    }

    // POR-1: verificar que el usuario sea ADMIN
    // Sin esto, cualquier empleado con sesión puede cancelar la suscripción de la tienda
    const uR = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(sess.usuario_id)}&select=rol,activo&limit=1`,
      { headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`} }
    );
    const usuarios = await uR.json();
    if (!usuarios.length || !usuarios[0].activo) {
      return res.status(401).json({ error: 'Usuario no válido' });
    }
    if (usuarios[0].rol !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador puede gestionar la suscripción' });
    }

    // 2. Recuperar stripe_customer_id de la tienda
    const tR = await fetch(
      `${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(sess.tienda_id)}&select=stripe_customer_id,stripe_sub_id,plan,plan_until,plan_email,cobro_manual,nombre`,
      { headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`} }
    );
    const tiendas = await tR.json();
    const tienda = tiendas[0] || {};

    // POR-3: return_url dinámico (origin de la request) con whitelist para evitar open redirect
    const origin = (req.headers.origin || req.headers.referer || '').toString();
    let returnUrl = 'https://www.tekpair.tech/dashboard.html';
    const origenesPermitidos = ['https://www.tekpair.tech', 'https://tekpair.tech'];
    for (const o of origenesPermitidos) {
      if (origin.startsWith(o)) { returnUrl = o + '/dashboard.html'; break; }
    }

    // ═══ Guardar la tarjeta de una cuenta pagada en mano ═══
    // No cobra nada ahora: crea la suscripcion con el PRIMER COBRO justo el dia
    // en que se le acaban los meses ya pagados. Si luego vuelven a pagar en
    // efectivo, el panel empuja esa fecha y Stripe no llega a cobrar nunca, que
    // es lo que hace que el cobro en mano siga saliendo sin comision.
    if (req.body.accion === 'guardar_tarjeta') {
      if (tienda.stripe_sub_id) return res.json({ error: 'Esta cuenta ya tiene una tarjeta guardada' });
      const price = PRECIO_POR_PLAN[String(tienda.plan || '').toLowerCase()];
      if (!price) return res.json({ error: 'Plan no reconocido. Contacta con soporte.' });

      const params = new URLSearchParams();
      params.append('mode', 'subscription');
      params.append('payment_method_types[]', 'card');
      params.append('line_items[0][price]', price);
      params.append('line_items[0][quantity]', '1');
      if (tienda.plan_email) params.append('customer_email', tienda.plan_email);
      params.append('success_url', returnUrl + '?tarjeta=ok');
      params.append('cancel_url', returnUrl);
      params.append('subscription_data[metadata][plan]', String(tienda.plan || ''));
      params.append('subscription_data[metadata][origen]', 'efectivo');

      // El primer cobro se aplaza hasta que se agoten los meses pagados. Si ya
      // quedan menos de 48 h (o esta vencida), Stripe no admite aplazarlo: se
      // cobra ya, que ademas es lo correcto porque su periodo se acabo.
      const fin = tienda.plan_until ? new Date(tienda.plan_until).getTime() : 0;
      const aplazable = fin && (fin - Date.now()) > MARGEN_TRIAL_MS;
      if (aplazable) params.append('subscription_data[trial_end]', String(Math.floor(fin / 1000)));

      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const ses = await r.json();
      if (!r.ok) {
        console.error('guardar_tarjeta Stripe:', ses);
        return res.json({ error: 'No se pudo abrir la pasarela. Inténtalo de nuevo.' });
      }
      return res.json({ ok: true, url: ses.url, primer_cobro: aplazable ? new Date(fin).toISOString() : null });
    }

    // POR-4: usar trim() por si en BD hay espacios en blanco
    const stripeCust = (tienda.stripe_customer_id || '').trim();
    if (!tiendas.length || !stripeCust) {
      return res.json({ error: 'No tienes una suscripción de Stripe vinculada. Contacta con soporte.' });
    }

    const params = new URLSearchParams();
    params.append('customer', stripeCust);
    params.append('return_url', returnUrl);

    const stripeR = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeR.json();
    if (!stripeR.ok) {
      console.error('Portal Stripe error:', session);
      // Mensaje genérico al cliente, log detallado en servidor
      return res.json({ error: 'No se pudo abrir el portal de facturación. Intenta de nuevo.' });
    }

    return res.json({ ok: true, url: session.url });

  } catch(e) {
    console.error('Portal error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
