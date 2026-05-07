export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, reporte, tienda } = req.body;
  if (!email || !reporte) return res.status(400).json({ error: 'Faltan datos' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });

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
  <p>Reporte diario — ${tienda || 'Mi Tienda'}</p>
</div>
<div class="body">
  <p style="color:#64748B;font-size:13px;margin-bottom:16px">📅 ${reporte.fecha}</p>
  
  <div style="text-align:center;margin-bottom:20px">
    <div class="stat"><div class="stat-val" style="color:#0055FF">${reporte.numVentas}</div><div class="stat-lbl">Ventas</div></div>
    <div class="stat"><div class="stat-val" style="color:#00C896">€${reporte.totalVentas}</div><div class="stat-lbl">Ingresos ventas</div></div>
    <div class="stat"><div class="stat-val" style="color:#7C3AED">${reporte.numReps}</div><div class="stat-lbl">Reparaciones</div></div>
    <div class="stat"><div class="stat-val" style="color:#F97316">€${reporte.totalReps}</div><div class="stat-lbl">Ingresos reps</div></div>
  </div>

  <div style="background:#020B2E;color:white;border-radius:10px;padding:14px;text-align:center;margin-bottom:20px">
    <div style="font-size:13px;opacity:.7">TOTAL DEL DÍA</div>
    <div style="font-size:28px;font-weight:800;color:#00C896">€${reporte.total}</div>
  </div>

  ${reporte.pagos && Object.keys(reporte.pagos).length ? `
  <div class="section">
    <h2>💳 Por forma de pago</h2>
    ${Object.entries(reporte.pagos).map(([k,v]) => `
    <div class="pago-row"><span>${k}</span><strong>€${v}</strong></div>
    `).join('')}
  </div>` : ''}

  ${reporte.ventas && reporte.ventas.length ? `
  <div class="section">
    <h2>📱 Ventas del día</h2>
    <table>
      <thead><tr><th>Cliente</th><th>Modelo</th><th>Pago</th><th>Total</th></tr></thead>
      <tbody>
        ${reporte.ventas.map(v => `<tr><td>${v.clienteNombre}</td><td>${v.modelo}</td><td>${v.pago}</td><td>€${v.total}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${reporte.reps && reporte.reps.length ? `
  <div class="section">
    <h2>🔧 Reparaciones entregadas</h2>
    <table>
      <thead><tr><th>Cliente</th><th>Equipo</th><th>Total</th></tr></thead>
      <tbody>
        ${reporte.reps.map(r => `<tr><td>${r.clienteNombre}</td><td>${r.marca} ${r.modelo}</td><td>€${r.total}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

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
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Tekpair <noreply@tekpair.tech>',
        to: [email],
        subject: `Reporte diario ${reporte.fecha} — ${tienda || 'Tekpair'}`,
        html: html
      })
    });

    const data = await r.json();
    if (r.ok) {
      return res.json({ ok: true, id: data.id });
    } else {
      console.error('Resend error:', data);
      return res.json({ error: data.message || 'Error al enviar' });
    }
  } catch(e) {
    console.error('Email error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
