// api/cron-trial-emails.js
// Vercel Cron job que se ejecuta cada día a las 9:00 (configurado en vercel.json)
// Envía recordatorios a clientes en trial que estén a 3 o 1 días de fin de prueba
//
// Fixes aplicados:
//   CRON-1: timing-safe comparison del CRON_SECRET (vía Node crypto.timingSafeEqual)
//   CRON-2: marcar la flag de "enviado" ANTES de mandar (evita doble envío si cron reintenta)
//   CRON-3: try/catch individual por tienda (un fallo no aborta el resto)
//   CRON-4: seleccionar por trial_until y no por plan_status. Un mes regalado a mano deja
//           la tienda en 'active' y antes se quedaba sin avisos: el cliente descubría el
//           cargo en el banco (le pasó a la tienda de Aleem el 4-ago-2026).
//
// CÓMO REGALAR UN MES para que el cliente SÍ reciba los avisos: hay que dejar la fecha
// en trial_until y limpiar las flags de enviado. Desde el SQL editor de Supabase:
//
//   update tiendas
//   set trial_until = (now() + interval '1 month'),
//       trial_email_3d_sent = false,
//       trial_email_1d_sent = false
//   where id = '<id-de-la-tienda>';
//
// Sin trial_until no hay forma de saber cuándo acaba lo gratis, y no se avisa.

import { nivelComercial, primerosPagos } from './_lib/nivel-comercial.js';
import { sbTodo } from './_lib/sb-todo.js';
import crypto from 'crypto';
import { construirResumen, enviarResumen, destinoResumen, fechaMadrid, esPremium, construirInformeMes, mesesInforme } from './_lib/resumen.js';

// CRON-1: timing-safe equal — evita ataques que deducen el secret carácter a carácter

// Desglose de una venta por forma de pago: el pago mixto trae `pagos`
// ([{metodo, importe}], sql/ventas-pago-mixto.sql); el resto, todo con `pago`.
function _desglosePago(v) {
  let pg = v && v.pagos;
  if (typeof pg === 'string') { try { pg = JSON.parse(pg); } catch (e) { pg = null; } }
  if (Array.isArray(pg) && pg.length) return pg.map((p) => ({ metodo: (p && p.metodo) || 'Efectivo', importe: Number(p && p.importe) || 0 }));
  return [{ metodo: (v && v.pago) || 'Efectivo', importe: Number(v && v.total) || 0 }];
}

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
  // AUD-fix: fail-closed si CRON_SECRET no está configurado (si no, 'Bearer undefined' pasaría).
  if (!process.env.CRON_SECRET) {
    console.error('[cron-trial] CRON_SECRET no configurado — fail-closed');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
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
    // 1. Tiendas con fecha de fin de prueba por delante y email configurado.
    //    La fuente de verdad es trial_until, NO plan_status: un mes regalado a mano deja
    //    la tienda en plan_status='active', así que con el filtro anterior (=trial) esos
    //    clientes se quedaban sin avisos y descubrían el cargo en el banco. Con
    //    trial_until entran igual. Las que ya pagan tienen trial_until en el pasado y
    //    quedan fuera solas, porque abajo solo se avisa entre 3.5 y 0.5 días antes.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?trial_until=not.is.null&plan_email=not.is.null&plan_status=in.(trial,active)&select=id,nombre,plan,plan_email,trial_until,trial_email_3d_sent,trial_email_1d_sent`, {
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

    // ── Aviso INTERNO de clientes que se están enfriando (no le llega a nadie más) ──
    let alertas = { avisos: 0, enviado: false };
    try {
      alertas = await avisarInactividad(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] alertas:', e.message); }

    // ── Recordatorio de recogida por email (tiendas que lo activan en Notificaciones) ──
    let recogida = { enviados: 0, errores: 0 };
    try {
      recogida = await recordatoriosRecogida(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] recogida:', e.message); }

    // ── Recordatorio de deudas por email (Te deben → automático) ──
    let deudas = { enviados: 0, errores: 0 };
    try {
      deudas = await recordatoriosDeuda(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] deudas:', e.message); }

    // ── Resumen diario para el dueño (Ajustes → Notificaciones) ──
    let resumen = { enviados: 0, errores: 0 };
    try {
      resumen = await resumenesDiarios(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] resumen:', e.message); }

    // ── Informe del mes (día 1, Premium) ──
    let informe = { enviados: 0, errores: 0 };
    try {
      informe = await informesMensuales(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] informe mes:', e.message); }

    // ── Encuesta de satisfacción por email el día después de entregar ──
    let encuestas = { enviados: 0, errores: 0 };
    try {
      encuestas = await encuestasValoracion(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] encuestas:', e.message); }

    // ── Comerciales: baja automática según sus condiciones (api/_lib/nivel-comercial.js) ──
    let comerciales = { revisados: 0, bajas: 0 };
    try {
      comerciales = await bajasComerciales(SUPABASE_URL, headers, RESEND_KEY, now);
    } catch (e) { console.error('[cron] comerciales:', e.message); }

    return res.json({ ok: true, processed: tiendas.length, emails_sent: emailsSent, errores: errores, cobrum, alertas, recogida, encuestas, resumen, informe, deudas, comerciales });

  } catch(e) {
    console.error('[cron] Error general:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

// ═══ COMERCIALES: BAJA AUTOMÁTICA ═══
// Un comercial que lleva un año en el 5 % sin hacer 3 altas en ningún trimestre queda de
// baja: se desactiva su código (deja de cobrar comisión y de dar el mes de prueba) y se
// avisa a info@tekpair.tech. Su cuenta de tienda no se toca: eso lo decide el dueño.
async function bajasComerciales(SUPABASE_URL, headers, RESEND_KEY, now) {
  const out = { revisados: 0, bajas: 0 };
  const afR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?activo=eq.true&select=codigo,nombre,email,comision_pct,created_at`, { headers });
  const afs = afR.ok ? await afR.json() : [];
  for (const af of Array.isArray(afs) ? afs : []) {
    out.revisados++;
    // Si no se pueden leer sus pagos NO se decide nada: con la lista vacía saldría de baja.
    let pagos;
    try { pagos = await sbTodo(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(af.codigo)}&monto_neto=gt.0&select=tienda_id,created_at,monto_neto&order=created_at.asc`, headers); }
    catch (e) { continue; }
    const nivel = nivelComercial({ alta: af.created_at, base: af.comision_pct, hoy: now,
      altas: primerosPagos((Array.isArray(pagos) ? pagos : []).map(x => ({ tienda: x.tienda_id, fecha: x.created_at, importe: x.monto_neto }))) });
    if (nivel.estado !== 'baja') continue;
    const up = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(af.codigo)}&activo=eq.true`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify({ activo: false })
    });
    const hechos = up.ok ? await up.json().catch(() => []) : [];
    if (!Array.isArray(hechos) || !hechos.length) continue;   // ya estaba de baja (otra ejecución)
    out.bajas++;
    if (RESEND_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'TekPair <info@tekpair.tech>', to: ['info@tekpair.tech'],
          subject: `Comercial de baja: ${af.nombre || af.codigo} (${af.codigo})`,
          html: `<p>El comercial <b>${esc(af.nombre || '')}</b> (código <b>${esc(af.codigo)}</b>, ${esc(af.email || '')}) ha pasado un año en el 5 % sin llegar a 3 altas en ningún trimestre.</p><p>Se ha desactivado su código: ya no cobra comisión ni da el mes de prueba. Su cuenta de tienda sigue activa; si quieres cerrarla, usa «Dar de baja» en Comisiones.</p>` })
      }).catch(() => {});
    }
  }
  return out;
}

// ═══ ENVÍO DIARIO A COBRUM (servidor) ═══
// Para cada tienda con cobrum_sync, calcula el día anterior (ventas + reparaciones + gastos
// por forma de pago) y lo manda a Cobrum. Idempotente por fecha (ref=ayer → no duplica).
function _cobrumMetodo(m) {
  m = String(m || '').trim().toLowerCase();
  const map = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', bizum: 'Bizum', transferencia: 'Transferencia' };
  return map[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Otros');
}
const cuotaAbonos = (c) => {
  // Cada pago de una cuota con su fecha y forma de pago (igual que _cuotaAbonos del panel).
  if (!c) return [];
  const pagado = c.pagadoImporte != null ? (parseFloat(c.pagadoImporte) || 0) : (c.pagado ? (parseFloat(c.importe) || 0) : 0);
  const out = []; let sum = 0;
  (Array.isArray(c.abonos) ? c.abonos : []).forEach((a) => { const i = parseFloat(a && a.importe) || 0; if (i) { out.push({ fecha: String(a.fecha || '').slice(0, 10), importe: i, metodo: a.metodo || 'Efectivo' }); sum += i; } });
  const resto = Math.round((pagado - sum) * 100) / 100;
  if (resto > 0.005 && c.fechaPago) out.push({ fecha: String(c.fechaPago).slice(0, 10), importe: resto, metodo: c.formaPago || 'Efectivo' });
  return out;
};
async function pushCobrumDiario(SUPABASE_URL, headers, ayer) {
  // Dominio propio. El viejo finanzas-app-six-zeta seguia sirviendo un deploy
  // congelado (v46) que escribia fiados en Cobrum: por eso volvian a aparecer
  // aunque el codigo actual ya no los crea.
  const COBRUM_URL = process.env.COBRUM_URL || 'https://cobrum.tech/api/integraciones';
  let enviados = 0, errores = 0;
  const tr = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?or=(cobrum_sync.eq.true,cierre_email_auto.eq.true)&select=id,nombre,cobrum_token,cobrum_sync,cierre_email_auto,email`, { headers });
  if (!tr.ok) return { enviados, errores: 1 };
  const tiendas = await tr.json();
  for (const t of tiendas) {
    try {
      const q = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }).then((r) => r.ok ? r.json() : []);
      const [ventas, pagos, gastos, finVentas] = await Promise.all([
        q(`ventas?tienda_id=eq.${t.id}&fecha=eq.${ayer}&select=total,pago,pagos,reembolsado,financiado,entrada,entrada_pago`),
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
        else _desglosePago(v).forEach((p) => { bk(p.metodo).v += p.importe; });
      });
      // Cuotas de financiadas pagadas AYER → ingreso el día que se cobran, por su forma de pago
      (finVentas || []).forEach((v) => {
        parseCuotas(v.cuotas).forEach((c) => {
          cuotaAbonos(c).forEach((a) => { if (a.fecha === ayer) bk(a.metodo).v += a.importe; });
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
      // Una reparación es fiado si el cliente ya tiene el móvil y debe dinero: estado 'Entregado',
      // O es financiada (a plazos) activa (el cliente se lo llevó al firmar la financiación).
      // Si el móvil sigue en la tienda (no entregado, no financiado), el saldo pendiente NO es fiado.
      const entregada = (r) => (r.estado || '').toLowerCase() === 'entregado';
      const financiadaActiva = (r) => r.financiado === true && (r.estado_financiado || '') !== 'completado';
      const esFiado = (r) => entregada(r) || financiadaActiva(r);
      const fiados = [];
      try {
        // Pendientes: reparaciones entregadas o financiadas con saldo por cobrar
        const pendRep = await q(`reparaciones?tienda_id=eq.${t.id}&restante=gt.0&select=id,cliente_nombre,restante,estado,financiado,estado_financiado`);
        (pendRep || []).forEach((r) => {
          if (Number(r.restante) > 0 && esFiado(r)) fiados.push({ ref: 'rep:' + r.id, cliente_nombre: r.cliente_nombre || null, concepto: r.financiado ? 'Reparación financiada' : 'Reparación', monto: Math.round(Number(r.restante) * 100) / 100, estado: 'pendiente', sin_ingreso: true });
        });
        // Cobrados: reparaciones ENTREGADAS con PAGO ayer que quedaron saldadas (por fecha de PAGO).
        const pagosAyer = await q(`pagos_reparacion?tienda_id=eq.${t.id}&fecha=eq.${ayer}&select=reparacion_id`);
        const repIds = [...new Set((pagosAyer || []).map((p) => p.reparacion_id).filter(Boolean))];
        if (repIds.length) {
          const repsCob = await q(`reparaciones?tienda_id=eq.${t.id}&id=in.(${repIds.join(',')})&select=id,cliente_nombre,total,anticipo,restante,estado,financiado,estado_financiado`);
          (repsCob || []).forEach((r) => {
            if (Number(r.restante || 0) <= 0 && Number(r.anticipo || 0) < Number(r.total || 0) && (entregada(r) || r.financiado === true)) {
              fiados.push({ ref: 'rep:' + r.id, cliente_nombre: r.cliente_nombre || null, concepto: r.financiado ? 'Reparación financiada' : 'Reparación', monto: Math.round(Number(r.total) * 100) / 100, estado: 'cobrado', sin_ingreso: true });
            }
          });
        }
        // FINANCIADO (ventas a plazos): lo pendiente = total − entrada − cuotas pagadas. sin_ingreso=true
        // (el ingreso ya entra por la entrada el día de la venta + cada cuota el día que se paga).
        (finVentas || []).forEach((v) => {
          const cuotas = parseCuotas(v.cuotas);
          const pagadoCuotas = cuotas.reduce((s, c) => s + cuotaAbonos(c).reduce((t, a) => t + a.importe, 0), 0);
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
            // negocio: permite que varias tiendas vuelquen en la misma cuenta de
            // Cobrum sin pisarse (entra en la clave de idempotencia del receptor).
            body: JSON.stringify({ source: 'tekpair', negocio: t.nombre || null, fecha: ayer, ref: ayer, lineas, fiados }),
          });
          if (cr.ok) enviados++; else errores++;
        } catch (e) { errores++; }
      }
      // 2) Email diario del cierre (servidor → funciona con el PC apagado)
      if (t.cierre_email_auto && t.email) {
        try {
          // Apuntado ANTES de enviar con id fijo por tienda y día: si el cron se repite, el
          // segundo apunte choca y no sale un segundo email.
          const _apR = await fetch(`${SUPABASE_URL}/rest/v1/avisos`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ id: `cierre_${t.id}_${ayer}`, tienda_id: t.id, tipo: 'cierre_diario', canal: 'email', destinatario: t.email, ref_tipo: 'tienda', ref_id: t.id, asunto: 'Cierre ' + ayer, estado: 'enviado', fecha: new Date().toISOString() }) });
          if (!_apR.ok) throw new Error('ya enviado o sin apuntar (' + _apR.status + ')');
          const noReemb = (ventas || []).filter((v) => !v.reembolsado);
          const totV = noReemb.reduce((s, v) => s + Number(v.total || 0), 0);
          const totR = (pagos || []).reduce((s, p) => s + Number(p.importe || 0), 0);
          const pagosObj = {};
          noReemb.forEach((v) => { _desglosePago(v).forEach((p) => { pagosObj[p.metodo] = (pagosObj[p.metodo] || 0) + p.importe; }); });
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

// ═══ AVISO INTERNO: CLIENTES QUE SE ENFRÍAN ═══
//
// Por qué existe: el 27-ago-2026 a una tienda le entró el primer cobro del Premium
// llevando tres días sin abrir la aplicación y con 0 reparaciones creadas. Nadie se
// enteró hasta mirarlo a mano en la base de datos. Un cliente que no entra es el que
// se da de baja al segundo o tercer recibo, así que conviene saberlo mientras aún se
// puede llamar.
//
// Este correo es para el dueño de TekPair, NO para el cliente. No cambia nada de cara
// a él: ni cobros, ni plan, ni emails.
//
// Avisa solo en días concretos (3, 7, 14 y 30 sin entrar) en vez de todos los días,
// porque un recordatorio diario del mismo cliente se acaba ignorando. Se manda un
// único correo con todo lo del día; si no hay nada que contar, no se manda nada.
//
// Config opcional (variables de entorno, ninguna obligatoria):
//   ALERTAS_EMAIL    → a dónde va el aviso (por defecto info@tekpair.tech)
//   ALERTAS_IGNORAR  → emails a excluir separados por comas, para las tiendas propias
//                      y las de prueba. Sin esto salen todas.
const ALERTA_UMBRALES = [3, 7, 14, 30];

// Separada del envío para poder probarla sin tocar la red ni la base de datos.
export function _evaluarTienda(t, now) {
  const refMs = t.ultimo_acceso ? new Date(t.ultimo_acceso).getTime()
    : (t.creada ? new Date(t.creada).getTime() : NaN);
  if (!Number.isFinite(refMs)) return null;

  const dias = Math.floor((now.getTime() - refMs) / 86400000);
  const sinUso = (Number(t.reps || 0) + Number(t.ventas || 0)) === 0;

  // Caso 1: el trial va a cobrar dentro de ~3 días y el taller sigue vacío.
  // Es el aviso que más margen da: aún se puede llamar antes de que le llegue el cargo.
  if (t.trial_until && sinUso) {
    const faltan = (new Date(t.trial_until).getTime() - now.getTime()) / 86400000;
    if (faltan >= 2.5 && faltan <= 3.5) {
      return { tipo: 'cobro_sin_uso', dias, sinUso, detalle: 'le cobran en 3 días y no ha creado nada' };
    }
  }

  // Caso 2: lleva justo 3, 7, 14 o 30 días sin abrir la aplicación.
  // A partir del mes se recuerda cada 30 días en vez de callar para siempre: un cliente
  // que paga y lleva medio año sin entrar sigue siendo una baja esperando a ocurrir, y
  // con la lista fija de umbrales dejaba de aparecer en cuanto se pasaba de 30.
  if (ALERTA_UMBRALES.includes(dias) || (dias > 30 && dias % 30 === 0)) {
    return {
      tipo: 'inactiva', dias, sinUso,
      detalle: t.ultimo_acceso ? `${dias} días sin entrar` : `${dias} días desde el alta y nunca ha entrado`
    };
  }
  return null;
}

async function avisarInactividad(SUPABASE_URL, headers, RESEND_KEY, now) {
  const DESTINO = process.env.ALERTAS_EMAIL || 'info@tekpair.tech';
  const IGNORAR = String(process.env.ALERTAS_IGNORAR || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  const q = (path, extra) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...headers, ...(extra || {}) } });

  const [tr, ur] = await Promise.all([
    q('tiendas?select=id,nombre,plan,plan_status,trial_until,email'),
    q('usuarios?select=tienda_id,email,rol,ultimo_acceso,created_at'),
  ]);
  if (!tr.ok || !ur.ok) return { avisos: 0, enviado: false, error: 'consulta' };
  const tiendas = await tr.json();
  const usuarios = await ur.json();

  // Último acceso de la tienda = el más reciente de cualquiera de sus usuarios.
  // Si mira el empleado y el dueño no, la tienda está viva igualmente.
  const porTienda = {};
  for (const u of usuarios) {
    if (!u.tienda_id) continue;
    const acc = porTienda[u.tienda_id] || (porTienda[u.tienda_id] = { ultimo_acceso: null, creada: null, email: null });
    if (u.ultimo_acceso && (!acc.ultimo_acceso || u.ultimo_acceso > acc.ultimo_acceso)) acc.ultimo_acceso = u.ultimo_acceso;
    if (u.created_at && (!acc.creada || u.created_at < acc.creada)) acc.creada = u.created_at;
    if (!acc.email || u.rol === 'admin') acc.email = u.email;
  }

  // Cuenta filas sin traérselas: Range 0-0 + count=exact devuelve el total en Content-Range.
  const contar = async (tabla, tiendaId) => {
    try {
      const r = await q(`${tabla}?tienda_id=eq.${encodeURIComponent(tiendaId)}&select=id`, { Prefer: 'count=exact', Range: '0-0' });
      if (!r.ok) return 0;
      const cr = r.headers.get('content-range') || '';
      return parseInt(cr.split('/')[1], 10) || 0;
    } catch (e) { return 0; }
  };

  const avisos = [];
  for (const t of tiendas) {
    try {
      const acc = porTienda[t.id] || {};
      const emailDueno = (acc.email || t.email || '').toLowerCase();
      if (IGNORAR.includes(emailDueno)) continue;

      // Primero el filtro por fechas (barato) y solo después se cuentan reparaciones y
      // ventas: así no se lanzan dos consultas por cada tienda que no va a salir.
      const previo = _evaluarTienda({ ...t, ...acc, reps: 0, ventas: 0 }, now);
      if (!previo) continue;

      const [reps, ventas] = await Promise.all([contar('reparaciones', t.id), contar('ventas', t.id)]);
      const ev = _evaluarTienda({ ...t, ...acc, reps, ventas }, now);
      if (!ev) continue;

      avisos.push({
        nombre: t.nombre || '(sin nombre)', email: emailDueno || '—',
        plan: t.plan || '—', estado: t.plan_status || '—',
        reps, ventas, ...ev
      });
    } catch (e) { console.error('[alertas] tienda', t.id, e.message); }
  }

  if (!avisos.length) return { avisos: 0, enviado: false };
  // Los cobros inminentes primero: son los únicos con fecha límite.
  avisos.sort((a, b) => (a.tipo === b.tipo ? b.dias - a.dias : a.tipo === 'cobro_sin_uso' ? -1 : 1));

  const enviado = await enviarAvisoInterno(avisos, DESTINO, RESEND_KEY);
  return { avisos: avisos.length, enviado };
}

async function enviarAvisoInterno(avisos, destino, RESEND_KEY) {
  if (!RESEND_KEY) { console.warn('[alertas] sin RESEND_API_KEY:', JSON.stringify(avisos)); return false; }
  const urgentes = avisos.filter((a) => a.tipo === 'cobro_sin_uso').length;

  const filas = avisos.map((a) => {
    const rojo = a.tipo === 'cobro_sin_uso';
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee">
        <strong>${esc(a.nombre)}</strong><br>
        <span style="color:#64748B;font-size:12px">${esc(a.email)} · ${esc(a.plan)} (${esc(a.estado)})</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;color:${rojo ? '#B91C1C' : '#111'};font-weight:${rojo ? '700' : '400'}">
        ${rojo ? '⚠️ ' : ''}${esc(a.detalle)}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
        ${a.reps} rep · ${a.ventas} ventas
      </td>
    </tr>`;
  }).join('');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Tekpair <info@tekpair.tech>',
        to: [destino],
        subject: `${urgentes ? '⚠️ ' : ''}${avisos.length} cliente${avisos.length > 1 ? 's' : ''} que conviene mirar hoy`,
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111">
  <h2 style="margin:0 0 4px">Clientes que se están enfriando</h2>
  <p style="color:#64748B;margin:0 0 18px;font-size:13px">Aviso interno de TekPair. Al cliente no le llega nada.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead><tr style="background:#F8FAFC">
      <th style="text-align:left;padding:10px 12px">Tienda</th>
      <th style="text-align:left;padding:10px 12px">Situación</th>
      <th style="text-align:right;padding:10px 12px">Uso</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <p style="color:#475569;font-size:13px;margin-top:20px">
    Una llamada de media hora montándole el taller vale más que cualquier correo automático.
    Los marcados en rojo tienen un cobro a tres días vista y el taller todavía vacío.
  </p>
  <p style="color:#94A3B8;font-size:11px;border-top:1px solid #eee;padding-top:12px;margin-top:18px">
    Avisa a los 3, 7, 14 y 30 días sin entrar. Para dejar fuera tus propias tiendas,
    pon sus emails en la variable ALERTAS_IGNORAR (separados por comas).
  </p>
</body></html>`
      })
    });
    if (!r.ok) console.error('[alertas] Resend respondió', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('[alertas] envío falló:', e.message);
    return false;
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

// ═══ RECORDATORIO DE RECOGIDA (email automático) ═══
// Tiendas con ajustes_config.recogida.auto: a las reparaciones "Por entregar" cuyo
// último aviso (rep_lista o rep_recogida, de la tabla avisos) tiene más de
// recogida.dias días, se les manda un email de recordatorio al cliente, con la
// plantilla rep_recogida de la tienda. Máximo 3 recordatorios por reparación y 40
// emails por tienda y día. Sin aviso previo no se recuerda nada (el cliente aún no
// sabe que está lista: eso lo resuelve el aviso de "lista", no este).
const RECOG_DEF = 'Hola {nombre}, te recuerdo que tu {modelo} sigue en {tienda} listo para recoger desde hace días. Cuando puedas pásate, ¡gracias!';
async function recordatoriosRecogida(SUPABASE_URL, headers, RESEND_KEY, now) {
  const out = { enviados: 0, errores: 0, tiendas: 0 };
  if (!RESEND_KEY) return out;
  const q = async (path) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }); return r.ok ? r.json() : []; };
  const tiendas = await q(`tiendas?ajustes_config->recogida->>auto=eq.true&select=id,nombre,ajustes_config`);
  for (const t of tiendas) {
    try {
      const cfg = (t.ajustes_config && t.ajustes_config.recogida) || {};
      if (cfg.off === true) continue;
      const dias = Math.max(1, parseInt(cfg.dias, 10) || 7);
      const reps = await q(`reparaciones?tienda_id=eq.${encodeURIComponent(t.id)}&estado=in.(%22Por%20Entregar%22,%22Por%20entregar%22)&select=id,cliente_id,cliente_nombre,marca,modelo,token,total,restante,financiado`);
      if (!reps.length) continue;
      out.tiendas++;
      const avisos = [];
      for (let i = 0; i < reps.length; i += 80) {
        const ids = reps.slice(i, i + 80).map(r => encodeURIComponent(r.id)).join(',');
        avisos.push(...await q(`avisos?tienda_id=eq.${encodeURIComponent(t.id)}&ref_id=in.(${ids})&tipo=in.(rep_lista,rep_recogida)&select=ref_id,tipo,fecha,estado`));
      }
      const info = {};
      for (const a of avisos) {
        if (a.estado === 'error') continue;
        const x = info[a.ref_id] || (info[a.ref_id] = { ult: 0, n: 0 });
        const f = new Date(a.fecha).getTime();
        if (f > x.ult) x.ult = f;
        if (a.tipo === 'rep_recogida') x.n++;
      }
      const plantilla = (t.ajustes_config.plantillasWA && t.ajustes_config.plantillasWA.rep_recogida && t.ajustes_config.plantillasWA.rep_recogida.texto) || RECOG_DEF;
      let enviadosTienda = 0;
      for (const r of reps) {
        if (enviadosTienda >= 40) break;
        const x = info[r.id];
        if (!x || !x.ult || x.n >= 3) continue;
        if ((now.getTime() - x.ult) / 86400000 < dias) continue;
        if (!r.cliente_id) continue;
        const cl = (await q(`clientes?id=eq.${encodeURIComponent(r.cliente_id)}&tienda_id=eq.${encodeURIComponent(t.id)}&select=nombre,apellidos,email`))[0];
        const email = cl && String(cl.email || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        const nombre = (cl.nombre || r.cliente_nombre || '').trim();
        const modelo = ((r.marca || '') + ' ' + (r.modelo || '')).trim();
        // Lo que queda por pagar (no en financiadas: eso va en cuotas)
        const queda = Math.max(0, Math.round((parseFloat(r.restante) || 0) * 100) / 100);
        const eur = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
        const conPago = !r.financiado && (parseFloat(r.total) || 0) > 0;
        const lineaPago = conPago ? (queda > 0.005 ? `Quedan ${eur(queda)} por pagar.` : 'Ya está todo pagado.') : '';
        let texto = String(plantilla).replace(/\{nombre\}/g, nombre).replace(/\{modelo\}/g, modelo).replace(/\{tienda\}/g, t.nombre || 'TekPair')
          .replace(/\{dias\}/g, String(Math.floor((now.getTime() - x.ult) / 86400000)))
          .replace(/\{pendiente\}/g, conPago ? eur(queda) : '');
        if (lineaPago && String(plantilla).indexOf('{pendiente}') === -1) texto += '\n\n' + lineaPago;
        texto = texto.replace(/\{[a-z_]+\}/g, '');
        const link = r.token ? `https://www.tekpair.tech/parte.html?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(r.token)}` : '';
        // Se apunta ANTES de enviar: si el cron se repite, no manda dos veces.
        const avId = 'av_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const asunto = `${t.nombre || 'TekPair'}: tu ${modelo || 'equipo'} está listo para recoger`;
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/avisos`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ id: avId, tienda_id: t.id, tipo: 'rep_recogida', canal: 'email', destinatario: email, ref_tipo: 'reparacion', ref_id: r.id, asunto, estado: 'enviado', fecha: now.toISOString() }) });
        if (!ins.ok) { out.errores++; continue; }
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#FF5B1F;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center"><h1 style="margin:0;font-size:21px">${esc(t.nombre || 'TekPair')}</h1></div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:14px;color:#333;line-height:1.6;margin:0">${esc(texto).replace(/\n/g, '<br>')}</p>
    ${link ? `<p style="text-align:center;margin:22px 0 4px"><a href="${esc(link)}" style="background:#FF5B1F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Ver mi reparación</a></p>` : ''}
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">Enviado con TekPair · tekpair.tech</div>
</body></html>`;
        try {
          const ra = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: `"${String(t.nombre || 'TekPair').replace(/[<>"\\\r\n]/g, '').slice(0, 60)}" <noreply@tekpair.tech>`, to: [email], subject: asunto, html }) });
          if (ra.ok) { out.enviados++; enviadosTienda++; }
          else {
            out.errores++;
            await fetch(`${SUPABASE_URL}/rest/v1/avisos?id=eq.${avId}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'error' }) });
          }
        } catch (e) { out.errores++; }
      }
    } catch (e) { console.error('[cron] recogida tienda', t.id, e.message); out.errores++; }
  }
  return out;
}

// ═══ ENCUESTA DE SATISFACCIÓN (día siguiente a entregar) ═══
// Tiendas con ajustes_config.resena.auto: reparaciones entregadas ayer (o hasta 3 días, por si
// el cron no corrió) sin valoración y sin aviso rep_valoracion previo (WhatsApp al entregar o
// este mismo email) → un email con el enlace a valorar.html. Una sola vez por reparación.
const VALOR_DEF = 'Hola {nombre}, gracias por confiar en {tienda} para tu {modelo}. ¿Qué tal ha ido? Puntúanos en 10 segundos: {link}';
async function encuestasValoracion(SUPABASE_URL, headers, RESEND_KEY, now) {
  const out = { enviados: 0, errores: 0, tiendas: 0 };
  if (!RESEND_KEY) return out;
  const q = async (path) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }); return r.ok ? r.json() : []; };
  const dia = (n) => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);
  const desde = dia(3), hasta = dia(1); // de hace 3 días a ayer, ambos incluidos
  const tiendas = await q(`tiendas?ajustes_config->resena->>auto=eq.true&select=id,nombre,ajustes_config`);
  for (const t of tiendas) {
    try {
      const reps = await q(`reparaciones?tienda_id=eq.${encodeURIComponent(t.id)}&estado=eq.Entregado&valoracion=is.null&fecha_entrega_real=gte.${desde}&fecha_entrega_real=lte.${hasta}&token=not.is.null&select=id,cliente_id,cliente_nombre,marca,modelo,token&limit=200`);
      if (!reps.length) continue;
      out.tiendas++;
      const ya = new Set();
      for (let i = 0; i < reps.length; i += 80) {
        const ids = reps.slice(i, i + 80).map(r => encodeURIComponent(r.id)).join(',');
        (await q(`avisos?tienda_id=eq.${encodeURIComponent(t.id)}&ref_id=in.(${ids})&tipo=eq.rep_valoracion&select=ref_id,estado`))
          .forEach(a => { if (a.estado !== 'error') ya.add(a.ref_id); });
      }
      const pl = t.ajustes_config.plantillasWA && t.ajustes_config.plantillasWA.rep_valoracion && t.ajustes_config.plantillasWA.rep_valoracion.texto;
      let enviadosTienda = 0;
      for (const r of reps) {
        if (enviadosTienda >= 40) break;
        if (ya.has(r.id) || !r.cliente_id) continue;
        const cl = (await q(`clientes?id=eq.${encodeURIComponent(r.cliente_id)}&tienda_id=eq.${encodeURIComponent(t.id)}&select=nombre,apellidos,email`))[0];
        const email = cl && String(cl.email || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        const nombre = (cl.nombre || r.cliente_nombre || '').trim();
        const modelo = ((r.marca || '') + ' ' + (r.modelo || '')).trim();
        const link = `https://www.tekpair.tech/valorar.html?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(r.token)}&lang=es`;
        const texto = String(pl || VALOR_DEF).replace(/\{nombre\}/g, nombre).replace(/\{modelo\}/g, modelo).replace(/\{tienda\}/g, t.nombre || 'TekPair')
          .replace(/\{link\}/g, '').replace(/\{[a-z_]+\}/g, '').trim();
        const avId = 'av_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const asunto = `¿Qué tal ha ido tu reparación? · ${t.nombre || 'TekPair'}`;
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/avisos`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ id: avId, tienda_id: t.id, tipo: 'rep_valoracion', canal: 'email', destinatario: email, ref_tipo: 'reparacion', ref_id: r.id, asunto, estado: 'enviado', fecha: now.toISOString() }) });
        if (!ins.ok) { out.errores++; continue; }
        const estrellas = [1, 2, 3, 4, 5].map(n => `<a href="${esc(link)}" style="text-decoration:none;font-size:30px;color:#F59E0B">★</a>`).join(' ');
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#FF5B1F;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center"><h1 style="margin:0;font-size:21px">${esc(t.nombre || 'TekPair')}</h1></div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:14px;color:#333;line-height:1.6;margin:0">${esc(texto).replace(/\n/g, '<br>')}</p>
    <p style="text-align:center;margin:20px 0 6px">${estrellas}</p>
    <p style="text-align:center;margin:10px 0 4px"><a href="${esc(link)}" style="background:#FF5B1F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">⭐ Puntuar</a></p>
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">Enviado con TekPair · tekpair.tech</div>
</body></html>`;
        try {
          const ra = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: `"${String(t.nombre || 'TekPair').replace(/[<>"\\\r\n]/g, '').slice(0, 60)}" <noreply@tekpair.tech>`, to: [email], subject: asunto, html }) });
          if (ra.ok) { out.enviados++; enviadosTienda++; }
          else {
            out.errores++;
            await fetch(`${SUPABASE_URL}/rest/v1/avisos?id=eq.${avId}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'error' }) });
          }
        } catch (e) { out.errores++; }
      }
    } catch (e) { console.error('[cron] encuestas tienda', t.id, e.message); out.errores++; }
  }
  return out;
}

// ═══ RESUMEN DIARIO PARA EL DUEÑO ═══
// Una vez al día (lo de ayer). Se apunta en avisos con id fijo por tienda y fecha ANTES de
// enviar: si el cron se repite, el segundo insert choca (409) y no se manda dos veces.
async function resumenesDiarios(SUPABASE_URL, headers, RESEND_KEY, now) {
  const out = { enviados: 0, errores: 0, sinDatos: 0 };
  if (!RESEND_KEY) return out;
  const ayer = fechaMadrid(new Date(now.getTime() - 86400000));
  const hoy = fechaMadrid(now);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?ajustes_config->resumen->>on=eq.true&select=id,nombre,email,plan_email,ajustes_config,plan,plan_status,trial_until`, { headers });
  const tiendas = r.ok ? await r.json() : [];
  for (const t of tiendas) {
    try {
      if (!esPremium(t)) continue; // función Premium
      const para = destinoResumen(t);
      if (!para) continue;
      const res = await construirResumen(SUPABASE_URL, headers, t, ayer, hoy);
      if (!res) { out.sinDatos++; continue; }
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/avisos`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ id: `resumen_${t.id}_${ayer}`, tienda_id: t.id, tipo: 'resumen_diario', canal: 'email', destinatario: para, ref_tipo: 'tienda', ref_id: t.id, asunto: res.asunto.slice(0, 200), estado: 'enviado', fecha: now.toISOString() }) });
      if (!ins.ok) continue; // ya enviado hoy (409) o error: no duplicar
      if (await enviarResumen(RESEND_KEY, para, res)) out.enviados++;
      else {
        out.errores++;
        await fetch(`${SUPABASE_URL}/rest/v1/avisos?id=eq.${encodeURIComponent(`resumen_${t.id}_${ayer}`)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'error' }) });
      }
    } catch (e) { console.error('[cron] resumen tienda', t.id, e.message); out.errores++; }
  }
  return out;
}

// ═══ INFORME DEL MES PARA EL DUEÑO ═══
// Solo el día 1 (hora de Madrid), del mes anterior. Id fijo por tienda y mes en avisos antes de
// enviar: si el cron se repite ese día, el segundo insert choca y no se manda dos veces.
async function informesMensuales(SUPABASE_URL, headers, RESEND_KEY, now) {
  const out = { enviados: 0, errores: 0, sinDatos: 0 };
  const hoy = fechaMadrid(now);
  if (!RESEND_KEY || hoy.slice(8, 10) !== '01') return out;
  const mi = mesesInforme(hoy);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?ajustes_config->resumen->>mensual=eq.true&select=id,nombre,email,plan_email,ajustes_config,plan,plan_status,trial_until`, { headers });
  const tiendas = r.ok ? await r.json() : [];
  for (const t of tiendas) {
    try {
      if (!esPremium(t)) continue;
      const para = destinoResumen(t);
      if (!para) continue;
      const res = await construirInformeMes(SUPABASE_URL, headers, t, mi.d1, mi.d2, mi.p1, mi.p2);
      if (!res) { out.sinDatos++; continue; }
      const avId = `informe_${t.id}_${mi.clave}`;
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/avisos`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ id: avId, tienda_id: t.id, tipo: 'informe_mes', canal: 'email', destinatario: para, ref_tipo: 'tienda', ref_id: t.id, asunto: res.asunto.slice(0, 200), estado: 'enviado', fecha: now.toISOString() }) });
      if (!ins.ok) continue;
      if (await enviarResumen(RESEND_KEY, para, res)) out.enviados++;
      else {
        out.errores++;
        await fetch(`${SUPABASE_URL}/rest/v1/avisos?id=eq.${encodeURIComponent(avId)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'error' }) });
      }
    } catch (e) { console.error('[cron] informe tienda', t.id, e.message); out.errores++; }
  }
  return out;
}

// ═══ RECORDATORIO DE DEUDAS ═══
// Tiendas con ajustes_config.deudas.auto: reparaciones entregadas sin pagar del todo y cuotas
// vencidas de ventas a plazos, a clientes con email. Cada `dias` días desde la deuda o el
// último recordatorio (también los manuales del panel), como mucho 3 veces. Se apunta el
// aviso ANTES de enviar para no duplicar si el cron se repite.
const DEUDA_DEF = 'Hola {nombre}, te escribimos desde {tienda}. Tienes pendiente {total} ({estado}) desde el {fecha}. Puedes pasar a pagarlo cuando te venga bien. ¡Gracias!';
async function recordatoriosDeuda(SUPABASE_URL, headers, RESEND_KEY, now) {
  const out = { enviados: 0, errores: 0, tiendas: 0 };
  if (!RESEND_KEY) return out;
  const q = async (path) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }); return r.ok ? r.json() : []; };
  const hoy = fechaMadrid(now);
  const diasDesde = (f) => Math.floor((new Date(hoy + 'T12:00:00Z') - new Date(String(f).slice(0, 10) + 'T12:00:00Z')) / 86400000);
  const eur = (x) => (Math.round(x * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const fmt = (f) => { const [y, m, d] = String(f).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const tiendas = await q(`tiendas?ajustes_config->deudas->>auto=eq.true&select=id,nombre,ajustes_config`);
  for (const t of tiendas) {
    try {
      const T = encodeURIComponent(t.id);
      const dias = Math.max(3, parseInt(t.ajustes_config.deudas.dias, 10) || 7);
      const [reps, ventas] = await Promise.all([
        q(`reparaciones?tienda_id=eq.${T}&estado=eq.Entregado&restante=gt.0&select=id,cliente_id,cliente_nombre,marca,modelo,restante,fecha,fecha_entrega_real&limit=500`),
        q(`ventas?tienda_id=eq.${T}&financiado=eq.true&select=id,cliente_id,cliente_nombre,marca,modelo,cuotas,reembolsado&limit=1000`)
      ]);
      const items = [];
      reps.forEach((r) => items.push({ ref: 'rep:' + r.id, tipo: 'rep', cliente_id: r.cliente_id, nombre: r.cliente_nombre, importe: Number(r.restante) || 0, desde: r.fecha_entrega_real || r.fecha, concepto: `reparación ${((r.marca || '') + ' ' + (r.modelo || '')).trim()}` }));
      ventas.forEach((v) => {
        if (v.reembolsado) return;
        let cuotas = v.cuotas; if (typeof cuotas === 'string') { try { cuotas = JSON.parse(cuotas); } catch (e) { cuotas = []; } }
        let imp = 0, desde = '';
        (cuotas || []).forEach((c) => {
          if (!c || c.pagado || !c.fecha || String(c.fecha).slice(0, 10) >= hoy) return;
          imp += (Number(c.importe) || 0) - (c.pagadoImporte != null ? Number(c.pagadoImporte) || 0 : 0);
          if (!desde || c.fecha < desde) desde = c.fecha;
        });
        if (imp > 0.005) items.push({ ref: 'venta:' + v.id, tipo: 'venta', cliente_id: v.cliente_id, nombre: v.cliente_nombre, importe: imp, desde, concepto: `cuotas vencidas ${((v.marca || '') + ' ' + (v.modelo || '')).trim()}` });
      });
      const listos = items.filter((x) => x.cliente_id && x.desde && diasDesde(x.desde) >= dias);
      if (!listos.length) continue;
      out.tiendas++;
      const avisos = {};
      for (let i = 0; i < listos.length; i += 80) {
        const refs = listos.slice(i, i + 80).map((x) => encodeURIComponent(x.ref)).join(',');
        (await q(`avisos?tienda_id=eq.${T}&tipo=eq.deuda_recordatorio&ref_id=in.(${refs})&select=ref_id,fecha,estado`)).forEach((a) => {
          if (a.estado === 'error') return;
          const x = avisos[a.ref_id] || (avisos[a.ref_id] = { ult: '', n: 0 });
          x.n++; if (String(a.fecha) > x.ult) x.ult = String(a.fecha);
        });
      }
      const pl = t.ajustes_config.plantillasWA && t.ajustes_config.plantillasWA.deuda_recordatorio && t.ajustes_config.plantillasWA.deuda_recordatorio.texto;
      let enviadosTienda = 0;
      for (const x of listos) {
        if (enviadosTienda >= 40) break;
        const av = avisos[x.ref];
        if (av && (av.n >= 3 || diasDesde(av.ult) < dias)) continue;
        const cl = (await q(`clientes?id=eq.${encodeURIComponent(x.cliente_id)}&tienda_id=eq.${T}&select=nombre,email`))[0];
        const email = cl && String(cl.email || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        const nombre = ((cl.nombre || x.nombre || '').trim().split(' ')[0]);
        const texto = String(pl || DEUDA_DEF).replace(/\{nombre\}/g, nombre).replace(/\{tienda\}/g, t.nombre || 'la tienda')
          .replace(/\{total\}/g, eur(x.importe)).replace(/\{estado\}/g, x.concepto).replace(/\{fecha\}/g, fmt(x.desde)).replace(/\{[a-z_]+\}/g, '');
        const avId = 'av_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const asunto = `Pago pendiente en ${t.nombre || 'TekPair'}`;
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/avisos`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ id: avId, tienda_id: t.id, tipo: 'deuda_recordatorio', canal: 'email', destinatario: email, ref_tipo: x.tipo, ref_id: x.ref, asunto, estado: 'enviado', fecha: now.toISOString() }) });
        if (!ins.ok) { out.errores++; continue; }
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#FF5B1F;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center"><h1 style="margin:0;font-size:21px">${esc(t.nombre || 'TekPair')}</h1></div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:14px;color:#333;line-height:1.6;margin:0">${esc(texto).replace(/\n/g, '<br>')}</p>
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">Enviado con TekPair · tekpair.tech</div>
</body></html>`;
        try {
          const ra = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: `"${String(t.nombre || 'TekPair').replace(/[<>"\\\r\n]/g, '').slice(0, 60)}" <noreply@tekpair.tech>`, to: [email], subject: asunto, html }) });
          if (ra.ok) { out.enviados++; enviadosTienda++; }
          else {
            out.errores++;
            await fetch(`${SUPABASE_URL}/rest/v1/avisos?id=eq.${avId}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'error' }) });
          }
        } catch (e) { out.errores++; }
      }
    } catch (e) { console.error('[cron] deudas tienda', t.id, e.message); out.errores++; }
  }
  return out;
}
