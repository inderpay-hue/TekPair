// api/citas-publicas.js
// =====================================================
// Endpoint público para reservar citas desde citas.html.
// Toda la validación se hace server-side; usa SUPABASE_SERVICE_KEY
// (bypasa RLS) y resuelve la tienda por slug en lugar de tienda_id.
//
// Acciones soportadas en req.body.action:
//   - 'get-tienda'      : datos públicos de la tienda por slug
//   - 'get-servicios'   : servicios publico=true de esa tienda
//   - 'get-citas-dia'   : horas ocupadas un día (sin datos personales)
//   - 'crear-cita'      : inserta cita con validación + email al admin
//
// Variables de entorno (ya configuradas en TekPair):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
// =====================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Helpers Supabase REST con service_role (bypasa RLS) ──────────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Accept': 'application/json'
    }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function sbPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase POST ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

// ── Rate limiting en memoria (1 instancia Vercel = 1 Map) ────────────────────
// Para producción seria, migrar a Upstash Redis o tabla en Postgres.
// Esto es mejor-que-nada y aguanta spam casual.
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 3;       // máx. 3 citas por hora por IP
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const key = `ip:${ip}`;
  let entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  }
  entry.count++;
  rateLimitMap.set(key, entry);

  // Limpieza periódica si el Map crece
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  return entry.count <= RATE_LIMIT_MAX;
}

// ── Validaciones ─────────────────────────────────────────────────────────────
function sanitizeStr(s, maxLen) {
  if (s == null) return '';
  s = String(s).trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function esValidoTelefono(tel) {
  const dig = (tel || '').replace(/\D/g, '');
  return dig.length >= 7 && dig.length <= 15;
}

function esValidoEmail(email) {
  if (!email) return true; // opcional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esValidaFechaCita(fechaStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return false;
  const f = new Date(fechaStr + 'T00:00:00');
  if (isNaN(f.getTime())) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const limite = new Date();
  limite.setDate(limite.getDate() + 90);
  return f >= hoy && f <= limite;
}

function esValidaHora(horaStr) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(horaStr);
}

function contienenURL(s) {
  return /https?:\/\/|www\.|\.com|\.net|\.es|\.org|\.tech/i.test(s || '');
}

const BAD_TELS = ['0','1','2','6','7','12','15','22','24','28','33','41','44','45','48','54','55','66','111','123','444','777','000','111111','123456','1234567'];

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Acciones ─────────────────────────────────────────────────────────────────

async function getTienda(slug) {
  if (!slug || typeof slug !== 'string') {
    return { ok: false, error: 'Slug inválido', status: 400 };
  }
  const q = `tiendas?citas_slug=eq.${encodeURIComponent(slug)}&select=id,nombre,logo_url,ciudad,provincia,dir,tel,email,horarios,citas_config,citas_slug&limit=1`;
  let rows;
  try {
    rows = await sbGet(q);
  } catch (e) {
    console.error('getTienda error:', e);
    return { ok: false, error: 'Error al cargar tienda', status: 500 };
  }
  if (!rows || !rows.length) {
    return { ok: false, error: 'Tienda no encontrada', status: 404 };
  }
  return { ok: true, tienda: rows[0] };
}

async function getServicios(slug) {
  const t = await getTienda(slug);
  if (!t.ok) return t;
  const q = `servicios?tienda_id=eq.${encodeURIComponent(t.tienda.id)}&publico=eq.true&select=id,nombre,categoria,precio,precio_fijo,tipo,duracion_min&order=nombre.asc`;
  let rows;
  try {
    rows = await sbGet(q);
  } catch (e) {
    console.error('getServicios error:', e);
    return { ok: false, error: 'Error al cargar servicios', status: 500 };
  }
  const servicios = (rows || []).filter(s => s.tipo !== 'venta');
  return { ok: true, servicios };
}

async function getCitasDia(slug, fecha) {
  if (!esValidaFechaCita(fecha)) {
    return { ok: false, error: 'Fecha inválida', status: 400 };
  }
  const t = await getTienda(slug);
  if (!t.ok) return t;
  const q = `citas?tienda_id=eq.${encodeURIComponent(t.tienda.id)}&fecha=eq.${fecha}&estado=neq.cancelada&select=hora,duracion_min`;
  let rows;
  try {
    rows = await sbGet(q);
  } catch (e) {
    console.error('getCitasDia error:', e);
    return { ok: false, error: 'Error al cargar citas', status: 500 };
  }
  // Solo horas, NO datos personales
  return { ok: true, ocupadas: (rows || []).map(c => ({ hora: c.hora, duracion_min: c.duracion_min })) };
}

async function crearCita(body, ip) {
  if (!checkRateLimit(ip)) {
    return { ok: false, error: 'Demasiadas reservas desde tu IP. Vuelve a intentarlo en una hora.', status: 429 };
  }

  const t = await getTienda(body.slug);
  if (!t.ok) return t;
  const tienda = t.tienda;

  const nombre = sanitizeStr(body.cliente_nombre, 100);
  const tel = sanitizeStr(body.cliente_tel, 30);
  const email = sanitizeStr(body.cliente_email, 100);
  const fecha = sanitizeStr(body.fecha, 10);
  const hora = sanitizeStr(body.hora, 5);
  const servicio = sanitizeStr(body.servicio, 100);
  const marca = sanitizeStr(body.marca, 50);
  const modelo = sanitizeStr(body.modelo, 100);
  const notas = sanitizeStr(body.notas, 500);
  const duracion = parseInt(body.duracion_min) || 30;

  if (!nombre || nombre.length < 2) {
    return { ok: false, error: 'Nombre obligatorio (mínimo 2 caracteres)', status: 400 };
  }
  if (!esValidoTelefono(tel)) {
    return { ok: false, error: 'Teléfono inválido', status: 400 };
  }
  if (!esValidoEmail(email)) {
    return { ok: false, error: 'Email inválido', status: 400 };
  }
  if (!esValidaFechaCita(fecha)) {
    return { ok: false, error: 'Fecha inválida (debe ser hoy o hasta 90 días en el futuro)', status: 400 };
  }
  if (!esValidaHora(hora)) {
    return { ok: false, error: 'Hora inválida (formato HH:MM)', status: 400 };
  }
  if (contienenURL(nombre) || contienenURL(notas)) {
    return { ok: false, error: 'No se permiten URLs en el nombre o las notas', status: 400 };
  }
  if (BAD_TELS.includes(tel.replace(/\D/g, ''))) {
    return { ok: false, error: 'Teléfono inválido', status: 400 };
  }

  // Verificar duplicado: misma tienda + fecha + hora no permitido (no canceladas)
  const qCheck = `citas?tienda_id=eq.${encodeURIComponent(tienda.id)}&fecha=eq.${fecha}&hora=eq.${encodeURIComponent(hora)}&estado=neq.cancelada&select=id&limit=1`;
  let existente;
  try {
    existente = await sbGet(qCheck);
  } catch (e) {
    console.error('crearCita check error:', e);
    return { ok: false, error: 'Error al validar disponibilidad', status: 500 };
  }
  if (existente && existente.length > 0) {
    return { ok: false, error: 'Esa hora ya está reservada. Elige otra.', status: 409 };
  }

  // Insertar
  const citaId = 'c' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const payload = {
    id: citaId,
    tienda_id: tienda.id,
    fecha,
    hora,
    servicio: servicio || 'Consulta',
    duracion_min: duracion,
    cliente_nombre: nombre,
    cliente_tel: tel,
    cliente_email: email || null,
    notas: notas || null,
    marca: marca || null,
    modelo: modelo || null,
    estado: 'pendiente'
  };

  let creada;
  try {
    const rows = await sbPost('citas', payload);
    creada = (rows && rows[0]) || payload;
  } catch (e) {
    console.error('crearCita insert error:', e);
    return { ok: false, error: 'No se pudo guardar la cita. Intenta más tarde.', status: 500 };
  }

  // Email al admin (no bloqueante: si falla, la cita ya está creada)
  enviarEmailAdmin(tienda, creada).catch(e => {
    console.error('enviarEmailAdmin error (no bloqueante):', e);
  });

  return { ok: true, cita: creada };
}

// ── Email al admin con Resend ────────────────────────────────────────────────
async function enviarEmailAdmin(tienda, cita) {
  const KEY = process.env.RESEND_API_KEY;
  if (!KEY) { console.error('RESEND_API_KEY no configurada'); return; }
  const destino = tienda.email;
  if (!destino) return; // tienda sin email, salir silenciosamente

  const fechaFmt = new Date(cita.fecha + 'T00:00:00').toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const subject = `Nueva cita: ${cita.cliente_nombre} - ${fechaFmt} ${cita.hora}`;
  const tNom = tienda.nombre || 'tu tienda';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f7f9fc;margin:0;padding:0">
<div style="max-width:520px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#0F172A;padding:28px;text-align:center">
    <div style="color:#00C896;font-size:22px;font-weight:800;margin-bottom:4px">⚡ ${escapeHtml(tNom)}</div>
    <div style="color:#94a3b8;font-size:13px">Nueva cita reservada</div>
  </div>
  <div style="padding:26px">
    <p style="font-size:15px;color:#0F1729;margin:0 0 18px">Hola, te ha llegado una cita nueva:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;background:#F7F9FC;border-radius:8px;overflow:hidden">
      <tr><td style="padding:10px 14px;color:#64748B;width:110px">Cliente</td><td style="padding:10px 14px;font-weight:700">${escapeHtml(cita.cliente_nombre)}</td></tr>
      <tr><td style="padding:10px 14px;color:#64748B">Teléfono</td><td style="padding:10px 14px;font-weight:700"><a href="tel:${escapeHtml(cita.cliente_tel)}" style="color:#00C896;text-decoration:none">${escapeHtml(cita.cliente_tel)}</a></td></tr>
      ${cita.cliente_email ? `<tr><td style="padding:10px 14px;color:#64748B">Email</td><td style="padding:10px 14px">${escapeHtml(cita.cliente_email)}</td></tr>` : ''}
      <tr><td style="padding:10px 14px;color:#64748B">Fecha</td><td style="padding:10px 14px;font-weight:700">${escapeHtml(fechaFmt)}</td></tr>
      <tr><td style="padding:10px 14px;color:#64748B">Hora</td><td style="padding:10px 14px;font-weight:700">${escapeHtml(cita.hora)}</td></tr>
      <tr><td style="padding:10px 14px;color:#64748B">Servicio</td><td style="padding:10px 14px">${escapeHtml(cita.servicio || 'Consulta')}</td></tr>
      ${(cita.marca || cita.modelo) ? `<tr><td style="padding:10px 14px;color:#64748B">Dispositivo</td><td style="padding:10px 14px">${escapeHtml(((cita.marca || '') + ' ' + (cita.modelo || '')).trim())}</td></tr>` : ''}
      ${cita.notas ? `<tr><td style="padding:10px 14px;color:#64748B;vertical-align:top">Notas</td><td style="padding:10px 14px;white-space:pre-wrap">${escapeHtml(cita.notas)}</td></tr>` : ''}
    </table>
    <p style="font-size:12px;color:#64748B;margin:18px 0 0">Entra a tu dashboard de TekPair para gestionarla.</p>
  </div>
  <div style="text-align:center;padding:16px;color:#aaa;font-size:11px">Enviado con TekPair · tekpair.tech</div>
</div>
</body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TekPair <noreply@tekpair.tech>',
        to: [destino],
        subject,
        html
      })
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('Resend HTTP ' + r.status + ':', t);
    }
  } catch (e) {
    console.error('Resend fetch error:', e);
  }
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS abierto: citas.html puede vivir en cualquier subdominio tuyo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Solo POST' });
  }

  // IP del cliente para rate limit
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString().split(',')[0].trim();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  let result;
  try {
    switch (body.action) {
      case 'get-tienda':
        result = await getTienda(body.slug);
        break;
      case 'get-servicios':
        result = await getServicios(body.slug);
        break;
      case 'get-citas-dia':
        result = await getCitasDia(body.slug, body.fecha);
        break;
      case 'crear-cita':
        result = await crearCita(body, ip);
        break;
      default:
        result = { ok: false, error: 'Acción no reconocida', status: 400 };
    }
  } catch (e) {
    console.error('handler exception:', e);
    result = { ok: false, error: 'Error interno', status: 500 };
  }

  const status = result.status || (result.ok ? 200 : 400);
  delete result.status;
  res.status(status).json(result);
}
