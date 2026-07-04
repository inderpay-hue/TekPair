// api/webhook.js
// Recibe eventos de Stripe y actualiza la tabla `tiendas` con el plan/estado actual.
// Centraliza TODO el estado de suscripción en `tiendas`:
//   plan, plan_status, plan_until, stripe_customer_id, stripe_sub_id, trial_until, plan_email

// W7: desactivar el body parser de Vercel. La verificación de firma de Stripe necesita
// el body EXACTO en crudo (getRawBody). Si Vercel parsea el body antes, el stream queda
// consumido y la firma siempre falla. Este handler nunca usa req.body, solo getRawBody,
// así que desactivarlo es seguro y obligatorio para que los webhooks funcionen.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  // Map de price_id → nombre de plan
  const PRICE_TO_PLAN = {
    'price_1TUEadKE1FTbu0p7OtHUDVnP': 'basico',
    'price_1TUEbPKE1FTbu0p78X80WKAH': 'pro',
    'price_1TUEbqKE1FTbu0p7U1y90BZF': 'premium'
  };

  // ═══ Verificación de firma Stripe ═══
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const body = await getRawBody(req);
    event = verifyStripeSignature(body, sig, WEBHOOK_SECRET);
  } catch(e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const sbHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  // ═══ Helper: encontrar tienda por customer_id, sub_id o email ═══
  async function findTienda({customerId, subId, email, metadataTiendaId}) {
    // W4: 1. Por tienda_id en metadata (lo más directo si el flujo lo ha guardado).
    //     Útil si en el futuro pre-creas la tienda antes del Checkout y pasas
    //     tienda_id en checkout.session.metadata.tienda_id.
    if (metadataTiendaId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(metadataTiendaId)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
    }
    // 2. Por stripe_sub_id (lo más fiable si ya está vinculado)
    if (subId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?stripe_sub_id=eq.${encodeURIComponent(subId)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
    }
    // 3. Por stripe_customer_id
    if (customerId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
    }
    // 4. Por plan_email (fallback inicial cuando aún no se ha vinculado)
    if (email) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?plan_email=eq.${encodeURIComponent(email)}&select=id,plan_email,plan&limit=1`, {headers: sbHeaders});
      const arr = await r.json();
      if (arr.length) return arr[0];
      // Fallback: buscar usuario admin por email y obtener su tienda
      const ru = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=tienda_id,plan&limit=1`, {headers: sbHeaders});
      const arrU = await ru.json();
      if (arrU.length && arrU[0].tienda_id) {
        return {id: arrU[0].tienda_id, plan_email: email, plan: arrU[0].plan};
      }
    }
    return null;
  }

  // ═══ Helper: actualizar tienda ═══
  // FIX W6: si esto falla, lanzamos excepción para que el handler devuelva 5xx
  // y Stripe reintente el webhook. Antes el error solo se logueaba y devolvíamos 200,
  // perdiendo cambios de estado sin posibilidad de recuperación.
  async function updateTienda(tiendaId, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tiendaId)}`, {
      method: 'PATCH',
      headers: {...sbHeaders, 'Prefer': 'return=minimal'},
      body: JSON.stringify(data)
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('updateTienda error:', r.status, txt);
      throw new Error('updateTienda failed: ' + r.status + ' ' + txt.slice(0, 200));
    }
  }

  // ═══ Helper: enviar email ═══
  async function sendEmail(to, subject, html) {
    if (!RESEND_KEY || !to) return;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({from:'Tekpair <info@tekpair.tech>', to:[to], subject, html})
      });
    } catch(e){ console.error('Email error:', e); }
  }

  // ═══ Helper: crear cuenta completa desde un checkout (fallback de onboarding) ═══
  // W12: si el cliente pagó en Stripe pero /api/register nunca corrió (cerró la pestaña
  // al volver del Checkout), la tienda no existe y quedaba pagando SIN cuenta en la app.
  // Este helper la crea server-to-server replicando /api/register: tienda + usuario admin
  // + email con credenciales. Idempotente: solo se invoca cuando findTienda devolvió null
  // (no hay tienda ni usuario con ese email). Si falla tras crear la tienda, hace rollback
  // y lanza para que Stripe reintente el webhook sin dejar registros a medias.
  async function crearCuentaDesdeCheckout({customerId, subId, email, plan, session}) {
    const meta = (session && session.metadata) || {};
    const nombre = meta.nombre || (email ? email.split('@')[0] : 'Cliente');
    const tiendaNombre = meta.tienda_nombre || (nombre + ' - Tienda');
    const lang = meta.lang || 'es';

    // Leer trial_end / current_period_end de la suscripción (como register.js)
    let trialUntil = null, planUntil = null;
    if (subId && STRIPE_KEY) {
      try {
        const subR = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
          headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
        });
        const sub = await subR.json();
        if (sub.trial_end) trialUntil = new Date(sub.trial_end * 1000).toISOString();
        if (sub.current_period_end) planUntil = new Date(sub.current_period_end * 1000).toISOString();
      } catch(e){ console.warn('No se pudo leer sub para trial:', e.message); }
    }
    if (!trialUntil) trialUntil = new Date(Date.now() + 15*86400000).toISOString();

    // Password temporal en bcrypt (igual que register.js)
    const tempPass = crypto.randomBytes(8).toString('hex');
    const hashV2 = await bcrypt.hash(tempPass, 10);

    // 1. Crear tienda (citas_slug es NOT NULL — generar único o falla con 23502)
    const tienda_id = 'tienda_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const _slugBase = String(tiendaNombre || nombre || 'tienda')
      .normalize('NFD').replace(/[^\x00-\x7f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tienda';
    const citasSlug = _slugBase + '-' + crypto.randomBytes(3).toString('hex');
    const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
      method: 'POST', headers: {...sbHeaders, 'Prefer': 'return=minimal'},
      body: JSON.stringify({
        id: tienda_id, nombre: tiendaNombre, plan: plan || 'basico',
        plan_status: 'trial', plan_email: email,
        stripe_customer_id: customerId, stripe_sub_id: subId,
        trial_until: trialUntil, plan_until: planUntil,
        citas_slug: citasSlug
      })
    });
    if (!tR.ok) throw new Error('crearCuenta tienda: ' + tR.status + ' ' + (await tR.text()).slice(0,200));

    // 2. Crear usuario admin (rollback de la tienda si falla, como register.js REG-6)
    const usuarioId = 'usr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST', headers: {...sbHeaders, 'Prefer': 'return=minimal'},
      body: JSON.stringify({
        id: usuarioId, tienda_id, nombre, email,
        password_hash_v2: hashV2, rol: 'admin', activo: true, permisos: { todo: true }
      })
    });
    if (!uR.ok) {
      const tx = await uR.text();
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tienda_id)}`, {
          method: 'DELETE', headers: {...sbHeaders, 'Prefer': 'return=minimal'}
        });
      } catch(e){ console.warn('No se pudo limpiar tienda huérfana:', e); }
      throw new Error('crearCuenta usuario: ' + uR.status + ' ' + tx.slice(0,200));
    }

    // 3. Email con credenciales (multiidioma compacto)
    const W = ({
      es:{s:'✓ Bienvenido a Tekpair — Tus credenciales',h:'Hola',p:'Tu cuenta está lista con 15 días de prueba gratis.',pass:'Contraseña temporal',av:'⚠️ Cambia tu contraseña tras el primer acceso.',b:'Entrar a Tekpair →'},
      en:{s:'✓ Welcome to Tekpair — Your credentials',h:'Hi',p:'Your account is ready with a 15-day free trial.',pass:'Temporary password',av:'⚠️ Change your password after first login.',b:'Sign in to Tekpair →'},
      fr:{s:'✓ Bienvenue sur Tekpair — Vos identifiants',h:'Bonjour',p:'Votre compte est prêt avec 15 jours d\'essai gratuit.',pass:'Mot de passe temporaire',av:'⚠️ Changez votre mot de passe après la première connexion.',b:'Accéder à Tekpair →'},
      it:{s:'✓ Benvenuto su Tekpair — Le tue credenziali',h:'Ciao',p:'Il tuo account è pronto con 15 giorni di prova gratuita.',pass:'Password temporanea',av:'⚠️ Cambia la password dopo il primo accesso.',b:'Accedi a Tekpair →'},
      de:{s:'✓ Willkommen bei Tekpair — Ihre Zugangsdaten',h:'Hallo',p:'Ihr Konto ist mit 15 Tagen kostenloser Testphase bereit.',pass:'Temporäres Passwort',av:'⚠️ Ändern Sie Ihr Passwort nach der ersten Anmeldung.',b:'Bei Tekpair anmelden →'},
      pt:{s:'✓ Bem-vindo ao Tekpair — As suas credenciais',h:'Olá',p:'A sua conta está pronta com 15 dias de prova gratuita.',pass:'Palavra-passe temporária',av:'⚠️ Mude a sua palavra-passe após o primeiro acesso.',b:'Entrar no Tekpair →'}
    })[lang] || ({s:'✓ Bienvenido a Tekpair — Tus credenciales',h:'Hola',p:'Tu cuenta está lista con 15 días de prueba gratis.',pass:'Contraseña temporal',av:'⚠️ Cambia tu contraseña tras el primer acceso.',b:'Entrar a Tekpair →'});
    const nombreEsc = String(nombre).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    await sendEmail(email, W.s, `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#020B2E;color:white;padding:24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:24px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <p>${W.h} <strong>${nombreEsc}</strong>,</p>
    <p>${W.p}</p>
    <div style="background:#F8FAFC;border-radius:8px;padding:16px;margin:16px 0;font-family:monospace">
      <div><strong>Email:</strong> ${email}</div>
      <div style="margin-top:8px"><strong>${W.pass}:</strong> ${tempPass}</div>
    </div>
    <p style="color:#EF4444;font-size:13px">${W.av}</p>
    <a href="https://www.tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">${W.b}</a>
  </div>
</div>`);

    console.log('Cuenta creada desde webhook (fallback onboarding):', tienda_id, 'para', email);
    return tienda_id;
  }

  try {
    switch(event.type) {

      // ═══ Checkout completado: vincular customer y sub a la tienda ═══
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subId = session.subscription;
        const email = session.customer_email || session.metadata?.email;
        const plan = session.metadata?.plan;

        // ═══ ADD-ON (multi-tienda Fase 2): crear tienda extra + enlace usuario_tiendas ═══
        if (session.metadata?.tipo === 'addon') {
          const ownerId = session.metadata?.owner_usuario_id;
          const nombreTienda = (session.metadata?.tienda_nombre || 'Nueva tienda').slice(0, 100);
          if (ownerId) {
            const planNueva = plan || 'pro';
            const nuevaId = 'tienda_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
            try {
              await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
                method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ id: nuevaId, nombre: nombreTienda, plan: planNueva, plan_status: 'active', plan_email: email, stripe_customer_id: customerId, stripe_sub_id: subId })
              });
              await fetch(`${SUPABASE_URL}/rest/v1/usuario_tiendas`, {
                method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ usuario_id: ownerId, tienda_id: nuevaId })
              });
              console.log('Add-on: tienda creada', nuevaId, 'enlazada a usuario', ownerId);
            } catch (e) { console.error('Add-on tienda create error:', e); }
          } else {
            console.warn('Add-on sin owner_usuario_id en metadata, no se crea tienda');
          }
          break; // no seguir al flujo normal de vinculación
        }

        // Detectar promotion_code usado (para tracking de afiliados)
        let codigoReferido = null;
        try {
          const sessR = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}?expand[]=total_details.breakdown.discounts`, {
            headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
          });
          const sessFull = await sessR.json();
          const disc = sessFull?.total_details?.breakdown?.discounts?.[0]?.discount;
          if (disc) {
            // Si hay promotion_code, usar su code (ej. BCNMOVILS50)
            if (disc.promotion_code) {
              const promoR = await fetch(`https://api.stripe.com/v1/promotion_codes/${disc.promotion_code}`, {
                headers: {'Authorization': `Bearer ${STRIPE_KEY}`}
              });
              const promo = await promoR.json();
              codigoReferido = promo.code || null;
            } else if (disc.coupon?.id) {
              codigoReferido = disc.coupon.id;
            }
          }
        } catch (e) {
          console.error('Error extrayendo promotion_code:', e);
        }

        const tienda = await findTienda({
          customerId,
          email,
          metadataTiendaId: session.metadata?.tienda_id  // W4: si flujo futuro lo añade
        });
        if (tienda) {
          const update = {
            stripe_customer_id: customerId,
            stripe_sub_id: subId,
            plan_email: email
          };
          if (plan) update.plan = plan;
          if (codigoReferido) {
            update.codigo_referido = codigoReferido;
            console.log('Codigo referido detectado:', codigoReferido, 'para tienda', tienda.id);
          }
          await updateTienda(tienda.id, update);
          console.log('Checkout vinculado a tienda', tienda.id);
        } else {
          // W12: nadie creó la tienda (cliente no completó /api/register). La creamos
          // aquí para que ningún pago quede sin cuenta. Requiere email para el alta.
          if (email) {
            console.warn('Checkout sin tienda asociada, creando cuenta desde webhook:', email);
            await crearCuentaDesdeCheckout({customerId, subId, email, plan, session});
          } else {
            console.warn('Checkout sin tienda ni email, no se puede crear cuenta:', customerId);
          }
        }
        break;
      }

      // ═══ Suscripción creada/actualizada: sincronizar plan, estado y fecha ═══
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subId = sub.id;
        const status = sub.status; // active, trialing, past_due, canceled, etc.
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || null;
        const planUntil = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        const trialUntil = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

        // Mapear estado de Stripe a nuestro modelo
        let planStatus = 'active';
        if (status === 'trialing') planStatus = 'trial';
        else if (status === 'past_due' || status === 'unpaid') planStatus = 'past_due';
        else if (status === 'canceled' || status === 'incomplete_expired') planStatus = 'cancelled';
        else if (status === 'active') planStatus = 'active';

        const tienda = await findTienda({customerId, subId});
        if (tienda) {
          const update = {
            plan_status: planStatus,
            plan_until: planUntil,
            trial_until: trialUntil,
            stripe_sub_id: subId,
            stripe_customer_id: customerId
          };
          if (plan) update.plan = plan;
          await updateTienda(tienda.id, update);
          console.log('Sub actualizada:', tienda.id, planStatus, plan);
        } else {
          console.warn('Sub sin tienda:', subId);
        }
        break;
      }

      // ═══ Suscripción cancelada o expirada ═══
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subId = sub.id;

        const tienda = await findTienda({customerId, subId});
        if (tienda) {
          // FIX W5: respetar el periodo ya pagado.
          // Stripe envía este evento cuando termina la gracia, pero por si llega antes
          // (cancelación inmediata) usamos current_period_end si existe.
          // Antes: plan_until = new Date().toISOString() → acceso cortado al instante
          const finPeriodo = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : new Date().toISOString();
          await updateTienda(tienda.id, {
            plan_status: 'cancelled',
            plan_until: finPeriodo
          });
          console.log('Sub cancelada:', tienda.id, 'acceso hasta:', finPeriodo);

          // Email de cancelación
          if (tienda.plan_email) {
            await sendEmail(tienda.plan_email, 'Tu suscripción ha sido cancelada — Tekpair', `
<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#374151">Suscripción cancelada</h2>
    <p>Tu suscripción a Tekpair ha sido cancelada. Tus datos se conservarán durante 30 días por si quieres reactivar.</p>
    <a href="https://www.tekpair.tech/registro.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Volver a Tekpair →</a>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">¿Algún comentario? info@tekpair.tech</p>
  </div>
</div>`);
          }
        }
        break;
      }

      // ═══ Pago exitoso: marcar active + actualizar fechas + registrar comisión ═══
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const email = invoice.customer_email;
        const subId = invoice.subscription;
        const periodStart = invoice.lines?.data?.[0]?.period?.start;
        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        const invoiceId = invoice.id;

        const tienda = await findTienda({customerId, subId, email});
        if (tienda) {
          const update = {plan_status: 'active'};
          if (periodEnd) update.plan_until = new Date(periodEnd * 1000).toISOString();
          await updateTienda(tienda.id, update);
          console.log('Pago OK:', tienda.id);

          // ═══ REFERIDOS ENTRE TIENDAS (Fase 2): premio al PRIMER pago real de la invitada ═══
          // 1 mes gratis (cupón Stripe) para la tienda que invitó Y la invitada. Solo una vez
          // (status pending → rewarded). Requiere env STRIPE_REFERRAL_COUPON_ID (cupón 100% off, once).
          try {
            const REFERRAL_COUPON = process.env.STRIPE_REFERRAL_COUPON_ID;
            const amountPaid = (invoice.amount_paid || 0) / 100;
            if (REFERRAL_COUPON && amountPaid > 0) {
              const rR = await fetch(`${SUPABASE_URL}/rest/v1/referrals?referred_tienda_id=eq.${encodeURIComponent(tienda.id)}&status=eq.pending&select=id,referrer_tienda_id&limit=1`, {headers: sbHeaders});
              const refArr = await rR.json();
              const ref = Array.isArray(refArr) && refArr[0];
              if (ref) {
                // Datos de ambas tiendas para anti-fraude.
                const refrR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(ref.referrer_tienda_id)}&select=cif,plan_email,stripe_customer_id,stripe_sub_id&limit=1`, {headers: sbHeaders});
                const referrer = (await refrR.json())[0] || {};
                const reddR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tienda.id)}&select=cif,plan_email&limit=1`, {headers: sbHeaders});
                const referred = (await reddR.json())[0] || {};
                const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, '');
                // Huella de la tarjeta por defecto de cada cliente Stripe (misma tarjeta = misma persona).
                const cardFp = async (custId) => {
                  if (!custId) return null;
                  try {
                    const r = await fetch(`https://api.stripe.com/v1/customers/${custId}/payment_methods?type=card&limit=1`, { headers: { 'Authorization': `Bearer ${STRIPE_KEY}` } });
                    if (!r.ok) return null;
                    const d = await r.json();
                    return (d && d.data && d.data[0] && d.data[0].card && d.data[0].card.fingerprint) || null;
                  } catch (e) { return null; }
                };
                let fraude = null;
                if (norm(referrer.cif) && norm(referrer.cif) === norm(referred.cif)) fraude = 'mismo CIF';
                else if (norm(referrer.plan_email) && norm(referrer.plan_email) === norm(referred.plan_email)) fraude = 'mismo email';
                else {
                  const fpRef = await cardFp(referrer.stripe_customer_id);
                  const fpRed = await cardFp(customerId);
                  if (fpRef && fpRed && fpRef === fpRed) fraude = 'misma tarjeta';
                }
                const nowIso = new Date().toISOString();
                if (fraude) {
                  await fetch(`${SUPABASE_URL}/rest/v1/referrals?id=eq.${ref.id}`, { method: 'PATCH', headers: {...sbHeaders, 'Prefer': 'return=minimal'}, body: JSON.stringify({ status: 'rechazado', nota: 'anti-fraude: ' + fraude }) });
                  console.warn('Referido RECHAZADO (anti-fraude):', ref.id, fraude);
                } else {
                  const aplicarCupon = async (sub) => {
                    if (!sub) return;
                    const p = new URLSearchParams(); p.append('coupon', REFERRAL_COUPON);
                    const cr = await fetch(`https://api.stripe.com/v1/subscriptions/${sub}`, { method: 'POST', headers: { 'Authorization': `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() });
                    if (!cr.ok) console.error('Cupón referido no aplicado a', sub, cr.status, (await cr.text()).slice(0, 150));
                  };
                  await aplicarCupon(subId);                 // tienda invitada (esta)
                  await aplicarCupon(referrer.stripe_sub_id); // tienda que invitó
                  await fetch(`${SUPABASE_URL}/rest/v1/referrals?id=eq.${ref.id}`, { method: 'PATCH', headers: {...sbHeaders, 'Prefer': 'return=minimal'}, body: JSON.stringify({ status: 'rewarded', qualified_at: nowIso, rewarded_at: nowIso }) });
                  console.log('Referido premiado:', ref.id, '→ cupón a', ref.referrer_tienda_id, 'y', tienda.id);
                }
              }
            }
          } catch (e) { console.error('Referido reward error (no bloqueante):', e); }

          // ═══ REGISTRAR PAGO REFERIDO (para comisiones de afiliados) ═══
          try {
            // Leer tienda completa para saber codigo_referido
            const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tienda.id)}&select=id,codigo_referido&limit=1`, {headers: sbHeaders});
            const tArr = await tR.json();
            const codigoReferido = tArr[0]?.codigo_referido || null;

            // Calcular importes
            const montoBruto = (invoice.subtotal || 0) / 100;  // En céntimos a euros
            const montoDescuento = (invoice.total_discount_amounts?.[0]?.amount || 0) / 100;
            const montoNeto = (invoice.amount_paid || 0) / 100;

            // Si tiene código referido, buscar afiliado para conocer su % comisión
            let comisionPct = 0;
            let comisionMonto = 0;
            if (codigoReferido) {
              const afR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigoReferido)}&select=comision_pct,activo&limit=1`, {headers: sbHeaders});
              const afArr = await afR.json();
              if (afArr[0]?.activo) {
                comisionPct = afArr[0].comision_pct || 0;
                // W8: leer IVA real de Stripe en lugar de asumir 21% hardcoded.
                // invoice.tax es el importe de IVA en céntimos. Si no existe (suscripción
                // a cliente sin tax_id en zona sin IVA), tax es 0 y baseImponible = montoNeto.
                // Esto permite que el sistema funcione correctamente para clientes UE y no-UE
                // y tipos de IVA distintos del 21% (Canarias 7%, etc.).
                const taxImporte = (invoice.tax || 0) / 100;
                const baseImponible = +(montoNeto - taxImporte).toFixed(2);
                comisionMonto = +(baseImponible * comisionPct / 100).toFixed(2);
              }
            }

            // Cuarentena M+2: comision disponible el dia 1 del mes M+2
            const _nowD = new Date();
            const fechaDisponible = new Date(_nowD.getFullYear(), _nowD.getMonth() + 2, 1, 0, 0, 0, 0);

            // INSERT en pagos_referidos (idempotente gracias a UNIQUE en stripe_invoice_id)
            const insertR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos`, {
              method: 'POST',
              headers: {...sbHeaders, 'Prefer': 'return=minimal,resolution=ignore-duplicates'},
              body: JSON.stringify({
                tienda_id: tienda.id,
                stripe_invoice_id: invoiceId,
                stripe_subscription_id: subId,
                stripe_customer_id: customerId,
                monto_bruto: montoBruto,
                monto_descuento: montoDescuento,
                monto_neto: montoNeto,
                codigo_referido: codigoReferido,
                comision_pct: comisionPct,
                comision_monto: comisionMonto,
                periodo_inicio: periodStart ? new Date(periodStart * 1000).toISOString() : null,
                periodo_fin: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
                fecha_disponible_cobro: fechaDisponible.toISOString(),
                estado_comision: 'bloqueada'
              })
            });
            if (insertR.ok) {
              console.log('Pago referido registrado:', invoiceId, 'comision:', comisionMonto);
            } else {
              const txt = await insertR.text();
              console.error('Error registrando pago referido:', txt);
            }
          } catch (e) {
            console.error('Error tracking comisión:', e);
          }
        }
        break;
      }

      // ═══ Pago fallido: marcar past_due + email ═══
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const email = invoice.customer_email;
        const subId = invoice.subscription;
        const attemptCount = invoice.attempt_count || 1;

        const tienda = await findTienda({customerId, subId, email});
        if (tienda) {
          await updateTienda(tienda.id, {plan_status: 'past_due'});
          console.log('Pago fallido:', tienda.id, 'intento', attemptCount);
        }

        // Email
        if (email) {
          await sendEmail(email, 'Problema con tu pago — Tekpair', `
<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px">
  <div style="background:#020B2E;color:white;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">⚡ Tekpair</h1>
  </div>
  <div style="background:white;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#EF4444">⚠️ Problema con tu pago</h2>
    <p>Hemos intentado cobrar tu suscripción pero el pago no se ha procesado. Intento ${attemptCount}.</p>
    <p>Por favor actualiza tu método de pago para mantener el acceso.</p>
    <a href="https://www.tekpair.tech/app.html" style="display:block;background:#0055FF;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Actualizar método →</a>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">¿Necesitas ayuda? info@tekpair.tech</p>
  </div>
</div>`);
        }
        break;
      }

      case 'charge.refunded': {
        // Anular comisiones referidas a este charge (chargeback/reembolso)
        try {
          const charge = event.data.object;
          const invoiceId = charge.invoice;
          if (invoiceId) {
            const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?stripe_invoice_id=eq.${encodeURIComponent(invoiceId)}&estado_comision=in.(bloqueada,disponible)`, {
              method: 'PATCH',
              headers: {...sbHeaders, 'Prefer': 'return=minimal'},
              body: JSON.stringify({
                estado_comision: 'anulada',
                motivo_anulacion: 'Reembolso/chargeback automatico via webhook Stripe'
              })
            });
            if (upR.ok) {
              console.log('Comision anulada por refund. Invoice:', invoiceId);
            } else {
              console.error('Error anulando comision por refund:', await upR.text());
            }
          }
        } catch (e) {
          console.error('Error handler charge.refunded:', e);
        }
        break;
      }

      default:
        console.log('Evento ignorado:', event.type);
    }

    return res.json({ received: true });

  } catch(e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: 'Webhook error' });
  }
}

// ═══ Helpers ═══
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(payload, sig, secret) {
  const crypto = require('crypto');
  if (!sig) throw new Error('Missing signature header');

  const parts = sig.split(',');
  let timestamp = '';
  let signatures = [];
  parts.forEach(part => {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  });

  if (!timestamp || !signatures.length) {
    throw new Error('Malformed signature header');
  }

  // FIX W2: rechazar eventos viejos (anti-replay attack)
  // Stripe recomienda ventana de 5 minutos
  const tsMs = parseInt(timestamp, 10) * 1000;
  if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    throw new Error('Timestamp outside tolerance window (possible replay attack)');
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');

  // FIX W1: comparación timing-safe (recomendado por Stripe)
  // Comparar con .includes() o === permite timing attacks que recuperan la firma byte a byte
  let valid = false;
  for (const sigHex of signatures) {
    try {
      const sigBuf = Buffer.from(sigHex, 'hex');
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        valid = true;
        break;
      }
    } catch (e) {
      // Ignorar firmas malformadas, seguir probando el resto
    }
  }
  if (!valid) throw new Error('Invalid signature');

  return JSON.parse(payload);
}
