// GET /api/parte?id=<repId>&t=<token>
// Devuelve datos publicos de una reparacion si el token es correcto.
// Usa SUPABASE_SERVICE_KEY (privada) para saltarse RLS y filtrar por id+token.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, t } = req.query;
  if (!id || !t) return res.status(400).json({ error: 'Faltan parametros' });

  if (id.length > 50 || t.length < 8 || t.length > 100) {
    return res.status(400).json({ error: 'Parametros invalidos' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing Supabase env vars');
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
      const txt = await r.text();
      console.error('Supabase error:', r.status, txt);
      return res.status(500).json({ error: 'Error consultando datos' });
    }

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Reparacion no encontrada' });
    }

    const rep = rows[0];

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
          if (Array.isArray(tRows) && tRows.length > 0) {
            tienda = tRows[0];
          }
        }
      } catch (e) {
        console.warn('No se pudo cargar info tienda:', e);
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
    console.error('parte.js error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
