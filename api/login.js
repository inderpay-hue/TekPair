// api/login.js
// Backend de login de Tekpair

const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'tekpair_salt_2025').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function supabaseQuery(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: `/rest/v1/${path}`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function supabaseInsert(table, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL);
    const body = JSON.stringify(data);
    const options = {
      hostname: url.hostname,
      path: `/rest/v1/${table}`,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'return=representation'
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseData) }); }
        catch(e) { resolve({ status: res.statusCode, data: responseData }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña obligatorios' });
    }

    // BUSCAR USUARIO
    const result = await supabaseQuery(
      `usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&limit=1`
    );

    if (!result.data || result.data.length === 0) {
      return res.status(401).json({ ok: false, error: 'Email no encontrado' });
    }

    const usuario = result.data[0];
    const passwordHash = hashPassword(password);

    if (usuario.password_hash !== passwordHash) {
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }

    // OBTENER TIENDA Y SUSCRIPCIÓN
    const tiendaResult = await supabaseQuery(
      `tiendas?usuario_id=eq.${usuario.id}&limit=1`
    );
    const tienda = tiendaResult.data && tiendaResult.data[0];

    const suscResult = await supabaseQuery(
      `suscripciones?usuario_id=eq.${usuario.id}&limit=1`
    );
    const suscripcion = suscResult.data && suscResult.data[0];

    // VERIFICAR SUSCRIPCIÓN ACTIVA
    if (suscripcion) {
      const ahora = new Date();
      const trialFin = new Date(suscripcion.trial_fin);
      if (suscripcion.estado === 'trial' && ahora > trialFin) {
        return res.status(403).json({
          ok: false,
          error: 'Tu periodo de prueba ha expirado. Activa tu suscripción para continuar.',
          expired: true
        });
      }
      if (suscripcion.estado === 'cancelado') {
        return res.status(403).json({
          ok: false,
          error: 'Tu suscripción está cancelada.',
          cancelled: true
        });
      }
    }

    // CREAR SESIÓN
    const token = generateToken();
    await supabaseInsert('sesiones', {
      usuario_id: usuario.id,
      token,
      expira_en: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    return res.status(200).json({
      ok: true,
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email
      },
      tienda: tienda ? { id: tienda.id, nombre: tienda.nombre } : null,
      plan: suscripcion ? suscripcion.plan : null,
      trial_fin: suscripcion ? suscripcion.trial_fin : null
    });

  } catch(error) {
    console.error('Error en login:', error);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
