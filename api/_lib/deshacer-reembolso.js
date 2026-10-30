// =====================================================
// TEKPAIR — Deshacer un reembolso o una devolución (cuentas puras, sin red)
// =====================================================
// Lo usa api/cajas.js (action=deshacer_reembolso). Hay dos casos:
//
//  · Reembolso ENTERO (reembolsarVenta): la venta tiene reembolsado=true y la caja
//    resta todo el ticket el día fecha_reembolso. Deshacer = volver a ponerla como
//    cobrada (reembolsado=false, sin fecha_reembolso). Es la misma fila: no hay
//    ningún ticket que borrar.
//
//  · Devolución PARCIAL (js/devolucion.js): una fila nueva en `ventas` en negativo
//    cuyas líneas llevan `dev: { v: venta original, ... }`, y en la original cada
//    línea guarda `devuelto` y `devs` (historial). No se borra: se crea una fila
//    CONTRARIA (mismos importes en positivo, mismas unidades) cuyas líneas llevan
//    `undev: { d: id de la devolución, v: venta original }`, y se quita esa
//    devolución del historial de la original (sus unidades se pueden volver a
//    devolver). La caja la suma el día de hoy con la misma forma de pago.
//
// Solo en las 24 h siguientes y si la caja de ese día no está cerrada (lo mira
// api/cajas.js). Una devolución hecha como «Cambio» no se deshace: ese saldo ya se
// ha podido usar en otra venta.

export const HORAS_DESHACER = 24;

export function itemsDe(v) {
  let its = v && v.items;
  if (typeof its === 'string') { try { its = JSON.parse(its); } catch (e) { its = null; } }
  return Array.isArray(its) ? its : [];
}

// La devolución parcial a la que pertenece una fila (o null si no es una devolución).
export function devDe(v) {
  for (const it of itemsDe(v)) if (it && it.dev && it.dev.v) return it.dev;
  return null;
}

// 'total' | 'parcial' | null
export function tipoDeshacer(v) {
  if (!v) return null;
  if (v.reembolsado === true) return 'total';
  if (devDe(v)) return 'parcial';
  return null;
}

export function dentroDelPlazo(desdeIso, ahora = Date.now()) {
  const t = Date.parse(desdeIso || '');
  if (!isFinite(t)) return false;
  return ahora - t <= HORAS_DESHACER * 3600 * 1000 && ahora - t >= -5 * 60 * 1000;
}

// ¿La venta original todavía tiene apuntada esa devolución? (si no, ya se deshizo)
export function devolucionApuntada(original, devId) {
  return itemsDe(original).some(it => Array.isArray(it && it.devs) && it.devs.some(d => d && d.id === devId));
}

// Líneas de la venta original sin la devolución devId: fuera de `devs` y sus
// unidades restadas de `devuelto`.
export function itemsSinDevolucion(original, devId) {
  return itemsDe(original).map(it => {
    if (!it || !Array.isArray(it.devs)) return it;
    const quitadas = it.devs.filter(d => d && d.id === devId);
    if (!quitadas.length) return it;
    const q = quitadas.reduce((s, d) => s + (parseInt(d.q, 10) || 0), 0);
    const o = { ...it, devs: it.devs.filter(d => !(d && d.id === devId)) };
    o.devuelto = Math.max(0, (parseInt(it.devuelto, 10) || 0) - q);
    if (!o.devs.length) delete o.devs;
    if (!o.devuelto) delete o.devuelto;
    return o;
  });
}

const r2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const neg = (n) => { const x = -r2(n); return x === 0 ? 0 : x; };

// Fila contraria de una devolución parcial, lista para insertar en `ventas`.
export function filaContraria(dev, { id, fecha, tienda_id, numTicketDev, nota }) {
  const modelo = (`Deshace la devolución${numTicketDev ? ' ' + numTicketDev : ''}` + (nota ? ': ' + nota : '')).slice(0, 250);
  const items = itemsDe(dev).map(it => {
    const o = { ...it, qty: Math.abs(parseFloat(it.qty) || 1) };
    const d = o.dev || {};
    delete o.dev;
    o.undev = { d: dev.id, v: d.v || null, i: d.i != null ? d.i : null };
    return o;
  });
  return {
    id, tienda_id, fecha,
    cliente_id: dev.cliente_id || null, cliente_nombre: dev.cliente_nombre || null,
    marca: '', modelo, imei: '',
    pago: dev.pago, precio: neg(dev.precio), descuento: 0, total: neg(dev.total),
    reembolsado: false, financiado: false, cuotas: null, entrada: 0, entrada_pago: null,
    iva: dev.iva || 0, iva_modo: dev.iva_modo || 'sin', base: neg(dev.base), iva_importe: neg(dev.iva_importe),
    items: JSON.stringify(items),
  };
}

// ¿Esta fila es la contraria de una devolución? (no se puede reembolsar ni devolver)
export function esContraria(v) {
  return itemsDe(v).some(it => it && it.undev && it.undev.d);
}

// Facturas de una venta: ¿hay ya un abono (rectificativa)? Entonces no se deshace.
export function tieneAbono(facturas) {
  return (facturas || []).some(f => f && (f.rectifica_a || f.rectificada_por));
}
