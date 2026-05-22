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
        const ids = body.ids.filter(n => Number.isInteger(n));
        if (!ids.length) return res.status(400).json({ error: 'IDs invalidos' });

        // Verificar que todos estan en estado disponible
        const idsStr = ids.join(',');
        const checkR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})&select=id,estado_comision`, {
          headers: sbHeaders
        });
        const checkArr = await checkR.json();
        const noDisp = checkArr.filter(p => p.estado_comision !== 'disponible');
        if (noDisp.length) {
          return res.status(400).json({ error: 'Hay comisiones no disponibles para pagar' });
        }

        // Generar numero de justificante correlativo JUST-YYYY-XXX
        const year = new Date().getFullYear();
        const cntR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?justificante_numero=like.JUST-${year}-*&select=justificante_numero&order=justificante_numero.desc&limit=1`, {
          headers: sbHeaders
        });
        const cntArr = await cntR.json();
        let nextNum = 1;
        if (cntArr[0] && cntArr[0].justificante_numero) {
          const m = cntArr[0].justificante_numero.match(/JUST-\d{4}-(\d+)/);
          if (m) nextNum = parseInt(m[1]) + 1;
        }
        const justificante = 'JUST-' + year + '-' + String(nextNum).padStart(3,'0');
        const fechaPago = body.fecha_pago || new Date().toISOString();

        const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({
            comision_pagada: true,
            estado_comision: 'pagada',
            fecha_pago: fechaPago,
            justificante_numero: justificante
          })
        });
        if (!upR.ok) {
          const txt = await upR.text();
          return res.status(500).json({ error: 'Error actualizando: ' + txt });
        }
        return res.json({ ok: true, marcados: ids.length, justificante_numero: justificante, fecha_pago: fechaPago });
      }

      if (action === 'marcar_codigo_pagado' && body.codigo) {
        // Solo los que esten en estado disponible
        const listR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(body.codigo)}&estado_comision=eq.disponible&select=id`, {
          headers: sbHeaders
        });
        const listArr = await listR.json();
        if (!listArr.length) {
          return res.status(400).json({ error: 'No hay comisiones disponibles para pagar' });
        }

        const year = new Date().getFullYear();
        const cntR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?justificante_numero=like.JUST-${year}-*&select=justificante_numero&order=justificante_numero.desc&limit=1`, {
          headers: sbHeaders
        });
        const cntArr = await cntR.json();
        let nextNum = 1;
        if (cntArr[0] && cntArr[0].justificante_numero) {
          const m = cntArr[0].justificante_numero.match(/JUST-\d{4}-(\d+)/);
          if (m) nextNum = parseInt(m[1]) + 1;
        }
        const justificante = 'JUST-' + year + '-' + String(nextNum).padStart(3,'0');
        const fechaPago = body.fecha_pago || new Date().toISOString();
        const ids = listArr.map(p => p.id);
        const idsStr = ids.join(',');

        const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({
            comision_pagada: true,
            estado_comision: 'pagada',
            fecha_pago: fechaPago,
            justificante_numero: justificante
          })
        });
        if (!upR.ok) {
          const txt = await upR.text();
          return res.status(500).json({ error: 'Error actualizando: ' + txt });
        }
        return res.json({ ok: true, codigo: body.codigo, marcados: ids.length, justificante_numero: justificante, fecha_pago: fechaPago });
      }

      // ═══ Crear cuenta del comercial (Paso 1 del wizard) ═══
      if (action === 'crear_cuenta_comercial') {
        const { codigo, nombre, email, comision_pct } = body;
        if (!codigo || !nombre || !email) return res.status(400).json({ error: 'Faltan datos obligatorios' });

        const codigoNorm = codigo.toUpperCase().trim();
        const emailNorm = email.toLowerCase().trim();

        // Verificar codigo unico en afiliados
        const dupAfR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigoNorm)}&select=codigo&limit=1`, { headers: sbHeaders });
        const dupAf = await dupAfR.json();
        if (dupAf.length) return res.status(400).json({ error: 'Ese codigo de afiliado ya existe' });

        // Verificar email unico en usuarios
        const dupUR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(emailNorm)}&select=email&limit=1`, { headers: sbHeaders });
        const dupU = await dupUR.json();
        if (dupU.length) return res.status(400).json({ error: 'Ese email ya tiene cuenta en TekPair' });

        // Generar password: codigo en minusculas + año actual
        const year = new Date().getFullYear();
        const passwordPlano = codigoNorm.toLowerCase() + year;
        // Hash sha256 sin salt (igual que register.js)
        const crypto = await import('crypto');
        const passwordHash = crypto.createHash('sha256').update(passwordPlano).digest('hex');

        // 1. Crear usuario
        const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
          method: 'POST',
          headers: {...sbHeaders, 'Prefer': 'return=representation'},
          body: JSON.stringify({
            nombre: nombre.trim(),
            email: emailNorm,
            password_hash: passwordHash,
            activo: true
          })
        });
        if (!uR.ok) {
          const t = await uR.text();
          return res.status(500).json({ error: 'Error creando usuario: ' + t });
        }
        const uArr = await uR.json();
        const nuevoUserId = uArr[0]?.id;
        if (!nuevoUserId) return res.status(500).json({ error: 'Usuario creado sin ID' });

        // 2. Crear tienda con plan TOP vitalicio
        const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
          method: 'POST',
          headers: {...sbHeaders, 'Prefer': 'return=representation'},
          body: JSON.stringify({
            usuario_id: nuevoUserId,
            nombre: codigoNorm + ' - Comercial',
            plan: 'premium',
            plan_status: 'active',
            plan_until: '2099-12-31T23:59:59Z'
          })
        });
        if (!tR.ok) {
          // Rollback: borrar usuario
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(nuevoUserId)}`, {
            method: 'DELETE',
            headers: sbHeaders
          });
          const t = await tR.text();
          return res.status(500).json({ error: 'Error creando tienda (revertido): ' + t });
        }
        const tArr = await tR.json();
        const nuevaTiendaId = tArr[0]?.id;

        // Vincular usuario con su tienda (fix bug Wizard)
        // login.js lee usuarios.tienda_id directamente para crear el JWT
        if (nuevaTiendaId) {
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(nuevoUserId)}`, {
            method: 'PATCH',
            headers: {...sbHeaders, 'Prefer': 'return=minimal'},
            body: JSON.stringify({ tienda_id: nuevaTiendaId })
          });
        }

        // Devolver datos al frontend para mostrar credenciales
        return res.json({
          ok: true,
          user_id: nuevoUserId,
          tienda_id: nuevaTiendaId,
          email: emailNorm,
          password: passwordPlano,
          codigo: codigoNorm,
          nombre: nombre.trim(),
          comision_pct: parseInt(comision_pct) || 20
        });
      }

      // ═══ Crear afiliado (también desde Paso 3 del wizard) ═══
      if (action === 'crear_afiliado') {
        const { codigo, nombre, email, comision_pct, tienda_id_comercial, password_plano, enviar_email } = body;
        if (!codigo || !nombre || !email) return res.status(400).json({ error: 'Faltan datos' });

        const codigoNorm = codigo.toUpperCase().trim();
        const emailNorm = email.toLowerCase().trim();
        const tiendaAfiliado = tienda_id_comercial || tiendaId;

        // Verificar codigo unico
        const existR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigoNorm)}&select=codigo&limit=1`, { headers: sbHeaders });
        const existArr = await existR.json();
        if (existArr.length) return res.status(400).json({ error: 'Ese codigo ya existe' });

        const inR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados`, {
          method: 'POST',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({
            codigo: codigoNorm,
            nombre: nombre.trim(),
            email: emailNorm,
            comision_pct: parseInt(comision_pct) || 20,
            activo: true,
            tienda_id: tiendaAfiliado
          })
        });
        if (!inR.ok) return res.status(500).json({ error: 'Error creando: ' + await inR.text() });

        // Enviar email de bienvenida si se solicita
        let emailEnviado = false;
        if (enviar_email && password_plano) {
          const RESEND_KEY = process.env.RESEND_API_KEY;
          if (RESEND_KEY) {
            const subject = 'Bienvenido al programa de afiliados de TekPair';
            const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;color:#0F172A">
<div style="background:linear-gradient(135deg,#0055FF,#10B981);color:white;padding:24px;border-radius:14px 14px 0 0">
  <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:.9">PROGRAMA DE AFILIADOS</div>
  <h1 style="margin:8px 0 0;font-size:26px;font-weight:800">Bienvenido al equipo, ${nombre.trim().split(' ')[0]}</h1>
</div>
<div style="background:white;border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 14px 14px">
  <p style="font-size:15px;line-height:1.6;color:#475569">Has sido dado de alta como comercial afiliado de <strong>TekPair</strong>. A partir de ahora, cada cliente que captes con tu código te dará una comisión recurrente.</p>

  <div style="background:#F8FAFC;border-radius:10px;padding:16px;margin:20px 0">
    <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:1px;margin-bottom:10px">TUS CREDENCIALES DE ACCESO</div>
    <div style="margin-bottom:8px"><strong style="color:#64748B;font-size:13px;display:inline-block;width:90px">Email:</strong> <span style="font-family:monospace;font-size:14px">${emailNorm}</span></div>
    <div><strong style="color:#64748B;font-size:13px;display:inline-block;width:90px">Contraseña:</strong> <span style="font-family:monospace;font-size:14px;background:#FEF3C7;padding:2px 8px;border-radius:4px">${password_plano}</span></div>
    <div style="font-size:12px;color:#94A3B8;margin-top:12px">Te recomendamos cambiar la contraseña al primer inicio de sesión.</div>
  </div>

  <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:16px;margin:20px 0">
    <div style="font-size:11px;font-weight:700;color:#10B981;letter-spacing:1px;margin-bottom:10px">TU CÓDIGO DE AFILIADO</div>
    <div style="font-size:28px;font-weight:800;color:#0F172A;letter-spacing:2px;font-family:monospace">${codigoNorm}</div>
    <div style="font-size:13px;color:#475569;margin-top:8px">Cuando un cliente lo use al suscribirse a TekPair, recibe 50% descuento durante 3 meses y tú cobras el <strong>${parseInt(comision_pct) || 20}%</strong> de comisión recurrente sobre cada pago.</div>
  </div>

  <p style="font-size:14px;line-height:1.6;color:#475569">Accede a tu panel en <a href="https://tekpair.tech/app.html" style="color:#0055FF;text-decoration:none;font-weight:700">tekpair.tech</a> para consultar tus comisiones, clientes captados e historial de cobros.</p>

  <div style="background:#F8FAFC;border-left:3px solid #94A3B8;border-radius:6px;padding:14px;margin-top:20px;font-size:12px;color:#475569;line-height:1.55">
    <div style="font-weight:700;color:#0F172A;margin-bottom:6px">📋 CONDICIONES DEL PROGRAMA</div>
    Este acuerdo de colaboración implica un compromiso de captación activa por tu parte. TekPair se reserva el derecho de modificar los porcentajes de comisión, ajustar las condiciones del programa o dar por finalizada la colaboración en caso de inactividad prolongada o si no se cumplen los objetivos de captación acordados. Cualquier cambio se te notificará con antelación razonable.
  </div>
  <p style="font-size:13px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:16px;margin-top:24px">Cualquier duda, escríbenos a <a href="mailto:info@tekpair.tech" style="color:#0055FF">info@tekpair.tech</a>.</p>
  <p style="font-size:13px;color:#94A3B8;margin-top:8px">Un saludo,<br><strong>Equipo TekPair</strong></p>
</div>
</body></html>`;
            try {
              const sendR = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: 'TekPair <info@tekpair.tech>',
                  to: [emailNorm],
                  subject: subject,
                  html: htmlBody
                })
              });
              emailEnviado = sendR.ok;
              if (!sendR.ok) console.error('Error enviando email:', await sendR.text());
            } catch (e) { console.error('Excepcion email:', e); }
          }
        }

        return res.json({ ok: true, email_enviado: emailEnviado });
      }

      // ═══ Editar afiliado ═══
      if (action === 'editar_afiliado') {
        const { codigo, nombre, email, comision_pct } = body;
        if (!codigo) return res.status(400).json({ error: 'Codigo obligatorio' });
        const update = {};
        if (nombre) update.nombre = nombre.trim();
        if (email) update.email = email.toLowerCase().trim();
        if (comision_pct !== undefined) update.comision_pct = parseInt(comision_pct);
        if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
        const upR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigo)}`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify(update)
        });
        if (!upR.ok) return res.status(500).json({ error: 'Error actualizando: ' + await upR.text() });
        return res.json({ ok: true });
      }

      // ═══ Eliminar afiliado ═══
      if (action === 'eliminar_afiliado') {
        const { codigo } = body;
        if (!codigo) return res.status(400).json({ error: 'Codigo obligatorio' });
        // Verificar que no tenga comisiones
        const pagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(codigo)}&select=id&limit=1`, { headers: sbHeaders });
        const pagosArr = await pagosR.json();
        if (pagosArr.length) return res.status(400).json({ error: 'No se puede eliminar: tiene comisiones registradas. Mejor desactivar.' });
        const delR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigo)}`, {
          method: 'DELETE',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'}
        });
        if (!delR.ok) return res.status(500).json({ error: 'Error eliminando: ' + await delR.text() });
        return res.json({ ok: true });
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

      const tiendaIdsConRef = [...new Set(allPagos.map(p => p.tienda_id).filter(Boolean))];
      let tiendasDetalle = {};
      if (tiendaIdsConRef.length) {
        const tIdsStr = tiendaIdsConRef.map(id => '"' + id + '"').join(',');
        const tDetailR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=in.(${encodeURIComponent(tIdsStr)})&select=id,nombre,plan,plan_status,creado_en,codigo_referido`, { headers: sbHeaders });
        const tDetailArr = await tDetailR.json();
        for (const t of (Array.isArray(tDetailArr) ? tDetailArr : [])) tiendasDetalle[t.id] = t;
      }

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

      const tiendasPorCodigo = {};
      for (const codigo of Object.keys(referidosPorCodigo)) {
        const tiendaIds = [...referidosPorCodigo[codigo]];
        tiendasPorCodigo[codigo] = tiendaIds.map(tid => {
          const det = tiendasDetalle[tid] || {};
          const facturado = allPagos.filter(p => p.tienda_id === tid && p.codigo_referido === codigo).reduce((s, p) => s + parseFloat(p.monto_neto || 0), 0);
          return {
            tienda_id: tid,
            nombre: det.nombre || 'Tienda sin nombre',
            plan: det.plan || '-',
            plan_status: det.plan_status || '-',
            fecha_captacion: det.creado_en || null,
            total_facturado: +facturado.toFixed(2)
          };
        });
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
          comisiones_pendientes: +stats.comisiones_pendientes.toFixed(2),
          tiendas_detalle: tiendasPorCodigo[af.codigo] || []
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
