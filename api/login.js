// api/login.js
// Login con email + password. Devuelve sesión + plan real de la tienda.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_KEY;

  try {
    // 1. Buscar usuario activo por email
    const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&select=*`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    const usuarios = await r.json();
    if (!usuarios.length) return res.json({ error: 'Usuario no encontrado' });

    const u = usuarios[0];

    // 2. Verificar contraseña (sha256 simple)
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    if (u.password_hash !== hash) return res.json({ error: 'Contraseña incorrecta' });

    // 3. Cargar tienda CON el plan
    const rt = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${u.tienda_id}&select=*`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    const tiendas = await rt.json();
    const tienda = tiendas[0] || { id: u.tienda_id, nombre: 'Mi Tienda' };

    // 4. Determinar plan + estado real
    const plan = tienda.plan || 'basico';
    const planStatus = tienda.plan_status || 'trial';
    const planUntil = tienda.plan_until || null;
    const trialUntil = tienda.trial_until || null;

    // 5. Verificar si la suscripción está activa o si el trial expiró
    let accessAllowed = true;
    if (planStatus === 'cancelled') {
      // Si está cancelada pero todavía no llegó a la fecha final, permitir
      if (planUntil && new Date(planUntil) < new Date()) accessAllowed = false;
    }
    if (planStatus === 'past_due') {
      // Permitir 7 días de gracia tras pago fallido
      if (planUntil && new Date(planUntil) < new Date(Date.now() - 7*86400000)) accessAllowed = false;
    }
    if (!accessAllowed) {
      return res.json({ error: 'Tu suscripción ha expirado. Renuévala desde tekpair.tech', plan_expired: true });
    }

    // 6. Crear sesión
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/sesiones`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ses_' + Date.now(),
        usuario_id: u.id,
        tienda_id: u.tienda_id,
        token,
        expires_at: expires
      })
    });

    return res.json({
      ok: true,
      token,
      sb_key: SERVICE_KEY,
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
      // ← PLAN REAL desde tiendas (antes estaba hardcoded 'pro')
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
