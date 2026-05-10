// api/portal.js
// Crea una sesión de Stripe Customer Portal para que el usuario gestione
// su suscripción (cambiar plan, cancelar, ver facturas, actualizar tarjeta).

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const { token } = req.body;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // 1. Validar sesión
    const sR = await fetch(`${SUPABASE_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=usuario_id,tienda_id&limit=1`, {
      headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`}
    });
    const sesiones = await sR.json();
    if (!sesiones.length) return res.status(401).json({ error: 'Sesión inválida' });

    // 2. Recuperar stripe_customer_id de la tienda
    const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(sesiones[0].tienda_id)}&select=stripe_customer_id`, {
      headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`}
    });
    const tiendas = await tR.json();
    if (!tiendas.length || !tiendas[0].stripe_customer_id) {
      return res.json({ error: 'No tienes una suscripción de Stripe vinculada. Contacta con soporte.' });
    }

    // 3. Crear sesión de Customer Portal
    const params = new URLSearchParams();
    params.append('customer', tiendas[0].stripe_customer_id);
    params.append('return_url', 'https://tekpair.tech/dashboard.html');

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
      console.error('Portal error:', session);
      return res.json({ error: session.error?.message || 'Error al abrir el portal' });
    }

    return res.json({ ok: true, url: session.url });

  } catch(e) {
    console.error('Portal error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
