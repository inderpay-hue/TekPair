// api/registro-ok.js
// Llamado tras Stripe Checkout exitoso. Crea tienda + usuario admin con plan en `tiendas`.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  const { session_id, email, nombre, tienda_nombre, plan } = req.body;
  if (!email || !nombre) return res.status(400).json({ error: 'Faltan datos' });

  const crypto = require('crypto');

  try {
    // ═══ 1. Recuperar info de Stripe (customer_id, sub_id, trial_end) ═══
    let stripeCustomerId = null;
    let stripeSubId = null;
    let trialUntil = null;
    let planUntil = null;

    if (session_id && STRIPE_KEY) {
      try {
        const sR = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}?expand[]=subscription`, {
          headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
        });
        const session = await sR.json();
        stripeCustomerId = session.customer || null;
        if (session.subscription) {
          if (typeof session.subscription === 'string') {
            stripeSubId = session.subscription;
            // Pedir la sub para obtener fechas
            const subR = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
              headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
            });
            const sub = await subR.json();
            if (sub.trial_end) trialUntil = new Date(sub.trial_end * 1000).toISOString();
            if (sub.current_period_end) planUntil = new Date(sub.current_period_end * 1000).toISOString();
          } else {
            stripeSubId = session.subscription.id;
            if (session.subscription.trial_end) trialUntil = new Date(session.subscription.trial_end * 1000).toISOString();
            if (session.subscription.current_period_end) planUntil = new Date(session.subscription.current_period_end * 1000).toISOString();
          }
        }
      } catch(e) { console.warn('No se pudo recuperar info de Stripe:', e.message); }
    }

    // Si Stripe no nos dio el trial, calcularlo manual (15 días)
    if (!trialUntil) {
      trialUntil = new Date(Date.now() + 15*86400000).toISOString();
    }

    // ═══ 2. Generar password temporal ═══
    const tempPass = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(tempPass).digest('hex');

    // ═══ 3. Crear tienda con TODA la info de plan ═══
    const tienda_id = 'tienda_' + Date.now();
    const tiendaData = {
      id: tienda_id,
      nombre: tienda_nombre || nombre + ' - Tienda',
      plan: plan || 'basico',
      plan_status: 'trial',
      plan_email: email,
      stripe_customer_id: stripeCustomerId,
      stripe_sub_id: stripeSubId,
      trial_until: trialUntil,
      plan_until: planUntil
    };

    const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(tiendaData)
    });
    if (!tR.ok) {
      const tx = await tR.text();
      console.error('Tienda creation error:', tx);
    }

    // ═══ 4. Crear usuario admin ═══
    const usuarioId = 'usr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        id: usuarioId,
        tienda_id,
        nombre,
        email,
        password_hash: hash,
        rol: 'admin',
        activo: true,
        permisos: { todo: true }
      })
    });
    let realUserId = usuarioId;
    if (uR.ok) {
      try {
        const usrCreated = await uR.json();
        if (usrCreated && usrCreated[0] && usrCreated[0].id) realUserId = usrCreated[0].id;
      } catch(e){}
    } else {
      const tx = await uR.text();
      console.error('Usuario creation error:', tx);
    }

    // ═══ 4.5. Crear SESIÓN automática (para que /api/me funcione al entrar) ═══
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sesiones`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          usuario_id: realUserId,
          tienda_id,
          token: sessionToken,
          expires_at: sessionExpires
        })
      });
    } catch(e) { console.warn('No se pudo crear sesión:', e.message); }

    // ═══ 5. Email con credenciales ═══
    if (RESEND_KEY) {
      const planLabel = ({basico:'Básico', pro:'Pro', top:'Top'})[plan] || 'Básico';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Tekpair <hola@tekpair.tech>',
          to: [email],
          subject: '✓ Bienvenido a Tekpair — Tus credenciales',
          html: `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#020B2E;color:white;padding:24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:24px">⚡ Tekpair</h1>
    <p style="margin:8px 0 0;opacity:.7">Tu cuenta está lista</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p>Hola <strong>${nombre}</strong>,</p>
    <p>Tu suscripción <strong style="color:#0055FF">plan ${planLabel}</strong> está activa con 15 días de prueba gratis.</p>
    <div style="background:#F8FAFC;border-radius:8px;padding:16px;margin:16px 0;font-family:monospace">
      <div><strong>Email:</strong> ${email}</div>
      <div style="margin-top:8px"><strong>Contraseña temporal:</strong> ${tempPass}</div>
    </div>
    <p style="color:#EF4444;font-size:13px">⚠️ Cambia tu contraseña tras el primer acceso.</p>
    <a href="https://tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Entrar a Tekpair →</a>
    <p style="color:#64748B;font-size:12px;margin-top:16px">Tu prueba gratis termina el ${new Date(trialUntil).toLocaleDateString('es')}. Después se cobrará automáticamente. Puedes cancelar en cualquier momento desde Mi cuenta.</p>
  </div>
</body></html>`
        })
      });
    }

    return res.json({ ok: true, tienda_id, tempPass, sessionToken });

  } catch(e) {
    console.error('Setup error:', e);
    return res.status(500).json({ error: 'Error al crear cuenta' });
  }
}
