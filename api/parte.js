// GET /api/parte?id=<repId>&t=<token>
// Devuelve datos publicos de una reparacion si el token es correcto.
// Endurecido v2: headers de seguridad, validacion estricta, rate limit suave.

// Rate limit en memoria (resets en cold start, suficiente para frenar scraping bobo).
// Para mas robustez se podria usar Upstash Redis o similar.
const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000; // 1 min
const RATE_MAX = 60;            // 60 reqs/min/IP

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateLimit.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_MAX) return false;
  return true;
}

// Limpieza periodica para no crecer infinitamente
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateLimit) {
    if (now - e.start > RATE_WINDOW_MS * 2) rateLimit.delete(ip);
  }
}, 60_000).unref?.();

const ID_RE = /^r[0-9]{8,20}$/;
const TOKEN_RE = /^[a-z0-9]{12,32}$/;

export default async function handler(req, res) {
  // Headers de seguridad
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Demasiadas peticiones, intenta en un minuto' });
  }

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
