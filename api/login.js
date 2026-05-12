// api/login.js
// Login con email + password. Devuelve JWT firmado con tienda_id como claim.
// VERSIÓN PRO: NO devuelve SERVICE_KEY al frontend (más seguro)

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

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
    // 1. Buscar usuario activo por email (usa SERVICE_KEY server-side, nunca expuesta)
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

    // 7. NUEVO: Generar JWT firmado con tienda_id (esto es lo que valida RLS)
    const expSeconds = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 días
    const userJWT = jwt.sign(
      {
        sub: u.id,                 // user id
        tienda_id: u.tienda_id,    // claim que RLS validara
        role: 'authenticated',
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
      token,                       // token de sesión (sistema antiguo, compatibilidad)
      sb_key: SUPABASE_ANON_KEY,   // AHORA solo ANON_KEY (no SERVICE_KEY)
      jwt_token: userJWT,          // NUEVO: JWT firmado para Authorization header
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
