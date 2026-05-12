// api/comisiones.js
// Endpoint para consultar comisiones de afiliados.
// Visibilidad:
//   - Admin (info@tekpair.tech) ve TODAS las comisiones de todos los afiliados
//   - Afiliados normales ven SOLO sus propias comisiones
//   - Cualquier otro usuario: 403 Forbidden

import jwt from 'jsonwebtoken';

const ADMIN_EMAILS = ['info@tekpair.tech'];

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

  // ═══ 1. Verificar autenticación ═══
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido' });
  }

  const userId = decoded.sub || '';
  const tiendaId = decoded.tienda_id || '';

  if (!userId || !tiendaId) return res.status(401).json({ error: 'Token incompleto' });

  const sbHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // Obtener email del usuario desde la BD
    const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(userId)}&select=email&limit=1`, {
      headers: sbHeaders
    });
    const uArr = await uR.json();
    const userEmail = (uArr[0]?.email || '').toLowerCase();

    if (!userEmail) return res.status(401).json({ error: 'Usuario no encontrado' });

    // ═══ 2. Determinar rol del usuario ═══
    const isAdmin = ADMIN_EMAILS.includes(userEmail);

    // ═══ POST: acciones de admin (marcar como pagado) ═══
    if (req.method === 'POST') {
      if (!isAdmin) return res.status(403).json({ error: 'Solo admin' });

      const body = req.body || {};
      const action = body.action;

      if (action === 'marcar_pagado' && Array.isArray(body.ids) && body.ids.length) {
        // Marcar pagos individuales como pagados por sus IDs
        const ids = body.ids.filter(n => Number.isInteger(n));
        if (!ids.length) return res.status(400).json({ error: 'IDs invalidos' });

        const idsStr = ids.join(',');
        const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({ comision_pagada: true })
        });
        if (!upR.ok) {
          const txt = await upR.text();
          return res.status(500).json({ error: 'Error actualizando: ' + txt });
        }
        return res.json({ ok: true, marcados: ids.length });
      }

      if (action === 'marcar_codigo_pagado' && body.codigo) {
        // Marcar TODOS los pagos pendientes de un código como pagados
        const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(body.codigo)}&comision_pagada=eq.false`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({ comision_pagada: true })
        });
        if (!upR.ok) {
          const txt = await upR.text();
          return res.status(500).json({ error: 'Error actualizando: ' + txt });
        }
        return res.json({ ok: true, codigo: body.codigo });
      }

      return res.status(400).json({ error: 'Accion desconocida' });
    }

    // Buscar si es afiliado
    const afR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?tienda_id=eq.${encodeURIComponent(tiendaId)}&select=*&limit=1`, {
      headers: sbHeaders
    });
    const afiliadosArr = await afR.json();
    const miAfiliado = afiliadosArr[0] || null;

    // Si NO es admin NI afiliado → no tiene acceso
    if (!isAdmin && !miAfiliado) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // ═══ 3. ADMIN: ver todos los afiliados y sus comisiones ═══
    if (isAdmin) {
      const allAfR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?activo=eq.true&order=created_at.desc&select=*`, {
        headers: sbHeaders
      });
      const allAfiliados = await allAfR.json();

      const allPagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?order=created_at.desc&select=*`, {
        headers: sbHeaders
      });
      const allPagos = await allPagosR.json();

      const porCodigo = {};
      for (const p of allPagos) {
        const codigo = p.codigo_referido;
        if (!codigo) continue;
        if (!porCodigo[codigo]) {
          porCodigo[codigo] = {
            pagos: [],
            total_comisiones: 0,
            comisiones_pagadas: 0,
            comisiones_pendientes: 0,
            num_pagos: 0
          };
        }
        porCodigo[codigo].pagos.push(p);
        porCodigo[codigo].total_comisiones += parseFloat(p.comision_monto || 0);
        if (p.comision_pagada) {
          porCodigo[codigo].comisiones_pagadas += parseFloat(p.comision_monto || 0);
        } else {
          porCodigo[codigo].comisiones_pendientes += parseFloat(p.comision_monto || 0);
        }
        porCodigo[codigo].num_pagos++;
      }

      const referidosPorCodigo = {};
      for (const p of allPagos) {
        const codigo = p.codigo_referido;
        if (!codigo) continue;
        if (!referidosPorCodigo[codigo]) referidosPorCodigo[codigo] = new Set();
        referidosPorCodigo[codigo].add(p.tienda_id);
      }

      const afiliadosConStats = allAfiliados.map(af => {
        const stats = porCodigo[af.codigo] || {total_comisiones:0, comisiones_pagadas:0, comisiones_pendientes:0, num_pagos:0};
        const referidos = referidosPorCodigo[af.codigo] ? referidosPorCodigo[af.codigo].size : 0;
        return {
          codigo: af.codigo,
          nombre: af.nombre,
          email: af.email,
          comision_pct: af.comision_pct,
          num_referidos: referidos,
          num_pagos: stats.num_pagos,
          total_comisiones: +stats.total_comisiones.toFixed(2),
          comisiones_pagadas: +stats.comisiones_pagadas.toFixed(2),
          comisiones_pendientes: +stats.comisiones_pendientes.toFixed(2)
        };
      });

      const totalComisiones = afiliadosConStats.reduce((s, a) => s + a.total_comisiones, 0);
      const totalPagadas = afiliadosConStats.reduce((s, a) => s + a.comisiones_pagadas, 0);
      const totalPendientes = afiliadosConStats.reduce((s, a) => s + a.comisiones_pendientes, 0);
      const totalReferidos = afiliadosConStats.reduce((s, a) => s + a.num_referidos, 0);

      return res.json({
        modo: 'admin',
        resumen: {
          num_afiliados: allAfiliados.length,
          num_referidos: totalReferidos,
          total_comisiones: +totalComisiones.toFixed(2),
          comisiones_pagadas: +totalPagadas.toFixed(2),
          comisiones_pendientes: +totalPendientes.toFixed(2)
        },
        afiliados: afiliadosConStats,
        pagos: allPagos
      });
    }

    // ═══ 4. AFILIADO normal: ver solo sus comisiones ═══
    const codigo = miAfiliado.codigo;

    const pagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(codigo)}&order=created_at.desc&select=*`, {
      headers: sbHeaders
    });
    const pagos = await pagosR.json();

    const totalComisiones = pagos.reduce((s, p) => s + parseFloat(p.comision_monto || 0), 0);
    const comisionesPagadas = pagos.filter(p => p.comision_pagada).reduce((s, p) => s + parseFloat(p.comision_monto || 0), 0);
    const comisionesPendientes = totalComisiones - comisionesPagadas;

    const referidos = new Set(pagos.map(p => p.tienda_id));

    let tiendasReferidas = [];
    if (referidos.size > 0) {
      const ids = Array.from(referidos).map(id => `"${id}"`).join(',');
      const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=in.(${ids})&select=id,nombre,plan,plan_status,created_at:creado_en`, {
        headers: sbHeaders
      });
      tiendasReferidas = await tR.json();
    }

    return res.json({
      modo: 'afiliado',
      mi_codigo: codigo,
      mi_comision_pct: miAfiliado.comision_pct,
      resumen: {
        num_referidos: referidos.size,
        num_pagos: pagos.length,
        total_comisiones: +totalComisiones.toFixed(2),
        comisiones_pagadas: +comisionesPagadas.toFixed(2),
        comisiones_pendientes: +comisionesPendientes.toFixed(2)
      },
      tiendas_referidas: tiendasReferidas,
      pagos: pagos
    });

  } catch (e) {
    console.error('Error comisiones:', e);
    return res.status(500).json({ error: 'Error servidor' });
  }
}
