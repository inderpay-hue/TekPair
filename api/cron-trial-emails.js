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

    return res.json({ ok: true, processed: tiendas.length, emails_sent: emailsSent, errores: errores, cobrum, alertas });

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
