// api/ayuda.js
// Recibe mensajes de soporte desde dashboard, los guarda en BD y envía email a info@tekpair.tech
//
// Fixes aplicados:
//   AYU-1: requiere JWT (antes endpoint público → spam abuse)
//   AYU-2: rate limit por IP+usuario para evitar spam masivo
//   AYU-3: reply_to solo si el email tiene formato válido (evita relay de phishing)

import jwt from 'jsonwebtoken';
import { rateLimit } from './_lib/ratelimit.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

// AYU-2: rate limit distribuido vía api/_lib/ratelimit.js (Upstash + fallback en memoria).
function _getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString().split(',')[0].trim();
}

function emailValido(e) {
  if (typeof e !== 'string') return false;
  if (e.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!JWT_SECRET) {
    console.error('[ayuda] Configuración incompleta');
    return res.status(500).json({ error: 'Configuración de servidor incompleta' });
  }

  // AYU-1: AUTH obligatorio (antes era endpoint público)
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido' });
  }
  if (!payload.tienda_id) return res.status(401).json({ error: 'JWT sin tienda_id' });

  // ── ACCIONES IA (Groq): extraer líneas de pedido / datos de factura de texto/foto/PDF ──
  const _accionIA = req.query.action || (req.body && req.body.action);
  if (_accionIA === 'parse-pedido' || _accionIA === 'parse-factura') {
    const uId = payload.sub || payload.user_id || 'unknown';
    const _rlIA = await rateLimit('ayuda:parseia:user:' + uId, 30, 10 * 60);
    if (!_rlIA.ok) {
      return res.status(429).json({ error: 'Demasiados análisis seguidos. Espera unos minutos.' });
    }
    return _accionIA === 'parse-factura' ? parseFacturaIA(req, res) : parsePedidoIA(req, res);
  }

  // AYU-2: rate limit
  //   - 3 mensajes / 10 min por usuario (sub)
  //   - 10 mensajes / hora por IP (anti spam masivo desde misma IP)
  const ip = _getClientIp(req);
  const userId = payload.sub || payload.user_id || 'unknown';
  const _rlUser = await rateLimit('ayuda:user:' + userId, 3, 10 * 60);
  if (!_rlUser.ok) {
    return res.status(429).json({ error: 'Demasiados mensajes. Espera unos minutos.' });
  }
  const _rlIp = await rateLimit('ayuda:ip:' + ip, 10, 60 * 60);
  if (!_rlIp.ok) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Espera una hora.' });
  }

  const { tipo, mensaje, email, nombre, tienda } = req.body;

  if (!mensaje || !String(mensaje).trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  // Sanitización básica
  const tipoSafe = String(tipo || 'general').slice(0, 50);
  const mensajeSafe = String(mensaje).trim().slice(0, 5000);
  // AYU-3: solo aceptamos el email si tiene formato válido. Si no, usamos el del JWT.
  // Antes el atacante podía poner "victima@gmail.com" y al responder, mi respuesta iba ahí.
  let emailSafe = String(email || '').slice(0, 200);
  if (!emailValido(emailSafe)) {
    // fallback al email del JWT (que sí está verificado)
    emailSafe = payload.email || '';
  }
  const nombreSafe = String(nombre || 'Anónimo').slice(0, 200);
  const tiendaSafe = String(tienda || 'Sin tienda').slice(0, 200);
  // tienda_id: forzar el del JWT (no fiarse del body)
  const tiendaIdSafe = String(payload.tienda_id).slice(0, 100);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const DEST_EMAIL = 'info@tekpair.tech';

  // 1. Guardar en BD (con SERVICE_KEY para bypass RLS)
  try {
    const insertR = await fetch(`${SUPABASE_URL}/rest/v1/mensajes_soporte`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        tienda_id: tiendaIdSafe,
        usuario_email: emailSafe,
        usuario_nombre: nombreSafe,
        tienda_nombre: tiendaSafe,
        tipo: tipoSafe,
        mensaje: mensajeSafe
      })
    });

    if (!insertR.ok) {
      const errText = await insertR.text();
      console.error('[ayuda] Error guardar mensaje:', insertR.status, errText);
      // No abortamos: seguimos enviando email aunque no se guarde en BD
    }
  } catch (e) {
    console.error('[ayuda] Error BD mensajes_soporte:', e);
  }

  // 2. Enviar email a info@tekpair.tech vía Resend
  if (!RESEND_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
  }

  // Escape HTML básico
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111;background:#f7f7f7">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">📩 Nuevo mensaje de soporte</h1>
    <p style="margin:6px 0 0;opacity:.75;font-size:13px">Tekpair Dashboard</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <table style="width:100%;font-size:13px;margin-bottom:18px">
      <tr><td style="padding:6px 0;color:#64748B;width:90px">Tipo:</td><td style="padding:6px 0"><strong>${esc(tipoSafe)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#64748B">Usuario:</td><td style="padding:6px 0">${esc(nombreSafe)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748B">Email:</td><td style="padding:6px 0"><a href="mailto:${esc(emailSafe)}" style="color:#0055FF">${esc(emailSafe)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#64748B">Tienda:</td><td style="padding:6px 0">${esc(tiendaSafe)}</td></tr>
    </table>
    <div style="background:#F8FAFC;padding:16px;border-left:4px solid #0055FF;border-radius:6px;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(mensajeSafe)}</div>
    <p style="color:#64748B;font-size:12px;margin-top:20px">💡 <strong>Responde directamente a este email</strong> para contestar al cliente.</p>
  </div>
  <div style="text-align:center;padding:14px;color:#94A3B8;font-size:11px">
    Tekpair · tekpair.tech
  </div>
</body></html>`;

  try {
    const resendR = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Tekpair Soporte <info@tekpair.tech>',
        to: [DEST_EMAIL],
        reply_to: emailSafe || undefined,
        subject: `[Soporte ${tipoSafe}] ${nombreSafe} - ${tiendaSafe}`,
        html: html
      })
    });

    const data = await resendR.json();
    if (resendR.ok) {
      return res.json({ ok: true });
    } else {
      console.error('[ayuda] Resend error:', resendR.status, data);
      // Mensaje en BD, email falló. Devolvemos ok porque el mensaje SÍ se guardó.
      return res.json({ ok: true, warning: 'Email no enviado pero mensaje guardado' });
    }
  } catch (e) {
    console.error('[ayuda] Error envío Resend:', e);
    return res.json({ ok: true, warning: 'Email no enviado pero mensaje guardado' });
  }
}

// Extrae líneas de pedido de un texto libre (email/albarán) con Gemini Flash (capa gratuita de Google).
// Devuelve { ok, lineas: [{pieza, marca, categoria, calidad, cantidad, precio_compra, precio_venta, sku}] }
async function parsePedidoIA(req, res) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(503).json({ error: 'IA no configurada (falta GROQ_API_KEY en el servidor)' });
  const texto = String((req.body && req.body.texto) || '').trim().slice(0, 20000);
  const imagenes = Array.isArray(req.body && req.body.imagenes)
    ? req.body.imagenes.filter((u) => typeof u === 'string' && u.startsWith('data:image')).slice(0, 5) : [];
  if (!texto && !imagenes.length) return res.status(400).json({ error: 'Texto vacío' });

  const sistema = 'Eres un extractor de pedidos de proveedor para una tienda de reparación de móviles. ' +
    'Recibes el texto pegado de un email o albarán (desordenado, multilínea) y devuelves SOLO un JSON válido. ' +
    'Formato exacto: {"lineas":[{"pieza":"","marca":"","categoria":"","calidad":"","cantidad":1,"precio_compra":0,"sku":""}]}. ' +
    'Reglas: ' +
    '- "pieza": nombre del producto limpio y legible (sin el "x N" ni el SKU). ' +
    '- "marca": Apple, Samsung, Xiaomi, etc. si se deduce; si no, "". ' +
    '- "categoria": una de Pantalla, Bateria, Telefono, Funda, Accesorio, Repuesto, Otros (la que mejor encaje). ' +
    '- "calidad": SOLO para pantallas, una de Original, OLED, "TFT Incell"; si no aplica o no está claro, "". ' +
    '- "cantidad": entero del "x N" (por defecto 1). ' +
    '- "precio_compra": el COSTE unitario en número (punto decimal, sin símbolo de moneda). El proveedor da el COSTE, nunca el precio de venta. ' +
    '- "sku": el código/SKU si aparece, si no "". ' +
    'Ignora líneas de Subtotal, Envío, Método de pago, TOTAL y cabeceras de tabla. No inventes productos.';

  try {
    const cuerpo = imagenes.length ? {
      // Visión (foto/PDF escaneado): modelo con visión de Groq
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: [{ type: 'text', text: 'Extrae los productos de este pedido/albarán (puede tener varias páginas):' }].concat(imagenes.map((u) => ({ type: 'image_url', image_url: { url: u } }))) }
      ]
    } : {
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: 'PEDIDO:\n' + texto }
      ]
    };
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify(cuerpo)
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('[parse-pedido] Groq error', r.status, t);
      return res.status(502).json({ error: 'IA HTTP ' + r.status + ': ' + String(t).replace(/\s+/g, ' ').slice(0, 260) });
    }
    const data = await r.json();
    let txt = (((data.choices || [])[0] || {}).message || {}).content || '';
    const i = txt.indexOf('{');
    const j = txt.lastIndexOf('}');
    if (i >= 0 && j > i) txt = txt.slice(i, j + 1);
    let parsed;
    try { parsed = JSON.parse(txt); } catch (e) { return res.status(502).json({ error: 'La IA devolvió una respuesta no válida' }); }
    const lineas = Array.isArray(parsed.lineas) ? parsed.lineas.slice(0, 200).map((l) => ({
      pieza: String(l.pieza || '').slice(0, 200),
      marca: String(l.marca || '').slice(0, 60),
      categoria: String(l.categoria || 'Otros').slice(0, 40),
      calidad: String(l.calidad || '').slice(0, 40),
      cantidad: Math.max(1, parseInt(l.cantidad, 10) || 1),
      precio_compra: Math.max(0, parseFloat(l.precio_compra) || 0),
      precio_venta: 0,
      sku: String(l.sku || '').slice(0, 60)
    })) : [];
    return res.json({ ok: true, lineas });
  } catch (e) {
    console.error('[parse-pedido] error', e);
    return res.status(500).json({ error: 'Error procesando el pedido' });
  }
}

// Extrae los datos de una factura/ticket de proveedor (texto, foto o PDF) con Groq.
// Devuelve { ok, factura: {proveedor, proveedor_nif, numero, fecha, base, iva_tipo, importe, concepto} }
async function parseFacturaIA(req, res) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(503).json({ error: 'IA no configurada (falta GROQ_API_KEY en el servidor)' });
  const texto = String((req.body && req.body.texto) || '').trim().slice(0, 20000);
  const imagenes = Array.isArray(req.body && req.body.imagenes)
    ? req.body.imagenes.filter((u) => typeof u === 'string' && u.startsWith('data:image')).slice(0, 5) : [];
  if (!texto && !imagenes.length) return res.status(400).json({ error: 'Texto vacío' });

  const sistema = 'Eres un extractor de facturas/tickets de proveedor para una tienda. ' +
    'Recibes el texto o la imagen de UNA factura y devuelves SOLO un JSON válido. ' +
    'Formato exacto: {"proveedor":"","proveedor_nif":"","numero":"","fecha":"","base":0,"iva_tipo":21,"importe":0,"concepto":""}. ' +
    'Reglas: ' +
    '- "proveedor": nombre del emisor de la factura (la empresa que te vende). ' +
    '- "proveedor_nif": CIF/NIF del proveedor si aparece, si no "". ' +
    '- "numero": número de factura si aparece, si no "". ' +
    '- "fecha": fecha de la factura en formato AAAA-MM-DD; si no se ve, "". ' +
    '- "base": base imponible (sin IVA) en número; si no se distingue, 0. ' +
    '- "iva_tipo": 0, 4, 10 o 21 según el IVA aplicado (por defecto 21). ' +
    '- "importe": TOTAL a pagar (con IVA) en número, punto decimal sin símbolo. Es el dato más importante. ' +
    '- "concepto": breve descripción de lo comprado (o "Compra a {proveedor}"). ' +
    'No inventes datos; si algo no está, déjalo vacío o 0.';

  try {
    const cuerpo = imagenes.length ? {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: [{ type: 'text', text: 'Extrae los datos de esta factura:' }].concat(imagenes.map((u) => ({ type: 'image_url', image_url: { url: u } }))) }
      ]
    } : {
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: 'FACTURA:\n' + texto }
      ]
    };
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify(cuerpo)
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('[parse-factura] Groq error', r.status, t);
      return res.status(502).json({ error: 'IA HTTP ' + r.status + ': ' + String(t).replace(/\s+/g, ' ').slice(0, 260) });
    }
    const data = await r.json();
    let txt = (((data.choices || [])[0] || {}).message || {}).content || '';
    const i = txt.indexOf('{');
    const j = txt.lastIndexOf('}');
    if (i >= 0 && j > i) txt = txt.slice(i, j + 1);
    let f;
    try { f = JSON.parse(txt); } catch (e) { return res.status(502).json({ error: 'La IA devolvió una respuesta no válida' }); }
    f = f || {};
    return res.json({ ok: true, factura: {
      proveedor: String(f.proveedor || '').slice(0, 120),
      proveedor_nif: String(f.proveedor_nif || '').slice(0, 40),
      numero: String(f.numero || '').slice(0, 60),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha || '')) ? f.fecha : '',
      base: Math.max(0, parseFloat(f.base) || 0),
      iva_tipo: [0, 4, 10, 21].includes(parseInt(f.iva_tipo, 10)) ? parseInt(f.iva_tipo, 10) : 21,
      importe: Math.max(0, parseFloat(f.importe) || 0),
      concepto: String(f.concepto || '').slice(0, 200)
    } });
  } catch (e) {
    console.error('[parse-factura] error', e);
    return res.status(500).json({ error: 'Error procesando la factura' });
  }
}
