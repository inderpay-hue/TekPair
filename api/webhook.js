// api/webhook.js
// Recibe eventos de Stripe y actualiza la tabla `tiendas` con el plan/estado actual.
// Centraliza TODO el estado de suscripción en `tiendas`:
//   plan, plan_status, plan_until, stripe_customer_id, stripe_sub_id, trial_until, plan_email

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  // Map de price_id → nombre de plan
  const PRICE_TO_PLAN = {
    'price_1TUEadKE1FTbu0p7OtHUDVnP': 'basico',
    'price_1TUEbPKE1FTbu0p78X80WKAH': 'pro',
    'price_1TUEbqKE1FTbu0p7U1y90BZF': 'top'
  };

  // ═══ Verificación de firma Stripe ═══
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const body = await getRawBody(req);
    event = verifyStripeSignature(body, sig, WEBHOOK_SECRET);
  } catch(e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const sbHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  // ═══ Helper: encontrar tienda por customer_id, sub_id o email ═══
  async function findTienda({customerId, subId, email}) {
    // 1. Por stripe_sub_id (lo más fiable si ya está vinculado)
    if (subId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?stripe_sub_id=eq.${encodeURIComponent(subId)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
    }
    // 2. Por stripe_customer_id
    if (customerId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
    }
    // 3. Por plan_email (fallback inicial cuando aún no se ha vinculado)
    if (email) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?plan_email=eq.${encodeURIComponent(email)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
      // Fallback: buscar usuario admin por email y obtener su tienda
      const ru = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=tienda_id,plan&limit=1`, {headers: sbHeaders});
      const arrU = await ru.json();
      if (arrU.length && arrU[0].tienda_id) {
        return {id: arrU[0].tienda_id, plan_email: email, plan: arrU[0].plan};
      }
    }
    return null;
  }

  // ═══ Helper: actualizar tienda ═══
  async function updateTienda(tiendaId, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tiendaId)}`, {
      method: 'PATCH',
      headers: {...sbHeaders, 'Prefer': 'return=minimal'},
      body: JSON.stringify(data)
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('updateTienda error:', r.status, txt);
    }
  }

  // ═══ Helper: enviar email ═══
  async function sendEmail(to, subject, html) {
    if (!RESEND_KEY || !to) return;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({from:'Tekpair <hola@tekpair.tech>', to:[to], subject, html})
      });
    } catch(e){ console.error('Email error:', e); }
  }

  try {
    switch(event.type) {

      // ═══ Checkout completado: vincular customer y sub a la tienda ═══
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subId = session.subscription;
        const email = session.customer_email || session.metadata?.email;
        const plan = session.metadata?.plan;

        const tienda = await findTienda({customerId, email});
        if (tienda) {
          const update = {
            stripe_customer_id: customerId,
            stripe_sub_id: subId,
            plan_email: email
          };
          if (plan) update.plan = plan;
          await updateTienda(tienda.id, update);
          console.log('Checkout vinculado a tienda', tienda.id);
        } else {
          console.warn('Checkout sin tienda asociada:', email);
        }
        break;
      }

      // ═══ Suscripción creada/actualizada: sincronizar plan, estado y fecha ═══
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subId = sub.id;
        const status = sub.status; // active, trialing, past_due, canceled, etc.
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || null;
        const planUntil = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        const trialUntil = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

        // Mapear estado de Stripe a nuestro modelo
        let planStatus = 'active';
        if (status === 'trialing') planStatus = 'trial';
        else if (status === 'past_due' || status === 'unpaid') planStatus = 'past_due';
        else if (status === 'canceled' || status === 'incomplete_expired') planStatus = 'cancelled';
        else if (status === 'active') planStatus = 'active';

        const tienda = await findTienda({customerId, subId});
        if (tienda) {
          const update = {
            plan_status: planStatus,
            plan_until: planUntil,
            trial_until: trialUntil,
            stripe_sub_id: subId,
            stripe_customer_id: customerId
          };
          if (plan) update.plan = plan;
          await updateTienda(tienda.id, update);
          console.log('Sub actualizada:', tienda.id, planStatus, plan);
        } else {
          console.warn('Sub sin tienda:', subId);
        }
        break;
      }

      // ═══ Suscripción cancelada o expirada ═══
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subId = sub.id;

        const tienda = await findTienda({customerId, subId});
        if (tienda) {
          await updateTienda(tienda.id, {
            plan_status: 'cancelled',
            plan_until: new Date().toISOString()
          });
          console.log('Sub cancelada:', tienda.id);

          // Email de cancelación
          if (tienda.plan_email) {
            await sendEmail(tienda.plan_email, 'Tu suscripción ha sido cancelada — Tekpair', `
<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#374151">Suscripción cancelada</h2>
    <p>Tu suscripción a Tekpair ha sido cancelada. Tus datos se conservarán durante 30 días por si quieres reactivar.</p>
    <a href="https://tekpair.tech/registro.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Volver a Tekpair →</a>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">¿Algún comentario? hola@tekpair.tech</p>
  </div>
</div>`);
          }
        }
        break;
      }

      // ═══ Pago exitoso: marcar active + actualizar fechas ═══
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const email = invoice.customer_email;
        const subId = invoice.subscription;
        const periodEnd = invoice.lines?.data?.[0]?.period?.end;

        const tienda = await findTienda({customerId, subId, email});
        if (tienda) {
          const update = {plan_status: 'active'};
          if (periodEnd) update.plan_until = new Date(periodEnd * 1000).toISOString();
          await updateTienda(tienda.id, update);
          console.log('Pago OK:', tienda.id);
        }
        break;
      }

      // ═══ Pago fallido: marcar past_due + email ═══
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const email = invoice.customer_email;
        const subId = invoice.subscription;
        const attemptCount = invoice.attempt_count || 1;

        const tienda = await findTienda({customerId, subId, email});
        if (tienda) {
          await updateTienda(tienda.id, {plan_status: 'past_due'});
          console.log('Pago fallido:', tienda.id, 'intento', attemptCount);
        }

        // Email
        if (email) {
          await sendEmail(email, 'Problema con tu pago — Tekpair', `
<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#EF4444">⚠️ Problema con tu pago</h2>
    <p>Hemos intentado cobrar tu suscripción pero el pago no se ha procesado. Intento ${attemptCount}.</p>
    <p>Por favor actualiza tu método de pago para mantener el acceso.</p>
    <a href="https://tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Actualizar método →</a>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">¿Necesitas ayuda? hola@tekpair.tech</p>
  </div>
</div>`);
        }
        break;
      }

      default:
        console.log('Evento ignorado:', event.type);
    }

    return res.json({ received: true });

  } catch(e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: 'Webhook error' });
  }
}

// ═══ Helpers ═══
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(payload, sig, secret) {
  const crypto = require('crypto');
  const parts = sig.split(',');
  let timestamp = '';
  let signatures = [];
  parts.forEach(part => {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  });
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (!signatures.includes(expectedSig)) throw new Error('Invalid signature');
  return JSON.parse(payload);
}
