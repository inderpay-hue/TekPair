export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const usuarios = await r.json();
    
    if (!usuarios.length) return res.json({ error: 'Usuario no encontrado' });
    
    const u = usuarios[0];
    
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (u.password_hash !== hash) return res.json({ error: 'Contrasena incorrecta' });

    const rt = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${u.tienda_id}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const tiendas = await rt.json();
    const tienda = tiendas[0] || { id: u.tienda_id, nombre: 'Mi Tienda' };

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    await fetch(`${SUPABASE_URL}/rest/v1/sesiones`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
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
      sb_key: SUPABASE_KEY,
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
      plan: 'pro'
    });

  } catch(e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
