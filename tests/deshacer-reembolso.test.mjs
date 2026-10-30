// Deshacer reembolso / devolución: cuentas puras de api/_lib/deshacer-reembolso.js.
// Ejecutar: node --test tests/deshacer-reembolso.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../api/_lib/deshacer-reembolso.js';

const HORA = 3600 * 1000;
const original = {
  id: 'v1', items: JSON.stringify([
    { id: 's1', nombre: 'Funda', qty: 3, precio: 10, devuelto: 2, devs: [{ id: 'd1', q: 1, imp: 10 }, { id: 'd2', q: 1, imp: 10 }] },
    { id: 's2', nombre: 'Cargador', qty: 1, precio: 20 },
  ]),
};
const dev = {
  id: 'd1', tienda_id: 't', fecha: '2026-10-30', pago: 'Efectivo', numero: 7, cliente_id: 'c1', cliente_nombre: 'Ana',
  precio: -10, total: -10, base: -8.26, iva_importe: -1.74, iva: 21, iva_modo: 'incluido', created_at: new Date().toISOString(),
  items: JSON.stringify([{ id: 's1', nombre: 'Funda', qty: -1, precio: 10, dev: { v: 'v1', n: 3, f: '2026-10-29', i: 0, imp: 10 } }]),
};

test('tipoDeshacer: reembolso entero, devolución parcial o nada', () => {
  assert.equal(D.tipoDeshacer({ reembolsado: true }), 'total');
  assert.equal(D.tipoDeshacer(dev), 'parcial');
  assert.equal(D.tipoDeshacer({ reembolsado: false, items: '[]' }), null);
  assert.equal(D.tipoDeshacer(null), null);
});

test('dentroDelPlazo: 24 h justas', () => {
  const ahora = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(D.dentroDelPlazo(new Date(ahora - 23 * HORA).toISOString(), ahora), true);
  assert.equal(D.dentroDelPlazo(new Date(ahora - 25 * HORA).toISOString(), ahora), false);
  assert.equal(D.dentroDelPlazo('', ahora), false);
});

test('devolucionApuntada / itemsSinDevolucion: quita solo esa devolución', () => {
  assert.equal(D.devolucionApuntada(original, 'd1'), true);
  assert.equal(D.devolucionApuntada(original, 'd9'), false);
  const its = D.itemsSinDevolucion(original, 'd1');
  assert.equal(its[0].devuelto, 1);
  assert.deepEqual(its[0].devs.map(d => d.id), ['d2']);
  assert.equal(its[1].devs, undefined);
  const sinNada = D.itemsSinDevolucion({ items: D.itemsSinDevolucion(original, 'd1') }, 'd2');
  assert.equal(sinNada[0].devuelto, undefined);
  assert.equal(sinNada[0].devs, undefined);
  assert.equal(D.devolucionApuntada({ items: sinNada }, 'd2'), false);
});

test('filaContraria: importes en positivo, unidades en positivo y marca undev', () => {
  const c = D.filaContraria(dev, { id: 'd1_undo', fecha: '2026-10-30', tienda_id: 't', numTicketDev: 'T2026-000007', nota: '' });
  assert.equal(c.total, 10);
  assert.equal(c.precio, 10);
  assert.equal(c.base, 8.26);
  assert.equal(c.iva_importe, 1.74);
  assert.equal(c.pago, 'Efectivo');
  assert.equal(c.reembolsado, false);
  assert.match(c.modelo, /Deshace la devolución T2026-000007/);
  const its = JSON.parse(c.items);
  assert.equal(its[0].qty, 1);
  assert.equal(its[0].dev, undefined);
  assert.deepEqual(its[0].undev, { d: 'd1', v: 'v1', i: 0 });
  assert.equal(D.esContraria(c), true);
  assert.equal(D.tipoDeshacer(c), null);   // la contraria no es una devolución
  assert.equal(D.esContraria(dev), false);
});

test('tieneAbono', () => {
  assert.equal(D.tieneAbono([{ id: 'f1' }]), false);
  assert.equal(D.tieneAbono([{ id: 'f1', rectificada_por: 'f2' }, { id: 'f2', rectifica_a: 'f1' }]), true);
  assert.equal(D.tieneAbono(null), false);
});
