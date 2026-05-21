// api/login.js
// =====================================================
// Endpoint multi-acción para sesión y cuenta de usuario.
// Acciones soportadas en req.body.action:
//   - 'cambiar-password' : cambia contraseña (usuario logueado)
//   - 'solicitar-reset'  : genera token de recuperación + email
//   - 'reset'            : restablece contraseña usando token
//   - 'me'               : devuelve plan/estado actuales (antes /api/me)
//   - (sin action)       : login con email + password (devuelve JWT)
//
// CAMBIOS v2 (22/05/2026):
//   - Fusionado api/me.js como ?action=me (libera 1 slot Vercel)
//   - JWT firmado ahora incluye email + rol además de tienda_id
//     (necesario para chequeos de admin en /api/cajas y otros)
// =====================================================

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function enviarEmailReset(email, nombre, enlace) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) { console.error('RESEND_API_KEY no configurada'); return; }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Tekpair <hola@tekpair.tech>',
        to: email,
        subject: 'Restablece tu contraseña de TekPair',
        html: `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f7f9fc;margin:0;padding:0">
<div style="max-width:520px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#0F172A;padding:28px;text-align:center">
    <div style="font-size:22px;font-weight:800;color:white">&#9889; TekPair</div>
  </div>
  <div style="padding:32px">
    <p style="font-size:16px;color:#333">Hola${nombre ? ' ' + nombre : ''},</p>
    <p style="color:#666;line-height:1.6">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta. Pulsa el botón para crear una nueva:</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${enlace}" style="background:#10B981;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Restablecer contraseña</a>
    </div>
    <p style="color:#999;font-size:13px;line-height:1.6">Este enlace caduca en <strong>1 hora</strong>. Si no has solicitado este cambio, puedes ignorar este email: tu contraseña no se modificará.</p>
    <div style="border-top:1px solid #eee;padding-top:16px;margin-top:16px">
      <p style="color:#999;font-size:12px;margin:0">TekPair &middot; tekpair.tech</p>
    </div>
  </div>
</div>
</body></html>`
      })
    });
  } catch (e) {
    console.error('Error enviando email de reset:', e);
  }
}

export default async function handler(req, res) {
  const SB_URL = process.env.SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;

  // ───────── Acción: me (antes /api/me) ─────────
  // Acepta GET o POST. Token desde Authorization o body.token
  const actionQuery = req.query?.action;
  const actionBody = req.body?.action;
  const action = actionBody || actionQuery;

  if (action === 'me') {
    if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

    const token = (req.body && req.body.token) || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    if (!SB_URL || !SK) {
      return res.status(500).json({ error: 'Configuración de servidor incompleta' });
    }

    try {
      // 1. Validar sesión
      const sR = await fetch(`${SB_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=usuario_id,tienda_id,expires_at&limit=1`, {
        headers: {'apikey': SK, 'Authorization': `Bearer ${SK}`}
      });
      const sesiones = await sR.json();
      if (!sesiones.length) return res.status(401).json({ error: 'Sesión inválida' });
      const sess = sesiones[0];
      if (sess.expires_at && new Date(sess.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Sesión caducada' });
      }

      // 2. Cargar tienda completa con plan
      const tR = await fetch(`${SB_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(sess.tienda_id)}&select=*`, {
        headers: {'apikey': SK, 'Authorization': `Bearer ${SK}`}
      });
      const tiendas = await tR.json();
      if (!tiendas.length) return res.status(404).json({ error: 'Tienda no encontrada' });
      const t = tiendas[0];

      // 3. Calcular días restantes de trial / próximo cobro
      let diasRestantes = null;
      if (t.plan_status === 'trial' && t.trial_until) {
        const ms = new Date(t.trial_until) - new Date();
        diasRestantes = Math.max(0, Math.floor(ms / 86400000));
      } else if (t.plan_until) {
        const ms = new Date(t.plan_until) - new Date();
        diasRestantes = Math.max(0, Math.floor(ms / 86400000));
      }

      return res.json({
        ok: true,
        plan: t.plan || 'basico',
        plan_status: t.plan_status || 'trial',
        plan_until: t.plan_until,
        trial_until: t.trial_until,
        dias_restantes: diasRestantes,
        tiene_stripe: !!t.stripe_customer_id,
        tienda_id: t.id,
        tienda_nombre: t.nombre
      });

    } catch(e) {
      console.error('Me error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }


  // El resto de acciones requieren POST
  if (req.method !== 'POST') return res.status(405).end();

  // ───────── Acción: cambiar contraseña ─────────
  if (action === 'cambiar-password') {
    const { email: cpEmail, password_actual, password_nueva } = req.body;

    if (!cpEmail || !password_actual || !password_nueva) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    if (String(password_nueva).length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    if (!SB_URL || !SK) {
      return res.status(500).json({ error: 'Configuración de servidor incompleta' });
    }

    try {
      const rcp = await fetch(
        `${SB_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(cpEmail)}&activo=eq.true&select=*`,
        { headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}` } }
      );
      const usuariosCp = await rcp.json();
      if (!usuariosCp.length) return res.json({ error: 'Usuario no encontrado' });

      const ucp = usuariosCp[0];
      if (ucp.password_hash !== sha256(password_actual)) {
        return res.json({ error: 'La contraseña actual no es correcta' });
      }
      const hashNuevo = sha256(password_nueva);
      if (hashNuevo === ucp.password_hash) {
        return res.json({ error: 'La nueva contraseña no puede ser igual a la actual' });
      }

      const upcp = await fetch(
        `${SB_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(ucp.id)}`,
        {
          method: 'PATCH',
          headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password_hash: hashNuevo })
        }
      );
      if (!upcp.ok) {
        console.error('Error actualizando contraseña:', await upcp.text());
        return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('cambiar-password error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }

  // ───────── Acción: solicitar recuperación de contraseña ─────────
  if (action === 'solicitar-reset') {
    const { email: srEmail } = req.body;
    if (!srEmail) return res.status(400).json({ error: 'Falta el email' });
    if (!SB_URL || !SK) {
      return res.status(500).json({ error: 'Configuración de servidor incompleta' });
    }

    try {
      const rsr = await fetch(
        `${SB_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(srEmail)}&activo=eq.true&select=*`,
        { headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}` } }
      );
      const usuariosSr = await rsr.json();

      // Por seguridad, respondemos ok exista o no el email (no revelar cuentas)
      if (usuariosSr.length) {
        const usr = usuariosSr[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expira = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

        await fetch(
          `${SB_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(usr.id)}`,
          {
            method: 'PATCH',
            headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reset_token: token, reset_expira: expira })
          }
        );

        const enlace = `https://tekpair.tech/reset.html?token=${token}`;
        await enviarEmailReset(usr.email, usr.nombre, enlace);
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('solicitar-reset error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }

  // ───────── Acción: restablecer contraseña con token ─────────
  if (action === 'reset') {
    const { token, password_nueva } = req.body;
    if (!token || !password_nueva) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    if (String(password_nueva).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (!SB_URL || !SK) {
      return res.status(500).json({ error: 'Configuración de servidor incompleta' });
    }

    try {
      const rrs = await fetch(
        `${SB_URL}/rest/v1/usuarios?reset_token=eq.${encodeURIComponent(token)}&select=*`,
        { headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}` } }
      );
      const usuariosRs = await rrs.json();
      if (!usuariosRs.length) {
        return res.json({ error: 'El enlace no es válido. Solicita uno nuevo.' });
      }

      const urs = usuariosRs[0];
      if (!urs.reset_expira || new Date(urs.reset_expira) < new Date()) {
        return res.json({ error: 'El enlace ha caducado. Solicita uno nuevo.' });
      }

      const ups = await fetch(
        `${SB_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(urs.id)}`,
        {
          method: 'PATCH',
          headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password_hash: sha256(password_nueva),
            reset_token: null,
            reset_expira: null
          })
        }
      );
      if (!ups.ok) {
        console.error('Error en reset:', await ups.text());
        return res.status(500).json({ error: 'No se pudo restablecer la contraseña' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('reset error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }

  // ───────── Login normal ─────────
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

  if (!JWT_SECRET) {
    console.error('SUPABASE_JWT_SECRET no configurado');
    return res.status(500).json({ error: 'Configuración de servidor incompleta' });
  }

  try {
    // 1. Buscar usuario activo por email
    const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&select=*`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    const usuarios = await r.json();
    if (!usuarios.length) return res.json({ error: 'Usuario no encontrado' });

    const u = usuarios[0];

    // 2. Verificar contraseña (sha256)
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    if (u.password_hash !== hash) return res.json({ error: 'Contraseña incorrecta' });

    // 3. Cargar tienda CON el plan
    const rt = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${u.tienda_id}&select=*`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    const tiendas = await rt.json();
    const tienda = tiendas[0] || { id: u.tienda_id, nombre: 'Mi Tienda' };

    // 4. Plan + estado real
    const plan = tienda.plan || 'basico';
    const planStatus = tienda.plan_status || 'trial';
    const planUntil = tienda.plan_until || null;
    const trialUntil = tienda.trial_until || null;

    // 5. Verificar suscripción activa
    let accessAllowed = true;
    if (planStatus === 'cancelled') {
      if (planUntil && new Date(planUntil) < new Date()) accessAllowed = false;
    }
    if (planStatus === 'past_due') {
      if (planUntil && new Date(planUntil) < new Date(Date.now() - 7*86400000)) accessAllowed = false;
    }
    if (!accessAllowed) {
      return res.json({ error: 'Tu suscripción ha expirado. Renuévala desde tekpair.tech', plan_expired: true });
    }

    // 6. Crear sesión en BD (sistema actual, sigue funcionando)
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = crypto.randomUUID();
    await fetch(`${SUPABASE_URL}/rest/v1/sesiones`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: sessionId,
        usuario_id: u.id,
        tienda_id: u.tienda_id,
        token,
        expires_at: expires
      })
    });

    // 7. Generar JWT firmado con claims completos (tienda_id + email + rol)
    //    Necesarios para chequeos en endpoints como /api/cajas
    const expSeconds = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 días
    const userJWT = jwt.sign(
      {
        sub: u.id,
        tienda_id: u.tienda_id,
        email: u.email,
        rol: u.rol || 'empleado',
        role: 'authenticated',      // requerido por Supabase RLS
        aud: 'authenticated',
        iss: 'tekpair',
        iat: Math.floor(Date.now() / 1000),
        exp: expSeconds
      },
      JWT_SECRET,
      { algorithm: 'HS256' }
    );

    // 8. Respuesta al frontend
    return res.json({
      ok: true,
      token,
      sb_key: SUPABASE_ANON_KEY,
      jwt_token: userJWT,
      tienda_id: u.tienda_id,
      usuario: {
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        rol: u.rol,
        permisos: u.permisos,
        tienda_id: u.tienda_id
      },
      tienda: {
        id: tienda.id,
        nombre: tienda.nombre
      },
      plan: plan,
      plan_status: planStatus,
      plan_until: planUntil,
      trial_until: trialUntil
    });

  } catch(e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
