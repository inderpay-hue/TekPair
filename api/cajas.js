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
        const { tipo, nombre, icono, color, orden, dias_apertura } = req.body || {};
        if (!tipo || !nombre) return err(res, 400, 'tipo y nombre obligatorios');
        if (!['envios','recargas','tpv','custom'].includes(tipo)) {
          return err(res, 400, 'tipo inválido');
        }
        const iconoDef = icono || (tipo === 'envios' ? '📤' : tipo === 'recargas' ? '📱' : tipo === 'tpv' ? '🛒' : '💼');
        const payload = {
          tienda_id,
          tipo,
          nombre,
          icono: iconoDef,
          color: color || '#3b82f6',
          orden: Number(orden || 0)
        };
        if (Array.isArray(dias_apertura) && dias_apertura.length > 0) {
          payload.dias_apertura = dias_apertura.filter(d => Number.isInteger(d) && d >= 1 && d <= 7);
        }
        if (typeof req.body.gestion_fiados === 'boolean') {
          payload.gestion_fiados = req.body.gestion_fiados;
        }
        const data = await sbPost('cajas', payload);
        return ok(res, { caja: Array.isArray(data) ? data[0] : data });
      }

      case 'editar_caja': {
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
          notas, estado, movimientos, total_cobrado_caja, importe_tpv
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

        const saldoTeorico = calcularSaldoTeorico(caja.tipo, saldo_inicial, movimientos, total_cobrado_caja);
        const saldoReal = Number(saldo_real_final || 0);
        const descuadre = Math.round((saldoReal - saldoTeorico) * 100) / 100;
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


      // ═══ FIADOS / COBROS PENDIENTES ═══

      case 'listar_fiados': {
        const { estado, caja_id, desde, hasta } = req.query;
        let path = `cajas_fiados?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&order=fecha.desc,created_at.desc`;
        if (estado) path += `&estado=eq.${encodeURIComponent(estado)}`;
        if (caja_id) path += `&caja_id=eq.${encodeURIComponent(caja_id)}`;
        if (desde) path += `&fecha=gte.${encodeURIComponent(desde)}`;
        if (hasta) path += `&fecha=lte.${encodeURIComponent(hasta)}`;
        const fiados = await sbGet(path);
        // Enriquecer con nombre de caja y compañía
        const cajasIds = [...new Set(fiados.map(f => f.caja_id).filter(Boolean))];
        const cmpIds = [...new Set(fiados.map(f => f.compania_id).filter(Boolean))];
        const cajasInfo = cajasIds.length ? await sbGet(
          `cajas?id=in.(${cajasIds.map(encodeURIComponent).join(',')})&select=id,nombre,icono`
        ) : [];
        const cmpsInfo = cmpIds.length ? await sbGet(
          `cajas_companias?id=in.(${cmpIds.map(encodeURIComponent).join(',')})&select=id,nombre`
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
        const fiados = await sbGet(
          `cajas_fiados?tienda_id=eq.${encodeURIComponent(tienda_id)}`
          + `&estado=eq.pendiente&select=id,importe`
        );
        const total = fiados.reduce((s, f) => s + Number(f.importe || 0), 0);
        return ok(res, { count: fiados.length, total: Math.round(total * 100) / 100 });
      }

      case 'crear_fiado': {
        const {
          caja_id, compania_id, cierre_id, fecha, importe,
          cliente_nombre, cliente_telefono, nota
        } = req.body || {};
        if (!caja_id || !fecha || !importe) {
          return err(res, 400, 'caja_id, fecha e importe obligatorios');
        }
        // Verificar caja
        const cajas = await sbGet(
          `cajas?id=eq.${encodeURIComponent(caja_id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}&select=id`
        );
        if (cajas.length === 0) return err(res, 403, 'Caja no accesible');
        const data = await sbPost('cajas_fiados', {
          tienda_id,
          caja_id,
          compania_id: compania_id || null,
          cierre_id: cierre_id || null,
          fecha,
          importe: Number(importe),
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
        const patch = {};
        if (cliente_nombre !== undefined) patch.cliente_nombre = cliente_nombre;
        if (cliente_telefono !== undefined) patch.cliente_telefono = cliente_telefono;
        if (nota !== undefined) patch.nota = nota;
        if (importe !== undefined) patch.importe = Number(importe);
        const data = await sbPatch(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          patch
        );
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'marcar_cobrado': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        const data = await sbPatch(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          {
            estado: 'cobrado',
            fecha_cobro: new Date().toISOString(),
            cobrado_por: payload.email || null
          }
        );
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'anular_fiado': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        const data = await sbPatch(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`,
          { estado: 'anulado' }
        );
        return ok(res, { fiado: Array.isArray(data) ? data[0] : data });
      }

      case 'borrar_fiado': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
        await sbDelete(
          `cajas_fiados?id=eq.${encodeURIComponent(id)}&tienda_id=eq.${encodeURIComponent(tienda_id)}`
        );
        return ok(res, {});
      }

      default: 
        return err(res, 400, `Acción desconocida: ${action}`);
    }
  } catch (e) {
    console.error('[api/cajas] error:', e.message, e.stack);
    return err(res, 500, e.message || 'Error interno');
  }
}
