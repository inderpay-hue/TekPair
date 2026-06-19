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

// REG-11: rate limiting — máx 5 registros por IP cada hora
// Previene creación masiva de cuentas y abuso del trial gratuito
const _regLimits = new Map();
function _checkRegLimit(ip) {
  const now = Date.now();
  const WINDOW = 60 * 60 * 1000; // 1 hora
  const MAX = 5;
  let e = _regLimits.get(ip);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + WINDOW };
  e.count++;
  _regLimits.set(ip, e);
  if (_regLimits.size > 500) {
    for (const [k, v] of _regLimits) if (now > v.resetAt) _regLimits.delete(k);
  }
  return e.count <= MAX;
}
function _getIp(req) {
  return ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // REG-11: rate limit por IP
  const ip = _getIp(req);
  if (!_checkRegLimit(ip)) {
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
        }
        // Fallback adicional: customer_email del Checkout si el metadata no lo tenía
        if (!email && session.customer_email) email = session.customer_email;
        if (session.subscription) {
          if (typeof session.subscription === 'string') {
            stripeSubId = session.subscription;
            const subR = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
              headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
            });
            const sub = await subR.json();
            if (sub.trial_end) trialUntil = new Date(sub.trial_end * 1000).toISOString();
            if (sub.current_period_end) planUntil = new Date(sub.current_period_end * 1000).toISOString();
          } else {
            stripeSubId = session.subscription.id;
            if (session.subscription.trial_end) trialUntil = new Date(session.subscription.trial_end * 1000).toISOString();
            if (session.subscription.current_period_end) planUntil = new Date(session.subscription.current_period_end * 1000).toISOString();
          }
        }
      } catch(e) { console.warn('No se pudo recuperar info de Stripe:', e.message); }
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
    const tiendaData = {
      id: tienda_id,
      nombre: tienda_nombre || nombre + ' - Tienda',
      plan: plan || 'basico',
      plan_status: 'trial',
      plan_email: email,
      stripe_customer_id: stripeCustomerId,
      stripe_sub_id: stripeSubId,
      trial_until: trialUntil,
      plan_until: planUntil
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
        error: 'No se pudo crear la tienda. Contacta soporte.',
        detail: tx.slice(0, 200)
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
        error: 'No se pudo crear el usuario. Contacta soporte.',
        detail: tx.slice(0, 200)
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
      try {
        const refR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?referral_code=eq.${encodeURIComponent(refCode)}&select=id&limit=1`, {
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
        });
        const refRows = await refR.json();
        const referrerId = Array.isArray(refRows) && refRows[0] && refRows[0].id;
        // No auto-referidos (misma tienda) ni código inexistente.
        if (referrerId && referrerId !== tienda_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/referrals`, {
            method: 'POST',
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ referrer_tienda_id: referrerId, referred_tienda_id: tienda_id, referred_email: email, referred_nombre: tienda_nombre || nombre, codigo: refCode, status: 'pending' })
          });
        }
      } catch (e) { console.error('Referral record error (no bloqueante):', e); }
    }

    return res.json({ ok: true, tienda_id, tempPass, sessionToken, nombre });

  } catch(e) {
    console.error('Setup error:', e);
    return res.status(500).json({ error: _loc('Error al crear cuenta', req) });
  }
}
