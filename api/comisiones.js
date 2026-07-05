// api/comisiones.js
// Endpoint para consultar comisiones de afiliados.
// Visibilidad:
//   - Admin (info@tekpair.tech con rol=admin) ve TODAS las comisiones de todos los afiliados
//   - Afiliados normales ven SOLO sus propias comisiones
//   - Cualquier otro usuario: 403 Forbidden

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { rateLimit } from './_lib/ratelimit.js';

const ADMIN_EMAILS = ['info@tekpair.tech'];
const BCRYPT_ROUNDS = 10;

// COM-7: lock en memoria para evitar race condition al generar justificante_numero.
// Si dos requests del admin marcan comisiones casi a la vez, se serializa la
// generación de número correlativo. Solo cubre concurrencia dentro de la misma
// instancia Vercel — múltiples instancias pueden colisionar todavía pero es
// muy raro porque solo el admin ejecuta esto. Para eliminarlo del todo habría
// que migrar a un sequence Postgres con nextval().
let _justificanteLock = Promise.resolve();

async function _generarJustificanteNumero(SUPABASE_URL, sbHeaders) {
  // Encolar esta llamada detrás de la anterior
  const prev = _justificanteLock;
  let release;
  _justificanteLock = new Promise(r => { release = r; });
  try {
    await prev;
    const year = new Date().getFullYear();
    const cntR = await fetch(
      `${SUPABASE_URL}/rest/v1/pagos_referidos?justificante_numero=like.JUST-${year}-*&select=justificante_numero&order=justificante_numero.desc&limit=1`,
      { headers: sbHeaders }
    );
    const cntArr = await cntR.json();
    let nextNum = 1;
    if (cntArr[0] && cntArr[0].justificante_numero) {
      const m = cntArr[0].justificante_numero.match(/JUST-\d{4}-(\d+)/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    return 'JUST-' + year + '-' + String(nextNum).padStart(3, '0');
  } finally {
    release();
  }
}

// COM-4: generador de password aleatorio fuerte (16 chars, base64url)
// Antes la password era predecible: codigo.toLowerCase() + año (ej "juan2026")
// Ahora es 96 bits de entropía aleatoria, imposible de adivinar.
function generarPasswordAleatorio() {
  // 12 bytes = 16 chars en base64. Quitamos +/= para que sea fácil de leer/copiar.
  return crypto.randomBytes(12).toString('base64')
    .replace(/\+/g, 'a')
    .replace(/\//g, 'b')
    .replace(/=/g, '');
}

// SEGURIDAD: código secreto de superadmin para acciones críticas.
// Vive SOLO en process.env.SUPERADMIN_SECRET (no en BD ni en el JWT/sesión) → aunque se
// filtren datos o un token, nadie puede ejecutar cambios sin conocer el código.
// Fail-closed: si no está configurado, las acciones críticas se rechazan.
function verificarSecreto(codigo) {
  const secret = process.env.SUPERADMIN_SECRET;
  if (!secret) return false;
  if (typeof codigo !== 'string' || !codigo) return false;
  const a = Buffer.from(codigo);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const ACCIONES_CRITICAS = [
  'marcar_pagado', 'marcar_codigo_pagado', 'crear_cuenta_comercial',
  'crear_afiliado', 'editar_afiliado', 'eliminar_afiliado', 'dar_de_baja_comercial',
];

// COM-9: validar y normalizar comision_pct con rango 0-100.
// Antes `parseInt(comision_pct) || 20` convertía un válido 0 en 20 (||), y aceptaba
// valores absurdos como 99999 o -50. Ahora rechaza fuera de rango.
function normalizarComisionPct(raw, fallback = 20) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  // AUD-fix: Number + isInteger rechaza '50abc'/'33.9' (parseInt los truncaba y aceptaba).
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) return null;  // null = inválido
  return n;
}

// COM-RATE: rate limiting — máx 60 req/min por usuario (distribuido vía api/_lib/ratelimit.js).

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

  // ═══ 1. Verificar autenticación ═══
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido' });
  }

  const userId = decoded.sub || '';
  const tiendaId = decoded.tienda_id || '';

  if (!userId || !tiendaId) return res.status(401).json({ error: 'Token incompleto' });
  const _rl = await rateLimit('comisiones:' + userId, 60, 60);
  if (!_rl.ok) return res.status(429).json({ error: 'Demasiadas peticiones' });

  const sbHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // Obtener email y rol del usuario desde la BD
    const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(userId)}&select=email,rol,activo&limit=1`, {
      headers: sbHeaders
    });
    const uArr = await uR.json();
    const usuario = uArr[0];
    const userEmail = (usuario?.email || '').toLowerCase();

    if (!userEmail) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (usuario && usuario.activo === false) return res.status(401).json({ error: 'Cuenta desactivada' });

    // ═══ 2. Determinar rol del usuario ═══
    // COM-5: chequear AMBOS — email en allowlist Y rol=admin en BD.
    // Antes solo se chequeaba el email, así que si alguien tenía email info@tekpair.tech
    // pero rol normal o activo=false igual le daba acceso total.
    const isAdmin = ADMIN_EMAILS.includes(userEmail) && usuario.rol === 'admin';

    // ═══ POST: acciones de admin (marcar como pagado) ═══
    if (req.method === 'POST') {
      if (!isAdmin) return res.status(403).json({ error: 'Solo admin' });

      const body = req.body || {};
      const action = body.action;

      // SEGURIDAD: acciones críticas exigen el código secreto de superadmin (2º factor).
      if (ACCIONES_CRITICAS.includes(action) && !verificarSecreto(body.codigo_secreto)) {
        return res.status(403).json({ error: 'Código secreto incorrecto o no configurado', need_secret: true });
      }

      if (action === 'marcar_pagado' && Array.isArray(body.ids) && body.ids.length) {
        const ids = body.ids.filter(n => Number.isInteger(n));
        if (!ids.length) return res.status(400).json({ error: 'IDs invalidos' });

        // Verificar que todos estan en estado disponible
        const idsStr = ids.join(',');
        const checkR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})&select=id,estado_comision`, {
          headers: sbHeaders
        });
        const checkArr = await checkR.json();
        const noDisp = checkArr.filter(p => p.estado_comision !== 'disponible');
        if (noDisp.length) {
          return res.status(400).json({ error: 'Hay comisiones no disponibles para pagar' });
        }

        // COM-7: Generar número de justificante con lock (serializa generaciones concurrentes)
        const justificante = await _generarJustificanteNumero(SUPABASE_URL, sbHeaders);
        const fechaPago = body.fecha_pago || new Date().toISOString();

        const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({
            comision_pagada: true,
            estado_comision: 'pagada',
            fecha_pago: fechaPago,
            justificante_numero: justificante
          })
        });
        if (!upR.ok) {
          const txt = await upR.text();
          console.error('Error PATCH pagos_referidos (marcar_pagado):', upR.status, txt);
          return res.status(500).json({ error: 'No se pudieron marcar las comisiones como pagadas' });
        }
        return res.json({ ok: true, marcados: ids.length, justificante_numero: justificante, fecha_pago: fechaPago });
      }

      if (action === 'marcar_codigo_pagado' && body.codigo) {
        // Solo los que esten en estado disponible
        const listR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(body.codigo)}&estado_comision=eq.disponible&select=id`, {
          headers: sbHeaders
        });
        const listArr = await listR.json();
        if (!listArr.length) {
          return res.status(400).json({ error: 'No hay comisiones disponibles para pagar' });
        }

        // COM-7: Generar número de justificante con lock
        const justificante = await _generarJustificanteNumero(SUPABASE_URL, sbHeaders);
        const fechaPago = body.fecha_pago || new Date().toISOString();
        const ids = listArr.map(p => p.id);
        const idsStr = ids.join(',');

        const upR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?id=in.(${idsStr})`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({
            comision_pagada: true,
            estado_comision: 'pagada',
            fecha_pago: fechaPago,
            justificante_numero: justificante
          })
        });
        if (!upR.ok) {
          const txt = await upR.text();
          console.error('Error PATCH pagos_referidos (marcar_codigo_pagado):', upR.status, txt);
          return res.status(500).json({ error: 'No se pudieron marcar las comisiones como pagadas' });
        }
        return res.json({ ok: true, codigo: body.codigo, marcados: ids.length, justificante_numero: justificante, fecha_pago: fechaPago });
      }

      // ═══ Crear cuenta del comercial (Paso 1 del wizard) ═══
      if (action === 'crear_cuenta_comercial') {
        const { codigo, nombre, email, comision_pct } = body;
        if (!codigo || !nombre || !email) return res.status(400).json({ error: 'Faltan datos obligatorios' });

        const codigoNorm = codigo.toUpperCase().trim();
        const emailNorm = email.toLowerCase().trim();
        // COM-9: validar rango de comision_pct (0-100)
        const comisionPct = normalizarComisionPct(comision_pct, 20);
        if (comisionPct === null) return res.status(400).json({ error: 'comision_pct debe estar entre 0 y 100' });

        // Verificar codigo unico en afiliados
        const dupAfR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigoNorm)}&select=codigo&limit=1`, { headers: sbHeaders });
        const dupAf = await dupAfR.json();
        if (dupAf.length) return res.status(400).json({ error: 'Ese codigo de afiliado ya existe' });

        // Verificar si el email ya existe en usuarios
        // COM-10: si ya existe, añadirlo como afiliado sin crear cuenta nueva
        const dupUR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(emailNorm)}&select=email,id,tienda_id&limit=1`, { headers: sbHeaders });
        const dupU = await dupUR.json();
        if (dupU.length) {
          // El email ya tiene cuenta — solo crear el registro de afiliado
          const existingUser = dupU[0];
          const tiendaAfiliado = existingUser.tienda_id || tiendaId;
          const comisionPctAfil = normalizarComisionPct(comision_pct, 20);

          const afilR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados`, {
            method: 'POST',
            headers: {...sbHeaders, 'Prefer': 'return=minimal'},
            body: JSON.stringify({
              codigo: codigoNorm,
              nombre: nombre.trim(),
              email: emailNorm,
              comision_pct: comisionPctAfil,
              activo: true,
              tienda_id: tiendaAfiliado
            })
          });
          if (!afilR.ok) {
            const t = await afilR.text();
            console.error('Error POST afiliados (usuario existente):', afilR.status, t);
            return res.status(500).json({ error: 'No se pudo crear el afiliado' });
          }
          return res.json({
            ok: true,
            solo_afiliado: true,
            email: emailNorm,
            codigo: codigoNorm,
            nombre: nombre.trim(),
            comision_pct: comisionPctAfil,
            mensaje: 'El email ya tiene cuenta en TekPair — añadido solo como afiliado'
          });
        }

        // COM-4: Generar password aleatorio fuerte (96 bits entropía)
        // Antes: codigo.toLowerCase() + year → predecible si conoces el código
        const passwordPlano = generarPasswordAleatorio();
        // COM-2: bcrypt cost 10 (consistente con login/register)
        // Antes: SHA-256 sin salt → vulnerable a rainbow tables
        const passwordHash = await bcrypt.hash(passwordPlano, BCRYPT_ROUNDS);

        // 1. Crear usuario (usa password_hash_v2 = bcrypt, no la columna legacy)
        const uR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
          method: 'POST',
          headers: {...sbHeaders, 'Prefer': 'return=representation'},
          body: JSON.stringify({
            nombre: nombre.trim(),
            email: emailNorm,
            password_hash_v2: passwordHash,  // COM-2: bcrypt en v2 (no SHA-256 en v1)
            rol: 'admin',  // comercial es admin de su propia tienda
            activo: true
          })
        });
        if (!uR.ok) {
          const t = await uR.text();
          console.error('Error POST usuarios (crear_cuenta_comercial):', uR.status, t);
          return res.status(500).json({ error: 'No se pudo crear el usuario' });
        }
        const uArr = await uR.json();
        const nuevoUserId = uArr[0]?.id;
        if (!nuevoUserId) return res.status(500).json({ error: 'Usuario creado sin ID' });

        // 2. Crear tienda con plan Premium vitalicio (interno: 'premium')
        const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas`, {
          method: 'POST',
          headers: {...sbHeaders, 'Prefer': 'return=representation'},
          body: JSON.stringify({
            usuario_id: nuevoUserId,
            nombre: codigoNorm + ' - Comercial',
            plan: 'premium',
            plan_status: 'active',
            plan_until: '2099-12-31T23:59:59Z'
          })
        });
        if (!tR.ok) {
          // Rollback: borrar usuario
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(nuevoUserId)}`, {
            method: 'DELETE',
            headers: sbHeaders
          });
          const t = await tR.text();
          console.error('Error POST tiendas (crear_cuenta_comercial, usuario revertido):', tR.status, t);
          return res.status(500).json({ error: 'No se pudo crear la tienda. Reintenta en unos momentos.' });
        }
        const tArr = await tR.json();
        const nuevaTiendaId = tArr[0]?.id;

        // COM-8: Vincular usuario con su tienda con rollback si falla.
        // login.js lee usuarios.tienda_id directamente para crear el JWT.
        // Antes este PATCH se ejecutaba sin chequear errores → si fallaba,
        // quedaba usuario sin tienda_id apuntando a tienda existente. Ahora si falla,
        // borramos usuario y tienda para mantener consistencia.
        if (nuevaTiendaId) {
          const linkR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(nuevoUserId)}`, {
            method: 'PATCH',
            headers: {...sbHeaders, 'Prefer': 'return=minimal'},
            body: JSON.stringify({ tienda_id: nuevaTiendaId })
          });
          if (!linkR.ok) {
            const t = await linkR.text();
            console.error('Error PATCH usuario.tienda_id (rollback iniciado):', linkR.status, t);
            // Rollback: borrar tienda y usuario
            try {
              await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(nuevaTiendaId)}`, {
                method: 'DELETE',
                headers: sbHeaders
              });
            } catch (e) { console.warn('Rollback tienda falló:', e); }
            try {
              await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(nuevoUserId)}`, {
                method: 'DELETE',
                headers: sbHeaders
              });
            } catch (e) { console.warn('Rollback usuario falló:', e); }
            return res.status(500).json({ error: 'No se pudo vincular el usuario con su tienda' });
          }
        }

        // Devolver datos al frontend para mostrar credenciales
        return res.json({
          ok: true,
          user_id: nuevoUserId,
          tienda_id: nuevaTiendaId,
          email: emailNorm,
          password: passwordPlano,
          codigo: codigoNorm,
          nombre: nombre.trim(),
          comision_pct: comisionPct
        });
      }

      // ═══ Crear afiliado (también desde Paso 3 del wizard) ═══
      if (action === 'crear_afiliado') {
        const { codigo, nombre, email, comision_pct, tienda_id_comercial, password_plano, enviar_email } = body;
        if (!codigo || !nombre || !email) return res.status(400).json({ error: 'Faltan datos' });

        const codigoNorm = codigo.toUpperCase().trim();
        const emailNorm = email.toLowerCase().trim();
        const tiendaAfiliado = tienda_id_comercial || tiendaId;
        // COM-9: validar rango de comision_pct
        const comisionPct = normalizarComisionPct(comision_pct, 20);
        if (comisionPct === null) return res.status(400).json({ error: 'comision_pct debe estar entre 0 y 100' });

        // Verificar codigo unico
        const existR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigoNorm)}&select=codigo&limit=1`, { headers: sbHeaders });
        const existArr = await existR.json();
        if (existArr.length) return res.status(400).json({ error: 'Ese codigo ya existe' });

        const inR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados`, {
          method: 'POST',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify({
            codigo: codigoNorm,
            nombre: nombre.trim(),
            email: emailNorm,
            comision_pct: comisionPct,
            activo: true,
            tienda_id: tiendaAfiliado
          })
        });
        if (!inR.ok) {
          const t = await inR.text();
          console.error('Error POST afiliados (crear_afiliado):', inR.status, t);
          return res.status(500).json({ error: 'No se pudo crear el afiliado' });
        }

        // Enviar email de bienvenida si se solicita
        let emailEnviado = false;
        if (enviar_email && password_plano) {
          const RESEND_KEY = process.env.RESEND_API_KEY;
          if (RESEND_KEY) {
            const subject = 'Bienvenido al programa de afiliados de TekPair';
            // AUD-fix: escapar campos dinámicos en el HTML del email al afiliado.
            const _escH = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
            const nombreE = _escH(String(nombre).trim().split(' ')[0]);
            const emailE = _escH(emailNorm);
            const codigoE = _escH(codigoNorm);
            const passE = _escH(password_plano);
            const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;color:#0F172A">
<div style="background:linear-gradient(135deg,#0055FF,#10B981);color:white;padding:24px;border-radius:14px 14px 0 0">
  <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:.9">PROGRAMA DE AFILIADOS</div>
  <h1 style="margin:8px 0 0;font-size:26px;font-weight:800">Bienvenido al equipo, ${nombreE}</h1>
</div>
<div style="background:white;border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 14px 14px">
  <p style="font-size:15px;line-height:1.6;color:#475569">Has sido dado de alta como comercial afiliado de <strong>TekPair</strong>. A partir de ahora, cada cliente que captes con tu código te dará una comisión recurrente.</p>

  <div style="background:#F8FAFC;border-radius:10px;padding:16px;margin:20px 0">
    <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:1px;margin-bottom:10px">TUS CREDENCIALES DE ACCESO</div>
    <div style="margin-bottom:8px"><strong style="color:#64748B;font-size:13px;display:inline-block;width:90px">Email:</strong> <span style="font-family:monospace;font-size:14px">${emailE}</span></div>
    <div><strong style="color:#64748B;font-size:13px;display:inline-block;width:90px">Contraseña:</strong> <span style="font-family:monospace;font-size:14px;background:#FEF3C7;padding:2px 8px;border-radius:4px">${passE}</span></div>
    <div style="font-size:12px;color:#94A3B8;margin-top:12px">Te recomendamos cambiar la contraseña al primer inicio de sesión.</div>
  </div>

  <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:16px;margin:20px 0">
    <div style="font-size:11px;font-weight:700;color:#10B981;letter-spacing:1px;margin-bottom:10px">TU CÓDIGO DE AFILIADO</div>
    <div style="font-size:28px;font-weight:800;color:#0F172A;letter-spacing:2px;font-family:monospace">${codigoE}</div>
    <div style="font-size:13px;color:#475569;margin-top:8px">Cuando un cliente lo use al suscribirse a TekPair, recibe 50% descuento durante 3 meses y tú cobras el <strong>${comisionPct}%</strong> de comisión recurrente sobre cada pago.</div>
  </div>

  <p style="font-size:14px;line-height:1.6;color:#475569">Accede a tu panel en <a href="https://www.tekpair.tech/app.html" style="color:#0055FF;text-decoration:none;font-weight:700">tekpair.tech</a> para consultar tus comisiones, clientes captados e historial de cobros.</p>

  <div style="background:#F8FAFC;border-left:3px solid #94A3B8;border-radius:6px;padding:14px;margin-top:20px;font-size:12px;color:#475569;line-height:1.55">
    <div style="font-weight:700;color:#0F172A;margin-bottom:6px">📋 CONDICIONES DEL PROGRAMA</div>
    Este acuerdo de colaboración implica un compromiso de captación activa por tu parte. TekPair se reserva el derecho de modificar los porcentajes de comisión, ajustar las condiciones del programa o dar por finalizada la colaboración en caso de inactividad prolongada o si no se cumplen los objetivos de captación acordados. Cualquier cambio se te notificará con antelación razonable.
  </div>
  <p style="font-size:13px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:16px;margin-top:24px">Cualquier duda, escríbenos a <a href="mailto:info@tekpair.tech" style="color:#0055FF">info@tekpair.tech</a>.</p>
  <p style="font-size:13px;color:#94A3B8;margin-top:8px">Un saludo,<br><strong>Equipo TekPair</strong></p>
</div>
</body></html>`;
            try {
              const sendR = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: 'TekPair <info@tekpair.tech>',
                  to: [emailNorm],
                  subject: subject,
                  html: htmlBody
                })
              });
              emailEnviado = sendR.ok;
              if (!sendR.ok) console.error('Error enviando email:', await sendR.text());
            } catch (e) { console.error('Excepcion email:', e); }
          }
        }

        return res.json({ ok: true, email_enviado: emailEnviado });
      }

      // ═══ Editar afiliado ═══
      if (action === 'editar_afiliado') {
        const { codigo, nombre, email, comision_pct } = body;
        if (!codigo) return res.status(400).json({ error: 'Codigo obligatorio' });
        const update = {};
        if (nombre) update.nombre = nombre.trim();
        if (email) update.email = email.toLowerCase().trim();
        if (comision_pct !== undefined) {
          // COM-9: validar rango también al editar
          const c = normalizarComisionPct(comision_pct, null);
          if (c === null) return res.status(400).json({ error: 'comision_pct debe estar entre 0 y 100' });
          update.comision_pct = c;
        }
        if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
        const upR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigo)}`, {
          method: 'PATCH',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'},
          body: JSON.stringify(update)
        });
        if (!upR.ok) {
          const t = await upR.text();
          console.error('Error PATCH afiliados (editar_afiliado):', upR.status, t);
          return res.status(500).json({ error: 'No se pudo actualizar el afiliado' });
        }
        return res.json({ ok: true });
      }

      // ═══ Eliminar afiliado ═══
      if (action === 'eliminar_afiliado') {
        const { codigo } = body;
        if (!codigo) return res.status(400).json({ error: 'Codigo obligatorio' });
        // Verificar que no tenga comisiones
        const pagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(codigo)}&select=id&limit=1`, { headers: sbHeaders });
        const pagosArr = await pagosR.json();
        if (pagosArr.length) return res.status(400).json({ error: 'No se puede eliminar: tiene comisiones registradas. Mejor desactivar.' });
        const delR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigo)}`, {
          method: 'DELETE',
          headers: {...sbHeaders, 'Prefer': 'return=minimal'}
        });
        if (!delR.ok) {
          const t = await delR.text();
          console.error('Error DELETE afiliados (eliminar_afiliado):', delR.status, t);
          return res.status(500).json({ error: 'No se pudo eliminar el afiliado' });
        }
        return res.json({ ok: true });
      }

      // ═══ Dar de baja un comercial → su tienda pasa a requerir suscripción ═══
      if (action === 'dar_de_baja_comercial') {
        const email = (body.email || '').toLowerCase().trim();
        const codigo = (body.codigo || '').toUpperCase().trim();
        if (!email && !codigo) return res.status(400).json({ error: 'Falta email o código del comercial' });

        // Resolver el email del comercial (vía código si hace falta)
        let afEmail = email;
        if (!afEmail && codigo) {
          const afR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?codigo=eq.${encodeURIComponent(codigo)}&select=email&limit=1`, { headers: sbHeaders });
          afEmail = ((await afR.json())[0]?.email || '').toLowerCase();
        }
        if (!afEmail) return res.status(404).json({ error: 'Comercial no encontrado' });

        // Usuario y tienda del comercial
        const uR2 = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(afEmail)}&select=id,tienda_id&limit=1`, { headers: sbHeaders });
        const u2 = (await uR2.json())[0];
        if (!u2) return res.status(404).json({ error: 'Usuario del comercial no encontrado' });
        let tiendaComercialId = u2.tienda_id || null;
        if (!tiendaComercialId) {
          const tR2 = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?usuario_id=eq.${encodeURIComponent(u2.id)}&select=id&limit=1`, { headers: sbHeaders });
          tiendaComercialId = (await tR2.json())[0]?.id || null;
        }
        if (!tiendaComercialId) return res.status(404).json({ error: 'Tienda del comercial no encontrada' });

        // Caducar el plan → cae en el flujo normal de "suscripción vencida, debe pagar"
        const ahora = new Date().toISOString();
        const upT = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tiendaComercialId)}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ plan_status: 'cancelled', plan_until: ahora })
        });
        if (!upT.ok) {
          console.error('Error PATCH tiendas (dar_de_baja_comercial):', upT.status, await upT.text());
          return res.status(500).json({ error: 'No se pudo dar de baja la tienda del comercial' });
        }
        // El afiliado deja de estar activo (no genera comisiones nuevas; su histórico se conserva)
        await fetch(`${SUPABASE_URL}/rest/v1/afiliados?email=eq.${encodeURIComponent(afEmail)}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ activo: false })
        });
        return res.json({ ok: true, mensaje: 'Comercial dado de baja. Su tienda ahora requiere suscripción.' });
      }

      return res.status(400).json({ error: 'Accion desconocida' });
    }

    // COM-12: el acceso de afiliado es SOLO para el admin de la tienda.
    // El registro `afiliados` está ligado a la tienda (tienda_id), que comparten admin y
    // empleados. Sin el chequeo de rol, cualquier EMPLEADO de una tienda afiliada veía las
    // comisiones del dueño. Un empleado (rol != admin) no debe verlas.
    const esAdminTienda = usuario && usuario.rol === 'admin';
    let miAfiliado = null;
    if (esAdminTienda) {
      const afR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?tienda_id=eq.${encodeURIComponent(tiendaId)}&select=*&limit=1`, {
        headers: sbHeaders
      });
      const afiliadosArr = await afR.json();
      miAfiliado = afiliadosArr[0] || null;
    }

    // Si NO es super-admin NI admin-afiliado → no tiene acceso
    if (!isAdmin && !miAfiliado) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // ═══ 3. ADMIN: ver todos los afiliados y sus comisiones ═══
    if (isAdmin) {
      const allAfR = await fetch(`${SUPABASE_URL}/rest/v1/afiliados?activo=eq.true&order=created_at.desc&select=*`, {
        headers: sbHeaders
      });
      const allAfiliados = await allAfR.json();

      const allPagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?order=created_at.desc&select=*`, {
        headers: sbHeaders
      });
      const allPagos = await allPagosR.json();

      const tiendaIdsConRef = [...new Set(allPagos.map(p => p.tienda_id).filter(Boolean))];
      let tiendasDetalle = {};
      if (tiendaIdsConRef.length) {
        const tIdsStr = tiendaIdsConRef.map(id => '"' + id + '"').join(',');
        const tDetailR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=in.(${encodeURIComponent(tIdsStr)})&select=id,nombre,plan,plan_status,creado_en,codigo_referido`, { headers: sbHeaders });
        const tDetailArr = await tDetailR.json();
        for (const t of (Array.isArray(tDetailArr) ? tDetailArr : [])) tiendasDetalle[t.id] = t;
      }

      const porCodigo = {};
      for (const p of allPagos) {
        const codigo = p.codigo_referido;
        if (!codigo) continue;
        if (!porCodigo[codigo]) {
          porCodigo[codigo] = {
            pagos: [],
            total_comisiones: 0,
            comisiones_pagadas: 0,
            comisiones_pendientes: 0,
            num_pagos: 0
          };
        }
        porCodigo[codigo].pagos.push(p);
        porCodigo[codigo].total_comisiones += parseFloat(p.comision_monto || 0);
        if (p.comision_pagada) {
          porCodigo[codigo].comisiones_pagadas += parseFloat(p.comision_monto || 0);
        } else {
          porCodigo[codigo].comisiones_pendientes += parseFloat(p.comision_monto || 0);
        }
        porCodigo[codigo].num_pagos++;
      }

      const referidosPorCodigo = {};
      for (const p of allPagos) {
        const codigo = p.codigo_referido;
        if (!codigo) continue;
        if (!referidosPorCodigo[codigo]) referidosPorCodigo[codigo] = new Set();
        referidosPorCodigo[codigo].add(p.tienda_id);
      }

      const tiendasPorCodigo = {};
      for (const codigo of Object.keys(referidosPorCodigo)) {
        const tiendaIds = [...referidosPorCodigo[codigo]];
        tiendasPorCodigo[codigo] = tiendaIds.map(tid => {
          const det = tiendasDetalle[tid] || {};
          const facturado = allPagos.filter(p => p.tienda_id === tid && p.codigo_referido === codigo).reduce((s, p) => s + parseFloat(p.monto_neto || 0), 0);
          return {
            tienda_id: tid,
            nombre: det.nombre || 'Tienda sin nombre',
            plan: det.plan || '-',
            plan_status: det.plan_status || '-',
            fecha_captacion: det.creado_en || null,
            total_facturado: +facturado.toFixed(2)
          };
        });
      }

      const afiliadosConStats = allAfiliados.map(af => {
        const stats = porCodigo[af.codigo] || {total_comisiones:0, comisiones_pagadas:0, comisiones_pendientes:0, num_pagos:0};
        const referidos = referidosPorCodigo[af.codigo] ? referidosPorCodigo[af.codigo].size : 0;
        return {
          codigo: af.codigo,
          nombre: af.nombre,
          email: af.email,
          comision_pct: af.comision_pct,
          num_referidos: referidos,
          num_pagos: stats.num_pagos,
          total_comisiones: +stats.total_comisiones.toFixed(2),
          comisiones_pagadas: +stats.comisiones_pagadas.toFixed(2),
          comisiones_pendientes: +stats.comisiones_pendientes.toFixed(2),
          tiendas_detalle: tiendasPorCodigo[af.codigo] || []
        };
      });

      const totalComisiones = afiliadosConStats.reduce((s, a) => s + a.total_comisiones, 0);
      const totalPagadas = afiliadosConStats.reduce((s, a) => s + a.comisiones_pagadas, 0);
      const totalPendientes = afiliadosConStats.reduce((s, a) => s + a.comisiones_pendientes, 0);
      const totalReferidos = afiliadosConStats.reduce((s, a) => s + a.num_referidos, 0);

      return res.json({
        modo: 'admin',
        resumen: {
          num_afiliados: allAfiliados.length,
          num_referidos: totalReferidos,
          total_comisiones: +totalComisiones.toFixed(2),
          comisiones_pagadas: +totalPagadas.toFixed(2),
          comisiones_pendientes: +totalPendientes.toFixed(2)
        },
        afiliados: afiliadosConStats,
        pagos: allPagos
      });
    }

    // ═══ 4. AFILIADO normal: ver solo sus comisiones ═══
    const codigo = miAfiliado.codigo;

    const pagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?codigo_referido=eq.${encodeURIComponent(codigo)}&order=created_at.desc&select=*`, {
      headers: sbHeaders
    });
    const pagos = await pagosR.json();

    const totalComisiones = pagos.reduce((s, p) => s + parseFloat(p.comision_monto || 0), 0);
    const comisionesPagadas = pagos.filter(p => p.comision_pagada).reduce((s, p) => s + parseFloat(p.comision_monto || 0), 0);
    const comisionesPendientes = totalComisiones - comisionesPagadas;

    const referidos = new Set(pagos.map(p => p.tienda_id));

    let tiendasReferidas = [];
    if (referidos.size > 0) {
      const ids = Array.from(referidos).map(id => `"${id}"`).join(',');
      const tR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=in.(${ids})&select=id,nombre,plan,plan_status,created_at:creado_en`, {
        headers: sbHeaders
      });
      tiendasReferidas = await tR.json();
    }

    return res.json({
      modo: 'afiliado',
      mi_codigo: codigo,
      mi_comision_pct: miAfiliado.comision_pct,
      resumen: {
        num_referidos: referidos.size,
        num_pagos: pagos.length,
        total_comisiones: +totalComisiones.toFixed(2),
        comisiones_pagadas: +comisionesPagadas.toFixed(2),
        comisiones_pendientes: +comisionesPendientes.toFixed(2)
      },
      tiendas_referidas: tiendasReferidas,
      pagos: pagos
    });

  } catch (e) {
    console.error('Error comisiones:', e);
    return res.status(500).json({ error: 'Error servidor' });
  }
}
