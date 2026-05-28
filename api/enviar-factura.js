export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, nombreCliente, numero, total, tienda, pdfBase64, nombreArchivo } = req.body || {};
  if (!email || !pdfBase64) return res.status(400).json({ error: 'Faltan datos (email o PDF)' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });

  const tiendaNom = tienda || 'TekPair';
  const num = numero || '';
  const cli = nombreCliente || 'Cliente';
  const totalTxt = total ? (total + ' EUR') : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#10B981;color:white;padding:22px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:22px">${tiendaNom}</h1>
    <p style="margin:6px 0 0;opacity:.85;font-size:13px">Tu factura ${num}</p>
  </div>
  <div style="background:white;padding:26px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:15px">Hola ${cli},</p>
    <p style="font-size:14px;color:#444;line-height:1.6">
      Adjuntamos tu factura <strong>${num}</strong>${totalTxt ? ' por un importe de <strong>' + totalTxt + '</strong>' : ''}.
      Puedes descargarla y conservarla como justificante.
    </p>
    <p style="font-size:14px;color:#444;line-height:1.6">Gracias por confiar en nosotros.</p>
    <p style="font-size:13px;color:#888;margin-top:24px">${tiendaNom}</p>
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">
    Enviado con TekPair · tekpair.tech
  </div>
</body>
</html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'TekPair <noreply@tekpair.tech>',
        to: [email],
        subject: `Factura ${num} — ${tiendaNom}`,
        html: html,
        attachments: [
          {
            filename: nombreArchivo || ('Factura_' + (num || 'documento') + '.pdf'),
            content: pdfBase64
          }
        ]
      })
    });

    const data = await r.json();
    if (r.ok) {
      return res.json({ ok: true, id: data.id });
    } else {
      console.error('Resend error (factura):', data);
      return res.json({ error: data.message || 'Error al enviar' });
    }
  } catch (e) {
    console.error('Enviar factura error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
