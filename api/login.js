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
import bcrypt from 'bcryptjs';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ═══ MIGRACIÓN BCRYPT (suave) ═══
// Estrategia: la tabla `usuarios` tiene 2 columnas de hash:
//   - password_hash      : SHA-256 legacy (lo que había hasta hoy)
//   - password_hash_v2   : bcrypt (cost 10) — el nuevo formato
//
// Al login: si v2 existe, comparar con bcrypt. Si NO existe pero v1 sí,
// verificar con SHA-256 y aprovechar para escribir v2 (migración silenciosa).
// Al cambiar/resetear password o crear cuenta nueva: escribir SOLO v2 y
// borrar v1 para que la cuenta quede definitivamente migrada.

const BCRYPT_ROUNDS = 10;

async function generarHashBcrypt(plainPwd) {
  return await bcrypt.hash(plainPwd, BCRYPT_ROUNDS);
}

// Verifica una contraseña en plano contra el usuario, soportando ambos formatos.
// Devuelve { ok: bool, necesitaMigracion: bool }
async function verificarPassword(usuario, plainPwd) {
  // Si tiene v2, esa es la fuente de verdad
  if (usuario.password_hash_v2) {
    try {
      const ok = await bcrypt.compare(plainPwd, usuario.password_hash_v2);
      return { ok, necesitaMigracion: false };
    } catch (e) {
      console.error('bcrypt.compare error:', e);
      return { ok: false, necesitaMigracion: false };
    }
  }
  // Si solo tiene v1 (cuenta no migrada), comparar con SHA-256
  if (usuario.password_hash) {
    const ok = usuario.password_hash === sha256(plainPwd);
    return { ok, necesitaMigracion: ok };  // migrar solo si el login fue correcto
  }
  return { ok: false, necesitaMigracion: false };
}

// Llamar tras login exitoso con v1 para escribir v2 silenciosamente
async function migrarUsuarioABcrypt(SB_URL, SK, usuarioId, plainPwd) {
  try {
    const hashV2 = await generarHashBcrypt(plainPwd);
    await fetch(`${SB_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuarioId)}`, {
      method: 'PATCH',
      headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ password_hash_v2: hashV2 })
    });
    console.log('Usuario migrado a bcrypt:', usuarioId);
  } catch (e) {
    // No bloqueante: el login ya fue exitoso, la migración puede esperar al próximo login
    console.warn('No se pudo migrar usuario a bcrypt:', e);
  }
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

    // FIX L1: exigir sesión válida antes de cambiar contraseña.
    // Sin esto, cualquiera con email + password_actual (p.ej. tras phishing) podía
    // cambiar la contraseña desde cualquier IP sin haber hecho login.
    const sessionToken = req.headers.authorization?.replace('Bearer ', '') || req.body?.session_token;
    if (!sessionToken) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    try {
      // Validar sesión: existe, no caducada, y pertenece al usuario que pide el cambio
      const sR = await fetch(
        `${SB_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(sessionToken)}&select=usuario_id,expires_at&limit=1`,
        { headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}` } }
      );
      const sesiones = await sR.json();
      if (!sesiones.length) {
        return res.status(401).json({ error: 'Sesión inválida' });
      }
      const sess = sesiones[0];
      if (sess.expires_at && new Date(sess.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Sesión caducada' });
      }

      const rcp = await fetch(
        `${SB_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(cpEmail)}&activo=eq.true&select=*`,
        { headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}` } }
      );
      const usuariosCp = await rcp.json();
      if (!usuariosCp.length) return res.json({ error: 'Usuario no encontrado' });

      const ucp = usuariosCp[0];

      // FIX L1 (continuación): la sesión debe ser DEL MISMO usuario que el del email
      // Sin esto, alguien con su propia sesión válida podría cambiar la contraseña de otro usuario
      if (sess.usuario_id !== ucp.id) {
        return res.status(403).json({ error: 'La sesión no corresponde a este usuario' });
      }

      // Verificar contraseña actual (soporta v1 y v2)
      const checkActual = await verificarPassword(ucp, password_actual);
      if (!checkActual.ok) {
        return res.json({ error: 'La contraseña actual no es correcta' });
      }
      // Comprobar que la nueva sea distinta
      const checkNuevaIgual = await verificarPassword(ucp, password_nueva);
      if (checkNuevaIgual.ok) {
        return res.json({ error: 'La nueva contraseña no puede ser igual a la actual' });
      }

      // Generar bcrypt (v2) y eliminar v1
      const hashV2 = await generarHashBcrypt(password_nueva);
      const upcp = await fetch(
        `${SB_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(ucp.id)}`,
        {
          method: 'PATCH',
          headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password_hash_v2: hashV2,
            password_hash: null  // borrar v1 — la cuenta queda definitivamente migrada
          })
        }
      );
      if (!upcp.ok) {
        console.error('Error actualizando contraseña:', await upcp.text());
        return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
      }

      // FIX L7: invalidar TODAS las sesiones del usuario excepto la actual,
      // por si la contraseña se cambió porque sospechaban robo.
      // Las otras sesiones quedan inutilizadas, el usuario tiene que volver a loguearse.
      try {
        await fetch(
          `${SB_URL}/rest/v1/sesiones?usuario_id=eq.${encodeURIComponent(ucp.id)}&token=neq.${encodeURIComponent(sessionToken)}`,
          {
            method: 'DELETE',
            headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Prefer': 'return=minimal' }
          }
        );
      } catch (e) {
        // No bloqueante: si falla la limpieza de sesiones, el cambio de password ya está hecho
        console.warn('No se pudieron invalidar sesiones tras cambio password:', e);
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
            password_hash_v2: await generarHashBcrypt(password_nueva),
            password_hash: null,  // borrar v1 tras reset
            reset_token: null,
            reset_expira: null
          })
        }
      );
      if (!ups.ok) {
        console.error('Error en reset:', await ups.text());
        return res.status(500).json({ error: 'No se pudo restablecer la contraseña' });
      }

      // FIX L7: tras reset (típicamente porque la contraseña se filtró),
      // invalidar TODAS las sesiones del usuario para forzar nuevo login en todos los dispositivos.
      try {
        await fetch(
          `${SB_URL}/rest/v1/sesiones?usuario_id=eq.${encodeURIComponent(urs.id)}`,
          {
            method: 'DELETE',
            headers: { 'apikey': SK, 'Authorization': `Bearer ${SK}`, 'Prefer': 'return=minimal' }
          }
        );
      } catch (e) {
        console.warn('No se pudieron invalidar sesiones tras reset:', e);
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

    // FIX L3: SIEMPRE verificamos aunque el usuario no exista (anti-timing-attack)
    // y devolvemos el mismo mensaje en ambos casos (anti-enumeración de emails).
    const u = usuarios[0];

    // verificarPassword soporta v1 (SHA-256 legacy) y v2 (bcrypt).
    // Si solo hay v1 pero el login es correcto, devuelve necesitaMigracion=true.
    let resultado = { ok: false, necesitaMigracion: false };
    if (u) {
      resultado = await verificarPassword(u, password);
    } else {
      // Hashear-comparar dummy para que el tiempo total sea similar al caso "usuario existe"
      // Sin esto, un atacante puede medir y enumerar emails registrados.
      await bcrypt.compare(password, '$2a$10$CwTycUXWue0Thq9StjUM0uJ8N6F6IZWuJ3qd0u3KZGBRpQK/qK1Au').catch(()=>{});
    }

    if (!resultado.ok) {
      return res.json({ error: 'Email o contraseña incorrectos' });
    }

    // MIGRACIÓN SILENCIOSA: si la cuenta usa SHA-256 (v1), escribir bcrypt (v2)
    // en segundo plano. No bloquea la respuesta al usuario.
    if (resultado.necesitaMigracion) {
      migrarUsuarioABcrypt(SUPABASE_URL, SERVICE_KEY, u.id, password).catch(()=>{});
    }

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
