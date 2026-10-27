// api/checkout.js
// Crea una sesión de Stripe Checkout para que el usuario se suscriba a un plan.
//
// Fixes aplicados:
//   CHK-1: usar SERVICE_KEY para chequear email (no anon), filtrar solo cuentas activas
//   CHK-2: NO pasar datos personales en URL (solo session_id; el resto lo lee del backend)
//   CHK-3: validar formato de email con regex
//   CHK-7: mensajes de error genéricos al cliente (sin filtrar info Stripe interna)
//   CHK-8: aceptar tanto 'top' como 'premium' como ID de plan para consistencia

// CHK-RATE: rate limiting — máx 10 peticiones por IP cada hora (distribuido vía api/_lib/ratelimit.js).
// Previene creación masiva de sesiones Stripe.
import { rateLimit } from './_lib/ratelimit.js';
import { PRECIOS_MENSUAL, PRECIOS_ANUAL } from './_lib/precios.js';

function _getIpChk(req) {
  return ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim() || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const _rl = await rateLimit('checkout:' + _getIpChk(req), 10, 60 * 60);
  if (!_rl.ok) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
  }
  // #B13: honeypot anti-bot. El campo 'website' está oculto en el formulario; si viene
  // relleno, es un bot → cortamos sin crear sesión de pago.
  if (req.body && typeof req.body.website === 'string' && req.body.website.trim() !== '') {
    return res.status(400).json({ error: 'Solicitud no válida.' });
  }

  // ═══ MULTI-TIENDA Fase 2 · ADD-ON: tienda extra para un dueño YA registrado ═══
  // Cobra al MISMO customer Stripe (suscripción add-on). El webhook crea la tienda
  // y el enlace usuario_tiendas al completarse el pago. Requiere env STRIPE_ADDON_PRICE_ID.
  if (req.body && req.body.action === 'addon') {
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    // Acepta el nombre canónico o el alias _EXTRA_TIENDA (por si la env se nombró así en Vercel).
    const ADDON_PRICE = process.env.STRIPE_ADDON_PRICE_ID || process.env.STRIPE_ADDON_PRICE_ID_EXTRA_TIENDA;
    const token = req.body.token;
    const tiendaNombre = String(req.body.tienda_nombre || '').trim();
    if (!token || !tiendaNombre) return res.status(400).json({ error: 'Faltan datos' });
    if (tiendaNombre.length > 100) return res.status(400).json({ error: 'Nombre demasiado largo' });
    if (!ADDON_PRICE) { console.error('Falta STRIPE_ADDON_PRICE_ID'); return res.status(500).json({ error: 'Add-on no configurado (falta STRIPE_ADDON_PRICE_ID)' }); }
    try {
      const sR = await fetch(`${SUPABASE_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=usuario_id,expires_at&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      const ses = await sR.json();
      if (!Array.isArray(ses) || !ses.length) return res.status(401).json({ error: 'Sesión inválida' });
      if (ses[0].expires_at && new Date(ses[0].expires_at) < new Date()) return res.status(401).json({ error: 'Sesión caducada' });
      const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(ses[0].usuario_id)}&select=id,rol,activo,tienda_id,email&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      const us = await uR.json();
      const u = us && us[0];
      if (!u || u.activo === false || u.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede añadir tiendas' });
      const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(u.tienda_id)}&select=stripe_customer_id,plan&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
      const tA = await tR.json();
      const customerId = tA && tA[0] && tA[0].stripe_customer_id;
      const planDueno = (tA && tA[0] && tA[0].plan) || 'pro';
      if (!customerId) return res.status(400).json({ error: 'Tu cuenta no tiene método de pago activo. Completa tu suscripción primero.' });
      const params = new URLSearchParams();
      params.append('mode', 'subscription');
      params.append('payment_method_types[]', 'card');
      params.append('line_items[0][price]', ADDON_PRICE);
      params.append('line_items[0][quantity]', '1');
      params.append('customer', customerId);
      params.append('success_url', 'https://www.tekpair.tech/dashboard.html?tienda_creada=1');
      params.append('cancel_url', 'https://www.tekpair.tech/dashboard.html');
      params.append('metadata[tipo]', 'addon');
      params.append('metadata[owner_usuario_id]', u.id);
      params.append('metadata[tienda_nombre]', tiendaNombre);
      params.append('metadata[plan]', planDueno);
      params.append('subscription_data[metadata][tipo]', 'addon');
      params.append('subscription_data[metadata][owner_usuario_id]', u.id);
      const stripeR = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { 'Authorization': `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      const session = await stripeR.json();
      if (!stripeR.ok) { console.error('Stripe addon checkout error:', stripeR.status, session); return res.json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' }); }
      return res.json({ ok: true, url: session.url });
    } catch (e) {
      console.error('Addon checkout error:', e);
      return res.status(500).json({ error: 'Error del servidor' });
    }
  }

  const { plan, nombre, email, tienda_nombre } = req.body;
  if (!plan || !email || !nombre) return res.status(400).json({ error: 'Faltan datos' });

  // CHK-3: validar formato email server-side (el frontend solo valida @)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'Email no válido' });
  }
  // Validar longitud razonable
  if (String(nombre).length > 100 || String(email).length > 100 || String(tienda_nombre || '').length > 100) {
    return res.status(400).json({ error: 'Datos demasiado largos' });
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  // CHK-1: usar SERVICE_KEY para bypasar RLS (la antigua ANON_KEY no debería poder leer usuarios)
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Precios de las ALTAS NUEVAS (desde el 27-oct-2026 Básico 14,90/149 y Pro 22,90/229;
  // Premium igual). Viven en api/_lib/precios.js junto a los viejos que reconoce el webhook.
  // CHK-8: aceptar tanto 'top' (como dice el form) como 'premium' (como dice webhook.js)
  const PLANES = { ...PRECIOS_MENSUAL, top: PRECIOS_MENSUAL.premium };
  // Anuales: Básico y Pro con los price nuevos fijos (las env STRIPE_PRICE_BASICO/PRO_ANUAL
  // apuntan a los anuales VIEJOS); Premium sigue en STRIPE_PRICE_PREMIUM_ANUAL.
  // Si un anual faltara, el ciclo 'anual' cae a mensual.
  const PLANES_ANUAL = { ...PRECIOS_ANUAL, top: PRECIOS_ANUAL.premium };
  const ciclo = (req.body.ciclo === 'anual') ? 'anual' : 'mensual';
  // Anual si lo piden Y hay price anual configurado; si no, mensual (fallback seguro).
  const tiene = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const priceId = (ciclo === 'anual' && tiene(PLANES_ANUAL, plan) && PLANES_ANUAL[plan]) ? PLANES_ANUAL[plan] : (tiene(PLANES, plan) ? PLANES[plan] : null);
  if (typeof priceId !== 'string' || !priceId) return res.status(400).json({ error: 'Plan inválido' });

  try {
    // CHK-1: verificar email existente, solo cuentas activas, con SERVICE_KEY
    const checkR = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&activo=eq.true&select=id&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!checkR.ok) {
      console.error('Check email failed:', checkR.status, await checkR.text());
      return res.status(500).json({ error: 'Error del servidor al validar email' });
    }
    const existing = await checkR.json();
    if (existing.length) {
      return res.json({ error: 'Este email ya tiene una cuenta activa. Inicia sesión en su lugar.' });
    }

    // Create Stripe checkout session
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', email);
    // CHK-2: success_url SIN datos personales en la URL.
    // Antes: ?session_id=...&email=user@...&nombre=Juan&tienda=...&plan=basico
    // Ahora: solo session_id. register.js recupera el resto desde session.metadata.
    params.append('success_url', `https://www.tekpair.tech/registro-ok.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', 'https://www.tekpair.tech/registro.html');
    // Los metadata se quedan en Stripe y se leen desde register.js
    params.append('metadata[nombre]', nombre);
    params.append('metadata[email]', email);
    params.append('metadata[tienda_nombre]', tienda_nombre || nombre);
    // AUD-fix: normalizar alias 'top' → canónico 'premium' (la app compara === 'premium';
    // si no, según qué webhook llegue último la tienda queda con plan='top' y no desbloquea Premium).
    const planCanonico = plan === 'top' ? 'premium' : plan;
    params.append('metadata[plan]', planCanonico);
    params.append('metadata[ciclo]', ciclo);
    params.append('metadata[lang]', req.body.lang || 'es');
    // Teléfono de contacto: viaja en metadata porque este endpoint no escribe en
    // la base de datos; lo guarda register.js al volver de la pasarela.
    const telReg = normalizarTel(req.body.tel);
    if (telReg) params.append('metadata[tel]', telReg);
    // #B10: registro del consentimiento (timestamp + versión) para RGPD.
    if (req.body.consent_ts) params.append('metadata[consent_ts]', String(req.body.consent_ts).slice(0, 40));
    if (req.body.consent_ver) params.append('metadata[consent_ver]', String(req.body.consent_ver).slice(0, 40));
    // Referidos: código de invitación (lo lee register.js para registrar la invitación).
    // A MAYUSCULAS: todos los codigos se guardan asi y la comparacion de
    // Postgres distingue mayusculas. Quien escribiera 'demba' en vez de
    // 'DEMBA' no encontraba al afiliado y el comercial se quedaba sin cobrar.
    let refCode = String(req.body.ref || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16);
    // La invitacion de la tienda de un COMERCIAL cuenta como su codigo de comercial.
    // Cada comercial tiene su propia tienda ("<CODIGO> - Comercial") y esa tienda,
    // como cualquier otra, tiene su enlace de "invitar". Si el comercial comparte
    // ese enlace en vez del suyo, el cliente entraba como invitacion entre tiendas
    // (un mes gratis para los dos), sin el 50% prometido y sin comision. Paso el
    // 15-oct-2026 con DEMBA.
    if (refCode) refCode = (await comercialDeInvitacion(refCode, SUPABASE_URL, SERVICE_KEY)) || refCode;
    if (refCode) { params.append('metadata[ref]', refCode); params.append('subscription_data[metadata][ref]', refCode); }

    // El código escrito en el registro se aplica AQUÍ como descuento de verdad.
    //
    // Antes solo viajaba como metadata y se dejaba `allow_promotion_codes`, así que
    // el cliente tenía que volver a escribirlo en la pantalla de Stripe para que le
    // hiciera algo. Nadie lo hacía —ya lo había escrito una vez— y el resultado eran
    // 0 canjes en TODOS los cupones desde mayo: ni un solo cliente recibió el 50%
    // que promete el kit comercial, y ningún comercial cobró su comisión, porque la
    // atribución va justo por este código (webhook.js lo lee del descuento aplicado).
    const _tipoRef = await tipoRef(refCode, SUPABASE_URL, SERVICE_KEY);
    // Desde el 22-oct-2026 el código de un COMERCIAL ya no da descuento: da un mes de
    // prueba (15 días de todos + 15 por el comercial). Por eso no se le aplica ningún
    // cupón ni se deja escribir uno en Stripe; la comisión se atribuye igual por la
    // metadata `ref` (respaldo de webhook.js).
    // Tampoco a un comercial DADO DE BAJA (tipoRef da null porque no está activo): si
    // conserva su cupón antiguo en Stripe, su cliente se llevaba el 50 %.
    const promoId = (refCode && _tipoRef !== 'afiliado' && !(await esCodigoComercial(refCode, SUPABASE_URL, SERVICE_KEY))) ? await buscarPromo(refCode, STRIPE_KEY) : null;
    if (_tipoRef === 'afiliado') {
      // sin descuento ni campo de código
    } else if (promoId) {
      // Stripe no admite las dos cosas a la vez: o se aplica un descuento concreto o
      // se ofrece el campo para escribirlo. Con código válido, aplicado y visible.
      params.append('discounts[0][promotion_code]', promoId);
    } else {
      params.append('allow_promotion_codes', 'true');
    }
    // Prueba: 15 dias normalmente, UN MES ENTERO si viene con codigo valido.
    //
    // Antes eran 15 fijos para todos y el "1 mes gratis" que prometen los
    // comerciales no se cumplia por ningun lado: el cupon del mes gratis solo
    // se dispara para referidos entre TIENDAS y despues del primer pago, asi
    // que a quien llegaba por un comercial no le llegaba nunca. Un cliente real
    // (9-oct-2026) entro asi y se quedo con 15 dias.
    // Quien llega con un codigo valido tiene UN MES de prueba; el resto, 15 dias.
    // Da igual de donde venga el codigo (comercial, otra tienda o Cobrum): la
    // promesa que se le hizo al cliente es la misma en los tres sitios, y tener
    // tres premios distintos es lo que hacia que a unos no les llegara nada.
    //
    // UN mes, no dos: quien recibe este trial ya NO recibe ademas el cupon del
    // mes gratis (webhook.js) ni los +30 dias de Cobrum (register.js).
    //
    // EXCEPCION (15-oct-2026, decision del dueño): el cliente de un COMERCIAL
    // tiene la prueba normal de 15 dias, porque su premio es el 50% durante 3
    // meses (el cupon aplicado arriba). Antes se llevaba las dos cosas. Si el
    // comercial aun no tiene su cupon creado en Stripe (promoId vacio), se le
    // deja el mes: si no, el cliente se quedaria sin nada de lo prometido.
    // Las invitaciones entre tiendas y las de Cobrum siguen con el mes.
    //
    // 22-oct-2026 (decision del dueño): TODOS los codigos dan el mes, tambien los de
    // comercial, que ya no llevan el 50%. Codigo valido = 30 dias; sin codigo = 15.
    const TRIAL_NORMAL = 15, TRIAL_REF = 30;
    const trialDias = _tipoRef ? TRIAL_REF : TRIAL_NORMAL;
    params.append('subscription_data[trial_period_days]', String(trialDias));
    // Pasar metadata también a la subscription para que el webhook tenga acceso
    params.append('subscription_data[metadata][plan]', planCanonico);
    params.append('subscription_data[metadata][email]', email);

    const stripeR = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeR.json();
    if (!stripeR.ok) {
      // CHK-7: log detallado en backend, mensaje genérico al cliente
      console.error('Stripe checkout error:', stripeR.status, session);
      return res.json({ error: 'No se pudo iniciar el pago. Intenta de nuevo en unos minutos.' });
    }

    return res.json({ ok: true, url: session.url });

  } catch(e) {
    console.error('Checkout error:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

// De dónde viene el código: 'tienda' (enlace "trae un amigo"), 'afiliado'
// (comercial dado de alta y activo), 'cobrum' (código cruzado) o null.
// Se valida contra la base ANTES de regalar nada: si no, basta escribir cuatro
// letras en el registro para llevarse el mes.
// ¿Es el código de un comercial, esté activo o no?
async function esCodigoComercial(code, SUPABASE_URL, SERVICE_KEY) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(code)}&select=codigo&limit=1`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
}

async function tipoRef(code, SUPABASE_URL, SERVICE_KEY) {
  if (!code) return null;
  const h = { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?referral_code=eq.${encodeURIComponent(code)}&select=id&limit=1`, { headers: h });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) return 'tienda';
  } catch (e) {}
  try {
    // Tiene que estar ACTIVO: un comercial dado de baja no sigue regalando meses.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(code)}&activo=eq.true&select=codigo&limit=1`, { headers: h });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) return 'afiliado';
  } catch (e) {}
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch((process.env.COBRUM_REFERIDO_URL || 'https://cobrum.tech/api/referido') + '?codigo=' + encodeURIComponent(code), { signal: ctrl.signal });
    clearTimeout(to);
    if (r.ok) { const d = await r.json().catch(() => ({})); if (d && d.valid) return 'cobrum'; }
  } catch (e) {}
  return null;
}

// Busca el código promocional en Stripe. Devuelve el id (promo_...) o null.
//
// Los códigos se crean a mano en el panel de Stripe y el afiliado guarda el mismo
// texto en la base de datos, así que aquí solo hay que resolverlo. Si no existe,
// está agotado o caducado, `active=true` lo deja fuera y el alta sigue sin
// descuento: un código mal escrito nunca debe impedir que alguien se suscriba.
// Si `code` es el codigo de invitar de la tienda propia de un comercial activo,
// devuelve el codigo de ese comercial; si no, null. Solo las tiendas creadas para
// el comercial (nombre acabado en " - Comercial"): una tienda normal enlazada a un
// comercial sigue invitando como tienda.
async function comercialDeInvitacion(code, SUPABASE_URL, SERVICE_KEY) {
  if (!code || !SUPABASE_URL || !SERVICE_KEY) return null;
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?referral_code=eq.${encodeURIComponent(code)}&select=id,nombre&limit=1`, { headers: h });
    const t = (await tR.json())[0];
    if (!t || !/ - Comercial$/i.test(String(t.nombre || '').trim())) return null;
    const aR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?tienda_id=eq.${encodeURIComponent(t.id)}&activo=eq.true&select=codigo&limit=1`, { headers: h });
    const a = (await aR.json())[0];
    return a && a.codigo ? String(a.codigo).toUpperCase() : null;
  } catch (e) { return null; }
}

async function buscarPromo(codigo, STRIPE_KEY) {
  if (!codigo || !STRIPE_KEY) return null;
  // Se prueba tal cual y en mayúsculas: en Stripe el código distingue mayúsculas y
  // el cliente lo escribe como le parece.
  const intentos = [...new Set([codigo, codigo.toUpperCase()])];
  for (const c of intentos) {
    try {
      const r = await fetch(
        `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(c)}&active=true&limit=1`,
        { headers: { 'Authorization': `Bearer ${STRIPE_KEY}` } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const promo = j && Array.isArray(j.data) ? j.data[0] : null;
      if (promo && promo.id) return promo.id;
    } catch (e) {
      // Sin descuento, pero el alta continúa.
      console.error('[checkout] buscando promo', c, e.message);
    }
  }
  return null;
}

// Deja el teléfono en un formato con el que se pueda escribir por WhatsApp.
// Se conserva el '+' inicial porque sin prefijo no se sabe de qué país es, y
// se quitan espacios, guiones y paréntesis, que cada uno escribe a su manera.
function normalizarTel(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/[\s\-().]/g, '');
  const masMas = t.startsWith('+');
  t = (masMas ? '+' : '') + t.replace(/[^0-9]/g, '');
  const digitos = t.replace(/\D/g, '');
  // Menos de 6 cifras no es un teléfono; más de 15 se sale del estándar E.164.
  if (digitos.length < 6 || digitos.length > 15) return null;
  return t.slice(0, 20);
}
