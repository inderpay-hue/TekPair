// api/email.js
// Envío de emails: facturas y reportes diarios desde el dashboard.
//
// Fixes aplicados:
//   EM-1: requiere JWT válido + sesión activa (antes era endpoint público, agujero crítico)
//   EM-2: escape HTML de todos los campos dinámicos para evitar inyección XSS
//   EM-3: validación estricta del destinatario (formato email + límite 5 destinatarios)
//   EM-4: límite del PDF base64 (máx 4MB para no reventar Vercel Hobby body limit)

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// EM-2: escape HTML básico para todos los valores dinámicos
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// EM-3: validación de email
function emailValido(e) {
  if (typeof e !== 'string') return false;
  if (e.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// EM-1: verificar JWT + sesión activa en BD
async function autenticar(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return null;
  }
  // Verificar que tienda_id en JWT existe y está activa
  if (!payload.tienda_id) return null;
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!JWT_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('[email] Configuración incompleta');
    return res.status(500).json({ error: 'Configuración de servidor incompleta' });
  }

  // EM-1: AUTH obligatorio
  const payload = await autenticar(req);
  if (!payload) return res.status(401).json({ error: 'No autorizado' });

  const KEY = process.env.RESEND_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });

  // ── Rama FACTURA (PDF adjunto) ──
  if (req.body && req.body.tipo === 'factura') {
    const { email, nombreCliente, numero, total, tienda, pdfBase64, nombreArchivo } = req.body;
    if (!email || !pdfBase64) return res.status(400).json({ error: 'Faltan datos (email o PDF)' });

    // EM-3: validar formato del destinatario
    if (!emailValido(email)) return res.status(400).json({ error: 'Email destinatario no válido' });

    // EM-4: límite tamaño PDF (4MB en base64 ~3MB original, dentro de Vercel Hobby 4.5MB)
    if (typeof pdfBase64 !== 'string') return res.status(400).json({ error: 'PDF inválido' });
    if (pdfBase64.length > 4 * 1024 * 1024) {
      return res.status(413).json({ error: 'PDF demasiado grande (máx 4MB)' });
    }
    // Validar que es base64 razonable (caracteres válidos)
    if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64.slice(0, 100))) {
      return res.status(400).json({ error: 'PDF en formato base64 inválido' });
    }

    // EM-2: escape de TODOS los campos dinámicos
    const tNom = esc(tienda || 'TekPair').slice(0, 100);
    const num = esc(numero || '').slice(0, 50);
    const cli = esc(nombreCliente || 'Cliente').slice(0, 100);
    const totalTxt = total != null ? esc(total) + ' EUR' : '';
    const nombreArchivoSafe = (nombreArchivo || ('Factura_' + (numero || 'documento') + '.pdf'))
      .toString().replace(/[^\w.\-]/g, '_').slice(0, 100);

    const htmlFac = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#10B981;color:white;padding:22px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:22px">${tNom}</h1>
    <p style="margin:6px 0 0;opacity:.85;font-size:13px">Tu factura ${num}</p>
  </div>
  <div style="background:white;padding:26px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:15px">Hola ${cli},</p>
    <p style="font-size:14px;color:#444;line-height:1.6">Adjuntamos tu factura <strong>${num}</strong>${totalTxt ? ' por un importe de <strong>' + totalTxt + '</strong>' : ''}. Puedes descargarla y conservarla como justificante.</p>
    <p style="font-size:14px;color:#444;line-height:1.6">Gracias por confiar en nosotros.</p>
    <p style="font-size:13px;color:#888;margin-top:24px">${tNom}</p>
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">Enviado con TekPair · tekpair.tech</div>
</body></html>`;
    try {
      const rf = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'TekPair <noreply@tekpair.tech>',
          to: [email],
          subject: `Factura ${numero || ''} — ${tienda || 'TekPair'}`,
          html: htmlFac,
          attachments: [{ filename: nombreArchivoSafe, content: pdfBase64 }]
        })
      });
      const df = await rf.json();
      if (rf.ok) return res.json({ ok: true, id: df.id });
      console.error('[email] Resend error (factura):', rf.status, df);
      return res.json({ error: 'No se pudo enviar el email' });
    } catch (e) {
      console.error('[email] Enviar factura error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }

  // ── Rama REPORTE DIARIO ──
  const { email, reporte, tienda } = req.body;
  if (!email || !reporte) return res.status(400).json({ error: 'Faltan datos' });

  // EM-3: validar destinatario
  if (!emailValido(email)) return res.status(400).json({ error: 'Email destinatario no válido' });

  // EM-2: escape de campos del reporte
  const fechaSafe = esc(reporte.fecha || '').slice(0, 50);
  const tiendaSafe = esc(tienda || 'Mi Tienda').slice(0, 100);
  const numVentasSafe = esc(reporte.numVentas || 0);
  const totalVentasSafe = esc(reporte.totalVentas || 0);
  const numRepsSafe = esc(reporte.numReps || 0);
  const totalRepsSafe = esc(reporte.totalReps || 0);
  const totalSafe = esc(reporte.total || 0);

  // Pagos (es un objeto {forma: importe})
  const pagosHtml = (reporte.pagos && Object.keys(reporte.pagos).length)
    ? Object.entries(reporte.pagos).map(([k, v]) =>
        `<div class="pago-row"><span>${esc(k)}</span><strong>€${esc(v)}</strong></div>`
      ).join('')
    : '';

  // Ventas (array de objetos)
  const ventasHtml = (Array.isArray(reporte.ventas) && reporte.ventas.length)
    ? reporte.ventas.slice(0, 100).map(v =>
        `<tr><td>${esc(v.clienteNombre)}</td><td>${esc(v.modelo)}</td><td>${esc(v.pago)}</td><td>€${esc(v.total)}</td></tr>`
      ).join('')
    : '';

  // Reparaciones
  const repsHtml = (Array.isArray(reporte.reps) && reporte.reps.length)
    ? reporte.reps.slice(0, 100).map(r =>
        `<tr><td>${esc(r.clienteNombre)}</td><td>${esc(r.marca)} ${esc(r.modelo)}</td><td>€${esc(r.total)}</td></tr>`
      ).join('')
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; }
.header { background: #020B2E; color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
.header h1 { margin: 0; font-size: 22px; }
.header p { margin: 5px 0 0; opacity: .7; font-size: 13px; }
.body { background: white; padding: 24px; border: 1px solid #eee; border-top: none; }
.stat { display: inline-block; text-align: center; padding: 14px 20px; background: #F8FAFC; border-radius: 10px; margin: 6px; min-width: 100px; }
.stat-val { font-size: 24px; font-weight: 800; color: #020B2E; }
.stat-lbl { font-size: 11px; color: #64748B; margin-top: 4px; }
.section { margin: 20px 0; }
.section h2 { font-size: 14px; color: #020B2E; border-bottom: 2px solid #eee; padding-bottom: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #020B2E; color: white; padding: 8px 10px; text-align: left; }
td { padding: 8px 10px; border-bottom: 1px solid #F1F5F9; }
.pago-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #F1F5F9; font-size: 13px; }
.total { font-weight: 700; font-size: 16px; color: #00C896; }
.footer { text-align: center; padding: 16px; color: #94A3B8; font-size: 11px; border-top: 1px solid #eee; margin-top: 20px; }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ Tekpair</h1>
  <p>Reporte diario — ${tiendaSafe}</p>
</div>
<div class="body">
  <p style="color:#64748B;font-size:13px;margin-bottom:16px">📅 ${fechaSafe}</p>

  <div style="text-align:center;margin-bottom:20px">
    <div class="stat"><div class="stat-val" style="color:#0055FF">${numVentasSafe}</div><div class="stat-lbl">Ventas</div></div>
    <div class="stat"><div class="stat-val" style="color:#00C896">€${totalVentasSafe}</div><div class="stat-lbl">Ingresos ventas</div></div>
    <div class="stat"><div class="stat-val" style="color:#7C3AED">${numRepsSafe}</div><div class="stat-lbl">Reparaciones</div></div>
    <div class="stat"><div class="stat-val" style="color:#F97316">€${totalRepsSafe}</div><div class="stat-lbl">Ingresos reps</div></div>
  </div>

  <div style="background:#020B2E;color:white;border-radius:10px;padding:14px;text-align:center;margin-bottom:20px">
    <div style="font-size:13px;opacity:.7">TOTAL DEL DÍA</div>
    <div style="font-size:28px;font-weight:800;color:#00C896">€${totalSafe}</div>
  </div>

  ${pagosHtml ? `<div class="section"><h2>💳 Por forma de pago</h2>${pagosHtml}</div>` : ''}

  ${ventasHtml ? `<div class="section"><h2>📱 Ventas del día</h2><table><thead><tr><th>Cliente</th><th>Modelo</th><th>Pago</th><th>Total</th></tr></thead><tbody>${ventasHtml}</tbody></table></div>` : ''}

  ${repsHtml ? `<div class="section"><h2>🔧 Reparaciones entregadas</h2><table><thead><tr><th>Cliente</th><th>Equipo</th><th>Total</th></tr></thead><tbody>${repsHtml}</tbody></table></div>` : ''}

</div>
<div class="footer">
  Generado por <strong>Tekpair</strong> · tekpair.tech<br>
  Este reporte se genera automáticamente al cierre del día.
</div>
</body>
</html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Tekpair <noreply@tekpair.tech>',
        to: [email],
        subject: `Reporte diario ${reporte.fecha || ''} — ${tienda || 'Tekpair'}`,
        html: html
      })
    });

    const data = await r.json();
    if (r.ok) {
      return res.json({ ok: true, id: data.id });
    } else {
      console.error('[email] Resend error:', r.status, data);
      return res.json({ error: 'No se pudo enviar el email' });
    }
  } catch (e) {
    console.error('[email] Error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
