// api/register.js
// Backend de registro de Tekpair
// Conecta formulario → Supabase + Stripe + Email

const https = require('https');
const crypto = require('crypto');

// ═══ CONFIGURACIÓN ═══
// Estas variables se configuran en Vercel → Settings → Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

// ═══ HELPERS ═══
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'tekpair_salt_2025').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function httpPost(hostname, path, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch(e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function supabaseInsert(table, data) {
  const url = new URL(SUPABASE_URL);
  const result = await httpPost(
    url.hostname,
    `/rest/v1/${table}`,
    data,
    {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    }
  );
  return result;
}

async function supabaseSelect(table, filter) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL);
    const path = `/rest/v1/${table}?${filter}&limit=1`;
    const options = {
      hostname: url.hostname,
      path,
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

async function createStripeCustomer(email, nombre) {
  if (!STRIPE_SECRET) return { id: null };
  try {
    const body = `email=${encodeURIComponent(email)}&name=${encodeURIComponent(nombre)}&metadata[source]=tekpair`;
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.stripe.com',
        path: '/v1/customers',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    return result;
  } catch(e) {
    console.error('Stripe error:', e);
    return { id: null };
  }
}

async function sendWelcomeEmail(email, nombre, tiendaNombre) {
  if (!RESEND_KEY) return;
  try {
    await httpPost(
      'api.resend.com',
      '/emails',
      {
        from: 'Tekpair <hola@tekpair.tech>',
        to: email,
        subject: `¡Bienvenido a Tekpair, ${nombre}! 🎉`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f7f9fc;margin:0;padding:0">
<div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#0055FF;padding:32px;text-align:center">
    <div style="width:48px;height:48px;background:white;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#0055FF;margin-bottom:12px">T</div>
    <h1 style="color:white;margin:0;font-size:24px">¡Bienvenido a Tekpair!</h1>
  </div>
  <div style="padding:32px">
    <p style="font-size:16px;color:#333">Hola <strong>${nombre}</strong>,</p>
    <p style="color:#666;line-height:1.6">Tu tienda <strong>${tiendaNombre}</strong> ya está configurada en Tekpair. Tienes <strong style="color:#0055FF">14 días gratis</strong> para explorar todas las funciones.</p>
    
    <div style="background:#f0f5ff;border-radius:12px;padding:20px;margin:24px 0">
      <p style="margin:0 0 12px;font-weight:700;color:#020B2E">¿Qué puedes hacer ahora?</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:10px;align-items:center"><span style="color:#0055FF;font-weight:700">✓</span><span style="color:#444">Añadir tu primer teléfono con IMEI</span></div>
        <div style="display:flex;gap:10px;align-items:center"><span style="color:#0055FF;font-weight:700">✓</span><span style="color:#444">Registrar tus clientes</span></div>
        <div style="display:flex;gap:10px;align-items:center"><span style="color:#0055FF;font-weight:700">✓</span><span style="color:#444">Crear tu primera orden de reparación</span></div>
        <div style="display:flex;gap:10px;align-items:center"><span style="color:#0055FF;font-weight:700">✓</span><span style="color:#444">Añadir a tus técnicos</span></div>
      </div>
    </div>

    <div style="text-align:center;margin:28px 0">
      <a href="https://tekpair.tech/app" style="background:#0055FF;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
        Ir a mi panel →
      </a>
    </div>

    <div style="border-top:1px solid #eee;padding-top:20px;margin-top:20px">
      <p style="color:#999;font-size:13px;margin:0">¿Necesitas ayuda? Responde a este email o visita <a href="https://tekpair.tech" style="color:#0055FF">tekpair.tech</a></p>
    </div>
  </div>
</div>
</body>
</html>`
      },
      {
        'Authorization': `Bearer ${RESEND_KEY}`
      }
    );
  } catch(e) {
    console.error('Email error:', e);
  }
}

// ═══ HANDLER PRINCIPAL ═══
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const { nombre, email, password, tiendaNombre, ciudad, pais, telefono, tecnicos, plan, precio, paymentMethodId } = req.body;

    // VALIDACIONES
    if (!nombre || !email || !password || !tiendaNombre) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' });
    }

    // VERIFICAR EMAIL ÚNICO
    const existente = await supabaseSelect('usuarios', `email=eq.${encodeURIComponent(email)}`);
    if (existente.data && existente.data.length > 0) {
      return res.status(400).json({ ok: false, error: 'Este email ya está registrado' });
    }

    // 1. CREAR USUARIO EN SUPABASE
    const passwordHash = hashPassword(password);
    const usuarioResult = await supabaseInsert('usuarios', {
      nombre,
      email,
      password_hash: passwordHash,
      activo: true
    });

    if (usuarioResult.status !== 201 || !usuarioResult.data || !usuarioResult.data[0]) {
      console.error('Error creando usuario:', usuarioResult);
      return res.status(500).json({ ok: false, error: 'Error creando usuario' });
    }

    const usuario = usuarioResult.data[0];

    // 2. CREAR TIENDA EN SUPABASE
    const tiendaResult = await supabaseInsert('tiendas', {
      usuario_id: usuario.id,
      nombre: tiendaNombre,
      ciudad: ciudad || '',
      pais: pais || '',
      telefono: telefono || '',
      num_tecnicos: tecnicos || '1'
    });

    const tienda = tiendaResult.data && tiendaResult.data[0];

    // 3. CREAR CLIENTE EN STRIPE
    const stripeCustomer = await createStripeCustomer(email, nombre);

    // 4. CREAR SUSCRIPCIÓN EN SUPABASE (trial 14 días)
    const trialFin = new Date();
    trialFin.setDate(trialFin.getDate() + 14);

    await supabaseInsert('suscripciones', {
      usuario_id: usuario.id,
      tienda_id: tienda ? tienda.id : null,
      plan: plan || 'pro',
      precio: precio || 24.90,
      estado: 'trial',
      stripe_customer_id: stripeCustomer.id || null,
      stripe_payment_method_id: paymentMethodId || null,
      trial_fin: trialFin.toISOString(),
      proximo_cobro: trialFin.toISOString()
    });

    // 5. CREAR SESIÓN
    const token = generateToken();
    await supabaseInsert('sesiones', {
      usuario_id: usuario.id,
      token,
      expira_en: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    // 6. ENVIAR EMAIL DE BIENVENIDA
    await sendWelcomeEmail(email, nombre, tiendaNombre);

    // RESPUESTA EXITOSA
    return res.status(200).json({
      ok: true,
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email
      },
      tienda: tienda ? { id: tienda.id, nombre: tienda.nombre } : null,
      trial_fin: trialFin.toISOString(),
      plan: plan || 'pro'
    });

  } catch(error) {
    console.error('Error en registro:', error);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
