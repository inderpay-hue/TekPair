export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  // Get raw body for signature verification
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
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

  try {
    switch(event.type) {

      case 'invoice.payment_succeeded': {
        // Payment successful - ensure account is active
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const customerEmail = invoice.customer_email;

        if (customerEmail) {
          // Activate user if was inactive
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(customerEmail)}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({ activo: true })
          });
          console.log('Payment succeeded for:', customerEmail);
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Payment failed - notify user
        const invoice = event.data.object;
        const customerEmail = invoice.customer_email;
        const attemptCount = invoice.attempt_count;

        if (customerEmail && RESEND_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Tekpair <onboarding@resend.dev>',
              to: [customerEmail],
              subject: 'Problema con tu pago — Tekpair',
              html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#EF4444;font-size:18px">⚠️ Problema con tu pago</h2>
    <p style="color:#374151;font-size:14px">Hemos intentado cobrar tu suscripción de Tekpair pero el pago no se ha procesado correctamente.</p>
    <p style="color:#374151;font-size:14px">Intento número: <strong>${attemptCount}</strong></p>
    <p style="color:#374151;font-size:14px">Por favor actualiza tu método de pago para mantener el acceso a Tekpair.</p>
    <a href="https://tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">
      Actualizar método de pago →
    </a>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">Si necesitas ayuda contacta con hola@tekpair.tech</p>
  </div>
</div>`
            })
          });
        }

        // After 3 failed attempts, deactivate account
        if (attemptCount >= 1 && customerEmail) {
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(customerEmail)}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({ activo: false })
          });
          console.log('Account deactivated after failed payments:', customerEmail);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription cancelled - deactivate account
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Get customer email from Stripe
        const custR = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${STRIPE_KEY}` }
        });
        const customer = await custR.json();
        const email = customer.email;

        if (email) {
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({ activo: false })
          });

          // Send cancellation email
          if (RESEND_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${RESEND_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'Tekpair <onboarding@resend.dev>',
                to: [email],
                subject: 'Tu suscripción ha sido cancelada — Tekpair',
                html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#374151;font-size:18px">Suscripción cancelada</h2>
    <p style="color:#374151;font-size:14px">Tu suscripción a Tekpair ha sido cancelada. Esperamos haberte sido de ayuda.</p>
    <p style="color:#374151;font-size:14px">Tus datos se conservarán durante 30 días. Puedes reactivar tu cuenta en cualquier momento.</p>
    <a href="https://tekpair.tech/registro.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">
      Volver a Tekpair →
    </a>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">Si tienes algún comentario, nos ayudaría mucho: hola@tekpair.tech</p>
  </div>
</div>`
              })
            });
          }
          console.log('Subscription cancelled for:', email);
        }
        break;
      }

      case 'customer.subscription.updated': {
        // Plan changed
        const subscription = event.data.object;
        console.log('Subscription updated:', subscription.id, subscription.status);
        break;
      }
    }

    return res.json({ received: true });

  } catch(e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ error: 'Webhook error' });
  }
}

// Helper: get raw body
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Helper: verify Stripe signature (simplified)
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
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  if (!signatures.includes(expectedSig)) {
    throw new Error('Invalid signature');
  }

  return JSON.parse(payload);
}
