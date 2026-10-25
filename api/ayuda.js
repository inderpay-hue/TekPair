// api/ayuda.js
// Recibe mensajes de soporte desde dashboard, los guarda en BD y envía email a info@tekpair.tech
//
// Fixes aplicados:
//   AYU-1: requiere JWT (antes endpoint público → spam abuse)
//   AYU-2: rate limit por IP+usuario para evitar spam masivo
//   AYU-3: reply_to solo si el email tiene formato válido (evita relay de phishing)

import jwt from 'jsonwebtoken';
import { rateLimit } from './_lib/ratelimit.js';
import { construirResumen, enviarResumen, destinoResumen, fechaMadrid, esPremium } from './_lib/resumen.js';

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

// Las fotos y los PDF escaneados viajan como data URL en el cuerpo: 3 paginas
// en base64 pasan del limite por defecto y la peticion se cae antes de llegar.
export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

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
  if (_accionIA === 'sync-error') return syncError(req, res, payload);
  if (_accionIA === 'resumen-prueba') return resumenPrueba(req, res, payload);
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

// Traduce un fallo de Groq a algo que el de la tienda pueda entender y accionar.
// El modelo de vision retirado (llama-4-scout, apagado el 17-jul-2026) devolvia un
// 404 tecnico que se leia como "no lee los PDF" y tardo tres meses en detectarse.
function _errGroq(status, cuerpo) {
  const t = String(cuerpo || '');
  if (/decommission|model_not_found|does not exist|has been deprecated/i.test(t) || status === 404) {
    return 'El modelo de IA ya no esta disponible en el proveedor. Hay que actualizarlo en el servidor (api/ayuda.js).';
  }
  if (status === 413 || /too large|payload/i.test(t)) {
    return 'El archivo es demasiado grande. Prueba con menos paginas o con una foto mas ligera.';
  }
  if (status === 429) return 'La IA esta saturada ahora mismo. Vuelve a intentarlo en un minuto.';
  if (status === 401 || status === 403) return 'La clave de la IA no es valida. Revisa GROQ_API_KEY en el servidor.';
  return 'IA HTTP ' + status + ': ' + t.replace(/\s+/g, ' ').slice(0, 260);
}

// Llamada a Groq con un reintento para el fallo de JSON.
//
// openai/gpt-oss-120b es un modelo que RAZONA antes de contestar, y ese
// razonamiento gasta del mismo presupuesto que la respuesta. Con un pedido
// largo se lo comia entero, la respuesta salia VACIA y, con
// response_format json_object, Groq la rechazaba con 400 json_validate_failed
// ("failed_generation":""). Paso el 15-oct-2026: tres intentos seguidos de
// pegar un pedido, los tres fallidos. Por eso: razonamiento bajo, margen de
// tokens de sobra y, si aun asi falla la validacion, se repite SIN el modo
// JSON y el JSON se saca del texto (el llamador ya lo hace con indexOf).
async function _groq(GROQ_KEY, cuerpo) {
  const llamar = (b) => fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
    body: JSON.stringify(b)
  });
  const b = Object.assign({}, cuerpo);
  if (b.model === 'openai/gpt-oss-120b') {
    if (!b.reasoning_effort) b.reasoning_effort = 'low';
    if (!b.max_completion_tokens) b.max_completion_tokens = 8192;
  }
  let r = await llamar(b);
  if (r.status === 400 && b.response_format) {
    const t = await r.clone().text();
    if (/json_validate_failed/i.test(t)) {
      console.warn('[groq] json_validate_failed: se repite sin response_format');
      const b2 = Object.assign({}, b); delete b2.response_format;
      r = await llamar(b2);
    }
  }
  return r;
}

// Extrae líneas de pedido de un texto libre (email/albarán) con Gemini Flash (capa gratuita de Google).
// Devuelve { ok, lineas: [{pieza, marca, categoria, calidad, cantidad, precio_compra, precio_venta, sku}] }
// La IA no siempre usa los nombres exactos de TekPair (devolvia "Otros",
// "TFT Incell"...). Estas dos funciones dejan categoria y calidad en los
// valores de los desplegables de Pedidos/Stock; el nombre de la pieza manda
// cuando dice claramente lo que es.
var _PED_CATS = ['Telefono', 'Tablet', 'Smartwatch', 'Pantalla', 'Tapa', 'Bateria', 'Flex de Carga', 'Altavoz', 'Repuesto', 'Accesorio', 'Funda', 'Otro'];
function _sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// Marca sacada del nombre cuando se ve clara: la IA a veces la deja vacia o
// duda entre Huawei y Honor en la misma pieza.
var _PED_MARCAS = [[/\b(iphone|ipad|apple ?watch|airpods|apple)\b/, 'Apple'], [/\b(samsung|galaxy)\b/, 'Samsung'], [/\bhonor\b/, 'Honor'],
  [/\bhuawei\b/, 'Huawei'], [/\b(xiaomi|redmi|poco|mi \d)/, 'Xiaomi'], [/\b(pixel|google)\b/, 'Google'], [/\boppo\b/, 'OPPO'], [/\brealme\b/, 'Realme'],
  [/\b(motorola|moto [a-z]\d)/, 'Motorola'], [/\boneplus\b/, 'OnePlus'], [/\bnokia\b/, 'Nokia'], [/\bsony|xperia\b/, 'Sony'], [/\btcl\b/, 'TCL'], [/\bvivo\b/, 'Vivo']];
function _pedMarca(marca, pieza) {
  var n = _sinTildes(pieza);
  for (var i = 0; i < _PED_MARCAS.length; i++) if (_PED_MARCAS[i][0].test(n)) return _PED_MARCAS[i][1];
  return String(marca || '').slice(0, 60);
}
function _pedCategoria(cat, pieza) {
  var n = _sinTildes(pieza);
  if (/^\s*(original\s+)?pantalla\b/.test(n)) return 'Pantalla';
  if (/\btapa trasera\b|\bback ?cover\b/.test(n)) return 'Tapa';
  if (/\bbateria\b/.test(n)) return 'Bateria';
  if (/\b(flex|conector|puerto|placa) de carga\b/.test(n)) return 'Flex de Carga';
  if (/\b(altavoz|auricular interno|buzzer)\b/.test(n)) return 'Altavoz';
  if (/\bbandeja\b/.test(n)) return 'Repuesto';
  if (/\b(pantalla|display|lcd\+tactil)\b/.test(n) && !/protector|cristal templado|hidrogel|funda/.test(n)) return 'Pantalla';
  var c = _sinTildes(cat).trim();
  if (c === 'otros' || c === 'otro' || !c) return 'Otro';
  if (c === 'flex' || c === 'flex de carga') return 'Flex de Carga';
  var hit = _PED_CATS.find(function (x) { return _sinTildes(x) === c; });
  return hit || 'Otro';
}
function _pedCalidad(cal, pieza, cat) {
  if (cat !== 'Pantalla') return '';
  var n = _sinTildes(pieza);
  if (/\boriginal\b|\bservice pack\b/.test(n)) return 'Original';
  if (/soft oled|oled soft/.test(n)) return 'Soft OLED';
  if (/hard oled|oled hard/.test(n)) return 'Hard OLED';
  if (/\bincell\b|\bin-cell\b/.test(n)) return 'Incell';
  if (/\b(oled|amoled)\b/.test(n)) return 'OLED';
  if (/\btft\b/.test(n)) return 'TFT';
  var c = _sinTildes(cal);
  if (/original/.test(c)) return 'Original';
  if (/soft/.test(c)) return 'Soft OLED';
  if (/hard/.test(c)) return 'Hard OLED';
  if (/incell/.test(c)) return 'Incell';
  if (/oled/.test(c)) return 'OLED';
  if (/tft|lcd/.test(c)) return 'TFT';
  return '';
}

// Precio por linea o por unidad. Hay proveedores (GSMMAX/GSMWOOX) que ponen
// "5x AURICULARES 25.00 €" = 25 € la linea (5 € cada uno), y la IA no siempre
// lo nota. El Total del pedido lo decide: si se acerca mas a la suma de los
// precios que a la suma de precio x cantidad, eran totales de linea.
function _numEur(t) {
  var s = String(t || '').replace(/[^\d.,-]/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  return parseFloat(s) || 0;
}
function _pedTotalTexto(texto) {
  var m, total = 0, re = /(?:^|\s)total(?![\s\-]*(?:l[ií]nea|parcial))\s*[:=]?\s*(?:€|eur)?\s*([\d][\d.,]*)/gi;
  while ((m = re.exec(String(texto || '')))) total = _numEur(m[1]) || total;   // el ultimo "Total" es el del pedido
  return total;
}
// Datos del pedido entero (proveedor, nº, fecha, total). La IA los propone y el
// texto manda donde es inequivoco (nº tras "#"/"pedido", fecha dd/mm/aaaa, Total).
var _MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
function _pedMeta(ia, texto) {
  ia = ia || {};
  var t = String(texto || '');
  var out = {
    proveedor: String(ia.proveedor || '').trim().slice(0, 80),
    numero: String(ia.numero || '').replace(/^#/, '').trim().slice(0, 40),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(ia.fecha || '')) ? ia.fecha : '',
    total: Math.max(0, parseFloat(ia.total) || 0)
  };
  var mn = t.match(/pedido\s*(?:n[uú]m(?:ero)?|n[º°o]\.?)?\s*[:#]?\s*#?\s*(\d{4,})/i) || t.match(/#\s?(\d{5,})/);
  if (mn) out.numero = mn[1];
  var mf = t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/) || null;
  var mf2 = t.match(/\b(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})\b/);
  var pad = function (n) { return ('0' + n).slice(-2); };
  if (mf && +mf[2] >= 1 && +mf[2] <= 12) out.fecha = mf[3] + '-' + pad(mf[2]) + '-' + pad(mf[1]);
  else if (mf2 && _MESES[mf2[2].toLowerCase()]) out.fecha = mf2[3] + '-' + pad(_MESES[mf2[2].toLowerCase()]) + '-' + pad(mf2[1]);
  var tot = _pedTotalTexto(t);
  if (tot > 0) out.total = tot;
  return out;
}
function _pedPrecioUnitario(lineas, texto) {
  if (!lineas.length || !lineas.some(function (l) { return l.cantidad > 1; })) return;
  var total = _pedTotalTexto(texto);
  if (!(total > 0)) return;
  var porUd = 0, porLinea = 0;
  lineas.forEach(function (l) { porUd += l.precio_compra * l.cantidad; porLinea += l.precio_compra; });
  var dUd = Math.abs(porUd - total), dLinea = Math.abs(porLinea - total);
  // margen para descuentos/envio que la IA no cuenta como linea
  if (dLinea < dUd && dLinea <= Math.max(0.05, total * 0.15)) {
    lineas.forEach(function (l) { if (l.cantidad > 1) l.precio_compra = Math.round(l.precio_compra / l.cantidad * 10000) / 10000; });
  }
}

async function parsePedidoIA(req, res) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(503).json({ error: 'IA no configurada (falta GROQ_API_KEY en el servidor)' });
  const texto = String((req.body && req.body.texto) || '').trim().slice(0, 20000);
  const imagenes = Array.isArray(req.body && req.body.imagenes)
    ? req.body.imagenes.filter((u) => typeof u === 'string' && u.startsWith('data:image')).slice(0, 3) : [];
  if (!texto && !imagenes.length) return res.status(400).json({ error: 'Texto vacío' });

  const sistema = 'Eres un extractor de pedidos de proveedor para una tienda de reparación de móviles. ' +
    'Recibes el texto pegado de un email o albarán (desordenado, multilínea) y devuelves SOLO un JSON válido. ' +
    'Formato exacto: {"pedido":{"proveedor":"","numero":"","fecha":"","total":0},"lineas":[{"pieza":"","marca":"","categoria":"","calidad":"","cantidad":1,"precio_compra":0,"sku":""}]}. ' +
    '- "pedido": datos del pedido entero si aparecen (si no, vacío o 0): "proveedor" = la empresa que vende (no la tienda que compra ni la agencia de transporte); "numero" = nº de pedido/albarán sin "#"; "fecha" = fecha del pedido en AAAA-MM-DD; "total" = TOTAL pagado del pedido. ' +
    'Reglas: ' +
    '- "pieza": el nombre del producto COMPLETO tal cual lo escribe el proveedor (con calidad, Original, color, "con marco"...); solo quita el SKU y el "x N". ' +
    '- "marca": Apple, Samsung, Xiaomi, etc. si se deduce; si no, "". ' +
    '- "categoria": una de Telefono, Tablet, Smartwatch, Pantalla, Tapa, Bateria, "Flex de Carga", Altavoz, Repuesto, Accesorio, Funda, Otro. ' +
    'Tapa trasera = Tapa. Piezas sueltas del móvil (bandeja SIM, cámara, lente, botones, flex que no sea de carga) = Repuesto. ' +
    'Accesorio = cargadores, cables, protectores de pantalla y similares. ' +
    '- "calidad": SOLO para pantallas, una de Original, OLED, "Soft OLED", "Hard OLED", Incell, TFT; si no aplica o no está claro, "". ' +
    'Si el nombre dice "Original" es Original; "OLED Soft" es "Soft OLED"; "OLED Hard" es "Hard OLED"; INCELL es Incell. "LCD+Táctil" solo indica que es la pantalla completa, no la calidad. ' +
    '- "cantidad": entero del "x N" (por defecto 1). ' +
    '- "precio_compra": el COSTE unitario en número (punto decimal, sin símbolo de moneda). El proveedor da el COSTE, nunca el precio de venta. ' +
    'Ojo: algunos proveedores (p. ej. GSMMAX/GSMWOOX, "10x CABLE ... 4.50 €") ponen el TOTAL de la línea y no el unitario; si las líneas suman el Total del pedido, divide cada importe entre su cantidad. ' +
    '- "sku": el código/SKU si aparece, si no "". ' +
    'Ignora líneas de Subtotal, Envío, Método de pago, TOTAL y cabeceras de tabla. No inventes productos.';

  try {
    const cuerpo = imagenes.length ? {
      // Visión (foto/PDF escaneado): modelo con visión de Groq
      // Modelo de VISION de Groq. Ojo: aqui estuvo llama-4-scout, que Groq
      // apago el 17-jul-2026 — y con el se cayeron en silencio todas las
      // fotos y los PDF escaneados. Si vuelve a fallar con HTTP 404, es que
      // han retirado este: console.groq.com/docs/vision tiene el vigente.
      // Maximo 3 imagenes por peticion y 20MB de cuerpo.
      model: 'qwen/qwen3.8-27b',
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
    const r = await _groq(GROQ_KEY, cuerpo);
    if (!r.ok) {
      const t = await r.text();
      console.error('[parse-pedido] Groq error', r.status, t);
      return res.status(502).json({ error: _errGroq(r.status, t) });
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
      marca: _pedMarca(l.marca, l.pieza),
      categoria: _pedCategoria(l.categoria, l.pieza),
      calidad: _pedCalidad(l.calidad, l.pieza, _pedCategoria(l.categoria, l.pieza)),
      cantidad: Math.max(1, parseInt(l.cantidad, 10) || 1),
      precio_compra: Math.max(0, parseFloat(l.precio_compra) || 0),
      precio_venta: 0,
      sku: String(l.sku || '').slice(0, 60)
    })) : [];
    _pedPrecioUnitario(lineas, texto);
    return res.json({ ok: true, lineas, pedido: _pedMeta(parsed.pedido, texto) });
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
    ? req.body.imagenes.filter((u) => typeof u === 'string' && u.startsWith('data:image')).slice(0, 3) : [];
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
      // Modelo de VISION de Groq. Ojo: aqui estuvo llama-4-scout, que Groq
      // apago el 17-jul-2026 — y con el se cayeron en silencio todas las
      // fotos y los PDF escaneados. Si vuelve a fallar con HTTP 404, es que
      // han retirado este: console.groq.com/docs/vision tiene el vigente.
      // Maximo 3 imagenes por peticion y 20MB de cuerpo.
      model: 'qwen/qwen3.8-27b',
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
    const r = await _groq(GROQ_KEY, cuerpo);
    if (!r.ok) {
      const t = await r.text();
      console.error('[parse-factura] Groq error', r.status, t);
      return res.status(502).json({ error: _errGroq(r.status, t) });
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

// ── Fallos de guardado en la nube (desde el panel) ──
// El panel manda aquí cada rechazo de Supabase (insert/update/delete/lectura).
// Queda en errores_sync y se avisa por email al admin: como mucho 1 email por
// hora por tienda + tabla + tipo de fallo, para no llenar el buzón.
async function syncError(req, res, payload) {
  const tid = String(payload.tienda_id).slice(0, 100);
  const b = req.body || {};
  const corto = (v, n) => String(v == null ? '' : v).slice(0, n);
  const fila = {
    tienda_id: tid,
    metodo: corto(b.metodo, 10), tabla: corto(b.tabla, 60).replace(/[^a-z0-9_]/gi, ''),
    status: parseInt(b.status, 10) || 0, codigo: corto(b.codigo, 30), mensaje: corto(b.mensaje, 300),
    pantalla: corto(b.pantalla, 60), usuario: corto(b.usuario || payload.email, 120),
    user_agent: corto(req.headers['user-agent'], 200),
  };
  if (!fila.tabla) return res.status(400).json({ error: 'Falta la tabla' });
  // Que un panel roto no pueda inundar: 60 avisos por hora por tienda.
  const rlTienda = await rateLimit('syncerr:tienda:' + tid, 60, 3600);
  if (!rlTienda.ok) return res.json({ ok: true, ignorado: true });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const h = { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  let tiendaNombre = tid;
  try {
    const t = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tid)}&select=nombre`, { headers: h });
    const j = t.ok ? await t.json() : [];
    if (j && j[0] && j[0].nombre) tiendaNombre = j[0].nombre;
  } catch (e) { /* sin nombre */ }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/errores_sync`, {
      method: 'POST', headers: { ...h, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...fila, tienda_nombre: tiendaNombre }),
    });
    if (!r.ok) console.error('[sync-error] no se guardó:', r.status, await r.text());
  } catch (e) { console.error('[sync-error] BD:', e.message); }

  const rlEmail = await rateLimit(`syncerr:email:${tid}:${fila.tabla}:${fila.metodo}:${fila.status}`, 1, 3600);
  if (rlEmail.ok && RESEND_KEY) {
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px">
      <h2 style="color:#b91c1c">⚠️ Un dato no se ha guardado en la nube</h2>
      <p><b>Tienda:</b> ${esc(tiendaNombre)} <span style="color:#64748b">(${esc(tid)})</span><br>
      <b>Usuario:</b> ${esc(fila.usuario || '—')}<br>
      <b>Qué:</b> ${esc(fila.metodo)} en <code>${esc(fila.tabla)}</code> · HTTP ${fila.status}${fila.codigo ? ' · código ' + esc(fila.codigo) : ''}<br>
      <b>Pantalla:</b> ${esc(fila.pantalla || '—')}</p>
      <pre style="background:#f1f5f9;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(fila.mensaje || '(sin mensaje)')}</pre>
      <p style="color:#64748b;font-size:12px">Como mucho llega un email por hora por tienda, tabla y tipo de fallo. Todos quedan en la tabla <code>errores_sync</code> de Supabase.</p></div>`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Tekpair Avisos <info@tekpair.tech>', to: ['info@tekpair.tech'],
          subject: `⚠️ No se guardó ${fila.tabla} · ${tiendaNombre}`, html }),
      });
      if (!r.ok) console.error('[sync-error] email:', r.status, await r.text());
    } catch (e) { console.error('[sync-error] email:', e.message); }
  }
  return res.json({ ok: true });
}

// Ajustes → Notificaciones → Resumen diario → "Enviarme uno de prueba": el de ayer, ya.
async function resumenPrueba(req, res, payload) {
  // Es el resumen de facturación de la tienda: solo el administrador puede pedirlo
  // (antes cualquier empleado podía mandarlo a un email cualquiera).
  if (payload.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede enviar el resumen' });
  const _rl = await rateLimit('resumen-prueba:' + payload.tienda_id, 5, 60 * 60);
  if (!_rl.ok) return res.status(429).json({ error: 'Demasiadas pruebas. Espera un rato.' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY, RESEND_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) return res.status(500).json({ error: 'Servidor no configurado' });
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  try {
    const tr = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(payload.tienda_id)}&select=id,nombre,email,plan_email,ajustes_config,plan,plan_status,trial_until`, { headers });
    const t = tr.ok ? (await tr.json())[0] : null;
    if (!t) return res.status(404).json({ error: 'Tienda no encontrada' });
    if (!esPremium(t)) return res.status(403).json({ error: 'El resumen diario es del plan Premium' });
    // El email puede venir del formulario (aún sin guardar): se valida igual.
    const pedido = String((req.body && req.body.email) || '').trim();
    const para = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pedido) ? pedido : destinoResumen(t);
    if (!para) return res.status(400).json({ error: 'Falta el email' });
    const now = new Date();
    const r = await construirResumen(SUPABASE_URL, headers, t, fechaMadrid(new Date(now.getTime() - 86400000)), fechaMadrid(now));
    if (!r) return res.json({ ok: true, vacio: true });
    const ok = await enviarResumen(RESEND_KEY, para, r);
    return ok ? res.json({ ok: true, email: para }) : res.status(502).json({ error: 'No se pudo enviar el email' });
  } catch (e) {
    console.error('[ayuda] resumen-prueba:', e.message);
    return res.status(500).json({ error: 'Error preparando el resumen' });
  }
}
