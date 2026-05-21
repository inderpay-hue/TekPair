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

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPost(path, body, opts = {}) {
  const headers = sbHeaders({ Prefer: 'return=representation' });
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Supabase POST ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPatch(path, body) {
  const headers = sbHeaders({ Prefer: 'return=representation' });
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbDelete(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!r.ok && r.status !== 204) throw new Error(`Supabase DELETE ${path}: ${r.status} ${await r.text()}`);
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

function esSuperAdmin(payload) {
  return payload?.email === 'info@tekpair.tech';
}

function esAdminTienda(payload) {
  return payload?.rol === 'admin' || esSuperAdmin(payload);
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
function calcularSaldoTeorico(tipoCaja, saldoInicial, movimientos) {
  let teorico = Number(saldoInicial || 0);
  for (const m of movimientos) {
    if (tipoCaja === 'envios') {
      teorico += Number(m.importe_cobrado || 0);
    } else if (tipoCaja === 'recargas') {
      teorico += Number(m.importe_efectivo || 0);
    }
  }
  return Math.round(teorico * 100) / 100;
}


// ── Handler principal ─────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
        return ok(res, { cajas });
      }

      case 'crear_caja': {
        const { tipo, nombre, icono, color, orden } = req.body || {};
        if (!tipo || !nombre) return err(res, 400, 'tipo y nombre obligatorios');
        if (!['envios','recargas','tpv','custom'].includes(tipo)) {
          return err(res, 400, 'tipo inválido');
        }
        const iconoDef = icono || (tipo === 'envios' ? '📤' : tipo === 'recargas' ? '📱' : tipo === 'tpv' ? '🛒' : '💼');
        const data = await sbPost('cajas', {
          tienda_id,
          tipo,
          nombre,
          icono: iconoDef,
          color: color || '#3b82f6',
          orden: Number(orden || 0)
        });
        return ok(res, { caja: Array.isArray(data) ? data[0] : data });
      }

      case 'editar_caja': {
        const { id, nombre, icono, color, orden, activa, permiso_editar_cerrada } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        const patch = {};
        if (nombre !== undefined) patch.nombre = nombre;
        if (icono !== undefined) patch.icono = icono;
        if (color !== undefined) patch.color = color;
        if (orden !== undefined) patch.orden = Number(orden);
        if (activa !== undefined) patch.activa = !!activa;
        if (permiso_editar_cerrada !== undefined) patch.permiso_editar_cerrada = permiso_editar_cerrada;
        const data = await sbPatch(
          `cajas?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          patch
        );
        return ok(res, { caja: Array.isArray(data) ? data[0] : data });
      }

      case 'borrar_caja': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
        await sbDelete(
          `cajas?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`
        );
        return ok(res, {});
      }


      // ─── COMPAÑÍAS ───────────────────────────
      case 'listar_companias': {
        const caja_id = req.query.caja_id;
        if (!caja_id) return err(res, 400, 'caja_id obligatorio');
        // Verificar caja
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0 && !esSuperAdmin(payload)) {
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
        // Verificar pertenencia: compañía → caja → tienda
        const cmps = await sbGet(
          `cajas_companias?id=eq.${encodeURIComponent(id)}&select=caja_id`
        );
        if (cmps.length === 0) return err(res, 404, 'Compañía no encontrada');
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
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
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

        // Saldo sugerido: cambio_siguiente del cierre anterior
        const previos = await sbGet(
          `cajas_cierres?caja_id=eq.${encodeURIComponent(caja_id)}&fecha=lt.${encodeURIComponent(fecha)}&order=fecha.desc&limit=1&select=cambio_siguiente`
        );
        const saldo_sugerido = previos[0]?.cambio_siguiente || 0;

        return ok(res, { caja, cierre, movimientos, companias, saldo_sugerido });
      }

      case 'guardar_cierre': {
        const {
          caja_id, fecha, saldo_inicial, saldo_real_final, cambio_siguiente,
          notas, estado, movimientos
        } = req.body || {};
        if (!caja_id || !fecha) return err(res, 400, 'caja_id y fecha obligatorios');
        if (!Array.isArray(movimientos)) return err(res, 400, 'movimientos[] obligatorio');

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
          if (caja.permiso_editar_cerrada === 'nadie' && !esSuperAdmin(payload)) {
            return err(res, 403, 'Cierre bloqueado');
          }
          if (caja.permiso_editar_cerrada === 'admin' && !esAdminTienda(payload)) {
            return err(res, 403, 'Solo admin puede editar cierres cerrados');
          }
        }

        const saldoTeorico = calcularSaldoTeorico(caja.tipo, saldo_inicial, movimientos);
        const saldoReal = Number(saldo_real_final || 0);
        const descuadre = Math.round((saldoReal - saldoTeorico) * 100) / 100;
        const estadoFinal = estado === 'cerrado'
          ? (Math.abs(descuadre) > 0.5 ? 'descuadre' : 'cerrado')
          : 'abierto';

        const cierrePayload = {
          caja_id,
          tienda_id,
          fecha,
          saldo_inicial: Number(saldo_inicial || 0),
          saldo_real_final: saldoReal,
          saldo_teorico: saldoTeorico,
          descuadre,
          cambio_siguiente: Number(cambio_siguiente || 0),
          estado: estadoFinal,
          notas: notas || null
        };
        if (estado === 'cerrado') {
          cierrePayload.cerrado_por = payload.email;
          cierrePayload.cerrado_at = new Date().toISOString();
        }

        let cierreId;
        if (cierreExistente) {
          const data = await sbPatch(
            `cajas_cierres?id=eq.${encodeURIComponent(cierreExistente.id)}`,
            cierrePayload
          );
          cierreId = Array.isArray(data) ? data[0].id : data.id;
          // Borrar movimientos previos
          await sbDelete(`cajas_movimientos?cierre_id=eq.${encodeURIComponent(cierreId)}`);
        } else {
          const data = await sbPost('cajas_cierres', cierrePayload);
          cierreId = Array.isArray(data) ? data[0].id : data.id;
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
        if (movsInsert.length > 0) {
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
        let path = `cajas_cierres?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&fecha=gte.${encodeURIComponent(desde)}`
          + `&fecha=lte.${encodeURIComponent(hasta)}`
          + `&order=fecha.desc`;
        if (caja_id) path += `&caja_id=eq.${encodeURIComponent(caja_id)}`;
        const cierres = await sbGet(path);
        return ok(res, { cierres });
      }

      case 'reabrir_cierre': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
        const data = await sbPatch(
          `cajas_cierres?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          { estado: 'abierto', cerrado_at: null, cerrado_por: null }
        );
        return ok(res, { cierre: Array.isArray(data) ? data[0] : data });
      }

      default:
        return err(res, 400, `Acción desconocida: ${action}`);
    }
  } catch (e) {
    console.error('[api/cajas] error:', e.message, e.stack);
    return err(res, 500, e.message || 'Error interno');
  }
}
