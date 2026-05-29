// api/citas-publicas.js
// =====================================================
// Endpoint público — acciones de citas Y presupuestos remotos.
//
// Acciones citas:
//   - 'get-tienda'         : datos públicos de la tienda por slug
//   - 'get-servicios'      : servicios publico=true
//   - 'get-citas-dia'      : horas ocupadas un día
//   - 'crear-cita'         : inserta cita con validación + email admin
//
// Acciones presupuestos (PRES-C):
//   - 'pres-generar-token' : genera token único para link público (auth JWT)
//   - 'pres-get'           : devuelve datos del presupuesto por token (público)
//   - 'pres-aceptar'       : cliente acepta + firma opcional (público)
// =====================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET;
const APP_URL      = process.env.APP_URL || 'https://www.tekpair.tech';

// ── Helpers Supabase ─────────────────────────────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Accept': 'application/json' }
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`GET ${path} → ${r.status}: ${t.slice(0,200)}`); }
  return r.json();
}

async function sbPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`POST ${path} → ${r.status}: ${t.slice(0,200)}`); }
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`PATCH ${path} → ${r.status}: ${t.slice(0,200)}`); }
}

// ── JWT verificación ligera (HS256) ──────────────────────────────────────────
async function verificarJWT(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    const [hB64, pB64, sigB64] = token.split('.');
    if (!hB64 || !pB64 || !sigB64) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const data = enc.encode(`${hB64}.${pB64}`);
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sig, data);
    if (!ok) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ── Rate limit ───────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
function checkRateLimit(ip, max = 3, windowMs = 3600000) {
  const now = Date.now();
  const key = `ip:${ip}`;
  let e = rateLimitMap.get(key);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + windowMs };
  e.count++;
  rateLimitMap.set(key, e);
  if (rateLimitMap.size > 1000) for (const [k,v] of rateLimitMap) if (now > v.resetAt) rateLimitMap.delete(k);
  return e.count <= max;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function san(s, max) { if (s == null) return ''; s = String(s).trim(); return max ? s.slice(0, max) : s; }
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function validTel(t) { const d = (t||'').replace(/\D/g,''); return d.length >= 7 && d.length <= 15; }
function validEmail(e) { return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validFecha(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(f+'T00:00:00'); if (isNaN(d.getTime())) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return d >= hoy && d <= new Date(hoy.getTime() + 90*86400000);
}
function validHora(h) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(h); }
function hasURL(s) { return /https?:\/\/|www\.|\.com|\.net|\.es|\.org|\.tech/i.test(s||''); }
const BAD_TELS = new Set(['0','1','2','6','7','12','15','22','24','28','33','41','44','45','48','54','55','66','111','123','444','777','000','111111','123456','1234567']);
function fmtEuros(n) { return Number(n||0).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' €'; }

// ── ACCIONES CITAS ────────────────────────────────────────────────────────────

async function getTienda(slug) {
  if (!slug || typeof slug !== 'string') return { ok:false, error:'Slug inválido', status:400 };
  const q = `tiendas?citas_slug=eq.${encodeURIComponent(slug)}&select=id,nombre,logo_url,ciudad,provincia,dir,tel,email,horarios,citas_config,citas_slug&limit=1`;
  let rows;
  try { rows = await sbGet(q); } catch(e) { console.error('getTienda:', e); return { ok:false, error:'Error al cargar tienda', status:500 }; }
  if (!rows?.length) return { ok:false, error:'Tienda no encontrada', status:404 };
  return { ok:true, tienda:rows[0] };
}

async function getServicios(slug) {
  const t = await getTienda(slug); if (!t.ok) return t;
  let rows;
  try { rows = await sbGet(`servicios?tienda_id=eq.${encodeURIComponent(t.tienda.id)}&publico=eq.true&select=id,nombre,categoria,precio,precio_fijo,tipo,duracion_min&order=nombre.asc`); }
  catch(e) { return { ok:false, error:'Error al cargar servicios', status:500 }; }
  return { ok:true, servicios:(rows||[]).filter(s=>s.tipo!=='venta') };
}

async function getCitasDia(slug, fecha) {
  if (!validFecha(fecha)) return { ok:false, error:'Fecha inválida', status:400 };
  const t = await getTienda(slug); if (!t.ok) return t;
  let rows;
  try { rows = await sbGet(`citas?tienda_id=eq.${encodeURIComponent(t.tienda.id)}&fecha=eq.${fecha}&estado=neq.cancelada&select=hora,duracion_min`); }
  catch(e) { return { ok:false, error:'Error al cargar citas', status:500 }; }
  return { ok:true, ocupadas:(rows||[]).map(c=>({hora:c.hora,duracion_min:c.duracion_min})) };
}

async function crearCita(body, ip) {
  if (!checkRateLimit(ip)) return { ok:false, error:'Demasiadas reservas desde tu IP. Vuelve a intentarlo en una hora.', status:429 };
  const t = await getTienda(body.slug); if (!t.ok) return t;
  const tienda = t.tienda;
  const nombre  = san(body.cliente_nombre, 100);
  const tel     = san(body.cliente_tel, 30);
  const email   = san(body.cliente_email, 100);
  const fecha   = san(body.fecha, 10);
  const hora    = san(body.hora, 5);
  const servicio= san(body.servicio, 100);
  const marca   = san(body.marca, 50);
  const modelo  = san(body.modelo, 100);
  const notas   = san(body.notas, 500);
  const duracion= parseInt(body.duracion_min)||30;
  if (!nombre || nombre.length < 2) return { ok:false, error:'Nombre obligatorio (mínimo 2 caracteres)', status:400 };
  if (!validTel(tel)) return { ok:false, error:'Teléfono inválido', status:400 };
  if (!validEmail(email)) return { ok:false, error:'Email inválido', status:400 };
  if (!validFecha(fecha)) return { ok:false, error:'Fecha inválida', status:400 };
  if (!validHora(hora)) return { ok:false, error:'Hora inválida (HH:MM)', status:400 };
  if (hasURL(nombre)||hasURL(notas)) return { ok:false, error:'No se permiten URLs', status:400 };
  if (BAD_TELS.has(tel.replace(/\D/g,''))) return { ok:false, error:'Teléfono inválido', status:400 };
  let existente;
  try { existente = await sbGet(`citas?tienda_id=eq.${encodeURIComponent(tienda.id)}&fecha=eq.${fecha}&hora=eq.${encodeURIComponent(hora)}&estado=neq.cancelada&select=id&limit=1`); }
  catch(e) { return { ok:false, error:'Error al validar disponibilidad', status:500 }; }
  if (existente?.length) return { ok:false, error:'Esa hora ya está reservada. Elige otra.', status:409 };
  const citaId = 'c'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  const payload = { id:citaId, tienda_id:tienda.id, fecha, hora, servicio:servicio||'Consulta', duracion_min:duracion, cliente_nombre:nombre, cliente_tel:tel, cliente_email:email||null, notas:notas||null, marca:marca||null, modelo:modelo||null, estado:'pendiente' };
  let creada;
  try { const rows = await sbPost('citas', payload); creada=(rows&&rows[0])||payload; }
  catch(e) { return { ok:false, error:'No se pudo guardar la cita. Intenta más tarde.', status:500 }; }
  enviarEmailAdminCita(tienda, creada).catch(e=>console.error('emailAdmin cita:',e));
  return { ok:true, cita:creada };
}

async function enviarEmailAdminCita(tienda, cita) {
  if (!RESEND_KEY || !tienda.email) return;
  const fechaFmt = new Date(cita.fecha+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const subject = `Nueva cita: ${cita.cliente_nombre} - ${fechaFmt} ${cita.hora}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f7f9fc;margin:0;padding:0"><div style="max-width:520px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)"><div style="background:#0F172A;padding:28px;text-align:center"><div style="color:#00C896;font-size:22px;font-weight:800;margin-bottom:4px">⚡ ${esc(tienda.nombre||'TekPair')}</div><div style="color:#94a3b8;font-size:13px">Nueva cita reservada</div></div><div style="padding:26px"><table style="width:100%;border-collapse:collapse;font-size:14px;background:#F7F9FC;border-radius:8px;overflow:hidden"><tr><td style="padding:10px 14px;color:#64748B">Cliente</td><td style="padding:10px 14px;font-weight:700">${esc(cita.cliente_nombre)}</td></tr><tr><td style="padding:10px 14px;color:#64748B">Teléfono</td><td style="padding:10px 14px"><a href="tel:${esc(cita.cliente_tel)}" style="color:#00C896">${esc(cita.cliente_tel)}</a></td></tr>${cita.cliente_email?`<tr><td style="padding:10px 14px;color:#64748B">Email</td><td style="padding:10px 14px">${esc(cita.cliente_email)}</td></tr>`:''}<tr><td style="padding:10px 14px;color:#64748B">Fecha</td><td style="padding:10px 14px;font-weight:700">${esc(fechaFmt)}</td></tr><tr><td style="padding:10px 14px;color:#64748B">Hora</td><td style="padding:10px 14px;font-weight:700">${esc(cita.hora)}</td></tr><tr><td style="padding:10px 14px;color:#64748B">Servicio</td><td style="padding:10px 14px">${esc(cita.servicio||'Consulta')}</td></tr>${(cita.marca||cita.modelo)?`<tr><td style="padding:10px 14px;color:#64748B">Dispositivo</td><td style="padding:10px 14px">${esc(((cita.marca||'')+' '+(cita.modelo||'')).trim())}</td></tr>`:''}</table><p style="font-size:12px;color:#64748B;margin:18px 0 0">Entra a tu dashboard para gestionarla.</p></div><div style="text-align:center;padding:16px;color:#aaa;font-size:11px">TekPair · tekpair.tech</div></div></body></html>`;
  await fetch('https://api.resend.com/emails',{ method:'POST', headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({from:'TekPair <noreply@tekpair.tech>',to:[tienda.email],subject,html}) });
}

// ── ACCIONES PRESUPUESTOS (PRES-C) ───────────────────────────────────────────

// PRES-C-1: Genera token y devuelve URL + datos para enviar al cliente
// Requiere JWT válido del taller en header Authorization
async function presGenerarToken(body, authHeader) {
  const jwt = (authHeader||'').replace(/^Bearer\s+/i,'');
  const payload = await verificarJWT(jwt);
  if (!payload) return { ok:false, error:'No autorizado', status:401 };

  const repId  = san(body.rep_id, 100);
  const enviar = body.enviar || []; // ['wa','email']
  if (!repId) return { ok:false, error:'rep_id requerido', status:400 };

  // Verificar que la reparación pertenece a la tienda del JWT
  const tiendaId = payload.tienda_id;
  if (!tiendaId) return { ok:false, error:'JWT sin tienda_id', status:401 };

  let reps;
  try {
    reps = await sbGet(`reparaciones?id=eq.${encodeURIComponent(repId)}&tienda_id=eq.${encodeURIComponent(tiendaId)}&select=id,cliente_id,cliente_nombre,marca,modelo,averia,total,base,iva,iva_importe,iva_modo,servicios,componentes,estado&limit=1`);
  } catch(e) { return { ok:false, error:'Error al cargar reparación', status:500 }; }

  if (!reps?.length) return { ok:false, error:'Reparación no encontrada', status:404 };
  const rep = reps[0];
  if (!['Presupuesto','presupuesto'].includes(rep.estado)) return { ok:false, error:'Esta reparación no es un presupuesto', status:400 };

  // Obtener teléfono y email del cliente
  let cliTel = '', cliEmail = '';
  if (rep.cliente_id) {
    try {
      const clis = await sbGet(`clientes?id=eq.${encodeURIComponent(rep.cliente_id)}&tienda_id=eq.${encodeURIComponent(tiendaId)}&select=tel,email&limit=1`);
      if (clis?.length) { cliTel = clis[0].tel||''; cliEmail = clis[0].email||''; }
    } catch(e) { console.error('presGenerarToken get cli:', e); }
  }

  // Generar token único + expiración 48h
  const token = crypto.randomUUID().replace(/-/g,'');
  const exp   = new Date(Date.now() + 48*3600*1000).toISOString();

  try {
    await sbPatch(`reparaciones?id=eq.${encodeURIComponent(repId)}&tienda_id=eq.${encodeURIComponent(tiendaId)}`, {
      presupuesto_token: token,
      presupuesto_token_exp: exp
    });
  } catch(e) { return { ok:false, error:'Error al guardar token', status:500 }; }

  const url = `${APP_URL}/presupuesto.html?t=${token}`;

  // Obtener nombre tienda para el mensaje
  let tiendaNombre = 'Tu taller';
  try {
    const ts = await sbGet(`tiendas?id=eq.${encodeURIComponent(tiendaId)}&select=nombre,email&limit=1`);
    if (ts?.length) tiendaNombre = ts[0].nombre||tiendaNombre;
  } catch(e) {}

  // Enviar email si se solicita
  if (enviar.includes('email') && cliEmail) {
    enviarEmailPresupuesto(tiendaNombre, cliEmail, rep, url).catch(e=>console.error('email presupuesto:',e));
  }

  return {
    ok: true,
    url,
    token,
    tel: cliTel,
    email: cliEmail,
    // Mensaje WhatsApp listo para usar
    waMensaje: encodeURIComponent(
      `Hola ${rep.cliente_nombre||''}! Te enviamos el presupuesto para tu ${rep.marca||''} ${rep.modelo||''} desde ${tiendaNombre}.\n\nPuedes revisarlo y aceptarlo aquí:\n${url}\n\nEspera tu confirmación. ¡Gracias!`
    )
  };
}

// PRES-C-2: Devuelve datos del presupuesto por token (público, sin auth)
async function presGet(token) {
  if (!token || token.length < 20) return { ok:false, error:'Token inválido', status:400 };
  let reps;
  try {
    reps = await sbGet(`reparaciones?presupuesto_token=eq.${encodeURIComponent(token)}&select=id,cliente_nombre,marca,modelo,averia,total,base,iva,iva_importe,iva_modo,servicios,componentes,estado,presupuesto_token_exp,presupuesto_aceptado_at,tienda_id&limit=1`);
  } catch(e) { return { ok:false, error:'Error al cargar presupuesto', status:500 }; }

  if (!reps?.length) return { ok:false, error:'Presupuesto no encontrado o enlace caducado', status:404 };
  const rep = reps[0];

  // Verificar expiración
  if (rep.presupuesto_token_exp && new Date(rep.presupuesto_token_exp) < new Date()) {
    return { ok:false, error:'Este enlace ha caducado (48h). Pide al taller un nuevo enlace.', status:410 };
  }

  // Ya aceptado
  if (rep.presupuesto_aceptado_at) {
    return { ok:false, error:'Este presupuesto ya fue aceptado.', status:409, yaAceptado:true };
  }

  // Obtener nombre y logo de la tienda
  let tienda = { nombre:'Tu taller', logo_url:null };
  try {
    const ts = await sbGet(`tiendas?id=eq.${encodeURIComponent(rep.tienda_id)}&select=nombre,logo_url&limit=1`);
    if (ts?.length) tienda = ts[0];
  } catch(e) {}

  const servicios = typeof rep.servicios === 'string' ? JSON.parse(rep.servicios||'[]') : (rep.servicios||[]);
  const componentes = typeof rep.componentes === 'string' ? JSON.parse(rep.componentes||'[]') : (rep.componentes||[]);

  return {
    ok: true,
    rep: {
      id: rep.id,
      clienteNombre: rep.cliente_nombre||'',
      marca: rep.marca||'',
      modelo: rep.modelo||'',
      averia: rep.averia||'',
      total: parseFloat(rep.total)||0,
      base: parseFloat(rep.base)||0,
      iva: parseFloat(rep.iva)||0,
      ivaImporte: parseFloat(rep.iva_importe)||0,
      ivaModo: rep.iva_modo||'sin',
      servicios,
      componentes
    },
    tienda
  };
}

// PRES-C-3: Cliente acepta el presupuesto (público)
async function presAceptar(body, ip) {
  if (!checkRateLimit(ip, 5, 3600000)) return { ok:false, error:'Demasiados intentos. Espera un momento.', status:429 };

  const token = san(body.token, 200);
  const firma = body.firma || null; // base64 PNG opcional
  if (!token || token.length < 20) return { ok:false, error:'Token inválido', status:400 };

  // Verificar token válido y no expirado
  let reps;
  try {
    reps = await sbGet(`reparaciones?presupuesto_token=eq.${encodeURIComponent(token)}&select=id,tienda_id,cliente_nombre,presupuesto_token_exp,presupuesto_aceptado_at,estado&limit=1`);
  } catch(e) { return { ok:false, error:'Error al verificar presupuesto', status:500 }; }

  if (!reps?.length) return { ok:false, error:'Enlace inválido o caducado', status:404 };
  const rep = reps[0];

  if (rep.presupuesto_token_exp && new Date(rep.presupuesto_token_exp) < new Date()) {
    return { ok:false, error:'Este enlace ha caducado. Pide al taller un nuevo enlace.', status:410 };
  }
  if (rep.presupuesto_aceptado_at) {
    return { ok:false, error:'Este presupuesto ya fue aceptado anteriormente.', status:409, yaAceptado:true };
  }

  // Validar firma si viene (max 300KB en base64)
  if (firma && (typeof firma !== 'string' || firma.length > 400000)) {
    return { ok:false, error:'Firma inválida', status:400 };
  }

  const ahora = new Date().toISOString();
  const patch = {
    presupuesto_aceptado_at: ahora,
    presupuesto_aceptado_ip: ip,
    presupuesto_token: null,       // invalidar token
  };
  if (firma) {
    patch.firma_cliente = firma;
    patch.firma_fecha   = ahora;
  }

  try {
    await sbPatch(`reparaciones?id=eq.${encodeURIComponent(rep.id)}&tienda_id=eq.${encodeURIComponent(rep.tienda_id)}`, patch);
  } catch(e) { return { ok:false, error:'Error al guardar aceptación', status:500 }; }

  // Notificación al taller: insertar en tabla notificaciones si existe
  try {
    await sbPost('notificaciones', {
      id: 'pres_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
      tienda_id: rep.tienda_id,
      tipo: 'presupuesto_aceptado',
      titulo: 'Presupuesto aceptado',
      detalle: `${rep.cliente_nombre||'Cliente'} aceptó el presupuesto`,
      rep_id: rep.id,
      leida: false,
      fecha: ahora
    });
  } catch(e) { console.error('notif presupuesto:', e); } // no bloqueante

  return { ok:true, mensaje:'Presupuesto aceptado correctamente.' };
}

async function enviarEmailPresupuesto(tiendaNombre, cliEmail, rep, url) {
  if (!RESEND_KEY) return;
  const servicios = typeof rep.servicios === 'string' ? JSON.parse(rep.servicios||'[]') : (rep.servicios||[]);
  const filas = servicios.map(s =>
    `<tr><td style="padding:8px 14px;color:#374151">${esc(s.nombre||s.desc||'Servicio')}</td><td style="padding:8px 14px;text-align:right;font-weight:600">${fmtEuros(s.precio||s.pvp||0)}</td></tr>`
  ).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f7f9fc;margin:0;padding:0">
<div style="max-width:520px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#0F172A;padding:28px;text-align:center">
    <div style="color:#FF5B1F;font-size:22px;font-weight:800;margin-bottom:4px">⚡ ${esc(tiendaNombre)}</div>
    <div style="color:#94a3b8;font-size:13px">Presupuesto de reparación</div>
  </div>
  <div style="padding:26px">
    <p style="font-size:15px;color:#0F1729;margin:0 0 6px">Hola <strong>${esc(rep.cliente_nombre||'')}</strong>,</p>
    <p style="font-size:14px;color:#64748B;margin:0 0 20px">Te enviamos el presupuesto para tu <strong>${esc(rep.marca||'')} ${esc(rep.modelo||'')}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;background:#F7F9FC;border-radius:8px;overflow:hidden;margin-bottom:16px">
      <thead><tr style="background:#E2E8F0"><th style="padding:10px 14px;text-align:left;color:#374151;font-weight:600">Servicio</th><th style="padding:10px 14px;text-align:right;color:#374151;font-weight:600">Precio</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr style="border-top:2px solid #E2E8F0"><td style="padding:12px 14px;font-weight:800;color:#0F1729">TOTAL</td><td style="padding:12px 14px;text-align:right;font-weight:800;color:#FF5B1F;font-size:18px">${fmtEuros(rep.total)}</td></tr></tfoot>
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${url}" style="background:#FF5B1F;color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block">Ver y aceptar presupuesto →</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">Este enlace es válido durante 48 horas.</p>
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">TekPair · tekpair.tech</div>
</div>
</body></html>`;
  await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({ from:'TekPair <noreply@tekpair.tech>', to:[cliEmail], subject:`Presupuesto de reparación — ${rep.marca||''} ${rep.modelo||''}`, html })
  });
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Solo POST' });

  const ip = ((req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown')).toString().split(',')[0].trim();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let result;
  try {
    switch (body.action) {
      case 'get-tienda':      result = await getTienda(body.slug); break;
      case 'get-servicios':   result = await getServicios(body.slug); break;
      case 'get-citas-dia':   result = await getCitasDia(body.slug, body.fecha); break;
      case 'crear-cita':      result = await crearCita(body, ip); break;
      case 'pres-generar-token': result = await presGenerarToken(body, req.headers['authorization']); break;
      case 'pres-get':        result = await presGet(body.token); break;
      case 'pres-aceptar':    result = await presAceptar(body, ip); break;
      default: result = { ok:false, error:'Acción no reconocida', status:400 };
    }
  } catch(e) {
    console.error('handler exception:', e);
    result = { ok:false, error:'Error interno', status:500 };
  }

  const status = result.status || (result.ok ? 200 : 400);
  delete result.status;
  res.status(status).json(result);
}
