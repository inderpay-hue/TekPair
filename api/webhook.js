// api/webhook.js
// Recibe eventos de Stripe y actualiza la tabla `tiendas` con el plan/estado actual.
// Centraliza TODO el estado de suscripción en `tiendas`:
//   plan, plan_status, plan_until, stripe_customer_id, stripe_sub_id, trial_until, plan_email

// W7: desactivar el body parser de Vercel. La verificación de firma de Stripe necesita
// el body EXACTO en crudo (getRawBody). Si Vercel parsea el body antes, el stream queda
// consumido y la firma siempre falla. Este handler nunca usa req.body, solo getRawBody,
// así que desactivarlo es seguro y obligatorio para que los webhooks funcionen.
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
          console.warn('Checkout sin tienda asociada:', email);
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
