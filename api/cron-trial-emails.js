// api/cron-trial-emails.js
// Vercel Cron job que se ejecuta cada día a las 9:00 (configurado en vercel.json)
// Envía recordatorios a clientes en trial que estén a 3 o 1 días de fin de prueba

export default async function handler(req, res) {
  // Verificar que viene del cron de Vercel (no de cualquiera)
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Buscar tiendas en trial con email configurado
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?plan_status=eq.trial&plan_email=not.is.null&select=id,nombre,plan,plan_email,trial_until,trial_email_3d_sent,trial_email_1d_sent`, {
      headers
    });
    const tiendas = await r.json();

    let emailsSent = 0;
    const now = new Date();

    for (const t of tiendas) {
      if (!t.trial_until) continue;
      
      const trialEnd = new Date(t.trial_until);
      const msLeft = trialEnd - now;
      const daysLeft = Math.floor(msLeft / 86400000);

      // Email "3 días"
      if (daysLeft === 3 && !t.trial_email_3d_sent) {
        await sendEmail3Days(t, RESEND_KEY);
        await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${t.id}`, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ trial_email_3d_sent: true })
        });
        emailsSent++;
      }
      
      // Email "1 día"
      if (daysLeft === 1 && !t.trial_email_1d_sent) {
        await sendEmail1Day(t, RESEND_KEY);
        await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${t.id}`, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ trial_email_1d_sent: true })
        });
        emailsSent++;
      }
    }

    return res.json({ ok: true, processed: tiendas.length, emails_sent: emailsSent });

  } catch(e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ═══ EMAIL FALTAN 3 DÍAS ═══
async function sendEmail3Days(tienda, RESEND_KEY) {
  if (!RESEND_KEY) return;
  const planLabel = ({basico:'Básico', pro:'Pro', top:'Top'})[tienda.plan] || 'Básico';
  const planPrecio = ({basico:'9,90', pro:'19,90', top:'34,90'})[tienda.plan] || '9,90';
  
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Tekpair <hola@tekpair.tech>',
      to: [tienda.plan_email],
      subject: '⏳ Tu prueba de Tekpair termina en 3 días',
      html: `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#020B2E;color:white;padding:24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:24px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:28px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#0055FF;margin-top:0">Tu prueba gratis termina en 3 días</h2>
    <p>Hola,</p>
    <p>Tu prueba gratuita de <strong>Tekpair ${planLabel}</strong> termina el <strong>${new Date(tienda.trial_until).toLocaleDateString('es', {day:'numeric',month:'long'})}</strong>.</p>
    <p>Después se cobrarán automáticamente <strong>${planPrecio}€</strong> de la tarjeta que registraste.</p>
    
    <div style="background:#F0F9FF;border-left:4px solid #0055FF;padding:14px 18px;margin:20px 0;border-radius:6px">
      <strong>✨ Si te gusta Tekpair:</strong><br>
      <span style="color:#475569">No tienes que hacer nada. Seguirás disfrutando sin interrupción.</span>
    </div>
    
    <div style="background:#FFF7ED;border-left:4px solid #F97316;padding:14px 18px;margin:20px 0;border-radius:6px">
      <strong>🛑 Si prefieres cancelar:</strong><br>
      <span style="color:#475569">Hazlo antes del ${new Date(tienda.trial_until).toLocaleDateString('es', {day:'numeric',month:'long'})} desde Ajustes → Mi suscripción.</span>
    </div>
    
    <a href="https://tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:24px">Entrar a Tekpair →</a>
    
    <p style="color:#64748B;font-size:12px;margin-top:24px;text-align:center;border-top:1px solid #eee;padding-top:16px">¿Dudas? Respondemos a hola@tekpair.tech</p>
  </div>
</body></html>`
    })
  });
}

// ═══ EMAIL FALTA 1 DÍA ═══
async function sendEmail1Day(tienda, RESEND_KEY) {
  if (!RESEND_KEY) return;
  const planLabel = ({basico:'Básico', pro:'Pro', top:'Top'})[tienda.plan] || 'Básico';
  const planPrecio = ({basico:'9,90', pro:'19,90', top:'34,90'})[tienda.plan] || '9,90';
  
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Tekpair <hola@tekpair.tech>',
      to: [tienda.plan_email],
      subject: '⚡ Mañana empezamos a cobrar tu Tekpair',
      html: `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#020B2E;color:white;padding:24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:24px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:28px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#F97316;margin-top:0">Tu prueba termina mañana</h2>
    <p>Hola,</p>
    <p>Mañana se renueva tu Tekpair <strong>${planLabel}</strong> y se cobrarán <strong>${planPrecio}€</strong> de tu tarjeta.</p>
    
    <p style="font-size:15px;background:#F8FAFC;padding:14px;border-radius:8px">📅 <strong>Fecha de cobro:</strong> ${new Date(tienda.trial_until).toLocaleDateString('es', {day:'numeric',month:'long',year:'numeric'})}</p>
    
    <p>Si estás aprovechando bien Tekpair, no hagas nada. ¡Gracias por confiar!</p>
    
    <p style="color:#94A3B8;font-size:13px">¿Última hora? Puedes cancelar desde Ajustes → Mi suscripción → Gestionar plan, antes de las 23:59 de hoy.</p>
    
    <a href="https://tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px">Abrir Tekpair →</a>
    
    <p style="color:#64748B;font-size:12px;margin-top:24px;text-align:center;border-top:1px solid #eee;padding-top:16px">¿Dudas? Respondemos a hola@tekpair.tech</p>
  </div>
</body></html>`
    })
  });
}
