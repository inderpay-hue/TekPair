// =====================================================
// TEKPAIR — /api/cajas.js
// Endpoint único para módulo Cajas (Fase 1)
// =====================================================
// Acción se selecciona con ?action=xxx para no consumir
// más slots de Vercel Hobby (límite 12 funciones).
//
// ACCIONES disponibles:
//   GET  ?action=listar_cajas              → todas las cajas de la tienda
//   POST ?action=crear_caja                → crear caja
//   POST ?action=editar_caja               → editar caja
//   POST ?action=borrar_caja               → borrar caja
//   GET  ?action=listar_companias&caja_id  → compañías de una caja
//   POST ?action=crear_compania            → crear compañía
//   POST ?action=editar_compania           → editar compañía
//   POST ?action=borrar_compania           → borrar compañía
//   GET  ?action=obtener_cierre&caja_id&fecha → cierre del día (o vacío)
//   POST ?action=guardar_cierre            → upsert cierre + movimientos
//   GET  ?action=listar_cierres&desde&hasta → histórico
//   POST ?action=reabrir_cierre            → solo admin
// =====================================================

import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

// ── Helpers ───────────────────────────────────────
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
  // En TekPair el admin de tienda es el usuario que la creó.
  // El campo rol viene en el JWT si está; por defecto asumimos admin
  // si es el dueño (lo validamos contra DB cuando hace falta).
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
      // Tarjeta no entra en caja física
    }
  }
  return Math.round(teorico * 100) / 100;
}


// ── Handler principal ─────────────────────────────
export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = verificarToken(req);
  if (!payload) return err(res, 401, 'Token inválido');

  const tienda_id = payload.tienda_id;
  if (!tienda_id) return err(res, 401, 'JWT sin tienda_id');

  const action = (req.query.action || '').toString();

  try {
    switch (action) {

      // ─── CAJAS ───────────────────────────────
      case 'listar_cajas': {
        const { data, error } = await sb
          .from('cajas')
          .select('*')
          .eq('tienda_id', tienda_id)
          .order('orden', { ascending: true })
          .order('created_at', { ascending: true });
        if (error) throw error;
        return ok(res, { cajas: data || [] });
      }

      case 'crear_caja': {
        const { tipo, nombre, icono, color, orden } = req.body || {};
        if (!tipo || !nombre) return err(res, 400, 'tipo y nombre obligatorios');
        if (!['envios','recargas','tpv','custom'].includes(tipo)) {
          return err(res, 400, 'tipo inválido');
        }
        const { data, error } = await sb
          .from('cajas')
          .insert({
            tienda_id,
            tipo,
            nombre,
            icono: icono || (tipo === 'envios' ? '📤' : tipo === 'recargas' ? '📱' : tipo === 'tpv' ? '🛒' : '💼'),
            color: color || '#3b82f6',
            orden: Number(orden || 0)
          })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { caja: data });
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
        const { data, error } = await sb
          .from('cajas')
          .update(patch)
          .eq('id', id)
          .eq('tienda_id', tienda_id)
          .select()
          .single();
        if (error) throw error;
        return ok(res, { caja: data });
      }

      case 'borrar_caja': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
        const { error } = await sb
          .from('cajas')
          .delete()
          .eq('id', id)
          .eq('tienda_id', tienda_id);
        if (error) throw error;
        return ok(res, {});
      }


      // ─── COMPAÑÍAS ───────────────────────────
      case 'listar_companias': {
        const caja_id = req.query.caja_id;
        if (!caja_id) return err(res, 400, 'caja_id obligatorio');
        // Verificar que la caja es de la tienda
        const { data: caja } = await sb
          .from('cajas').select('id').eq('id', caja_id).eq('tienda_id', tienda_id).single();
        if (!caja && !esSuperAdmin(payload)) return err(res, 403, 'Caja no accesible');
        const { data, error } = await sb
          .from('cajas_companias')
          .select('*')
          .eq('caja_id', caja_id)
          .order('orden', { ascending: true })
          .order('nombre', { ascending: true });
        if (error) throw error;
        return ok(res, { companias: data || [] });
      }

      case 'crear_compania': {
        const { caja_id, nombre, orden } = req.body || {};
        if (!caja_id || !nombre) return err(res, 400, 'caja_id y nombre obligatorios');
        // Verificar caja
        const { data: caja } = await sb
          .from('cajas').select('id').eq('id', caja_id).eq('tienda_id', tienda_id).single();
        if (!caja) return err(res, 403, 'Caja no accesible');
        const { data, error } = await sb
          .from('cajas_companias')
          .insert({ caja_id, nombre: nombre.trim(), orden: Number(orden || 0) })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { compania: data });
      }

      case 'editar_compania': {
        const { id, nombre, orden, activa } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        const patch = {};
        if (nombre !== undefined) patch.nombre = nombre.trim();
        if (orden !== undefined) patch.orden = Number(orden);
        if (activa !== undefined) patch.activa = !!activa;
        // Verificar pertenencia
        const { data: cmp } = await sb
          .from('cajas_companias')
          .select('caja_id, cajas:caja_id(tienda_id)')
          .eq('id', id).single();
        if (!cmp || cmp.cajas?.tienda_id !== tienda_id) return err(res, 403, 'Sin acceso');
        const { data, error } = await sb
          .from('cajas_companias')
          .update(patch)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return ok(res, { compania: data });
      }

      case 'borrar_compania': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
        // Verificar pertenencia
        const { data: cmp } = await sb
          .from('cajas_companias')
          .select('caja_id, cajas:caja_id(tienda_id)')
          .eq('id', id).single();
        if (!cmp || cmp.cajas?.tienda_id !== tienda_id) return err(res, 403, 'Sin acceso');
        const { error } = await sb.from('cajas_companias').delete().eq('id', id);
        if (error) throw error;
        return ok(res, {});
      }


      // ─── CIERRES ─────────────────────────────
      case 'obtener_cierre': {
        const { caja_id, fecha } = req.query;
        if (!caja_id || !fecha) return err(res, 400, 'caja_id y fecha obligatorios');
        // Obtener caja
        const { data: caja } = await sb
          .from('cajas')
          .select('*')
          .eq('id', caja_id)
          .eq('tienda_id', tienda_id)
          .single();
        if (!caja) return err(res, 404, 'Caja no encontrada');
        // Buscar cierre
        const { data: cierre } = await sb
          .from('cajas_cierres')
          .select('*')
          .eq('caja_id', caja_id)
          .eq('fecha', fecha)
          .maybeSingle();
        // Movimientos (si existe cierre)
        let movimientos = [];
        if (cierre) {
          const { data: movs } = await sb
            .from('cajas_movimientos')
            .select('*')
            .eq('cierre_id', cierre.id);
          movimientos = movs || [];
        }
        // Compañías activas de la caja
        const { data: companias } = await sb
          .from('cajas_companias')
          .select('*')
          .eq('caja_id', caja_id)
          .eq('activa', true)
          .order('orden', { ascending: true });
        // Saldo anterior (cambio_siguiente del cierre del día previo)
        const { data: cierreAnterior } = await sb
          .from('cajas_cierres')
          .select('cambio_siguiente, fecha')
          .eq('caja_id', caja_id)
          .lt('fecha', fecha)
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();
        return ok(res, {
          caja,
          cierre: cierre || null,
          movimientos,
          companias: companias || [],
          saldo_sugerido: cierreAnterior?.cambio_siguiente || 0
        });
      }

      case 'guardar_cierre': {
        const {
          caja_id, fecha, saldo_inicial, saldo_real_final, cambio_siguiente,
          notas, estado, movimientos
        } = req.body || {};
        if (!caja_id || !fecha) return err(res, 400, 'caja_id y fecha obligatorios');
        if (!Array.isArray(movimientos)) return err(res, 400, 'movimientos[] obligatorio');
        // Verificar caja
        const { data: caja } = await sb
          .from('cajas')
          .select('*')
          .eq('id', caja_id)
          .eq('tienda_id', tienda_id)
          .single();
        if (!caja) return err(res, 404, 'Caja no encontrada');

        // Verificar si ya hay cierre y si está bloqueado para edición
        const { data: cierreExistente } = await sb
          .from('cajas_cierres')
          .select('*')
          .eq('caja_id', caja_id)
          .eq('fecha', fecha)
          .maybeSingle();
        if (cierreExistente && cierreExistente.estado === 'cerrado') {
          // Solo admin puede editar cerrado (o configuración permite a todos)
          if (caja.permiso_editar_cerrada === 'nadie' && !esSuperAdmin(payload)) {
            return err(res, 403, 'Cierre bloqueado');
          }
          if (caja.permiso_editar_cerrada === 'admin' && !esAdminTienda(payload)) {
            return err(res, 403, 'Solo admin puede editar cierres cerrados');
          }
        }

        // Calcular saldo teórico
        const saldoTeorico = calcularSaldoTeorico(caja.tipo, saldo_inicial, movimientos);
        const saldoReal = Number(saldo_real_final || 0);
        const descuadre = Math.round((saldoReal - saldoTeorico) * 100) / 100;
        const estadoFinal = estado === 'cerrado'
          ? (Math.abs(descuadre) > 0.5 ? 'descuadre' : 'cerrado')
          : 'abierto';

        // Upsert cierre
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
          const { data, error } = await sb
            .from('cajas_cierres')
            .update(cierrePayload)
            .eq('id', cierreExistente.id)
            .select()
            .single();
          if (error) throw error;
          cierreId = data.id;
          // Borrar movimientos previos
          await sb.from('cajas_movimientos').delete().eq('cierre_id', cierreId);
        } else {
          const { data, error } = await sb
            .from('cajas_cierres')
            .insert(cierrePayload)
            .select()
            .single();
          if (error) throw error;
          cierreId = data.id;
        }

        // Insertar movimientos
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
          const { error } = await sb.from('cajas_movimientos').insert(movsInsert);
          if (error) throw error;
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
        let q = sb.from('cajas_cierres')
          .select('*, cajas(nombre, tipo, icono, color)')
          .eq('tienda_id', tienda_id)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha', { ascending: false });
        if (caja_id) q = q.eq('caja_id', caja_id);
        const { data, error } = await q;
        if (error) throw error;
        return ok(res, { cierres: data || [] });
      }

      case 'reabrir_cierre': {
        const { id } = req.body || {};
        if (!id) return err(res, 400, 'id obligatorio');
        if (!esAdminTienda(payload)) return err(res, 403, 'Solo admin');
        const { data, error } = await sb
          .from('cajas_cierres')
          .update({ estado: 'abierto', cerrado_at: null, cerrado_por: null })
          .eq('id', id)
          .eq('tienda_id', tienda_id)
          .select()
          .single();
        if (error) throw error;
        return ok(res, { cierre: data });
      }

      default:
        return err(res, 400, `Acción desconocida: ${action}`);
    }
  } catch (e) {
    console.error('[api/cajas] error:', e);
    return err(res, 500, e.message || 'Error interno');
  }
}
