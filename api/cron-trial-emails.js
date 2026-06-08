// api/cron-trial-emails.js
// Vercel Cron job que se ejecuta cada día a las 9:00 (configurado en vercel.json)
// Envía recordatorios a clientes en trial que estén a 3 o 1 días de fin de prueba
//
// Fixes aplicados:
//   CRON-1: timing-safe comparison del CRON_SECRET (vía Node crypto.timingSafeEqual)
//   CRON-2: marcar la flag de "enviado" ANTES de mandar (evita doble envío si cron reintenta)
//   CRON-3: try/catch individual por tienda (un fallo no aborta el resto)

import crypto from 'crypto';

// CRON-1: timing-safe equal — evita ataques que deducen el secret carácter a carácter
function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Forzar misma longitud usando un buffer temporal para evitar leak de longitud
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Comparamos contra sí mismo para que tarde tiempo similar, después devolvemos false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export default async function handler(req, res) {
  // CRON-1: verificar con timing-safe comparison
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const got = req.headers['authorization'] || '';
  if (!timingSafeEq(expected, got)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[cron] Configuración incompleta');
    return res.status(500).json({ error: 'Configuración de servidor incompleta' });
  }

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
    if (!r.ok) {
      const t = await r.text();
      console.error('[cron] Error consultando tiendas:', r.status, t);
      return res.status(500).json({ error: 'Error consultando tiendas' });
    }
    const tiendas = await r.json();

    let emailsSent = 0;
    let errores = 0;
    const now = new Date();

    for (const t of tiendas) {
      // CRON-3: try/catch por tienda — si una falla, las demás siguen
      try {
        if (!t.trial_until) continue;

        const trialEnd = new Date(t.trial_until);
        const msLeft = trialEnd - now;
        const daysLeft = msLeft / 86400000;

        // Email "3 días" - se dispara si quedan entre 2.5 y 3.5 días (ventana de 24h)
        if (daysLeft >= 2.5 && daysLeft <= 3.5 && !t.trial_email_3d_sent) {
          // CRON-2: marcar la flag PRIMERO (antes de enviar).
          // Si el send falla, perdemos un email — preferible a duplicarlo si el cron reintenta.
          const markR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(t.id)}&trial_email_3d_sent=is.false`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ trial_email_3d_sent: true })
          });
          if (markR.ok) {
            const updated = await markR.json();
            // Si el WHERE filtró bien, updated.length === 1 (race: si otro proceso marcó antes, length 0)
            if (Array.isArray(updated) && updated.length === 1) {
              const sentOk = await sendEmail3Days(t, RESEND_KEY);
              if (sentOk) {
                emailsSent++;
              } else {
                // Rollback de la flag si el email falló (para que vuelva a intentarse otro día)
                await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(t.id)}`, {
                  method: 'PATCH',
                  headers: { ...headers, 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ trial_email_3d_sent: false })
                });
                errores++;
              }
            }
          }
        }

        // Email "1 día" - se dispara si quedan entre 0.5 y 1.5 días
        if (daysLeft >= 0.5 && daysLeft <= 1.5 && !t.trial_email_1d_sent) {
          const markR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(t.id)}&trial_email_1d_sent=is.false`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ trial_email_1d_sent: true })
          });
          if (markR.ok) {
            const updated = await markR.json();
            if (Array.isArray(updated) && updated.length === 1) {
              const sentOk = await sendEmail1Day(t, RESEND_KEY);
              if (sentOk) {
                emailsSent++;
              } else {
                await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(t.id)}`, {
                  method: 'PATCH',
                  headers: { ...headers, 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ trial_email_1d_sent: false })
                });
                errores++;
              }
            }
          }
        }
      } catch (eTienda) {
        // CRON-3: error individual no aborta el resto
        console.error('[cron] Error procesando tienda', t.id, ':', eTienda.message);
        errores++;
      }
    }

    // ── Envío diario a Cobrum (funciona con el PC apagado): tiendas con cobrum_sync ──
    let cobrum = { enviados: 0, errores: 0 };
    try {
      const ayerD = new Date(now.getTime() - 86400000);
      const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ayerD);
      cobrum = await pushCobrumDiario(SUPABASE_URL, headers, ayer);
    } catch (e) { console.error('[cron] cobrum:', e.message); }

    return res.json({ ok: true, processed: tiendas.length, emails_sent: emailsSent, errores: errores, cobrum });

  } catch(e) {
    console.error('[cron] Error general:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

// ═══ ENVÍO DIARIO A COBRUM (servidor) ═══
// Para cada tienda con cobrum_sync, calcula el día anterior (ventas + reparaciones + gastos
// por forma de pago) y lo manda a Cobrum. Idempotente por fecha (ref=ayer → no duplica).
function _cobrumMetodo(m) {
  m = String(m || '').trim().toLowerCase();
  const map = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', bizum: 'Bizum', transferencia: 'Transferencia' };
  return map[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Otros');
}
async function pushCobrumDiario(SUPABASE_URL, headers, ayer) {
  const COBRUM_URL = 'https://finanzas-app-six-zeta.vercel.app/api/integraciones';
  let enviados = 0, errores = 0;
  const tr = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?or=(cobrum_sync.eq.true,cierre_email_auto.eq.true)&select=id,nombre,cobrum_token,cobrum_sync,cierre_email_auto,email`, { headers });
  if (!tr.ok) return { enviados, errores: 1 };
  const tiendas = await tr.json();
  for (const t of tiendas) {
    try {
      const q = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }).then((r) => r.ok ? r.json() : []);
      const [ventas, pagos, gastos, finVentas] = await Promise.all([
        q(`ventas?tienda_id=eq.${t.id}&fecha=eq.${ayer}&select=total,pago,reembolsado,financiado,entrada,entrada_pago`),
        q(`pagos_reparacion?tienda_id=eq.${t.id}&fecha=eq.${ayer}&select=importe,metodo`),
        q(`gastos?tienda_id=eq.${t.id}&fecha=eq.${ayer}&select=importe,metodo_pago`),
        // Todas las ventas financiadas vivas (cualquier fecha) → para cuotas pagadas ayer + saldo pendiente
        q(`ventas?tienda_id=eq.${t.id}&financiado=eq.true&reembolsado=eq.false&select=id,cliente_nombre,total,entrada,cuotas`),
      ]);
      const parseCuotas = (c) => { try { return Array.isArray(c) ? c : JSON.parse(c || '[]'); } catch (e) { return []; } };
      const porMet = {};
      const bk = (m) => { const l = _cobrumMetodo(m); return (porMet[l] = porMet[l] || { v: 0, r: 0, g: 0 }); };
      (ventas || []).forEach((v) => {
        if (v.reembolsado) return;
        // Venta financiada: el día de la venta solo entra la ENTRADA (por su forma de pago). El resto son cuotas.
        if (v.financiado) bk(v.entrada_pago).v += Number(v.entrada || 0);
        else bk(v.pago).v += Number(v.total || 0);
      });
      // Cuotas de financiadas pagadas AYER → ingreso el día que se cobran, por su forma de pago
      (finVentas || []).forEach((v) => {
        parseCuotas(v.cuotas).forEach((c) => {
          if (c && c.pagado && c.fechaPago === ayer) bk(c.formaPago).v += Number(c.importe || 0);
        });
      });
      (pagos || []).forEach((p) => { bk(p.metodo).r += Number(p.importe || 0); });
      (gastos || []).forEach((g) => { bk(g.metodo_pago).g += Number(g.importe || 0); });
      const lineas = [];
      Object.keys(porMet).forEach((l) => {
        const x = porMet[l], c = 'TekPair ' + l;
        if (x.v > 0) lineas.push({ tipo: 'ingreso', cuenta: c, categoria: 'Ventas', monto: Math.round(x.v * 100) / 100 });
        if (x.r > 0) lineas.push({ tipo: 'ingreso', cuenta: c, categoria: 'Reparaciones', monto: Math.round(x.r * 100) / 100 });
        if (x.g > 0) lineas.push({ tipo: 'gasto', cuenta: c, categoria: 'Gastos negocio', monto: Math.round(x.g * 100) / 100 });
      });
      // FIADOS (lo por cobrar = restante de reparaciones). Informativo: sin_ingreso=true
      // (el ingreso ya entra por los pagos de reparación del volcado diario → no doblar).
      // Una reparación SOLO es fiado si el cliente ya se llevó el móvil (estado 'Entregado') y debe dinero.
      // Si el móvil sigue en la tienda, el saldo pendiente NO es fiado (la tienda tiene el equipo).
      const entregada = (r) => (r.estado || '').toLowerCase() === 'entregado';
      const fiados = [];
      try {
        // Pendientes: reparaciones ENTREGADAS con saldo por cobrar
        const pendRep = await q(`reparaciones?tienda_id=eq.${t.id}&restante=gt.0&select=id,cliente_nombre,restante,estado`);
        (pendRep || []).forEach((r) => {
          if (Number(r.restante) > 0 && entregada(r)) fiados.push({ ref: 'rep:' + r.id, cliente_nombre: r.cliente_nombre || null, concepto: 'Reparación', monto: Math.round(Number(r.restante) * 100) / 100, estado: 'pendiente', sin_ingreso: true });
        });
        // Cobrados: reparaciones ENTREGADAS con PAGO ayer que quedaron saldadas (por fecha de PAGO).
        const pagosAyer = await q(`pagos_reparacion?tienda_id=eq.${t.id}&fecha=eq.${ayer}&select=reparacion_id`);
        const repIds = [...new Set((pagosAyer || []).map((p) => p.reparacion_id).filter(Boolean))];
        if (repIds.length) {
          const repsCob = await q(`reparaciones?tienda_id=eq.${t.id}&id=in.(${repIds.join(',')})&select=id,cliente_nombre,total,anticipo,restante,estado`);
          (repsCob || []).forEach((r) => {
            if (Number(r.restante || 0) <= 0 && Number(r.anticipo || 0) < Number(r.total || 0) && entregada(r)) {
              fiados.push({ ref: 'rep:' + r.id, cliente_nombre: r.cliente_nombre || null, concepto: 'Reparación', monto: Math.round(Number(r.total) * 100) / 100, estado: 'cobrado', sin_ingreso: true });
            }
          });
        }
        // FINANCIADO (ventas a plazos): lo pendiente = total − entrada − cuotas pagadas. sin_ingreso=true
        // (el ingreso ya entra por la entrada el día de la venta + cada cuota el día que se paga).
        (finVentas || []).forEach((v) => {
          const cuotas = parseCuotas(v.cuotas);
          const pagadoCuotas = cuotas.filter((c) => c && c.pagado).reduce((s, c) => s + Number(c.importe || 0), 0);
          const pendiente = Math.round((Number(v.total || 0) - Number(v.entrada || 0) - pagadoCuotas) * 100) / 100;
          if (pendiente > 0.005) {
            fiados.push({ ref: 'venta:' + v.id, cliente_nombre: v.cliente_nombre || null, concepto: 'Venta a plazos', monto: pendiente, estado: 'pendiente', sin_ingreso: true });
          } else if (cuotas.some((c) => c && c.pagado && c.fechaPago === ayer)) {
            // Se completó AYER (última cuota pagada ayer) → marcar cobrado
            fiados.push({ ref: 'venta:' + v.id, cliente_nombre: v.cliente_nombre || null, concepto: 'Venta a plazos', monto: 0, estado: 'cobrado', sin_ingreso: true });
          }
        });
      } catch (e) { /* sin fiados */ }

      // 1) Volcado a Cobrum (si la tienda lo tiene activado)
      if (t.cobrum_sync && t.cobrum_token && (lineas.length || fiados.length)) {
        try {
          const cr = await fetch(COBRUM_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cobrum-Token': t.cobrum_token },
            body: JSON.stringify({ source: 'tekpair', fecha: ayer, ref: ayer, lineas, fiados }),
          });
          if (cr.ok) enviados++; else errores++;
        } catch (e) { errores++; }
      }
      // 2) Email diario del cierre (servidor → funciona con el PC apagado)
      if (t.cierre_email_auto && t.email) {
        try {
          const noReemb = (ventas || []).filter((v) => !v.reembolsado);
          const totV = noReemb.reduce((s, v) => s + Number(v.total || 0), 0);
          const totR = (pagos || []).reduce((s, p) => s + Number(p.importe || 0), 0);
          const pagosObj = {};
          noReemb.forEach((v) => { const k = v.pago || 'Efectivo'; pagosObj[k] = (pagosObj[k] || 0) + Number(v.total || 0); });
          (pagos || []).forEach((p) => { const k = p.metodo || 'Efectivo'; pagosObj[k] = (pagosObj[k] || 0) + Number(p.importe || 0); });
          const reporte = { fecha: ayer, numVentas: noReemb.length, totalVentas: totV.toFixed(2), numReps: (pagos || []).length, totalReps: totR.toFixed(2), total: (totV + totR).toFixed(2), pagos: pagosObj, ventas: [], reps: [] };
          await fetch('https://www.tekpair.tech/api/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
            body: JSON.stringify({ email: t.email, tienda: t.nombre, reporte }),
          });
        } catch (e) { console.error('[cron-email] tienda', t.id, e.message); }
      }
    } catch (e) { console.error('[cron-cobrum] tienda', t.id, e.message); errores++; }
  }
  return { enviados, errores };
}

// ═══ EMAIL FALTAN 3 DÍAS ═══
async function sendEmail3Days(tienda, RESEND_KEY) {
  if (!RESEND_KEY) return false;
  const planLabel = ({basico:'Básico', pro:'Pro', top:'Premium', premium:'Premium'})[tienda.plan] || 'Básico';
  const planPrecio = ({basico:'9,90', pro:'19,90', top:'34,90', premium:'34,90'})[tienda.plan] || '9,90';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Tekpair <info@tekpair.tech>',
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

    <a href="https://www.tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:24px">Entrar a Tekpair →</a>

    <p style="color:#64748B;font-size:12px;margin-top:24px;text-align:center;border-top:1px solid #eee;padding-top:16px">¿Dudas? Respondemos a info@tekpair.tech</p>
  </div>
</body></html>`
      })
    });
    return r.ok;
  } catch (e) {
    console.error('[cron] sendEmail3Days falló para', tienda.id, ':', e.message);
    return false;
  }
}

// ═══ EMAIL FALTA 1 DÍA ═══
async function sendEmail1Day(tienda, RESEND_KEY) {
  if (!RESEND_KEY) return false;
  const planLabel = ({basico:'Básico', pro:'Pro', top:'Premium', premium:'Premium'})[tienda.plan] || 'Básico';
  const planPrecio = ({basico:'9,90', pro:'19,90', top:'34,90', premium:'34,90'})[tienda.plan] || '9,90';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Tekpair <info@tekpair.tech>',
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

    <a href="https://www.tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px">Abrir Tekpair →</a>

    <p style="color:#64748B;font-size:12px;margin-top:24px;text-align:center;border-top:1px solid #eee;padding-top:16px">¿Dudas? Respondemos a info@tekpair.tech</p>
  </div>
</body></html>`
      })
    });
    return r.ok;
  } catch (e) {
    console.error('[cron] sendEmail1Day falló para', tienda.id, ':', e.message);
    return false;
  }
}
