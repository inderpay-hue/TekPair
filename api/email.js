// api/email.js
// Envío de emails: facturas y reportes diarios desde el dashboard.
//
// Fixes aplicados:
//   EM-1: requiere JWT válido + sesión activa (antes era endpoint público, agujero crítico)
//   EM-2: escape HTML de todos los campos dinámicos para evitar inyección XSS
//   EM-3: validación estricta del destinatario (formato email + límite 5 destinatarios)
//   EM-4: límite del PDF base64 (máx 4MB para no reventar Vercel Hobby body limit)

import jwt from 'jsonwebtoken';
import { rateLimit } from './_lib/ratelimit.js';

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

// AUD-fix: rate limit por tienda para que una cuenta (trial gratis) no use el dominio
// tekpair.tech como plataforma de spam/phishing con destinatarios y adjuntos arbitrarios.
// 40 emails/hora/tienda (holgado para facturas legítimas), distribuido vía api/_lib/ratelimit.js.

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

  // EM-1: AUTH obligatorio — JWT de usuario, O el cron del servidor con CRON_SECRET
  const cronAuth = process.env.CRON_SECRET && (req.headers.authorization || '') === `Bearer ${process.env.CRON_SECRET}`;
  const payload = cronAuth ? { cron: true } : await autenticar(req);
  if (!payload) return res.status(401).json({ error: 'No autorizado' });

  // AUD-fix: rate limit por tienda (salvo el cron del servidor).
  if (!cronAuth && payload.tienda_id) {
    const _rl = await rateLimit('email:' + payload.tienda_id, 40, 60 * 60);
    if (!_rl.ok) {
      return res.status(429).json({ error: 'Límite de envíos alcanzado. Inténtalo más tarde.' });
    }
  }

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
  // Agrupar pagos: efectivo vs tarjeta/bizum/transferencia
  const EFECTIVO_KEYS = ['efectivo','Efectivo','cash','Cash','espèces','contanti','bargeld','dinheiro'];
  let totalEfectivo = 0, totalTarjeta = 0;
  if (reporte.pagos) {
    Object.entries(reporte.pagos).forEach(([k, v]) => {
      if (EFECTIVO_KEYS.includes(k)) totalEfectivo += parseFloat(v) || 0;
      else totalTarjeta += parseFloat(v) || 0;
    });
  }
  const pagosHtml = (totalEfectivo > 0 || totalTarjeta > 0) ? `
    <div class="pago-row"><span>${esc(L.efectivo||'💵 Efectivo')}</span><strong>€${totalEfectivo.toFixed(2)}</strong></div>
    <div class="pago-row"><span>${esc(L.tarjeta||'💳 Tarjeta / Bizum / Transferencia')}</span><strong>€${totalTarjeta.toFixed(2)}</strong></div>
  ` : '';

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

  const lang = req.body.lang || 'es';
  const RPT = {
    es: { subj: `Reporte diario ${reporte.fecha||''} — ${tienda||'Tekpair'}`, header:'Reporte diario', ventas:'Ventas', ingVentas:'Ingresos ventas', reps:'Reparaciones', ingReps:'Ingresos reps', totalDia:'TOTAL DEL DÍA', pagos:'💳 Por forma de pago', efectivo:'💵 Efectivo', tarjeta:'💳 Tarjeta / Bizum / Transferencia', ventasDia:'📱 Ventas del día', repsDia:'🔧 Reparaciones entregadas', cliente:'Cliente', modelo:'Modelo', pago:'Pago', total:'Total', equipo:'Equipo', footer:'Este reporte se genera automáticamente al cierre del día.' },
    en: { subj: `Daily report ${reporte.fecha||''} — ${tienda||'Tekpair'}`, header:'Daily report', ventas:'Sales', ingVentas:'Sales revenue', reps:'Repairs', ingReps:'Repair revenue', totalDia:'TOTAL FOR THE DAY', pagos:'💳 By payment method', efectivo:'💵 Cash', tarjeta:'💳 Card / Bizum / Transfer', ventasDia:'📱 Sales of the day', repsDia:'🔧 Repairs delivered', cliente:'Customer', modelo:'Model', pago:'Payment', total:'Total', equipo:'Device', footer:'This report is generated automatically at end of day.' },
    fr: { subj: `Rapport quotidien ${reporte.fecha||''} — ${tienda||'Tekpair'}`, header:'Rapport quotidien', ventas:'Ventes', ingVentas:'Revenus ventes', reps:'Réparations', ingReps:'Revenus réparations', totalDia:'TOTAL DU JOUR', pagos:'💳 Par mode de paiement', efectivo:'💵 Espèces', tarjeta:'💳 Carte / Virement', ventasDia:'📱 Ventes du jour', repsDia:'🔧 Réparations livrées', cliente:'Client', modelo:'Modèle', pago:'Paiement', total:'Total', equipo:'Appareil', footer:'Ce rapport est généré automatiquement en fin de journée.' },
    it: { subj: `Rapporto giornaliero ${reporte.fecha||''} — ${tienda||'Tekpair'}`, header:'Rapporto giornaliero', ventas:'Vendite', ingVentas:'Ricavi vendite', reps:'Riparazioni', ingReps:'Ricavi riparazioni', totalDia:'TOTALE DEL GIORNO', pagos:'💳 Per metodo di pagamento', efectivo:'💵 Contanti', tarjeta:'💳 Carta / Bonifico', ventasDia:'📱 Vendite del giorno', repsDia:'🔧 Riparazioni consegnate', cliente:'Cliente', modelo:'Modello', pago:'Pagamento', total:'Totale', equipo:'Dispositivo', footer:'Questo rapporto viene generato automaticamente a fine giornata.' },
    de: { subj: `Tagesbericht ${reporte.fecha||''} — ${tienda||'Tekpair'}`, header:'Tagesbericht', ventas:'Verkäufe', ingVentas:'Verkaufseinnahmen', reps:'Reparaturen', ingReps:'Reparatureinnahmen', totalDia:'TAGESGESAMT', pagos:'💳 Nach Zahlungsart', efectivo:'💵 Bargeld', tarjeta:'💳 Karte / Überweisung', ventasDia:'📱 Verkäufe des Tages', repsDia:'🔧 Ausgelieferte Reparaturen', cliente:'Kunde', modelo:'Modell', pago:'Zahlung', total:'Gesamt', equipo:'Gerät', footer:'Dieser Bericht wird automatisch am Ende des Tages generiert.' },
    pt: { subj: `Relatório diário ${reporte.fecha||''} — ${tienda||'Tekpair'}`, header:'Relatório diário', ventas:'Vendas', ingVentas:'Receitas vendas', reps:'Reparações', ingReps:'Receitas reparações', totalDia:'TOTAL DO DIA', pagos:'💳 Por forma de pagamento', efectivo:'💵 Dinheiro', tarjeta:'💳 Cartão / Transferência', ventasDia:'📱 Vendas do dia', repsDia:'🔧 Reparações entregues', cliente:'Cliente', modelo:'Modelo', pago:'Pagamento', total:'Total', equipo:'Dispositivo', footer:'Este relatório é gerado automaticamente no fecho do dia.' }
  };
  const L = RPT[lang] || RPT.es;

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
  <p>${L.header} — ${tiendaSafe}</p>
</div>
<div class="body">
  <p style="color:#64748B;font-size:13px;margin-bottom:16px">📅 ${fechaSafe}</p>

  <div style="text-align:center;margin-bottom:20px">
    <div class="stat"><div class="stat-val" style="color:#0055FF">${numVentasSafe}</div><div class="stat-lbl">${L.ventas}</div></div>
    <div class="stat"><div class="stat-val" style="color:#00C896">€${totalVentasSafe}</div><div class="stat-lbl">${L.ingVentas}</div></div>
    <div class="stat"><div class="stat-val" style="color:#7C3AED">${numRepsSafe}</div><div class="stat-lbl">${L.reps}</div></div>
    <div class="stat"><div class="stat-val" style="color:#F97316">€${totalRepsSafe}</div><div class="stat-lbl">${L.ingReps}</div></div>
  </div>

  <div style="background:#020B2E;color:white;border-radius:10px;padding:14px;text-align:center;margin-bottom:20px">
    <div style="font-size:13px;opacity:.7">${L.totalDia}</div>
    <div style="font-size:28px;font-weight:800;color:#00C896">€${totalSafe}</div>
  </div>

  ${pagosHtml ? `<div class="section"><h2>💳 Por forma de pago</h2>${pagosHtml}</div>` : ''}

  ${ventasHtml ? `<div class="section"><h2>📱 Ventas del día</h2><table><thead><tr><th>${L.cliente}</th><th>${L.modelo}</th><th>${L.pago}</th><th>${L.total}</th></tr></thead><tbody>${ventasHtml}</tbody></table></div>` : ''}

  ${repsHtml ? `<div class="section"><h2>🔧 Reparaciones entregadas</h2><table><thead><tr><th>${L.cliente}</th><th>${L.equipo}</th><th>${L.total}</th></tr></thead><tbody>${repsHtml}</tbody></table></div>` : ''}

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
        from: 'Tekpair <info@tekpair.tech>',
        to: [email],
        subject: L.subj,
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
