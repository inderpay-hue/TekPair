// api/register.js
// Llamado tras Stripe Checkout exitoso. Crea tienda + usuario admin con plan en `tiendas`.
//
// Cambios respecto a versión anterior:
//   - REG-1: contraseña temporal en bcrypt (password_hash_v2), no SHA-256
//   - REG-2: si tienda no se crea, abortar sin crear usuario huérfano
//   - REG-3: tienda_id con entropía (no solo Date.now)
//   - REG-4: chequear email duplicado antes de insertar
//   - REG-6: no enviar email si usuario no se creó

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from './_lib/ratelimit.js';

// Referido cruzado con Cobrum: valida (GET) y acredita al dueño (POST con secreto).
const COBRUM_REFERIDO = process.env.COBRUM_REFERIDO_URL || 'https://cobrum.tech/api/referido';
async function _cobrumFetch(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (e) { return null; }
  finally { clearTimeout(t); }
}
async function validarCobrumReferido(codigo) {
  const r = await _cobrumFetch(COBRUM_REFERIDO + '?codigo=' + encodeURIComponent(codigo));
  if (!r || !r.ok) return null;
  return await r.json().catch(() => null);
}
async function acreditarCobrumReferido(codigo, refExterno) {
  const r = await _cobrumFetch(COBRUM_REFERIDO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ref-Secret': process.env.REFERIDO_SECRET || '' },
    body: JSON.stringify({ codigo, producto: 'tekpair', ref_externo: refExterno }),
  });
  if (!r || !r.ok) return false;
  const d = await r.json().catch(() => ({}));
  return !!d.ok;
}

// F195: traducir mensajes de error al idioma del cliente (body.lang o Accept-Language).
function _apiLang(req) {
  try {
    let l = (req.body && req.body.lang) || '';
    if (!l) { const al = (req.headers && req.headers['accept-language']) || ''; l = al.split(',')[0].slice(0, 2).toLowerCase(); }
    return ['es', 'en', 'fr', 'it', 'de', 'pt'].includes(l) ? l : 'es';
  } catch (e) { return 'es'; }
}
const _RMSG = {
  'Demasiados intentos de registro. Espera un momento.': { en:'Too many registration attempts. Please wait a moment.', fr:'Trop de tentatives d\'inscription. Patientez un instant.', it:'Troppi tentativi di registrazione. Attendi un momento.', de:'Zu viele Registrierungsversuche. Bitte einen Moment warten.', pt:'Demasiadas tentativas de registo. Aguarda um momento.' },
  'Faltan datos': { en:'Missing data', fr:'Données manquantes', it:'Dati mancanti', de:'Fehlende Daten', pt:'Dados em falta' },
  'Error al crear cuenta': { en:'Could not create account', fr:'Impossible de créer le compte', it:'Impossibile creare l\'account', de:'Konto konnte nicht erstellt werden', pt:'Não foi possível criar a conta' }
};
function _loc(msg, req) {
  const l = _apiLang(req);
  if (l === 'es') return msg;
  const t = _RMSG[msg];
  return (t && t[l]) || msg;
}

const BCRYPT_ROUNDS = 10;

// REG-11: rate limiting — máx 5 registros por IP cada hora (distribuido vía api/_lib/ratelimit.js).
// Previene creación masiva de cuentas y abuso del trial gratuito.
function _getIp(req) {
  return ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // REG-11: rate limit por IP
  const ip = _getIp(req);
  const _rl = await rateLimit('register:' + ip, 5, 60 * 60);
  if (!_rl.ok) {
    return res.status(429).json({ error: _loc('Demasiados intentos de registro. Espera un momento.', req) });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  const { session_id } = req.body;
  let { email, nombre, tienda_nombre, plan } = req.body;

  try {
    // ═══ 1. Recuperar info de Stripe (customer_id, sub_id, trial_end, METADATA) ═══
    // CHK-2 fix: ahora el success_url no lleva datos personales en URL.
    // Si email/nombre/etc. no vienen en req.body, se leen del metadata de la session Stripe.
    let stripeCustomerId = null;
    let stripeSubId = null;
    let refCode = String(req.body.ref || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    // Teléfono de contacto de la tienda. Es obligatorio en el formulario, pero aquí
    // no se exige: si por lo que sea llegara vacío, el alta no debe romperse — el
    // cliente ya ha pagado a estas alturas.
    let telefono = String(req.body.tel || '').trim().slice(0, 20) || null;
    let trialUntil = null;
    let planUntil = null;

    let session = null;
    if (session_id && STRIPE_KEY) {
      try {
        const sR = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}?expand[]=subscription`, {
          headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
        });
        session = await sR.json();
        stripeCustomerId = session.customer || null;
        // CHK-2 fix: leer datos del metadata si no vinieron en body
        if (session.metadata) {
          if (!email && session.metadata.email) email = session.metadata.email;
          if (!nombre && session.metadata.nombre) nombre = session.metadata.nombre;
          if (!tienda_nombre && session.metadata.tienda_nombre) tienda_nombre = session.metadata.tienda_nombre;
          if (!plan && session.metadata.plan) plan = session.metadata.plan;
          if (session.metadata.ref) refCode = String(session.metadata.ref).replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
          if (session.metadata.tel && !telefono) telefono = String(session.metadata.tel).slice(0, 20);
        }
        // Fallback adicional: customer_email del Checkout si el metadata no lo tenía
        if (!email && session.customer_email) email = session.customer_email;
        // En la API nueva de Stripe el fin de periodo vive en el ITEM, no en la
        // suscripción; mirando solo arriba se guardaba null y la tienda nacía sin
        // fecha de próximo cobro. Se leen los dos sitios.
        const _finPeriodo = (sub) => {
          const seg = sub?.items?.data?.[0]?.current_period_end || sub?.current_period_end;
          return seg ? new Date(seg * 1000).toISOString() : null;
        };
        if (session.subscription) {
          let subObj = null;
          if (typeof session.subscription === 'string') {
            stripeSubId = session.subscription;
            const subR = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
              headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
            });
            subObj = await subR.json();
          } else {
            stripeSubId = session.subscription.id;
            subObj = session.subscription;
          }
          if (subObj) {
            if (subObj.trial_end) trialUntil = new Date(subObj.trial_end * 1000).toISOString();
            planUntil = _finPeriodo(subObj) || planUntil;
          }
        }
      } catch(e) { console.warn('No se pudo recuperar info de Stripe:', e.message); }
    }

    // AUD-fix: exigir una sesión de Checkout REAL y completada. Sin esto, un POST directo sin
    // session_id (o con uno inválido) crearía una cuenta trial saltándose el checkout/captura de tarjeta.
    if (!session || session.error || !stripeCustomerId || session.status !== 'complete') {
      return res.status(400).json({ error: 'Sesión de pago no válida' });
    }

    // Validar que tengamos datos mínimos tras leer Stripe
    if (!email || !nombre) {
      return res.status(400).json({ error: _loc('Faltan datos', req) });
    }

    // ═══ REG-4: Verificar que el email no existe ya ═══
    // Si existe, abortar antes de crear nada.
    const checkR = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (checkR.ok) {
      const existentes = await checkR.json();
      if (existentes && existentes.length > 0) {
        return res.status(409).json({
          error: 'Ya existe una cuenta con este email. Inicia sesión en lugar de registrarte.'
        });
      }
    }

    // Si Stripe no nos dio el trial, calcularlo manual (15 días)
    if (!trialUntil) {
      trialUntil = new Date(Date.now() + 15*86400000).toISOString();
    }

    // ═══ 2. Generar password temporal con BCRYPT (REG-1) ═══
    const tempPass = crypto.randomBytes(8).toString('hex');
    const hashV2 = await bcrypt.hash(tempPass, BCRYPT_ROUNDS);

    // ═══ REG-3: tienda_id con entropía (no solo Date.now) ═══
    // Date.now() solo permite ~1 registro por milisegundo. Si dos personas se registran
    // a la vez, ambas obtienen el mismo ID → PK conflict. Sufijo aleatorio evita esto.
    const tienda_id = 'tienda_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    // REG-12: `citas_slug` es NOT NULL en `tiendas` (clave de la URL pública de citas).
    // Si no se rellena, el INSERT falla con 23502 y el registro ENTERO se rompe. Generamos
    // uno único (slug del nombre + sufijo aleatorio); el dueño puede cambiarlo en Ajustes.
    const _slugBase = String(tienda_nombre || nombre || 'tienda')
      .normalize('NFD').replace(/[^\x00-\x7f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tienda';
    const citasSlug = _slugBase + '-' + crypto.randomBytes(3).toString('hex');
    const tiendaData = {
      id: tienda_id,
      nombre: tienda_nombre || nombre + ' - Tienda',
      plan: plan || 'basico',
      plan_status: 'trial',
      plan_email: email,
      stripe_customer_id: stripeCustomerId,
      stripe_sub_id: stripeSubId,
      trial_until: trialUntil,
      plan_until: planUntil,
      citas_slug: citasSlug,
      telefono: telefono
    };

    // ═══ REG-2: si tienda no se crea, abortar ═══
    // Antes: el error se logueaba pero se seguía creando el usuario sin tienda → huérfano.
    const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(tiendaData)
    });
    if (!tR.ok) {
      const tx = await tR.text();
      console.error('Tienda creation error:', tR.status, tx);
      return res.status(500).json({
        error: 'No se pudo crear la tienda. Contacta soporte.'
      });
    }

    // ═══ 4. Crear usuario admin ═══
    const usuarioId = 'usr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        id: usuarioId,
        tienda_id,
        nombre,
        email,
        password_hash_v2: hashV2,  // REG-1: bcrypt en lugar de SHA-256
        rol: 'admin',
        activo: true,
        permisos: { todo: true }
      })
    });

    let realUserId = usuarioId;
    if (uR.ok) {
      try {
        const usrCreated = await uR.json();
        if (usrCreated && usrCreated[0] && usrCreated[0].id) realUserId = usrCreated[0].id;
      } catch(e){}
    } else {
      // ═══ REG-6: si usuario no se creó, intentar rollback de tienda y devolver error ═══
      const tx = await uR.text();
      console.error('Usuario creation error:', uR.status, tx);
      // Rollback best-effort: borrar la tienda recién creada para no dejar huérfana
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tienda_id)}`, {
          method: 'DELETE',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'return=minimal' }
        });
      } catch (e) { console.warn('No se pudo limpiar tienda huérfana:', e); }
      return res.status(500).json({
        error: 'No se pudo crear el usuario. Contacta soporte.'
      });
    }

    // ═══ 4.5. Crear SESIÓN automática (para que /api/me funcione al entrar) ═══
    const sessionToken = crypto.randomBytes(32).toString('hex');
    // Sesión de 7 días, consistente con login.js (L8): reduce ventana de daño si el token se filtra.
    const sessionExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sesiones`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          usuario_id: realUserId,
          tienda_id,
          token: sessionToken,
          expires_at: sessionExpires
        })
      });
    } catch(e) { console.warn('No se pudo crear sesión:', e.message); }

    // ═══ 5. Email con credenciales ═══
    // REG-6: solo enviamos email si llegamos hasta aquí (usuario y tienda creados OK)
    if (RESEND_KEY) {
      const planLabel = ({basico:'Básico', pro:'Pro', top:'Premium'})[plan] || 'Básico';
      const lang = (session && session.metadata && session.metadata.lang) || 'es';
      const WELCOME = {
        es: { subj:'✓ Bienvenido a Tekpair — Tus credenciales', hola:'Hola', suscripcion:'Tu suscripción', activa:'está activa con 15 días de prueba gratis.', credenciales:'Tus credenciales', pass:'Contraseña temporal', aviso:'⚠️ Cambia tu contraseña tras el primer acceso.', btn:'Entrar a Tekpair →', prueba:'Tu prueba gratis termina el', cobro:'Después se cobrará automáticamente. Puedes cancelar en cualquier momento desde Mi cuenta.', cuenta:'Tu cuenta está lista' },
        en: { subj:'✓ Welcome to Tekpair — Your credentials', hola:'Hi', suscripcion:'Your subscription', activa:'is active with a 15-day free trial.', credenciales:'Your credentials', pass:'Temporary password', aviso:'⚠️ Change your password after first login.', btn:'Sign in to Tekpair →', prueba:'Your free trial ends on', cobro:'After that, you will be charged automatically. You can cancel anytime from My account.', cuenta:'Your account is ready' },
        fr: { subj:'✓ Bienvenue sur Tekpair — Vos identifiants', hola:'Bonjour', suscripcion:'Votre abonnement', activa:'est actif avec 15 jours d\'essai gratuit.', credenciales:'Vos identifiants', pass:'Mot de passe temporaire', aviso:'⚠️ Changez votre mot de passe après la première connexion.', btn:'Accéder à Tekpair →', prueba:'Votre essai gratuit se termine le', cobro:'Ensuite, vous serez facturé automatiquement. Vous pouvez annuler à tout moment.', cuenta:'Votre compte est prêt' },
        it: { subj:'✓ Benvenuto su Tekpair — Le tue credenziali', hola:'Ciao', suscripcion:'Il tuo abbonamento', activa:'è attivo con 15 giorni di prova gratuita.', credenciales:'Le tue credenziali', pass:'Password temporanea', aviso:'⚠️ Cambia la password dopo il primo accesso.', btn:'Accedi a Tekpair →', prueba:'La tua prova gratuita termina il', cobro:'Successivamente verrà addebitato automaticamente. Puoi annullare in qualsiasi momento.', cuenta:'Il tuo account è pronto' },
        de: { subj:'✓ Willkommen bei Tekpair — Ihre Zugangsdaten', hola:'Hallo', suscripcion:'Ihr Abonnement', activa:'ist mit 15 Tagen kostenloser Testphase aktiv.', credenciales:'Ihre Zugangsdaten', pass:'Temporäres Passwort', aviso:'⚠️ Ändern Sie Ihr Passwort nach der ersten Anmeldung.', btn:'Bei Tekpair anmelden →', prueba:'Ihre kostenlose Testphase endet am', cobro:'Danach wird automatisch abgerechnet. Sie können jederzeit kündigen.', cuenta:'Ihr Konto ist bereit' },
        pt: { subj:'✓ Bem-vindo ao Tekpair — As suas credenciais', hola:'Olá', suscripcion:'A sua subscrição', activa:'está ativa com 15 dias de prova gratuita.', credenciales:'As suas credenciais', pass:'Palavra-passe temporária', aviso:'⚠️ Mude a sua palavra-passe após o primeiro acesso.', btn:'Entrar no Tekpair →', prueba:'A sua prova gratuita termina a', cobro:'Depois será cobrado automaticamente. Pode cancelar a qualquer momento em A minha conta.', cuenta:'A sua conta está pronta' }
      };
      const W = WELCOME[lang] || WELCOME.es;
      const trialDate = new Date(trialUntil).toLocaleDateString(lang === 'en' ? 'en-GB' : lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : lang === 'it' ? 'it-IT' : lang === 'pt' ? 'pt-PT' : 'es-ES');
      // REG-9: escapar nombre por si trae caracteres especiales (aunque emails no ejecutan JS, romper HTML es feo)
      const nombreEsc = String(nombre).replace(/[<>&"']/g, function(c) {
        return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c];
      });
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Tekpair <info@tekpair.tech>',
          to: [email],
          subject: W.subj,
          html: `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#020B2E;color:white;padding:24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:24px">⚡ Tekpair</h1>
    <p style="margin:8px 0 0;opacity:.7">${W.cuenta}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p>${W.hola} <strong>${nombreEsc}</strong>,</p>
    <p>${W.suscripcion} <strong style="color:#0055FF">plan ${planLabel}</strong> ${W.activa}</p>
    <div style="background:#F8FAFC;border-radius:8px;padding:16px;margin:16px 0;font-family:monospace">
      <div><strong>Email:</strong> ${email}</div>
      <div style="margin-top:8px"><strong>${W.pass}:</strong> ${tempPass}</div>
    </div>
    <p style="color:#EF4444;font-size:13px">${W.aviso}</p>
    <a href="https://www.tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">${W.btn}</a>
    <p style="color:#64748B;font-size:12px;margin-top:16px">${W.prueba} ${trialDate}. ${W.cobro}</p>
  </div>
</body></html>`
        })
      });
    }

    // ═══ Referidos: si vino con código, registrar la invitación (status pending) ═══
    if (refCode) {
      let referrerId = null;
      try {
        const refR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?referral_code=eq.${encodeURIComponent(refCode)}&select=id&limit=1`, {
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
        });
        const refRows = await refR.json();
        referrerId = Array.isArray(refRows) && refRows[0] && refRows[0].id;
        // No auto-referidos (misma tienda) ni código inexistente.
        if (referrerId && referrerId !== tienda_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/referrals`, {
            method: 'POST',
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ referrer_tienda_id: referrerId, referred_tienda_id: tienda_id, referred_email: email, referred_nombre: tienda_nombre || nombre, codigo: refCode, status: 'pending' })
          });
        }
      } catch (e) { console.error('Referral record error (no bloqueante):', e); }

      // Si el código NO es de TekPair, probarlo como referido cruzado de Cobrum → +30 días de trial.
      if (!referrerId) {
        try {
          const val = await validarCobrumReferido(refCode);
          if (val && val.valid) {
            const ok = await acreditarCobrumReferido(refCode, email);
            if (ok) {
              const base = (trialUntil && new Date(trialUntil) > new Date()) ? new Date(trialUntil) : new Date();
              base.setDate(base.getDate() + 30);
              await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${tienda_id}`, {
                method: 'PATCH',
                headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                body: JSON.stringify({ trial_until: base.toISOString() })
              });
            }
          }
        } catch (e) { console.error('Cobrum referral error (no bloqueante):', e); }
      }
    }

    // ═══ Aviso al dueño: alta nueva, con el WhatsApp listo para escribirle ═══
    // Va al final y con su propio try/catch: si esto fallara, el cliente ya está
    // dado de alta y no puede enterarse de nada.
    try {
      await avisarAltaNueva({ nombre, email, telefono, tienda_nombre: tiendaData.nombre, plan, trialUntil, refCode, RESEND_KEY });
    } catch (e) { console.error('[alta] aviso al dueño (no bloqueante):', e.message); }

    return res.json({ ok: true, tienda_id, tempPass, sessionToken, nombre });

  } catch(e) {
    console.error('Setup error:', e);
    return res.status(500).json({ error: _loc('Error al crear cuenta', req) });
  }
}


// ═══ AVISO DE ALTA NUEVA (para el dueño de TekPair, no para el cliente) ═══
//
// Por qué existe: el correo no lo lee casi nadie. De los primeros clientes de
// pago, uno estuvo 52 días sin entrar y a otro le rebotó el cobro; a ninguno se
// le pudo escribir por otra vía. Ahora cada alta llega con un enlace de WhatsApp
// listo: se pulsa y se abre la conversación con el mensaje ya escrito.
//
// El mensaje NO se envía solo a propósito. Automatizar WhatsApp sin la API
// oficial de Meta se salta sus términos y arriesga el baneo del número. Y con
// pocas altas al día, un mensaje que se envía a mano se responde mucho más que
// uno que huele a robot: aquí lo que hace falta es que contesten.
//
// ALERTAS_EMAIL cambia el destinatario (por defecto info@tekpair.tech).
async function avisarAltaNueva(d) {
  if (!d.RESEND_KEY) { console.warn('[alta] sin RESEND_API_KEY, no se avisa'); return; }
  const destino = process.env.ALERTAS_EMAIL || 'info@tekpair.tech';
  const esc = (v) => String(v == null ? '' : v).replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

  // wa.me quiere el número sin '+' ni separadores.
  const telLimpio = String(d.telefono || '').replace(/\D/g, '');
  const primerNombre = String(d.nombre || '').trim().split(' ')[0] || '';

  const saludo = `Hola ${primerNombre}, te escribimos de TekPair 👋\n\n` +
    'Acabamos de ver que has creado tu cuenta. Si te atascas con algo (montar tus servicios, ' +
    'los precios o las primeras reparaciones), escríbenos por aquí y te echamos una mano.\n\n' +
    'Este es nuestro WhatsApp, así que guárdalo y úsalo cuando lo necesites.\n\n' +
    'Un saludo,\nEl equipo de TekPair';
  const enlaceWa = telLimpio ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(saludo)}` : null;

  const planLabel = ({ basico: 'Básico', pro: 'Pro', top: 'Premium', premium: 'Premium' })[d.plan] || d.plan || '—';
  const cobro = d.trialUntil ? new Date(d.trialUntil).toLocaleDateString('es', { day: 'numeric', month: 'long' }) : '—';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <h2 style="margin:0 0 4px">🎉 Alta nueva: ${esc(d.tienda_nombre)}</h2>
  <p style="color:#64748B;margin:0 0 18px;font-size:13px">Aviso interno. Al cliente no le llega nada de esto.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:7px 0;color:#64748B;width:110px">Nombre</td><td style="padding:7px 0"><b>${esc(d.nombre)}</b></td></tr>
    <tr><td style="padding:7px 0;color:#64748B">Email</td><td style="padding:7px 0">${esc(d.email)}</td></tr>
    <tr><td style="padding:7px 0;color:#64748B">Teléfono</td><td style="padding:7px 0"><b>${esc(d.telefono) || '<span style="color:#B91C1C">no lo dejó</span>'}</b></td></tr>
    <tr><td style="padding:7px 0;color:#64748B">Plan</td><td style="padding:7px 0">${esc(planLabel)}</td></tr>
    <tr><td style="padding:7px 0;color:#64748B">Primer cobro</td><td style="padding:7px 0">${esc(cobro)}</td></tr>
    ${d.refCode ? `<tr><td style="padding:7px 0;color:#64748B">Código</td><td style="padding:7px 0"><b>${esc(d.refCode)}</b> (comercial)</td></tr>` : ''}
  </table>
  ${enlaceWa ? `<a href="${enlaceWa}" style="display:block;background:#25D366;color:#fff;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-weight:700;margin:22px 0 10px">💬 Escribirle por WhatsApp</a>
  <p style="font-size:12px;color:#64748B;margin:0 0 18px">Se abre con el mensaje ya escrito. Léelo antes de enviarlo y cámbialo a tu manera de hablar.</p>`
  : '<p style="background:#FEF2F2;border-left:4px solid #B91C1C;padding:12px 14px;font-size:13px;margin:20px 0">Sin teléfono válido: solo se le puede escribir por correo.</p>'}
  <p style="font-size:13px;color:#475569;border-top:1px solid #eee;padding-top:14px">
    Los primeros días deciden si este cliente se queda. Media hora ahora vale más que cualquier correo automático dentro de un mes.
  </p>
</body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${d.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Tekpair <info@tekpair.tech>',
      to: [destino],
      subject: `🎉 Alta nueva: ${d.tienda_nombre}${d.telefono ? ' · ' + d.telefono : ''}`,
      html,
    }),
  });
  if (!r.ok) console.error('[alta] Resend respondió', r.status, await r.text());
}
