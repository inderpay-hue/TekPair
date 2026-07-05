// GET /api/parte?id=<repId>&t=<token>
// Devuelve datos publicos de una reparacion si el token es correcto.
// Endurecido v2: headers de seguridad, validacion estricta, rate limit suave.

// Rate limit distribuido vía api/_lib/ratelimit.js (Upstash + fallback en memoria): 60 reqs/min/IP.
import { rateLimit } from './_lib/ratelimit.js';

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
