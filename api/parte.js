// GET /api/parte?id=<repId>&t=<token>
// Devuelve datos publicos de una reparacion si el token es correcto.
// Endurecido v2: headers de seguridad, validacion estricta, rate limit suave.

// Rate limit distribuido vía api/_lib/ratelimit.js (Upstash + fallback en memoria): 60 reqs/min/IP.
import { rateLimit } from './_lib/ratelimit.js';
import crypto from 'crypto';

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

const ID_RE = /^r[0-9a-z_]{8,40}$/i; // acepta r<timestamp>_<random6>
const TOKEN_RE = /^[a-z0-9]{12,32}$/;
const METODOS_OK = ['bizum', 'transferencia', 'paypal', 'otro'];

export default async function handler(req, res) {
  // Headers de seguridad
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  const action = typeof req.query.action === 'string' ? req.query.action : '';

  // Rate limit (común a todas las acciones)
  const ip = getClientIp(req);
  const _rl = await rateLimit(`parte:${ip}`, 60, 60);
  if (!_rl.ok) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Demasiadas peticiones, intenta en un minuto' });
  }

  // POST: el cliente declara que ha pagado una cuota (Modelo C)
  if (req.method === 'POST') {
    if (action === 'confirmar-pago') return cobroConfirmarPago(req, res, ip);
    if (action === 'foto-token') return fotoToken(req, res);
    if (action === 'foto-subir') return fotoSubir(req, res);
    if (action === 'firma-token') return firmaToken(req, res);
    if (action === 'firma-datos') return firmaDatos(req, res);
    if (action === 'firma-guardar') return firmaGuardar(req, res, ip);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // GET ?action=cobro: datos públicos de una cuota para la página /cobrar
  if (action === 'cobro') return cobroDatosCuota(req, res);

  const { id, t } = req.query;
  if (!id || !t) return res.status(400).json({ error: 'Faltan parametros' });

  // Validacion estricta de formato — ahorra hits a Supabase si vienen basura
  if (typeof id !== 'string' || typeof t !== 'string') {
    return res.status(400).json({ error: 'Parametros invalidos' });
  }
  if (!ID_RE.test(id) || !TOKEN_RE.test(t)) {
    return res.status(400).json({ error: 'Formato invalido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[parte] Missing Supabase env vars');
    return res.status(500).json({ error: 'Servidor no configurado' });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}&token=eq.${encodeURIComponent(t)}&select=id,fecha,cliente_nombre,marca,modelo,imei,averia,estado,prioridad,fecha_entrega,fecha_entrega_real,total,restante,nota,tienda_id`;
    const r = await fetch(url, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      }
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[parte] Supabase error:', r.status, txt.slice(0, 200));
      return res.status(500).json({ error: 'Error consultando datos' });
    }

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      // No filtramos por que falla — para el cliente siempre 'no encontrada'
      return res.status(404).json({ error: 'Reparacion no encontrada' });
    }

    const rep = rows[0];

    // Buscar info publica de la tienda
    let tienda = { nombre: 'Tekpair' };
    if (rep.tienda_id) {
      try {
        const tUrl = `${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(rep.tienda_id)}&select=nombre,telefono,ciudad,pais,logo_url`;
        const tR = await fetch(tUrl, {
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`
          }
        });
        if (tR.ok) {
          const tRows = await tR.json();
          if (Array.isArray(tRows) && tRows.length > 0) tienda = tRows[0];
        }
      } catch (e) {
        console.warn('[parte] Tienda fetch fallo:', e?.message || e);
      }
    }

    return res.status(200).json({
      ok: true,
      rep: {
        id: rep.id,
        fecha: rep.fecha,
        cliente_nombre: rep.cliente_nombre,
        marca: rep.marca,
        modelo: rep.modelo,
        imei: rep.imei,
        averia: rep.averia,
        estado: rep.estado,
        prioridad: rep.prioridad,
        fecha_entrega: rep.fecha_entrega,
        fecha_entrega_real: rep.fecha_entrega_real,
        total: rep.total,
        restante: rep.restante
      },
      tienda: {
        nombre: tienda.nombre || 'Tekpair',
        telefono: tienda.telefono || '',
        ciudad: tienda.ciudad || '',
        pais: tienda.pais || '',
        logo: tienda.logo_url || ''
      }
    });
  } catch (e) {
    console.error('[parte] Error:', e?.message || e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

// ═══ FINANCIACIÓN · LINK DE COBRO (Modelo C) ═══
function parseCuotas(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

async function fetchRepCobro(SUPABASE_URL, SERVICE_KEY, id, t) {
  const url = `${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}&token=eq.${encodeURIComponent(t)}&select=id,numero,cliente_nombre,marca,modelo,cuotas,total,entrada,tienda_id`;
  const r = await fetch(url, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) return { error: 'db' };
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) return { error: 'notfound' };
  return { rep: rows[0] };
}

// GET ?action=cobro&id=&t=&n=  → datos públicos de la cuota n
async function cobroDatosCuota(req, res) {
  const { id, t, n } = req.query;
  if (!id || !t || n === undefined) return res.status(400).json({ error: 'Faltan parametros' });
  if (typeof id !== 'string' || typeof t !== 'string') return res.status(400).json({ error: 'Parametros invalidos' });
  if (!ID_RE.test(id) || !TOKEN_RE.test(t)) return res.status(400).json({ error: 'Formato invalido' });
  const idx = parseInt(n, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx > 60) return res.status(400).json({ error: 'Cuota invalida' });

  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });

  try {
    const { rep, error } = await fetchRepCobro(SUPABASE_URL, SERVICE_KEY, id, t);
    if (error === 'db') return res.status(500).json({ error: 'Error consultando datos' });
    if (error) return res.status(404).json({ error: 'No encontrado' });
    const cuotas = parseCuotas(rep.cuotas);
    if (!Array.isArray(cuotas) || !cuotas[idx]) return res.status(404).json({ error: 'Cuota no encontrada' });
    const cu = cuotas[idx];

    let tienda = { nombre: 'TekPair' };
    if (rep.tienda_id) {
      try {
        const tUrl = `${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(rep.tienda_id)}&select=nombre,telefono,cobro_datos`;
        const tR = await fetch(tUrl, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        if (tR.ok) { const tRows = await tR.json(); if (Array.isArray(tRows) && tRows.length) tienda = tRows[0]; }
      } catch (e) { /* tienda opcional */ }
    }
    const cobro = (tienda.cobro_datos && typeof tienda.cobro_datos === 'object') ? tienda.cobro_datos : {};
    return res.status(200).json({
      ok: true,
      cuota: { num: idx + 1, total: cuotas.length, importe: cu.importe, vence: cu.fecha || '', pagado: !!cu.pagado },
      equipo: `${rep.marca || ''} ${rep.modelo || ''}`.trim(),
      cliente: rep.cliente_nombre || '',
      concepto: `REP-${rep.numero || id}-CUOTA-${idx + 1}`,
      tienda: { nombre: tienda.nombre || 'TekPair', telefono: tienda.telefono || '', cobro }
    });
  } catch (e) {
    console.error('[cobro] datos error', e?.message || e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

// POST ?action=confirmar-pago  body {id,t,n,metodo,comentario}  → registra intento (NO marca pagada)
async function cobroConfirmarPago(req, res, ip) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const id = body.id, t = body.t, metodo = body.metodo;
  const n = parseInt(body.n, 10);
  const comentario = typeof body.comentario === 'string' ? body.comentario.slice(0, 300) : null;
  if (!id || !t || !Number.isInteger(n)) return res.status(400).json({ error: 'Faltan parametros' });
  if (typeof id !== 'string' || typeof t !== 'string' || !ID_RE.test(id) || !TOKEN_RE.test(t)) return res.status(400).json({ error: 'Formato invalido' });
  if (n < 0 || n > 60) return res.status(400).json({ error: 'Cuota invalida' });
  if (METODOS_OK.indexOf(metodo) === -1) return res.status(400).json({ error: 'Metodo invalido' });

  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });

  try {
    const { rep, error } = await fetchRepCobro(SUPABASE_URL, SERVICE_KEY, id, t);
    if (error === 'db') return res.status(500).json({ error: 'Error consultando datos' });
    if (error) return res.status(404).json({ error: 'No encontrado' });
    const cuotas = parseCuotas(rep.cuotas);
    if (!Array.isArray(cuotas) || !cuotas[n]) return res.status(404).json({ error: 'Cuota no encontrada' });
    const cu = cuotas[n];
    if (cu.pagado) return res.status(409).json({ error: 'Esta cuota ya consta como pagada' });

    // Idempotencia: no duplicar si ya hay un intento pendiente para (rep, cuota)
    const qUrl = `${SUPABASE_URL}/rest/v1/payment_attempts?reparacion_id=eq.${encodeURIComponent(id)}&cuota_idx=eq.${n}&estado=eq.pendiente_confirmacion&select=id&limit=1`;
    const qR = await fetch(qUrl, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (qR.ok) { const ex = await qR.json(); if (Array.isArray(ex) && ex.length) return res.status(200).json({ ok: true, mensaje: 'Ya hemos avisado a la tienda. Verificarán tu pago.' }); }

    const row = {
      tienda_id: rep.tienda_id, reparacion_id: id, cuota_idx: n,
      importe: cu.importe || null, metodo_declarado: metodo, comentario,
      ip: (ip && ip !== 'unknown') ? ip : null,
      user_agent: (req.headers['user-agent'] || '').slice(0, 300) || null,
      estado: 'pendiente_confirmacion'
    };
    const insR = await fetch(`${SUPABASE_URL}/rest/v1/payment_attempts`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(row)
    });
    if (!insR.ok) { const txt = await insR.text().catch(() => ''); console.error('[cobro] insert error', insR.status, txt.slice(0, 200)); return res.status(500).json({ error: 'No se pudo registrar' }); }
    return res.status(200).json({ ok: true, mensaje: 'Hemos avisado a la tienda. Verificarán tu pago en breve.' });
  } catch (e) {
    console.error('[cobro] confirmar error', e?.message || e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

// ═══ SUBIR FOTOS POR QR (móvil → reparación) ═══
// Permiso de subida firmado y CADUCO, sin estado en BD: sig = HMAC(SERVICE_KEY, id:exp).
// El PC (que conoce id+token de la rep) pide el permiso; el QR lleva id+exp+sig; el móvil sube.
const FOTO_TTL_MS = 45 * 60 * 1000;       // el QR de subida caduca a los 45 min
const FOTO_MAX_BYTES = 2 * 1024 * 1024;   // 2 MB por foto (ya comprimida en el móvil)
const FOTO_MAX_POR_REP = 30;              // tope defensivo de fotos de recepción

function _fotoFirma(id, exp, secret) {
  return crypto.createHmac('sha256', secret).update(id + ':' + exp).digest('hex');
}
function _fotoFirmaOk(id, exp, sig, secret) {
  if (!/^[0-9a-f]{64}$/i.test(String(sig || ''))) return false;
  const esperado = _fotoFirma(id, exp, secret);
  try { return crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(String(sig).toLowerCase(), 'hex')); } catch (e) { return false; }
}

// POST ?action=foto-token  body {id,t}  → firma un permiso de subida caduco para esa reparación
async function fotoToken(req, res) {
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const id = body.id, t = body.t;
  if (!id || !t || typeof id !== 'string' || typeof t !== 'string' || !ID_RE.test(id) || !TOKEN_RE.test(t)) return res.status(400).json({ error: 'Formato invalido' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });
  try {
    // Autoriza solo si id+token coinciden con una reparación real (el PC conoce el token del parte).
    const url = `${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}&token=eq.${encodeURIComponent(t)}&select=id&limit=1`;
    const r = await fetch(url, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) return res.status(500).json({ error: 'Error consultando datos' });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'No encontrado' });
    const exp = Date.now() + FOTO_TTL_MS;
    const sig = _fotoFirma(id, exp, SERVICE_KEY);
    return res.status(200).json({ ok: true, id, exp, sig, ttl_min: Math.round(FOTO_TTL_MS / 60000) });
  } catch (e) { console.error('[foto-token]', e?.message || e); return res.status(500).json({ error: 'Error del servidor' }); }
}

// POST ?action=foto-subir  body {id,exp,sig,foto(dataURL)}  → sube al Storage + añade a fotos_recepcion
async function fotoSubir(req, res) {
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const id = body.id; const exp = parseInt(body.exp, 10); const sig = body.sig; const foto = body.foto;
  if (!id || typeof id !== 'string' || !ID_RE.test(id)) return res.status(400).json({ error: 'Formato invalido' });
  if (!Number.isInteger(exp)) return res.status(400).json({ error: 'Permiso invalido' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });
  if (Date.now() > exp) return res.status(403).json({ error: 'caducado' });
  if (!_fotoFirmaOk(id, exp, sig, SERVICE_KEY)) return res.status(403).json({ error: 'no autorizado' });
  // Decodificar la foto (dataURL o base64 puro)
  let b64 = String(foto || '');
  const m = b64.match(/^data:image\/[a-z+.-]+;base64,(.+)$/i);
  if (m) b64 = m[1];
  if (!b64 || b64.length < 100) return res.status(400).json({ error: 'Foto invalida' });
  let buf; try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'Foto invalida' }); }
  if (!buf || buf.length < 100) return res.status(400).json({ error: 'Foto invalida' });
  if (buf.length > FOTO_MAX_BYTES) return res.status(413).json({ error: 'Foto demasiado grande' });
  try {
    // tienda_id + fotos actuales de la reparación
    const rUrl = `${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}&select=tienda_id,fotos_recepcion&limit=1`;
    const rR = await fetch(rUrl, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!rR.ok) return res.status(500).json({ error: 'Error consultando datos' });
    const rows = await rR.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'No encontrado' });
    const tiendaId = rows[0].tienda_id;
    let fotos = Array.isArray(rows[0].fotos_recepcion) ? rows[0].fotos_recepcion : [];
    if (fotos.length >= FOTO_MAX_POR_REP) return res.status(409).json({ error: 'limite' });
    const path = `${tiendaId}/reps/movil_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    // Subir al bucket privado gastos-adjuntos (mismo que las fotos M7)
    const upR = await fetch(`${SUPABASE_URL}/storage/v1/object/gastos-adjuntos/${path}`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: buf
    });
    if (!upR.ok) { const t2 = await upR.text().catch(() => ''); console.error('[foto-subir] storage', upR.status, t2.slice(0, 200)); return res.status(502).json({ error: 'No se pudo subir' }); }
    // Append a fotos_recepcion → el PATCH dispara Realtime → el PC refresca solo
    fotos = fotos.concat([path]);
    const paR = await fetch(`${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ fotos_recepcion: fotos })
    });
    if (!paR.ok) { const t3 = await paR.text().catch(() => ''); console.error('[foto-subir] patch', paR.status, t3.slice(0, 200)); return res.status(500).json({ error: 'No se pudo guardar' }); }
    return res.status(200).json({ ok: true, n: fotos.length });
  } catch (e) { console.error('[foto-subir]', e?.message || e); return res.status(500).json({ error: 'Error del servidor' }); }
}

// ═══ FIRMA DEL CLIENTE EN RECEPCIÓN POR QR (móvil del cliente → reparación) ═══
// Mismo esqueleto que fotos, pero permiso con PROPÓSITO 'firma:' → un token de fotos NO sirve
// para firmar (y viceversa). El QR lleva id+exp+sig; el móvil pide datos y firma una sola vez.
const FIRMA_TTL_MS = 45 * 60 * 1000;        // el QR de firma caduca a los 45 min
const FIRMA_MAX_BYTES = 1.5 * 1024 * 1024;  // PNG de firma

function _firmaSig(id, exp, secret) {
  return crypto.createHmac('sha256', secret).update('firma:' + id + ':' + exp).digest('hex');
}
function _firmaSigOk(id, exp, sig, secret) {
  if (!/^[0-9a-f]{64}$/i.test(String(sig || ''))) return false;
  try { return crypto.timingSafeEqual(Buffer.from(_firmaSig(id, exp, secret), 'hex'), Buffer.from(String(sig).toLowerCase(), 'hex')); } catch (e) { return false; }
}
// Hash del contenido firmado (avería + presupuesto + condiciones + garantía + IDs de fotos).
// Se calcula en el SERVIDOR desde la BD → prueba que la firma corresponde a ese contenido exacto.
function _firmaHash(rep, condiciones, garantia) {
  const canon = JSON.stringify({
    averia: rep.averia || '', total: rep.total || 0,
    condiciones: condiciones || '', garantia: garantia || '',
    fotos: Array.isArray(rep.fotos_recepcion) ? rep.fotos_recepcion : []
  });
  return crypto.createHash('sha256').update(canon).digest('hex');
}
// Firma una URL de Storage privado (bucket gastos-adjuntos) por N segundos.
async function _signedUrl(SUPABASE_URL, SERVICE_KEY, path, secs) {
  try {
    const sR = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/gastos-adjuntos/${path}`, {
      method: 'POST', headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: secs || 3600 })
    });
    if (!sR.ok) return '';
    const sj = await sR.json();
    return (sj && sj.signedURL) ? (SUPABASE_URL + '/storage/v1' + sj.signedURL) : '';
  } catch (e) { return ''; }
}
// Lee la rep (campos a mostrar/firmar) + condiciones y garantía de la tienda (de ajustes_config).
async function _firmaLeerRep(SUPABASE_URL, SERVICE_KEY, id) {
  const sel = 'id,cliente_nombre,marca,modelo,imei,averia,total,servicios,fotos_recepcion,firma_recep,firma_recep_fecha,tienda_id';
  const rR = await fetch(`${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}&select=${sel}&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
  if (!rR.ok) return { error: 'db' };
  const rows = await rR.json();
  if (!Array.isArray(rows) || !rows.length) return { error: 'notfound' };
  const rep = rows[0];
  let tienda = { nombre: 'TekPair', logo: '' }, condiciones = '', garantia = '', garantiaDias = 90;
  if (rep.tienda_id) {
    try {
      const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(rep.tienda_id)}&select=nombre,logo_url,ajustes_config`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      if (tR.ok) { const tRows = await tR.json(); if (Array.isArray(tRows) && tRows.length) {
        const t = tRows[0];
        tienda = { nombre: t.nombre || 'TekPair', logo: t.logo_url || '' };
        const aj = (t.ajustes_config && typeof t.ajustes_config === 'object') ? t.ajustes_config : {};
        garantia = String(aj.garantia || '');
        condiciones = String(aj.politica || '');
        garantiaDias = aj.grDiasDefault || 90;
      } }
    } catch (e) { /* tienda opcional */ }
  }
  return { rep, tienda, condiciones, garantia, garantiaDias };
}

// POST ?action=firma-token  body {id,t}  → permiso de firma caduco (el PC conoce el token del parte)
async function firmaToken(req, res) {
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const id = body.id, t = body.t;
  if (!id || !t || typeof id !== 'string' || typeof t !== 'string' || !ID_RE.test(id) || !TOKEN_RE.test(t)) return res.status(400).json({ error: 'Formato invalido' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });
  try {
    const url = `${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}&token=eq.${encodeURIComponent(t)}&select=id&limit=1`;
    const r = await fetch(url, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) return res.status(500).json({ error: 'Error consultando datos' });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'No encontrado' });
    const exp = Date.now() + FIRMA_TTL_MS;
    const sig = _firmaSig(id, exp, SERVICE_KEY);
    return res.status(200).json({ ok: true, id, exp, sig, ttl_min: Math.round(FIRMA_TTL_MS / 60000) });
  } catch (e) { console.error('[firma-token]', e?.message || e); return res.status(500).json({ error: 'Error del servidor' }); }
}

// POST ?action=firma-datos  body {id,exp,sig}  → datos que ve el cliente antes de firmar (o la firma ya hecha)
async function firmaDatos(req, res) {
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const id = body.id; const exp = parseInt(body.exp, 10); const sig = body.sig;
  if (!id || typeof id !== 'string' || !ID_RE.test(id) || !Number.isInteger(exp)) return res.status(400).json({ error: 'Formato invalido' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });
  if (Date.now() > exp) return res.status(403).json({ error: 'caducado' });
  if (!_firmaSigOk(id, exp, sig, SERVICE_KEY)) return res.status(403).json({ error: 'no autorizado' });
  try {
    const d = await _firmaLeerRep(SUPABASE_URL, SERVICE_KEY, id);
    if (d.error === 'db') return res.status(500).json({ error: 'Error consultando datos' });
    if (d.error) return res.status(404).json({ error: 'No encontrado' });
    const rep = d.rep;
    let fotos = [];
    const paths = Array.isArray(rep.fotos_recepcion) ? rep.fotos_recepcion : [];
    for (const p of paths.slice(0, 12)) { const u = await _signedUrl(SUPABASE_URL, SERVICE_KEY, p, 3600); if (u) fotos.push(u); }
    let firmaUrl = '';
    if (rep.firma_recep) firmaUrl = await _signedUrl(SUPABASE_URL, SERVICE_KEY, rep.firma_recep, 3600);
    return res.status(200).json({
      ok: true, firmada: !!rep.firma_recep, firma_url: firmaUrl, firma_fecha: rep.firma_recep_fecha || null,
      rep: { cliente: rep.cliente_nombre || '', marca: rep.marca || '', modelo: rep.modelo || '', imei: rep.imei || '', averia: rep.averia || '', total: rep.total || 0, servicios: (rep.servicios ? (typeof rep.servicios === 'string' ? JSON.parse(rep.servicios) : rep.servicios) : []) },
      tienda: d.tienda, condiciones: d.condiciones, garantia: d.garantia, garantia_dias: d.garantiaDias, fotos
    });
  } catch (e) { console.error('[firma-datos]', e?.message || e); return res.status(500).json({ error: 'Error del servidor' }); }
}

// POST ?action=firma-guardar  body {id,exp,sig,firma(PNG dataURL)}  → guarda firma + fecha + hash + UA/IP
async function firmaGuardar(req, res, ip) {
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const id = body.id; const exp = parseInt(body.exp, 10); const sig = body.sig; const firma = body.firma;
  if (!id || typeof id !== 'string' || !ID_RE.test(id) || !Number.isInteger(exp)) return res.status(400).json({ error: 'Formato invalido' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Servidor no configurado' });
  if (Date.now() > exp) return res.status(403).json({ error: 'caducado' });
  if (!_firmaSigOk(id, exp, sig, SERVICE_KEY)) return res.status(403).json({ error: 'no autorizado' });
  let b64 = String(firma || '');
  const m = b64.match(/^data:image\/png;base64,(.+)$/i);
  if (m) b64 = m[1];
  if (!b64 || b64.length < 100) return res.status(400).json({ error: 'Firma invalida' });
  let buf; try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'Firma invalida' }); }
  if (!buf || buf.length < 100) return res.status(400).json({ error: 'Firma invalida' });
  if (buf.length > FIRMA_MAX_BYTES) return res.status(413).json({ error: 'Firma demasiado grande' });
  try {
    const d = await _firmaLeerRep(SUPABASE_URL, SERVICE_KEY, id);
    if (d.error === 'db') return res.status(500).json({ error: 'Error consultando datos' });
    if (d.error) return res.status(404).json({ error: 'No encontrado' });
    if (d.rep.firma_recep) return res.status(409).json({ error: 'ya_firmada' });   // no re-firmar
    const tiendaId = d.rep.tienda_id;
    const path = `${tiendaId}/firmas/recep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const upR = await fetch(`${SUPABASE_URL}/storage/v1/object/gastos-adjuntos/${path}`, {
      method: 'POST', headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: buf
    });
    if (!upR.ok) { const t2 = await upR.text().catch(() => ''); console.error('[firma-guardar] storage', upR.status, t2.slice(0, 200)); return res.status(502).json({ error: 'No se pudo guardar la firma' }); }
    const hash = _firmaHash(d.rep, d.condiciones, d.garantia);
    const ua = (req.headers['user-agent'] || '').slice(0, 300) || null;
    const patch = { firma_recep: path, firma_recep_fecha: new Date().toISOString(), firma_recep_hash: hash, firma_recep_ip: (ip && ip !== 'unknown') ? ip : null, firma_recep_ua: ua };
    const paR = await fetch(`${SUPABASE_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify(patch)
    });
    if (!paR.ok) { const t3 = await paR.text().catch(() => ''); console.error('[firma-guardar] patch', paR.status, t3.slice(0, 200)); return res.status(500).json({ error: 'No se pudo guardar' }); }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('[firma-guardar]', e?.message || e); return res.status(500).json({ error: 'Error del servidor' }); }
}
