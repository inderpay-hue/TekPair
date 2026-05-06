export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, nombre, email, tienda_nombre } = req.body;
  if (!plan || !email || !nombre) return res.status(400).json({ error: 'Faltan datos' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  const PLANES = {
    basico: 'price_1TUEadKE1FTbu0p7OtHUDVnP',
    pro: 'price_1TUEbPKE1FTbu0p78X80WKAH',
    top: 'price_1TUEbqKE1FTbu0p7U1y90BZF'
  };

  const priceId = PLANES[plan];
  if (!priceId) return res.status(400).json({ error: 'Plan invalido' });

  try {
    // Check if email already exists
    const checkR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const existing = await checkR.json();
    if (existing.length) return res.json({ error: 'Este email ya tiene una cuenta' });

    // Create Stripe checkout session
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', email);
    params.append('success_url', `https://tekpair.tech/registro-ok.html?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&nombre=${encodeURIComponent(nombre)}&tienda=${encodeURIComponent(tienda_nombre||nombre)}&plan=${plan}`);
    params.append('cancel_url', 'https://tekpair.tech/registro.html');
    params.append('metadata[nombre]', nombre);
    params.append('metadata[email]', email);
    params.append('metadata[tienda_nombre]', tienda_nombre || nombre);
    params.append('metadata[plan]', plan);
    params.append('allow_promotion_codes', 'true');
    params.append('subscription_data[trial_period_days]', '15');

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
      console.error('Stripe error:', session);
      return res.json({ error: session.error?.message || 'Error de Stripe' });
    }

    return res.json({ ok: true, url: session.url });

  } catch(e) {
    console.error('Checkout error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
