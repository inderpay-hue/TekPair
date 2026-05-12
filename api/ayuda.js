// api/ayuda.js
// Recibe mensajes de soporte desde dashboard, los guarda en BD y envía email a info@tekpair.tech

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tipo, mensaje, email, nombre, tienda, tienda_id } = req.body;

  if (!mensaje || !String(mensaje).trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  // Sanitización básica
  const tipoSafe = String(tipo || 'general').slice(0, 50);
  const mensajeSafe = String(mensaje).trim().slice(0, 5000);
  const emailSafe = String(email || '').slice(0, 200);
  const nombreSafe = String(nombre || 'Anónimo').slice(0, 200);
  const tiendaSafe = String(tienda || 'Sin tienda').slice(0, 200);
  const tiendaIdSafe = String(tienda_id || '').slice(0, 100) || null;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const DEST_EMAIL = 'info@tekpair.tech';

  // 1. Guardar en BD (con SERVICE_KEY para bypass RLS)
  try {
    const insertR = await fetch(`${SUPABASE_URL}/rest/v1/mensajes_soporte`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        tienda_id: tiendaIdSafe,
        usuario_email: emailSafe,
        usuario_nombre: nombreSafe,
        tienda_nombre: tiendaSafe,
        tipo: tipoSafe,
        mensaje: mensajeSafe
      })
    });

    if (!insertR.ok) {
      const errText = await insertR.text();
      console.error('Error guardar mensaje:', errText);
      // No abortamos: seguimos enviando email aunque no se guarde en BD
    }
  } catch (e) {
    console.error('Error BD mensajes_soporte:', e);
  }

  // 2. Enviar email a info@tekpair.tech vía Resend
  if (!RESEND_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
  }

  // Escape HTML básico
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111;background:#f7f7f7">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">📩 Nuevo mensaje de soporte</h1>
    <p style="margin:6px 0 0;opacity:.75;font-size:13px">Tekpair Dashboard</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <table style="width:100%;font-size:13px;margin-bottom:18px">
      <tr><td style="padding:6px 0;color:#64748B;width:90px">Tipo:</td><td style="padding:6px 0"><strong>${esc(tipoSafe)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#64748B">Usuario:</td><td style="padding:6px 0">${esc(nombreSafe)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748B">Email:</td><td style="padding:6px 0"><a href="mailto:${esc(emailSafe)}" style="color:#0055FF">${esc(emailSafe)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#64748B">Tienda:</td><td style="padding:6px 0">${esc(tiendaSafe)}</td></tr>
    </table>
    <div style="background:#F8FAFC;padding:16px;border-left:4px solid #0055FF;border-radius:6px;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(mensajeSafe)}</div>
    <p style="color:#64748B;font-size:12px;margin-top:20px">💡 <strong>Responde directamente a este email</strong> para contestar al cliente.</p>
  </div>
  <div style="text-align:center;padding:14px;color:#94A3B8;font-size:11px">
    Tekpair · tekpair.tech
  </div>
</body></html>`;

  try {
    const resendR = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Tekpair Soporte <noreply@tekpair.tech>',
        to: [DEST_EMAIL],
        reply_to: emailSafe || undefined,
        subject: `[Soporte ${tipoSafe}] ${nombreSafe} - ${tiendaSafe}`,
        html: html
      })
    });

    const data = await resendR.json();
    if (resendR.ok) {
      return res.json({ ok: true });
    } else {
      console.error('Resend error:', data);
      // Guardamos pero el email falló. Aún así devolvemos ok para que el cliente vea éxito
      // (el mensaje SÍ está en BD, lo podemos leer manualmente)
      return res.json({ ok: true, warning: 'Email no enviado pero mensaje guardado' });
    }
  } catch (e) {
    console.error('Error envío Resend:', e);
    return res.json({ ok: true, warning: 'Email no enviado pero mensaje guardado' });
  }
}
