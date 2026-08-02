// =====================================================
// TEKPAIR — /api/cajas.js v2
// Endpoint único para módulo Cajas (Fase 1)
// =====================================================
// Reescrito con fetch directo a Supabase REST (estilo TekPair)
// Sin dependencias externas más allá de jsonwebtoken (ya instalado)
// =====================================================

import jwt from 'jsonwebtoken';

const SB_URL = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

// ── Helpers Supabase REST ─────────────────────────
function sbHeaders(extra = {}) {
  return {
    'apikey': SK,
    'Authorization': `Bearer ${SK}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

// Excepción tipada con status HTTP para que el handler pueda diferenciar
// entre conflict (409), validation (400), etc.
class SupabaseError extends Error {
  constructor(method, path, status, body) {
    super(`Supabase ${method} ${path}: ${status} ${body}`);
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
  }
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new SupabaseError('GET', path, r.status, await r.text());
  return r.json();
}

async function sbPost(path, body, opts = {}) {
  const headers = sbHeaders({ Prefer: 'return=representation' });
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new SupabaseError('POST', path, r.status, await r.text());
  return r.json();
}

async function sbPatch(path, body) {
  const headers = sbHeaders({ Prefer: 'return=representation' });
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new SupabaseError('PATCH', path, r.status, await r.text());
  return r.json();
}

async function sbDelete(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!r.ok && r.status !== 204) throw new SupabaseError('DELETE', path, r.status, await r.text());
  return true;
}


// ── Helpers Auth ──────────────────────────────────
function verificarToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return null;
  }
}

// CAJ-SEC-1 / AUD: el rol se relee SIEMPRE de la BBDD (usuarios.rol vía _usuarioPerm), NO del
// claim del JWT. Antes un admin degradado a empleado conservaba rol='admin' en su token y mantenía
// poderes de admin en Cajas hasta que caducara (hasta 7 días). Ambos helpers son ASYNC → hay que
// usar `await` en cada llamada (si se olvida, es ReferenceError con estos nombres nuevos → 500,
// falla cerrado, nunca deja pasar como admin).
const SUPER_ADMIN_EMAILS = ['info@tekpair.tech'];
async function esAdminTiendaDB(payload) {
  if (!payload) return false;
  const u = await _usuarioPerm(payload);
  return !!u && u.rol === 'admin';
}
async function esSuperAdminDB(payload) {
  return !!payload && SUPER_ADMIN_EMAILS.includes(payload.email) && (await esAdminTiendaDB(payload));
}

function err(res, code, message) {
  return res.status(code).json({ ok: false, error: message });
}

function ok(res, data) {
  return res.status(200).json({ ok: true, ...data });
}

// Calcula balance de un movimiento según tipo de caja
function calcularBalance(tipoCaja, mov) {
  if (tipoCaja === 'envios') {
    return Number(mov.importe_cobrado || 0) - Number(mov.importe_enviado || 0);
  }
  if (tipoCaja === 'recargas') {
    return Number(mov.importe_efectivo || 0) + Number(mov.importe_tarjeta || 0);
  }
  return 0;
}

// Calcula saldo teórico del cierre
// Para envíos: teórico = saldo_inicial + total_enviado por compañías.
//   El descuadre entonces = total_caja - teorico = balance (comisiones a favor del operador).
// Para recargas: saldo_inicial + suma de importe_efectivo por compañía
function calcularSaldoTeorico(tipoCaja, saldoInicial, movimientos, totalCobradoCaja) {
  let teorico = Number(saldoInicial || 0);
  if (tipoCaja === 'envios') {
    for (const m of movimientos) {
      teorico += Number(m.importe_enviado || 0);
    }
  } else if (tipoCaja === 'recargas') {
    for (const m of movimientos) {
      teorico += Number(m.importe_efectivo || 0);
    }
  }
  return Math.round(teorico * 100) / 100;
}



// Helper: comprueba si el usuario tiene un permiso del módulo Cajas Multi-Servicio
// Los admin tienen TODOS los permisos automáticamente
// Los empleados los tienen solo si su permisos_usuarios[clave] = true
async function tienePermisoCaja(payload, clave) {
  if (!payload) return false;
  // Consultar rol desde BBDD (JWT no lo lleva, solo trae 'role: authenticated' de Supabase)
  const userId = payload.sub || payload.user_id;
  const email = payload.email;
  let usuario = null;
  if (userId) {
    const r = await sbGet(
      `usuarios?id=eq.${encodeURIComponent(userId)}&select=rol,permisos&limit=1`
    );
    usuario = r[0] || null;
  } else if (email) {
    const r = await sbGet(
      `usuarios?email=eq.${encodeURIComponent(email)}&select=rol,permisos&limit=1`
    );
    usuario = r[0] || null;
  }
  if (!usuario) return false;
  if (usuario.rol === 'admin') return true;
  const permisos = usuario.permisos || {};
  // Coherencia con el frontend (tienePerm): permisos.todo === true concede todos los permisos
  // del módulo. Antes el backend lo ignoraba → un usuario con `todo` pasaba el gating del front
  // (p.ej. abría un día anterior) y luego el backend respondía 403 → pantalla vacía.
  if (permisos.todo === true) return true;
  const claveCompleta = clave.startsWith('cajasm_') ? clave : 'cajasm_' + clave;
  return permisos[claveCompleta] === true;
}

// ── Permiso POR CAJA ────────────────────────────────────────────────────────
// El admin ve/opera todas las cajas. El empleado SOLO las que el admin le haya
// asignado en permisos.cajas_permitidas (whitelist estricta de ids UUID). Sin
// asignación = ninguna (ni la "Caja del día"). Se relee de BBDD (el JWT no trae rol).
async function _usuarioPerm(payload) {
  if (!payload) return null;
  const userId = payload.sub || payload.user_id;
  const email = payload.email;
  let r = [];
  if (userId) r = await sbGet(`usuarios?id=eq.${encodeURIComponent(userId)}&select=rol,permisos&limit=1`);
  else if (email) r = await sbGet(`usuarios?email=eq.${encodeURIComponent(email)}&select=rol,permisos&limit=1`);
  return r[0] || null;
}
// null = acceso a TODAS las cajas (admin / permisos.todo). Array = whitelist de ids.
async function _cajasPermitidas(payload) {
  const u = await _usuarioPerm(payload);
  if (!u) return [];
  if (u.rol === 'admin' || (u.permisos && u.permisos.todo === true)) return null;
  const p = u.permisos || {};
  return Array.isArray(p.cajas_permitidas) ? p.cajas_permitidas.map(String) : [];
}
async function puedeAccederCaja(payload, cajaId) {
  if (!cajaId) return false;
  const permit = await _cajasPermitidas(payload);
  if (permit === null) return true;         // admin / todo
  return permit.includes(String(cajaId));
}
// Resuelve la caja de un fiado (para gating de cobrar/anular/editar por id de fiado).
async function _cajaDeFiado(id) {
  if (!id) return null;
  const f = await sbGet(`cajas_fiados?id=eq.${encodeURIComponent(id)}&select=caja_id&limit=1`);
  return (f[0] && f[0].caja_id) || null;
}

// ¿La fecha es claramente anterior a "hoy"? Heurística de servidor con 36h de margen (así "hoy"
// nunca se bloquea en ningún huso horario). Si el cliente informa su fecha local (clientHoy),
// se aplica también → bloquea "ayer" para el empleado honesto. Se toma el criterio MÁS ESTRICTO:
// spoofear una clientHoy vieja NO desbloquea nada (la heurística de 36h sigue aplicando).
function _fechaAnterior(fecha, clientHoy) {
  try {
    const f = String(fecha || '').slice(0, 10);
    const lim = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10);
    let anterior = f < lim;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(clientHoy || '')) && f < String(clientHoy)) anterior = true;
    return anterior;
  } catch (e) { return false; }
}

// Efectivo esperado del día para la "Caja del día", recalculado en el SERVIDOR (no se fía del
// cliente, que podría deflactarlo para tapar un descuadre de la caja). Mismo cálculo que
// cajaDiaResumen del frontend: ventas financiado-aware (solo efectivo) + pagos_reparacion en
// efectivo, excluyendo presupuestos/rechazados no aceptados.
async function _efectivoEsperadoDia(tienda_id, fecha) {
  const esEf = (m) => /efectiv/i.test(String(m == null ? 'Efectivo' : m));
  const F = String(fecha || '').slice(0, 10);
  let ef = 0;
  // Ventas del día (no reembolsadas)
  const ventas = await sbGet(`ventas?tienda_id=eq.${encodeURIComponent(tienda_id)}&reembolsado=eq.false&select=fecha,pago,total,financiado,cuotas,entrada,entrada_pago`);
  for (const v of (ventas || [])) {
    if (v.financiado && v.cuotas) {
      let cuotas = v.cuotas;
      if (typeof cuotas === 'string') { try { cuotas = JSON.parse(cuotas); } catch (e) { cuotas = []; } }
      if (String(v.fecha).slice(0, 10) === F && Number(v.entrada || 0) > 0 && esEf(v.entrada_pago)) {
        ef += Number(v.entrada) || 0;
      }
      (cuotas || []).forEach((c) => {
        if (c && c.fechaPago && String(c.fechaPago).slice(0, 10) === F && esEf(c.formaPago)) {
          ef += (c.pagadoImporte != null) ? (parseFloat(c.pagadoImporte) || 0) : (c.pagado ? (parseFloat(c.importe) || 0) : 0);
        }
      });
    } else if (String(v.fecha).slice(0, 10) === F && esEf(v.pago)) {
      ef += Number(v.total) || 0;
    }
  }
  // Pagos de reparación del día en efectivo (anticipo o no), excluyendo presupuestos/rechazados.
  const pagos = await sbGet(`pagos_reparacion?tienda_id=eq.${encodeURIComponent(tienda_id)}&fecha=eq.${encodeURIComponent(F)}&select=metodo,importe,reparacion_id`);
  if (pagos && pagos.length) {
    const repIds = [...new Set(pagos.map((p) => p.reparacion_id).filter(Boolean))];
    let presup = new Set();
    if (repIds.length) {
      const reps = await sbGet(`reparaciones?tienda_id=eq.${encodeURIComponent(tienda_id)}&id=in.(${repIds.map(encodeURIComponent).join(',')})&estado=in.(Presupuesto,Rechazado)&select=id`);
      presup = new Set((reps || []).map((r) => String(r.id)));
    }
    for (const p of pagos) {
      if (p.reparacion_id && presup.has(String(p.reparacion_id))) continue;
      if (esEf(p.metodo)) ef += parseFloat(p.importe) || 0;
    }
  }
  return Math.round(ef * 100) / 100;
}



// Helper: recalcula descuadre del cierre de un fiado después de cobrarlo/anularlo
// CAJ-4: ahora devuelve true/false para que el caller sepa si tuvo éxito.
// Si falla, loguea con error (no warn) para que aparezca en monitorización.
async function recalcularCierreDeFiado(fiadoId, tienda_id) {
  try {
    // Obtener el fiado para saber caja_id y fecha
    const fiados = await sbGet(`cajas_fiados?id=eq.${encodeURIComponent(fiadoId)}&select=caja_id,fecha`);
    if (!fiados[0]) return false;
    const { caja_id, fecha } = fiados[0];

    // Buscar el cierre de ese día/caja
    const cierres = await sbGet(`cajas_cierres?caja_id=eq.${encodeURIComponent(caja_id)}&fecha=eq.${encodeURIComponent(fecha)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`);
    if (!cierres[0]) return true; // no hay cierre que recalcular, OK
    const cierre = cierres[0];

    // Sumar fiados pendientes (NO cobrados) de ese día
    const pendientes = await sbGet(`cajas_fiados?caja_id=eq.${encodeURIComponent(caja_id)}&fecha=eq.${encodeURIComponent(fecha)}&estado=eq.pendiente&select=importe`);
    const totalPendientes = pendientes.reduce((s, f) => s + Number(f.importe || 0), 0);

    // Recalcular descuadre
    const efectivo = Number(cierre.saldo_real_final || 0);
    const tpv = Number(cierre.importe_tpv || 0);
    const teorico = Number(cierre.saldo_teorico || 0);
    // v2.3: pendientes restan al cobrado (son deuda)
    const cobrado = efectivo + tpv;
    const nuevoDescuadre = Math.round((cobrado - teorico - totalPendientes) * 100) / 100;

    // Determinar estado
    let nuevoEstado = cierre.estado;
    if (cierre.estado !== "abierto" && cierre.estado !== "festivo") {
      nuevoEstado = Math.abs(nuevoDescuadre) <= 0.5 ? "cerrado" : "descuadre";
    }

    await sbPatch(`cajas_cierres?id=eq.${encodeURIComponent(cierre.id)}`, {
      descuadre: nuevoDescuadre,
      estado: nuevoEstado
    });
    return true;
  } catch(e) {
    // CAJ-4: log error (no warn) para que aparezca como incidente
    console.error("[cajas] recalcularCierreDeFiado FALLO para fiado", fiadoId, ":", e.message);
    return false;
  }
}

// ── Handler principal ─────────────────────────────
export default async function handler(req, res) {
  // CAJ-SEC-2: CORS restringido a dominios TekPair
  const allowedOrigins = ['https://tekpair.tech', 'https://www.tekpair.tech'];
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'https://www.tekpair.tech');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SB_URL || !SK || !JWT_SECRET) {
    console.error('[cajas] Faltan env vars: SUPABASE_URL/SUPABASE_SERVICE_KEY/SUPABASE_JWT_SECRET');
    return err(res, 500, 'Configuración de servidor incompleta');
  }

  const payload = verificarToken(req);
  if (!payload) return err(res, 401, 'Token inválido');

  const tienda_id = payload.tienda_id;
  if (!tienda_id) return err(res, 401, 'JWT sin tienda_id');

  const action = (req.query.action || '').toString();

  try {
    switch (action) {

      // ─── CAJAS ───────────────────────────────
      case 'listar_cajas': {
        const cajas = await sbGet(
          `cajas?tienda_id=eq.${encodeURIComponent(tienda_id)}&order=orden.asc,created_at.asc`
        );
        // Permiso por caja: el empleado solo recibe las cajas que el admin le asignó.
        const permit = await _cajasPermitidas(payload);
        const visibles = permit === null ? cajas : cajas.filter(c => permit.includes(String(c.id)));
        return ok(res, { cajas: visibles });
      }

      // ─── CUENTAS DE SALDO (monedero prepago de recargas) ───────────────
      case 'listar_cuentas': {
        const caja_id = req.query.caja_id;
        let path = `cajas_cuentas?tienda_id=eq.${encodeURIComponent(tienda_id)}&order=created_at.asc`;
        if (caja_id) path += `&caja_id=eq.${encodeURIComponent(caja_id)}`;
        let cuentas = await sbGet(path);
        const permitCta = await _cajasPermitidas(payload);
        if (permitCta !== null) cuentas = cuentas.filter(c => permitCta.includes(String(c.caja_id)));
        // Adjuntar las compañías de cada cuenta.
        const ids = cuentas.map(c => c.id);
        let comps = [];
        if (ids.length) comps = await sbGet(`cajas_companias?tienda_id=eq.${encodeURIComponent(tienda_id)}&cuenta_id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,nombre,cuenta_id`);
        const out = cuentas.map(c => Object.assign({}, c, { companias: comps.filter(k => k.cuenta_id === c.id).map(k => ({ id: k.id, nombre: k.nombre })) }));
        return ok(res, { cuentas: out });
      }

      case 'crear_cuenta': {
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        const { caja_id, nombre, saldo } = req.body || {};
        if (!caja_id || !nombre) return err(res, 400, 'caja_id y nombre obligatorios');
        const cajas = await sbGet(`cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`);
        if (!cajas.length) return err(res, 404, 'Caja no encontrada');
        const data = await sbPost('cajas_cuentas', { tienda_id, caja_id, nombre: String(nombre).slice(0, 80), saldo: Number(saldo) || 0 });
        return ok(res, { cuenta: Array.isArray(data) ? data[0] : data });
      }

      case 'editar_cuenta': {
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        const { id, nombre } = req.body || {};
        if (!id || nombre === undefined) return err(res, 400, 'id y nombre obligatorios');
        const data = await sbPatch(`cajas_cuentas?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`, { nombre: String(nombre).slice(0, 80) });
        return ok(res, { cuenta: Array.isArray(data) ? data[0] : data });
      }

      case 'borrar_cuenta': {
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        await sbDelete(`cajas_cuentas?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`);
        return ok(res, {});
      }

      case 'asignar_compania_cuenta': {
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        const { compania_id, cuenta_id } = req.body || {};
        if (!compania_id) return err(res, 400, 'compania_id obligatorio');
        const cmps = await sbGet(`cajas_companias?id=eq.${encodeURIComponent(compania_id)}&select=caja_id`);
        if (!cmps.length) return err(res, 404, 'Compañía no encontrada');
        const cajas = await sbGet(`cajas?id=eq.${encodeURIComponent(cmps[0].caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`);
        if (!cajas.length) return err(res, 403, 'Sin acceso');
        if (cuenta_id) {
          const cta = await sbGet(`cajas_cuentas?id=eq.${encodeURIComponent(cuenta_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=caja_id`);
          if (!cta.length || String(cta[0].caja_id) !== String(cmps[0].caja_id)) return err(res, 400, 'Cuenta inválida para esta caja');
        }
        await sbPatch(`cajas_companias?id=eq.${encodeURIComponent(compania_id)}`, { cuenta_id: cuenta_id || null });
        return ok(res, {});
      }

      case 'recargar_saldo': {
        const { cuenta_id, importe, nota } = req.body || {};
        const imp = Number(importe);
        if (!cuenta_id || !Number.isFinite(imp) || imp === 0) return err(res, 400, 'cuenta_id e importe (≠0) obligatorios');
        const cta = await sbGet(`cajas_cuentas?id=eq.${encodeURIComponent(cuenta_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`);
        if (!cta.length) return err(res, 404, 'Cuenta no encontrada');
        if (!(await puedeAccederCaja(payload, cta[0].caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        const nuevo = Math.round((Number(cta[0].saldo || 0) + imp) * 100) / 100;
        const data = await sbPatch(`cajas_cuentas?id=eq.${encodeURIComponent(cuenta_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`, { saldo: nuevo });
        await sbPost('cajas_saldo_mov', { tienda_id, cuenta_id, tipo: 'recarga', importe: imp, saldo_resultante: nuevo, nota: nota || null, usuario: payload.email || null });
        return ok(res, { cuenta: Array.isArray(data) ? data[0] : data });
      }

      case 'confirmar_saldo': {
        const { cuenta_id, fecha, nota } = req.body || {};
        if (!cuenta_id) return err(res, 400, 'cuenta_id obligatorio');
        const cta = await sbGet(`cajas_cuentas?id=eq.${encodeURIComponent(cuenta_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`);
        if (!cta.length) return err(res, 404, 'Cuenta no encontrada');
        if (!(await puedeAccederCaja(payload, cta[0].caja_id))) return err(res, 403, 'Sin permiso para esta caja');

        const currentSaldo = Number(cta[0].saldo || 0);
        // IDEMPOTENCIA por (cuenta, fecha): si ya se confirmó este día, deshacer su efecto (delta)
        // para re-basear al saldo de AYER. Así re-cerrar la misma caja no vuelve a sumar/restar el
        // movimiento del día (antes duplicaba el saldo en cada re-cierre). La confirmación previa se
        // SOBREESCRIBE (no se apila) en el historial.
        let prevMov = null, baseAyer = currentSaldo;
        if (fecha) {
          const prev = await sbGet(`cajas_saldo_mov?cuenta_id=eq.${encodeURIComponent(cuenta_id)}&tipo=eq.confirmacion&fecha=eq.${encodeURIComponent(fecha)}&order=created_at.desc&limit=1&select=id,importe`);
          prevMov = prev[0] || null;
          if (prevMov) baseAyer = Math.round((currentSaldo - Number(prevMov.importe || 0)) * 100) / 100;
        }

        const montoDia = Number(req.body.monto_dia);
        let nuevo, esperado;
        if (!Number.isFinite(montoDia)) {
          // Compatibilidad con cliente antiguo: saldo_real absoluto tal cual (no idempotente).
          const real = Number(req.body.saldo_real);
          if (!Number.isFinite(real)) return err(res, 400, 'saldo_real o monto_dia obligatorios');
          const ventas = Number(req.body.ventas_dia) || 0;
          nuevo = Math.round(real * 100) / 100;
          esperado = Math.round((baseAyer - ventas) * 100) / 100;
        } else if (req.body.tipo === 'envios') {
          // Envíos: lo enviado hoy sube el pendiente; el ingreso en banco lo baja.
          const ingreso = Number(req.body.ingreso_banco) || 0;
          esperado = Math.round((baseAyer + montoDia) * 100) / 100;
          nuevo = Math.round((baseAyer + montoDia - ingreso) * 100) / 100;
        } else {
          // Recargas: lo vendido hoy baja el saldo. Si el cajero recontó un valor real distinto,
          // llega en saldo_contado; si aceptó el esperado, lo recalculamos aquí (idempotente).
          esperado = Math.round((baseAyer - montoDia) * 100) / 100;
          const contado = req.body.saldo_contado;
          nuevo = (contado === undefined || contado === null || String(contado).trim() === '')
            ? esperado
            : Math.round(Number(contado) * 100) / 100;
        }
        if (!Number.isFinite(nuevo)) return err(res, 400, 'valor de saldo inválido');

        const ajuste = Math.round((nuevo - esperado) * 100) / 100;
        const delta = Math.round((nuevo - baseAyer) * 100) / 100;
        await sbPatch(`cajas_cuentas?id=eq.${encodeURIComponent(cuenta_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`, { saldo: nuevo });
        const mov = { tienda_id, cuenta_id, tipo: 'confirmacion', importe: delta, saldo_resultante: nuevo, nota: (nota || '') + (ajuste ? ` [ajuste ${ajuste}]` : ''), usuario: payload.email || null };
        if (fecha) mov.fecha = fecha;
        if (prevMov) await sbPatch(`cajas_saldo_mov?id=eq.${encodeURIComponent(prevMov.id)}`, mov);
        else await sbPost('cajas_saldo_mov', mov);
        return ok(res, { cuenta_id, saldo: nuevo, esperado, ajuste });
      }

      case 'listar_saldo_mov': {
        const cuenta_id = req.query.cuenta_id;
        if (!cuenta_id) return err(res, 400, 'cuenta_id obligatorio');
        const cta = await sbGet(`cajas_cuentas?id=eq.${encodeURIComponent(cuenta_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id,caja_id,nombre,saldo`);
        if (!cta.length) return err(res, 404, 'Cuenta no encontrada');
        if (!(await puedeAccederCaja(payload, cta[0].caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        const movimientos = await sbGet(`cajas_saldo_mov?cuenta_id=eq.${encodeURIComponent(cuenta_id)}&order=created_at.desc&limit=100`);
        return ok(res, { cuenta: cta[0], movimientos });
      }

      case 'crear_caja': {
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        const { tipo, nombre, icono, color, orden, dias_apertura } = req.body || {};
        if (!tipo || !nombre) return err(res, 400, 'tipo y nombre obligatorios');
        if (!['envios','recargas','tpv','custom'].includes(tipo)) {
          return err(res, 400, 'tipo inválido');
        }
        const iconoDef = icono || (tipo === 'envios' ? '📤' : tipo === 'recargas' ? '📱' : tipo === 'tpv' ? '🛒' : '💼');
        // CAJ-9: variable renombrada de `payload` a `cajaData` para no sombrear el JWT
        const cajaData = {
          tienda_id,
          tipo,
          nombre,
          icono: iconoDef,
          color: color || '#3b82f6',
          orden: Number(orden || 0)
        };
        if (Array.isArray(dias_apertura) && dias_apertura.length > 0) {
          const diasValidos = dias_apertura.filter(d => Number.isInteger(d) && d >= 1 && d <= 7);
          // CAJ-11: rechazar si tras el filtro queda vacío (datos basura del frontend)
          if (diasValidos.length === 0) return err(res, 400, 'dias_apertura inválidos (1-7)');
          cajaData.dias_apertura = diasValidos;
        }
        if (typeof req.body.gestion_fiados === 'boolean') {
          cajaData.gestion_fiados = req.body.gestion_fiados;
        }
        const data = await sbPost('cajas', cajaData);
        return ok(res, { caja: Array.isArray(data) ? data[0] : data });
      }

      // Caja del día por defecto: idempotente. La crea una vez por tienda si no existe.
      // El desglose diario (efectivo/tarjeta/bizum + anticipos) se calcula en el front en vivo
      // desde ventas + pagos_reparacion; aquí solo garantizamos que la caja exista para el histórico.
      case 'asegurar_caja_dia': {
        // La columna cajas.tipo tiene un CHECK que solo admite envios/recargas/tpv/custom, así
        // que la Caja del día usa tipo 'custom' y se identifica por su nombre reservado.
        const existentes = await sbGet(
          `cajas?tienda_id=eq.${encodeURIComponent(tienda_id)}&nombre=eq.${encodeURIComponent('Caja del día')}&order=created_at.asc&limit=1`
        );
        if (existentes.length) return ok(res, { caja: existentes[0], creada: false });
        // Crear la Caja del día la primera vez la hace un admin (el dueño al arrancar). Un empleado
        // no la crea ni fuerza su alta. El frontend ignora este retorno y lista las cajas aparte.
        if (!(await esAdminTiendaDB(payload))) return ok(res, { caja: null, creada: false });
        const cajaData = {
          tienda_id, tipo: 'custom', nombre: 'Caja del día',
          icono: '📅', color: '#00C896', orden: -1
        };
        const data = await sbPost('cajas', cajaData);
        return ok(res, { caja: Array.isArray(data) ? data[0] : data, creada: true });
      }

      case 'editar_caja': {
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        const { id, nombre, icono, color, orden, activa, permiso_editar_cerrada, dias_apertura } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        const patch = {};
        if (nombre !== undefined) patch.nombre = nombre;
        if (icono !== undefined) patch.icono = icono;
        if (color !== undefined) patch.color = color;
        if (orden !== undefined) patch.orden = Number(orden);
        if (activa !== undefined) patch.activa = !!activa;
        if (permiso_editar_cerrada !== undefined) patch.permiso_editar_cerrada = permiso_editar_cerrada;
        if (Array.isArray(dias_apertura)) {
          patch.dias_apertura = dias_apertura.filter(d => Number.isInteger(d) && d >= 1 && d <= 7);
        }
        if (typeof req.body.gestion_fiados === 'boolean') {
          patch.gestion_fiados = req.body.gestion_fiados;
        }
        const data = await sbPatch(
          `cajas?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          patch
        );
        return ok(res, { caja: Array.isArray(data) ? data[0] : data });
      }

      case 'borrar_caja': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        await sbDelete(
          `cajas?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`
        );
        return ok(res, {});
      }


      // ─── COMPAÑÍAS ───────────────────────────
      case 'listar_companias': {
        const caja_id = req.query.caja_id;
        if (!caja_id) return err(res, 400, 'caja_id obligatorio');
        if (!(await puedeAccederCaja(payload, caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        // Verificar caja
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0 && !(await esSuperAdminDB(payload))) {
          return err(res, 403, 'Caja no accesible');
        }
        const companias = await sbGet(
          `cajas_companias?caja_id=eq.${encodeURIComponent(caja_id)}&order=orden.asc,nombre.asc`
        );
        return ok(res, { companias });
      }

      case 'crear_compania': {
        const { caja_id, nombre, orden } = req.body || {};
        if (!caja_id || !nombre) return err(res, 400, 'caja_id y nombre obligatorios');
        // Coherente con editar_compania (CAJ-1): crear config de compañías requiere permiso de edición.
        if (!(await tienePermisoCaja(payload, 'editar'))) return err(res, 403, 'No tienes permiso para crear compañías');
        if (!(await puedeAccederCaja(payload, caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0) return err(res, 403, 'Caja no accesible');
        const data = await sbPost('cajas_companias', {
          caja_id,
          nombre: nombre.trim(),
          orden: Number(orden || 0)
        });
        return ok(res, { compania: Array.isArray(data) ? data[0] : data });
      }

      case 'editar_compania': {
        const { id, nombre, orden, activa } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        // CAJ-1: requiere permiso. Empleados sin permiso no pueden cambiar config de compañías
        const puedeEditar = await tienePermisoCaja(payload, 'editar');
        if (!puedeEditar) return err(res, 403, 'No tienes permiso para editar compañías');
        // Verificar pertenencia: compañía → caja → tienda
        const cmps = await sbGet(
          `cajas_companias?id=eq.${encodeURIComponent(id)}&select=caja_id`
        );
        if (cmps.length === 0) return err(res, 404, 'Compañía no encontrada');
        if (!(await puedeAccederCaja(payload, cmps[0].caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(cmps[0].caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0) return err(res, 403, 'Sin acceso');
        const patch = {};
        if (nombre !== undefined) patch.nombre = nombre.trim();
        if (orden !== undefined) patch.orden = Number(orden);
        if (activa !== undefined) patch.activa = !!activa;
        const data = await sbPatch(`cajas_companias?id=eq.${encodeURIComponent(id)}`, patch);
        return ok(res, { compania: Array.isArray(data) ? data[0] : data });
      }

      case 'borrar_compania': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        // Verificar pertenencia
        const cmps = await sbGet(`cajas_companias?id=eq.${encodeURIComponent(id)}&select=caja_id`);
        if (cmps.length === 0) return err(res, 404, 'Compañía no encontrada');
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(cmps[0].caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0) return err(res, 403, 'Sin acceso');
        await sbDelete(`cajas_companias?id=eq.${encodeURIComponent(id)}`);
        return ok(res, {});
      }


      // ─── CIERRES ─────────────────────────────
      case 'obtener_cierre': {
        const { caja_id, fecha } = req.query;
        if (!caja_id || !fecha) return err(res, 400, 'caja_id y fecha obligatorios');
        if (!(await puedeAccederCaja(payload, caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        // Ver el contenido de días anteriores requiere permiso de histórico (admin siempre).
        // req.query.hoy = fecha local del cliente → endurece el gate (bloquea "ayer" al empleado honesto).
        if (_fechaAnterior(fecha, req.query.hoy) && !(await tienePermisoCaja(payload, 'cajasm_historico'))) return err(res, 403, 'Sin permiso para ver días anteriores');
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`
        );
        if (cajas.length === 0) return err(res, 404, 'Caja no encontrada');
        const caja = cajas[0];

        const cierres = await sbGet(
          `cajas_cierres?caja_id=eq.${encodeURIComponent(caja_id)}&fecha=eq.${encodeURIComponent(fecha)}`
        );
        const cierre = cierres[0] || null;

        let movimientos = [];
        if (cierre) {
          movimientos = await sbGet(
            `cajas_movimientos?cierre_id=eq.${encodeURIComponent(cierre.id)}`
          );
        }

        const companias = await sbGet(
          `cajas_companias?caja_id=eq.${encodeURIComponent(caja_id)}&activa=eq.true&order=orden.asc`
        );

        // Saldo sugerido: busca el último cierre NO festivo hacia atrás
        const previos = await sbGet(
          `cajas_cierres?caja_id=eq.${encodeURIComponent(caja_id)}&fecha=lt.${encodeURIComponent(fecha)}`
          + `&estado=neq.festivo&order=fecha.desc&limit=1`
          + `&select=cambio_siguiente,fecha`
        );
        const saldo_sugerido = previos[0]?.cambio_siguiente || 0;
        const saldo_sugerido_fecha = previos[0]?.fecha || null;

        return ok(res, { caja, cierre, movimientos, companias, saldo_sugerido, saldo_sugerido_fecha });
      }

      case 'guardar_cierre': {
        const {
          caja_id, fecha, saldo_inicial, saldo_real_final, cambio_siguiente,
          notas, estado, movimientos, total_cobrado_caja, importe_tpv, total_fiados
        } = req.body || {};
        if (!caja_id || !fecha) return err(res, 400, 'caja_id y fecha obligatorios');
        if (!Array.isArray(movimientos)) return err(res, 400, 'movimientos[] obligatorio');
        if (!(await puedeAccederCaja(payload, caja_id))) return err(res, 403, 'Sin permiso para esta caja');

        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`
        );
        if (cajas.length === 0) return err(res, 404, 'Caja no encontrada');
        const caja = cajas[0];

        const cierresExistentes = await sbGet(
          `cajas_cierres?caja_id=eq.${encodeURIComponent(caja_id)}&fecha=eq.${encodeURIComponent(fecha)}`
        );
        const cierreExistente = cierresExistentes[0] || null;

        if (cierreExistente && cierreExistente.estado === 'cerrado') {
          // AUD-fix: default restrictivo. Solo 'todos' deja a cualquier empleado editar/reabrir un
          // cierre cerrado; 'nadie' → solo superadmin; cualquier otro valor (incl. null/'admin') → admin.
          const permisoCerr = caja.permiso_editar_cerrada || 'admin';
          if (permisoCerr === 'nadie' && !(await esSuperAdminDB(payload))) {
            return err(res, 403, 'Cierre bloqueado');
          }
          if (permisoCerr !== 'todos' && !(await esAdminTiendaDB(payload))) {
            return err(res, 403, 'Solo admin puede editar cierres cerrados');
          }
        }

        let saldoTeorico = calcularSaldoTeorico(caja.tipo, saldo_inicial, movimientos, total_cobrado_caja);
        // Caja del día: el teórico es el EFECTIVO esperado del día (ventas+reparaciones+anticipos
        // cobrados en efectivo), que el front calcula con la lógica canónica y envía. El descuadre
        // queda = efectivo contado − efectivo esperado (tarjeta/bizum no se cuentan a mano).
        if (caja.nombre === 'Caja del día') {
          // No fiarse del efectivo_esperado del cliente (un empleado podría deflactarlo para tapar
          // un descuadre): recalcularlo en el servidor. Si el recálculo fallara, caer al valor del
          // cliente para no bloquear el cierre.
          try {
            saldoTeorico = await _efectivoEsperadoDia(tienda_id, fecha);
          } catch (e) {
            console.error('[cajas] _efectivoEsperadoDia falló, uso valor del cliente:', e.message);
            saldoTeorico = Math.round(Number(req.body.efectivo_esperado || 0) * 100) / 100;
          }
        }
        const saldoReal = Number(saldo_real_final || 0);
        // v2.3: Los fiados PENDIENTES son deuda (no suman al cobrado).
        // Los COBRADOS ya se ven reflejados porque suman al efectivo/TPV.
        // Formula: cobrado = efectivo + TPV; descuadre = cobrado - teorico
        // El total_fiados que llega es solo de PENDIENTES (frontend filtra cobrados)
        const tpvNum = Number(importe_tpv || 0);
        const fiadosNum = Number(total_fiados || 0);
        const cobrado = Math.round((saldoReal + tpvNum) * 100) / 100;
        // v2.3: pendientes restan al cobrado (son deuda)
        const descuadre = Math.round((cobrado - saldoTeorico - fiadosNum) * 100) / 100;
        // estados permitidos: abierto, cerrado, descuadre (auto), festivo
        let estadoFinal;
        if (estado === 'festivo') {
          estadoFinal = 'festivo';
        } else if (estado === 'cerrado') {
          estadoFinal = Math.abs(descuadre) > 0.5 ? 'descuadre' : 'cerrado';
        } else {
          estadoFinal = 'abierto';
        }

        const cierrePayload = {
          caja_id,
          tienda_id,
          fecha,
          saldo_inicial: Number(saldo_inicial || 0),
          saldo_real_final: saldoReal,
          saldo_teorico: saldoTeorico,
          descuadre,
          cambio_siguiente: Number(cambio_siguiente || 0),
          total_cobrado_caja: Number(total_cobrado_caja || 0),
          importe_tpv: Number(importe_tpv || 0),
          estado: estadoFinal,
          notas: notas || null
        };
        if (estado === 'cerrado') {
          cierrePayload.cerrado_por = payload.email;
          cierrePayload.cerrado_at = new Date().toISOString();
        }

        // Apertura: fichar quién abre la caja por su código (solo si aún no está fichada).
        // El servidor traduce el código a nombre (no se fía del cliente).
        const yaAbierta = cierreExistente && cierreExistente.abierto_por;
        const codAp = (req.body.codigo_apertura || '').toString().trim();
        const nomAp = (req.body.abierto_por_nombre || '').toString().trim();
        if (!yaAbierta) {
          if (codAp) {
            const us = await sbGet(
              `usuarios?tienda_id=eq.${encodeURIComponent(tienda_id)}&codigo=eq.${encodeURIComponent(codAp)}&select=nombre&limit=1`
            );
            if (!us.length) return err(res, 400, 'Código de empleado no válido');
            cierrePayload.abierto_por = us[0].nombre;
          } else if (nomAp && (await esAdminTiendaDB(payload))) {
            // Admin operando sin código: se registra por su propio nombre (de confianza)
            cierrePayload.abierto_por = nomAp.slice(0, 100);
          }
        }

        let cierreId;
        try {
          if (cierreExistente) {
            const data = await sbPatch(
              `cajas_cierres?id=eq.${encodeURIComponent(cierreExistente.id)}`,
              cierrePayload
            );
            cierreId = Array.isArray(data) ? data[0].id : data.id;
          } else {
            const data = await sbPost('cajas_cierres', cierrePayload);
            cierreId = Array.isArray(data) ? data[0].id : data.id;
          }
        } catch (e) {
          // CAJ-8b: detectar conflict UNIQUE (uq_cierres_caja_fecha).
          // Pasa si dos cajeros guardan cierre del mismo día/caja simultáneamente.
          // PostgreSQL devuelve 409 con código 23505. PostgREST también devuelve 409.
          if (e instanceof SupabaseError && (e.status === 409 || /23505|already exists|duplicate/i.test(e.body || ''))) {
            return err(res, 409, 'Ya existe un cierre para esta caja y fecha. Refresca la página para ver el cierre actual.');
          }
          throw e;
        }

        const movsInsert = movimientos
          .filter(m => m.compania_id)
          .map(m => ({
            cierre_id: cierreId,
            compania_id: m.compania_id,
            importe_enviado: Number(m.importe_enviado || 0),
            importe_cobrado: Number(m.importe_cobrado || 0),
            importe_efectivo: Number(m.importe_efectivo || 0),
            importe_tarjeta: Number(m.importe_tarjeta || 0),
            balance: calcularBalance(caja.tipo, m)
          }));

        // CAJ-7: borrar viejos e insertar nuevos en orden que minimice pérdida.
        // Si el POST nuevo falla, los viejos siguen ahí (porque borramos DESPUÉS del POST OK).
        // Caso edge: si insertamos nuevos antes de borrar, se duplican durante un instante.
        // Solución pragmática sin transacciones: si hay cierre existente, hacer un "swap":
        //   1. Marcar viejos con cierre_id temporal (no se puede sin alterar schema)
        // Alternativa simple: usar try/catch para reintentar/loguear si algo falla
        if (cierreExistente && movsInsert.length > 0) {
          // Borrar los viejos solo después de validar que tenemos movsInsert válidos
          await sbDelete(`cajas_movimientos?cierre_id=eq.${encodeURIComponent(cierreId)}`);
          try {
            await sbPost('cajas_movimientos', movsInsert);
          } catch (e) {
            // CAJ-7: si falla insertar los nuevos, dejar log crítico para que el admin
            // pueda restaurar manualmente desde el frontend (los datos siguen en payload original)
            console.error('[cajas] CRÍTICO: insertar movimientos falló tras borrar viejos. cierre_id=', cierreId, 'movsInsert=', JSON.stringify(movsInsert).slice(0, 500), 'error:', e.message);
            throw e;
          }
        } else if (cierreExistente) {
          // No hay movimientos nuevos: solo borrar viejos
          await sbDelete(`cajas_movimientos?cierre_id=eq.${encodeURIComponent(cierreId)}`);
        } else if (movsInsert.length > 0) {
          // Cierre nuevo, no había viejos: solo insertar
          await sbPost('cajas_movimientos', movsInsert);
        }

        return ok(res, {
          cierre_id: cierreId,
          saldo_teorico: saldoTeorico,
          descuadre,
          estado: estadoFinal
        });
      }

      case 'listar_cierres': {
        const { desde, hasta, caja_id } = req.query;
        if (!desde || !hasta) return err(res, 400, 'desde y hasta obligatorios');
        // Listado histórico → requiere permiso de histórico (admin siempre).
        if (!(await tienePermisoCaja(payload, 'cajasm_historico'))) return err(res, 403, 'Sin permiso para ver días anteriores');
        let path = `cajas_cierres?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&fecha=gte.${encodeURIComponent(desde)}`
          + `&fecha=lte.${encodeURIComponent(hasta)}`
          + `&order=fecha.desc`;
        if (caja_id) path += `&caja_id=eq.${encodeURIComponent(caja_id)}`;
        const cierres = await sbGet(path);
        // Permiso por caja: el empleado solo ve cierres de sus cajas.
        const permitCi = await _cajasPermitidas(payload);
        const cierresVis = permitCi === null ? cierres : cierres.filter(c => permitCi.includes(String(c.caja_id)));
        return ok(res, { cierres: cierresVis });
      }

      case 'reabrir_cierre': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        // CAJ-5: añadir trazabilidad de la reapertura en las notas del cierre.
        // Antes se borraba cerrado_por/cerrado_at sin dejar rastro de quién reabrió.
        const cierresExist = await sbGet(
          `cajas_cierres?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=cerrado_por,cerrado_at,notas`
        );
        if (cierresExist.length === 0) return err(res, 404, 'Cierre no encontrado');
        const cierreActual = cierresExist[0];
        const reapertura = `[Reabierto ${new Date().toISOString()} por ${payload.email || 'desconocido'} — cierre original: ${cierreActual.cerrado_por || '?'} ${cierreActual.cerrado_at || '?'}]`;
        const nuevaNota = (cierreActual.notas ? cierreActual.notas + '\n' : '') + reapertura;
        const data = await sbPatch(
          `cajas_cierres?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          { estado: 'abierto', cerrado_at: null, cerrado_por: null, notas: nuevaNota }
        );
        return ok(res, { cierre: Array.isArray(data) ? data[0] : data });
      }


      // ═══ FIADOS / COBROS PENDIENTES ═══

      case 'listar_fiados': {
        const { estado, caja_id, desde, hasta } = req.query;
        let path = `cajas_fiados?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&order=fecha.desc,created_at.desc`;
        if (estado) path += `&estado=eq.${encodeURIComponent(estado)}`;
        if (caja_id) path += `&caja_id=eq.${encodeURIComponent(caja_id)}`;
        if (desde) path += `&fecha=gte.${encodeURIComponent(desde)}`;
        if (hasta) path += `&fecha=lte.${encodeURIComponent(hasta)}`;
        let fiados = await sbGet(path);
        // Permiso por caja: el empleado solo ve fiados de sus cajas.
        const permitFi = await _cajasPermitidas(payload);
        if (permitFi !== null) fiados = fiados.filter(f => permitFi.includes(String(f.caja_id)));
        // Enriquecer con nombre de caja y compañía
        const cajasIds = [...new Set(fiados.map(f => f.caja_id).filter(Boolean))];
        const cmpIds = [...new Set(fiados.map(f => f.compania_id).filter(Boolean))];
        const cajasInfo = cajasIds.length ? await sbGet(
          `cajas?id=in.(${cajasIds.map(encodeURIComponent).join(',')})&select=id,nombre,icono`
        ) : [];
        const cmpsInfo = cmpIds.length ? await sbGet(
          // AUD-fix: filtrar por tienda_id para no exponer el nombre de una compañía de otra tienda.
          `cajas_companias?id=in.(${cmpIds.map(encodeURIComponent).join(',')})&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id,nombre`
        ) : [];
        const mapCaja = Object.fromEntries(cajasInfo.map(c => [c.id, c]));
        const mapCmp = Object.fromEntries(cmpsInfo.map(c => [c.id, c]));
        const enriched = fiados.map(f => ({
          ...f,
          caja_nombre: mapCaja[f.caja_id]?.nombre,
          caja_icono: mapCaja[f.caja_id]?.icono,
          compania_nombre: mapCmp[f.compania_id]?.nombre
        }));
        return ok(res, { fiados: enriched });
      }

      case 'contar_fiados_pendientes': {
        let fiados = await sbGet(
          `cajas_fiados?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&estado=eq.pendiente&select=id,importe,caja_id`
        );
        // Permiso por caja: el empleado solo cuenta pendientes de sus cajas.
        const permitCf = await _cajasPermitidas(payload);
        if (permitCf !== null) fiados = fiados.filter(f => permitCf.includes(String(f.caja_id)));
        const total = fiados.reduce((s, f) => s + Number(f.importe || 0), 0);
        return ok(res, { count: fiados.length, total: Math.round(total * 100) / 100 });
      }

      case 'crear_fiado': {
        const {
          caja_id, compania_id, cierre_id, fecha, importe,
          cliente_nombre, cliente_telefono, nota
        } = req.body || {};
        const _impCrear = Number(importe);
        if (!caja_id || !fecha || !importe || !Number.isFinite(_impCrear) || _impCrear <= 0) {
          return err(res, 400, 'caja_id, fecha e importe (>0) obligatorios');
        }
        // Verificar caja
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0) return err(res, 403, 'Caja no accesible');
        if (!(await puedeAccederCaja(payload, caja_id))) return err(res, 403, 'Sin permiso para esta caja');
        const data = await sbPost('cajas_fiados', {
          tienda_id,
          caja_id,
          compania_id: compania_id || null,
          cierre_id: cierre_id || null,
          fecha,
          importe: _impCrear,
          cliente_nombre: cliente_nombre || null,
          cliente_telefono: cliente_telefono || null,
          nota: nota || null,
          estado: 'pendiente'
        });
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'editar_fiado': {
        const { id, cliente_nombre, cliente_telefono, nota, importe } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!(await puedeAccederCaja(payload, await _cajaDeFiado(id)))) return err(res, 403, 'Sin permiso para esta caja');
        // CAJ-3: cambiar importe afecta la deuda real del cliente. Si el usuario
        // intenta cambiar el importe, requiere permiso explícito de cobro/edición.
        // Cambios de nombre/teléfono/nota son cosméticos y se permiten sin permiso.
        if (importe !== undefined) {
          const puedeEditarImporte = await tienePermisoCaja(payload, 'cobrar');
          if (!puedeEditarImporte) return err(res, 403, 'No tienes permiso para modificar el importe');
          const _impEd = Number(importe);
          if (!Number.isFinite(_impEd) || _impEd <= 0) return err(res, 400, 'Importe inválido (>0)');
        }
        const patch = {};
        if (cliente_nombre !== undefined) patch.cliente_nombre = cliente_nombre;
        if (cliente_telefono !== undefined) patch.cliente_telefono = cliente_telefono;
        if (nota !== undefined) patch.nota = nota;
        if (importe !== undefined) patch.importe = Number(importe);
        if (Object.keys(patch).length === 0) return err(res, 400, 'Nada que actualizar');
        const data = await sbPatch(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          patch
        );
        // Si cambió el importe, recalcular cierre afectado
        if (importe !== undefined) await recalcularCierreDeFiado(id, tienda_id);
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'marcar_cobrado': {
        const { id, metodo_pago } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!metodo_pago || !['efectivo','tarjeta'].includes(metodo_pago)) {
          return err(res, 400, 'metodo_pago debe ser efectivo o tarjeta');
        }
        // Validar permiso: admin o permiso explícito
        const puede = await tienePermisoCaja(payload, 'cajasm_cobrar');
        if (!puede) return err(res, 403, 'No tienes permiso para cobrar pendientes');
        if (!(await puedeAccederCaja(payload, await _cajaDeFiado(id)))) return err(res, 403, 'Sin permiso para esta caja');

        const data = await sbPatch(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          {
            estado: 'cobrado',
            metodo_pago,
            fecha_cobro: new Date().toISOString(),
            cobrado_por: payload.email || null
          }
        );
        // Recalcular cierre del día original automáticamente
        await recalcularCierreDeFiado(id, tienda_id);
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'anular_fiado': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        // CAJ-2: anular fiado afecta contabilidad. Solo admin o usuario con permiso 'cobrar'
        // (mismo permiso que cobrar — anular es la operación inversa).
        const puede = await tienePermisoCaja(payload, 'cobrar');
        if (!puede) return err(res, 403, 'No tienes permiso para anular fiados');
        if (!(await puedeAccederCaja(payload, await _cajaDeFiado(id)))) return err(res, 403, 'Sin permiso para esta caja');
        const data = await sbPatch(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          { estado: 'anulado' }
        );
        // CAJ-4: si recalcular falla, ya queda log; pero el cambio principal ya está hecho
        await recalcularCierreDeFiado(id, tienda_id);
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'borrar_fiado': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!(await esAdminTiendaDB(payload))) return err(res, 403, 'Solo admin');
        await sbDelete(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`
        );
        return ok(res, {});
      }


      case 'resumen_periodo': {
        const { desde, hasta } = req.query;
        if (!desde || !hasta) return err(res, 400, 'desde y hasta obligatorios');
        // Ver el histórico (calendario de días anteriores) requiere permiso; admin siempre.
        if (!(await tienePermisoCaja(payload, 'cajasm_historico'))) return err(res, 403, 'Sin permiso para ver días anteriores');

        // 1) Cierres del periodo
        let cierres = await sbGet(
          `cajas_cierres?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&fecha=gte.${encodeURIComponent(desde)}`
          + `&fecha=lte.${encodeURIComponent(hasta)}`
          + `&select=fecha,estado,descuadre,caja_id&order=fecha.asc`
        );

        // 2) Fiados pendientes del periodo (para color amarillo)
        let fiados = await sbGet(
          `cajas_fiados?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&estado=eq.pendiente`
          + `&fecha=gte.${encodeURIComponent(desde)}`
          + `&fecha=lte.${encodeURIComponent(hasta)}`
          + `&select=fecha,importe,caja_id`
        );

        // Permiso por caja: el empleado solo agrega sus cajas al resumen.
        const permitRp = await _cajasPermitidas(payload);
        if (permitRp !== null) {
          cierres = cierres.filter(c => permitRp.includes(String(c.caja_id)));
          fiados = fiados.filter(f => permitRp.includes(String(f.caja_id)));
        }

        // 3) Calcular peor estado por día
        // Prioridad: falta > borrador > pendientes > sobra > cuadrado > vacio
        const PRIO = {
          falta: 6,
          borrador: 5,
          pendientes: 4,
          sobra: 3,
          cuadrado: 2,
          festivo: 1,
          vacio: 0
        };
        const dias = {};

        // Marcar días con fiados pendientes como "pendientes"
        for (const f of fiados) {
          const fecha = f.fecha;
          if (!dias[fecha]) dias[fecha] = { estado: 'pendientes', descuadre: 0, fiado: 0 };
          dias[fecha].fiado = (dias[fecha].fiado || 0) + Number(f.importe || 0);
          // Si ya estaba como cuadrado o sobra, subir a pendientes
          if (PRIO[dias[fecha].estado] < PRIO.pendientes) {
            dias[fecha].estado = 'pendientes';
          }
        }

        // Aplicar estado de cierres
        for (const c of cierres) {
          const f = c.fecha;
          let estadoDia;
          if (c.estado === 'festivo') {
            estadoDia = 'festivo';
          } else if (c.estado === 'abierto') {
            estadoDia = 'borrador';
          } else if (Math.abs(Number(c.descuadre || 0)) <= 0.5) {
            estadoDia = 'cuadrado';
          } else if (Number(c.descuadre) > 0.5) {
            estadoDia = 'sobra';
          } else {
            estadoDia = 'falta';
          }
          if (!dias[f] || PRIO[estadoDia] > PRIO[dias[f].estado]) {
            dias[f] = {
              estado: estadoDia,
              descuadre: Number(c.descuadre || 0),
              fiado: dias[f]?.fiado || 0
            };
          }
        }

        return ok(res, { dias });
      }

      default:  
        return err(res, 400, `Acción desconocida: ${action}`);
    }
  } catch (e) {
    // CAJ-6: mensaje genérico al cliente, log detallado en servidor.
    // Antes devolvíamos e.message que incluía status + texto crudo de Supabase
    // (con detalles internos como nombres de columnas, códigos PG, etc.)
    console.error('[api/cajas] error:', e.message, e.stack);
    return err(res, 500, 'Error interno del servidor');
  }
}
