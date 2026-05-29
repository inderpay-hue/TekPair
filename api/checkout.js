// api/checkout.js
// Crea una sesión de Stripe Checkout para que el usuario se suscriba a un plan.
//
// Fixes aplicados:
//   CHK-1: usar SERVICE_KEY para chequear email (no anon), filtrar solo cuentas activas
//   CHK-2: NO pasar datos personales en URL (solo session_id; el resto lo lee del backend)
//   CHK-3: validar formato de email con regex
//   CHK-7: mensajes de error genéricos al cliente (sin filtrar info Stripe interna)
//   CHK-8: aceptar tanto 'top' como 'premium' como ID de plan para consistencia

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

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

  const priceId = PLANES[plan];
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
    params.append('metadata[plan]', plan);
    params.append('allow_promotion_codes', 'true');
    params.append('subscription_data[trial_period_days]', '15');
    // Pasar metadata también a la subscription para que el webhook tenga acceso
    params.append('subscription_data[metadata][plan]', plan);
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
