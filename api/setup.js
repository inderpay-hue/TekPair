export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { nombre, email, password, tienda_nombre } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan datos' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const crypto = require('crypto');

  try {
    const check = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const existing = await check.json();
    if (existing.length) return res.json({ error: 'Email ya registrado' });

    const tienda_id = 'tienda_' + Date.now();
    await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tienda_id, nombre: tienda_nombre || nombre + ' - Tienda' })
    });

    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const usuario_id = 'usr_' + Date.now();
    await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: usuario_id,
        tienda_id,
        nombre,
        email,
        password_hash: hash,
        rol: 'admin',
        activo: true,
        permisos: { todo: true }
      })
    });

    return res.json({ ok: true, tienda_id, usuario_id });

  } catch(e) {
    console.error('Setup error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
