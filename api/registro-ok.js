export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const { session_id, email, nombre, tienda_nombre, plan } = req.body;
  if (!email || !nombre) return res.status(400).json({ error: 'Faltan datos' });

  const crypto = require('crypto');

  try {
    // Generate random password
    const tempPass = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(tempPass).digest('hex');

    // Create tienda
    const tienda_id = 'tienda_' + Date.now();
    await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
      method: 'POST',
      headers: { 
        'apikey': SERVICE_KEY, 
        'Authorization': `Bearer ${SERVICE_KEY}`, 
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ 
        id: tienda_id, 
        nombre: tienda_nombre || nombre + ' - Tienda'
      })
    });

    // Create admin user
    await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: { 
        'apikey': SERVICE_KEY, 
        'Authorization': `Bearer ${SERVICE_KEY}`, 
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        tienda_id,
        nombre,
        email,
        password_hash: hash,
        rol: 'admin',
        activo: true,
        permisos: { todo: true },
        plan: plan || 'basico'
      })
    });

    // Send welcome email with credentials
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (RESEND_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Tekpair <noreply@tekpair.tech>',
          to: [email],
          subject: 'Bienvenido a Tekpair - Tus credenciales de acceso',
          html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#020B2E;color:white;padding:24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:24px">⚡ Tekpair</h1>
    <p style="margin:8px 0 0;opacity:.7">Bienvenido a bordo</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p>Hola <strong>${nombre}</strong>,</p>
    <p>Tu cuenta de Tekpair está lista. Aquí tienes tus credenciales:</p>
    <div style="background:#F8FAFC;border-radius:8px;padding:16px;margin:16px 0;font-family:monospace">
      <div><strong>Email:</strong> ${email}</div>
      <div style="margin-top:8px"><strong>Contraseña temporal:</strong> ${tempPass}</div>
    </div>
    <p style="color:#EF4444;font-size:13px">⚠️ Cambia tu contraseña después del primer acceso.</p>
    <a href="https://tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">
      Entrar a Tekpair →
    </a>
    <p style="color:#64748B;font-size:12px;margin-top:16px">Plan: <strong>${plan || 'Básico'}</strong></p>
  </div>
</body>
</html>`
        })
      });
    }

    return res.json({ ok: true, tienda_id, tempPass });

  } catch(e) {
    console.error('Setup error:', e);
    return res.status(500).json({ error: 'Error al crear cuenta' });
  }
}
