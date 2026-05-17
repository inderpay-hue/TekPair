// api/cambiar-password.js
// Cambio de contraseña para un usuario ya autenticado.
// Recibe email + contraseña actual + contraseña nueva.
// Valida la actual contra password_hash (sha256) y guarda la nueva.

import crypto from 'crypto';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password_actual, password_nueva } = req.body || {};

  if (!email || !password_actual || !password_nueva) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  if (String(password_nueva).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Variables de Supabase no configuradas');
    return res.status(500).json({ error: 'Configuración de servidor incompleta' });
  }

  try {
    // 1. Buscar usuario activo por email
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&select=*`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    const usuarios = await r.json();
    if (!usuarios.length) return res.json({ error: 'Usuario no encontrado' });

    const u = usuarios[0];

    // 2. Verificar la contraseña actual
    if (u.password_hash !== sha256(password_actual)) {
      return res.json({ error: 'La contraseña actual no es correcta' });
    }

    // 3. Evitar que la nueva sea igual a la actual
    const nuevoHash = sha256(password_nueva);
    if (nuevoHash === u.password_hash) {
      return res.json({ error: 'La nueva contraseña no puede ser igual a la actual' });
    }

    // 4. Actualizar el hash
    const up = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(u.id)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password_hash: nuevoHash })
      }
    );

    if (!up.ok) {
      console.error('Error actualizando contraseña:', await up.text());
      return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
    }

    return res.json({ ok: true });

  } catch (e) {
    console.error('cambiar-password error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
