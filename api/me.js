// api/me.js
// Devuelve plan + estado actualizado del usuario logueado.
// Llamar al cargar dashboard y cada cierto tiempo para refrescar.

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Token desde body o header
  const token = (req.body && req.body.token) || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // 1. Validar sesión
    const sR = await fetch(`${SUPABASE_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=usuario_id,tienda_id,expires_at&limit=1`, {
      headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`}
    });
    const sesiones = await sR.json();
    if (!sesiones.length) return res.status(401).json({ error: 'Sesión inválida' });
    const sess = sesiones[0];
    if (sess.expires_at && new Date(sess.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Sesión caducada' });
    }

    // 2. Cargar tienda completa con plan
    const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(sess.tienda_id)}&select=*`, {
      headers: {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`}
    });
    const tiendas = await tR.json();
    if (!tiendas.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    const t = tiendas[0];

    // 3. Calcular días restantes de trial / próximo cobro
    // Usamos floor (no ceil) para que 14.99 días = 14, no 15
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
