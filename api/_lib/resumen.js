// api/_lib/resumen.js
// Resumen diario para el dueño (Ajustes → Notificaciones → Resumen diario).
// Lo usan la tarea diaria (cron-trial-emails) y el botón "Enviarme uno de prueba" (ayuda).
// Todo se lee de la base de datos en el servidor: funciona con el PC de la tienda apagado.
// La carpeta empieza por "_" → Vercel no la cuenta como función.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (x) => parseFloat(x) || 0;
const r2 = (x) => Math.round(x * 100) / 100;
const eur = (x) => r2(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const d10 = (x) => String(x || '').slice(0, 10);
const parse = (x) => { if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return null; } } return x; };

export function fechaMadrid(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function menosDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function crearLector(SUPABASE_URL, headers) {
  const get = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
    if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`);
    return r.json();
  };
  // Paginado: PostgREST corta en 1000 filas.
  const todo = async (path) => {
    const out = [];
    for (let off = 0; off < 100000; off += 1000) {
      const rows = await get(`${path}&order=id.asc&limit=1000&offset=${off}`);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  };
  return { get, todo };
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

// Lo que entró de verdad un día (misma regla que la caja del panel): ventas de ese día
// (las financiadas solo la entrada), cuotas cobradas ese día, pagos de reparación de ese
// día (sin presupuestos sin aceptar) y menos las devoluciones hechas ese día.
function ingresoDia(F, ventas, pagos, presup) {
  let ventasT = 0, repsT = 0, nVentas = 0;
  const pagosVenta = (v) => {
    const p = parse(v.pagos);
    if (Array.isArray(p) && p.length) return p.reduce((s, x) => s + num(x.importe), 0);
    return num(v.total);
  };
  for (const v of ventas) {
    const cuotas = parse(v.cuotas);
    const fin = v.financiado && Array.isArray(cuotas);
    if (v.reembolsado && d10(v.fecha_reembolso || v.fecha) === F) {
      ventasT -= fin ? num(v.entrada) + cuotas.reduce((s, c) => s + cuotaAbonos(c).reduce((t, a) => t + a.importe, 0), 0) : pagosVenta(v);
    }
    if (fin) {
      if (d10(v.fecha) === F) { ventasT += num(v.entrada); nVentas++; }
      cuotas.forEach((c) => { cuotaAbonos(c).forEach((a) => { if (a.fecha === F) ventasT += a.importe; }); });
    } else if (d10(v.fecha) === F) { ventasT += pagosVenta(v); nVentas++; }
  }
  for (const p of pagos) {
    if (d10(p.fecha) !== F) continue;
    if (p.reparacion_id && presup.has(String(p.reparacion_id))) continue;
    repsT += num(p.importe);
  }
  return { ventas: r2(ventasT), reps: r2(repsT), total: r2(ventasT + repsT), nVentas };
}

// Devuelve { asunto, html, datos } o null si la tienda no tuvo nada que contar.
export async function construirResumen(SUPABASE_URL, headers, tienda, ayer, hoy) {
  const { get, todo } = crearLector(SUPABASE_URL, headers);
  const T = encodeURIComponent(tienda.id);
  const semanaPasada = menosDias(ayer, 7);
  const hace5 = menosDias(hoy, 5);

  const [ventas, pagos, reps, cierres, cajas, fiados, citas, pedidos] = await Promise.all([
    todo(`ventas?tienda_id=eq.${T}&or=(fecha.in.(${ayer},${semanaPasada}),financiado.eq.true,fecha_reembolso.in.(${ayer},${semanaPasada}))&select=id,fecha,total,pagos,financiado,cuotas,entrada,reembolsado,fecha_reembolso,cliente_nombre`),
    todo(`pagos_reparacion?tienda_id=eq.${T}&fecha=in.(${ayer},${semanaPasada})&select=id,fecha,importe,reparacion_id`),
    todo(`reparaciones?tienda_id=eq.${T}&or=${encodeURIComponent(`(estado.not.in.(Entregado,Rechazado,Devuelto,"Sin Solucion"),fecha.eq.${ayer},fecha_entrega_real.eq.${ayer},restante.gt.0,valoracion_at.gte.${ayer})`)}&select=id,estado,fecha,fecha_entrega_real,marca,modelo,cliente_nombre,restante,valoracion,valoracion_comentario,valoracion_at`),
    get(`cajas_cierres?tienda_id=eq.${T}&fecha=gte.${menosDias(ayer, 14)}&fecha=lte.${ayer}&select=caja_id,fecha,estado,descuadre`),
    get(`cajas?tienda_id=eq.${T}&select=id,nombre`),
    todo(`cajas_fiados?tienda_id=eq.${T}&estado=eq.pendiente&select=id,importe`),
    get(`citas?tienda_id=eq.${T}&fecha=eq.${hoy}&estado=neq.cancelada&select=hora`).catch(() => []),
    get(`pedidos?tienda_id=eq.${T}&estado=neq.recibido&select=rep_id`).catch(() => [])
  ]);

  const presup = new Set(reps.filter((r) => r.estado === 'Presupuesto' || r.estado === 'Rechazado').map((r) => String(r.id)));
  const ing = ingresoDia(ayer, ventas, pagos, presup);
  const ingPrev = ingresoDia(semanaPasada, ventas, pagos, presup);

  // Reparaciones
  const recibidas = reps.filter((r) => d10(r.fecha) === ayer).length;
  const entregadas = reps.filter((r) => d10(r.fecha_entrega_real) === ayer).length;
  const esperandoPieza = new Set((pedidos || []).map((p) => p.rep_id).filter(Boolean));
  const dias = (f) => Math.max(0, Math.round((new Date(hoy) - new Date(d10(f))) / 86400000));
  const paradas = reps.filter((r) => (r.estado === 'Pendiente' || r.estado === 'En Proceso') && d10(r.fecha) && d10(r.fecha) <= hace5 && !esperandoPieza.has(r.id))
    .sort((a, b) => d10(a.fecha).localeCompare(d10(b.fecha)));
  const porEntregar = reps.filter((r) => r.estado === 'Por Entregar' || r.estado === 'Por entregar').length;

  // Cajas: descuadres de ayer y cajas que se usan pero ayer no se cerraron
  const nomCaja = {}; (cajas || []).forEach((c) => { nomCaja[c.id] = c.nombre; });
  const ayerC = (cierres || []).filter((c) => c.fecha === ayer);
  const descuadres = ayerC.filter((c) => c.estado !== 'festivo' && c.estado !== 'abierto' && Math.abs(num(c.descuadre)) > 0.5);
  const usadas = new Set((cierres || []).map((c) => c.caja_id));
  // Solo si ayer se abrió: sin ventas, cobros ni cajas tocadas ese día, la tienda no abrió
  // (domingo, festivo) y avisar de "cajas sin cerrar" era una falsa alarma.
  const abrioAyer = Math.abs(ing.total) > 0.005 || ayerC.length > 0 || recibidas > 0 || entregadas > 0;
  const sinCerrar = !abrioAyer ? [] : [...usadas].filter((id) => !ayerC.some((c) => c.caja_id === id && c.estado !== 'abierto')).map((id) => nomCaja[id] || 'Caja');

  // Te deben
  const deFiados = r2((fiados || []).reduce((s, f) => s + num(f.importe), 0));
  const deReps = r2(reps.filter((r) => r.estado === 'Entregado' && num(r.restante) > 0).reduce((s, r) => s + num(r.restante), 0));
  let deCuotas = 0;
  ventas.forEach((v) => {
    if (!v.financiado || v.reembolsado) return;
    (parse(v.cuotas) || []).forEach((c) => {
      if (!c || c.pagado || !c.fecha || d10(c.fecha) >= hoy) return;
      deCuotas += num(c.importe) - (c.pagadoImporte != null ? num(c.pagadoImporte) : 0);
    });
  });
  deCuotas = r2(deCuotas);
  const teDeben = r2(deFiados + deReps + deCuotas);

  // Valoraciones de ayer
  const vals = reps.filter((r) => r.valoracion != null && d10(r.valoracion_at) === ayer);
  const bajas = vals.filter((r) => r.valoracion <= 3);

  const nada = !ing.total && !recibidas && !entregadas && !paradas.length && !descuadres.length && !teDeben && !(citas || []).length;
  if (nada) return null;

  // ── HTML ──
  const fechaTxt = new Date(ayer + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const dif = ing.total - ingPrev.total;
  const difTxt = ingPrev.total > 0
    ? `<span style="color:${dif >= 0 ? '#16A34A' : '#DC2626'};font-weight:700">${dif >= 0 ? '▲' : '▼'} ${eur(Math.abs(dif))}</span> <span style="color:#888">frente al mismo día de la semana pasada (${eur(ingPrev.total)})</span>`
    : '';
  const bloque = (titulo, cuerpo, color) => `<div style="border:1px solid #eee;border-left:4px solid ${color || '#FF5B1F'};border-radius:10px;padding:14px 16px;margin:12px 0"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#666;margin-bottom:6px">${titulo}</div>${cuerpo}</div>`;
  const fila = (a, b) => `<tr><td style="padding:3px 0;color:#444">${a}</td><td style="padding:3px 0;text-align:right;font-weight:700">${b}</td></tr>`;

  let html = '';
  html += bloque('💰 Lo que entró ayer', `<div style="font-size:28px;font-weight:800;color:#111">${eur(ing.total)}</div><div style="font-size:13px;margin:4px 0 8px">${difTxt}</div>
    <table style="width:100%;font-size:14px;border-collapse:collapse">${fila('Ventas (' + ing.nVentas + ')', eur(ing.ventas))}${fila('Reparaciones cobradas', eur(ing.reps))}${fila('Reparaciones recibidas', recibidas)}${fila('Reparaciones entregadas', entregadas)}</table>`, '#16A34A');

  if (descuadres.length || sinCerrar.length) {
    html += bloque('🧾 Cajas de ayer',
      descuadres.map((c) => `<div style="font-size:14px;margin:3px 0">⚠️ <b>${esc(nomCaja[c.caja_id] || 'Caja')}</b>: ${num(c.descuadre) < 0 ? 'falta' : 'sobra'} <b style="color:${num(c.descuadre) < 0 ? '#DC2626' : '#D97706'}">${eur(Math.abs(num(c.descuadre)))}</b></div>`).join('')
      + (sinCerrar.length ? `<div style="font-size:14px;margin:3px 0">🔓 Sin cerrar: <b>${sinCerrar.map(esc).join(', ')}</b></div>` : ''), '#DC2626');
  } else if (ayerC.length) {
    html += bloque('🧾 Cajas de ayer', '<div style="font-size:14px">✅ Todas cuadradas.</div>', '#16A34A');
  }

  if (paradas.length) {
    html += bloque(`🐢 Reparaciones paradas (${paradas.length})`, '<div style="font-size:13px;color:#666;margin-bottom:6px">Llevan 5 días o más sin entregarse y no esperan pieza.</div>'
      + paradas.slice(0, 6).map((r) => `<div style="font-size:14px;margin:3px 0"><b>${dias(r.fecha)} días</b> · ${esc(((r.marca || '') + ' ' + (r.modelo || '')).trim() || 'Equipo')} · ${esc(r.cliente_nombre || '')} <span style="color:#888">(${esc(r.estado)})</span></div>`).join('')
      + (paradas.length > 6 ? `<div style="font-size:13px;color:#888;margin-top:4px">y ${paradas.length - 6} más…</div>` : ''), '#D97706');
  }
  if (porEntregar) html += bloque('📦 Listas para recoger', `<div style="font-size:14px"><b>${porEntregar}</b> reparaciones esperan a que el cliente las recoja.</div>`, '#7C3AED');

  if (teDeben > 0) {
    html += bloque('💸 Te deben', `<div style="font-size:24px;font-weight:800;color:#DC2626">${eur(teDeben)}</div><table style="width:100%;font-size:14px;border-collapse:collapse;margin-top:6px">`
      + (deFiados ? fila('Cobros pendientes de cajas', eur(deFiados)) : '')
      + (deReps ? fila('Reparaciones entregadas sin pagar', eur(deReps)) : '')
      + (deCuotas ? fila('Cuotas vencidas', eur(deCuotas)) : '') + '</table>', '#DC2626');
  }
  if (vals.length) {
    const media = vals.reduce((s, r) => s + r.valoracion, 0) / vals.length;
    html += bloque('⭐ Valoraciones de ayer', `<div style="font-size:14px">${vals.length} valoraciones · media <b>${media.toFixed(1).replace('.', ',')}</b>/5</div>`
      + bajas.map((r) => `<div style="font-size:13px;margin-top:4px;color:#991B1B">${r.valoracion}/5 · ${esc(r.cliente_nombre || '')}${r.valoracion_comentario ? ': «' + esc(String(r.valoracion_comentario).slice(0, 160)) + '»' : ''}</div>`).join(''), '#F59E0B');
  }
  if ((citas || []).length) html += bloque('📅 Hoy', `<div style="font-size:14px"><b>${citas.length}</b> citas reservadas para hoy.</div>`, '#3B82F6');

  const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#111;background:#fafafa">
  <div style="background:#FF5B1F;color:#fff;padding:18px 20px;border-radius:12px">
    <div style="font-size:13px;opacity:.9">Resumen de ${esc(fechaTxt)}</div>
    <div style="font-size:21px;font-weight:800;margin-top:2px">${esc(tienda.nombre || 'Tu tienda')}</div>
  </div>
  ${html}
  <p style="text-align:center;margin:20px 0"><a href="https://www.tekpair.tech/dashboard.html" style="background:#FF5B1F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Abrir TekPair</a></p>
  <div style="text-align:center;color:#aaa;font-size:11px">Lo recibes porque lo activaste en Ajustes → Notificaciones → Resumen diario.</div>
</body></html>`;
  const asunto = `${tienda.nombre || 'TekPair'}: ayer entraron ${eur(ing.total)}${descuadres.length ? ' · ⚠️ caja descuadrada' : ''}${paradas.length ? ' · ' + paradas.length + ' paradas' : ''}`;
  return { asunto, html: doc, datos: { ingreso: ing.total, paradas: paradas.length, descuadres: descuadres.length, teDeben } };
}

export async function enviarResumen(RESEND_KEY, para, r) {
  const ra = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'TekPair <noreply@tekpair.tech>', to: [para], subject: r.asunto, html: r.html })
  });
  return ra.ok;
}

export function destinoResumen(t) {
  const cfg = (t.ajustes_config && t.ajustes_config.resumen) || {};
  const e = String(cfg.email || t.plan_email || t.email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

// Solo Premium (o prueba gratis en curso, que lo desbloquea todo como en el panel).
export function esPremium(t) {
  if (t.plan === 'top' || t.plan === 'premium') return true;
  return t.plan_status === 'trial' && t.trial_until && new Date(t.trial_until) > new Date();
}
