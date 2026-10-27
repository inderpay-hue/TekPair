// Pruebas del lector de facturas de proveedor (Stock › Importar factura, js/dash-app.js).
// Uso: node tests/unit/impfac-parser.test.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dash-app.js'), 'utf8');
const ini = src.indexOf('// Importe de factura → número');
const fin = src.indexOf('function impFacMostrarRevision');
assert.ok(ini > 0 && fin > ini, 'no se encuentra el lector de facturas en dash-app.js');
const ctx = { _norm: (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') };
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fin), ctx);
const leer = (t) => JSON.parse(JSON.stringify(ctx.impFacParsearProductos(t.split('\n'), t)));   // fuera del vm (otro realm)

let n = 0;
function caso(nombre, fn) { fn(); n++; console.log('✓ ' + nombre); }

caso('factura de recambios: 8 productos con uds y coste', () => {
  const t = 'RECAMBIOS MÓVIL DEMO S.L.\nCIF B00000005 · Polígono Industrial Demo, nave 3 · 28806 Alcalá de Henares (Madrid)\nFACTURA Nº FD-2026-0457 Fecha: 27/10/2026\nCliente: Phone Fix Centre · B00000004 · Calle Mayor, 25 · 28801 Alcalá de Henares\nRef. Descripción Uds. Precio ud. Importe\nPAN-IP13-OLED Pantalla iPhone 13 OLED 3 48,00 144,00\nPAN-IP13-INC Pantalla iPhone 13 Incell 3 26,00 78,00\nBAT-IP13 Batería iPhone 13 compatible 5 14,50 72,50\nFLEX-IP13 Conector de carga iPhone 13 4 9,00 36,00\nFUN-IP13-SIL Funda silicona iPhone 13 10 3,20 32,00\nCRI-IP13 Cristal templado iPhone 13 20 1,10 22,00\nCAR-20W Cargador USB-C 20 W 8 5,40 43,20\nCAB-USBC-L Cable USB-C a Lightning 1 m 12 2,30 27,60\nBase imponible: 455,30 € · IVA 21 %: 95,61 € · TOTAL: 550,91 €';
  const r = leer(t);
  assert.strictEqual(r.length, 8);
  assert.deepStrictEqual(r.map((p) => [p.cat, p.unidades, p.coste]), [
    ['Pantalla', 3, 48], ['Pantalla', 3, 26], ['Bateria', 5, 14.5], ['Flex de Carga', 4, 9],
    ['Accesorio', 10, 3.2], ['Accesorio', 20, 1.1], ['Accesorio', 8, 5.4], ['Accesorio', 12, 2.3]
  ]);
  assert.strictEqual(r[0].marca, 'Apple'); assert.strictEqual(r[0].modelo, 'iPhone 13'); assert.strictEqual(r[0].calidad, 'OLED');
  assert.strictEqual(r[1].calidad, 'Incell');
  assert.strictEqual(r[6].modelo, 'Cargador USB-C 20 W');
});

caso('1. teléfono con «IMEI:» en la línea de abajo: una sola vez, como teléfono', () => {
  const r = leer('Apple iPhone 13 128GB Negro 1 450,00 450,00\nIMEI: 356789012345678\nPantalla iPhone 11 Incell 2 15,00 30,00');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].cat, 'Telefono'); assert.strictEqual(r[0].imei, '356789012345678'); assert.strictEqual(r[0].coste, 450);
  assert.strictEqual(r[1].cat, 'Pantalla');
});
caso('1. teléfono suelto sin IMEI no entra como repuesto; una cámara sí', () => {
  const r = leer('Samsung Galaxy A52 128GB Azul 1 199,00 199,00\nCámara trasera iPhone 13 2 12,00 24,00');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].cat, 'Repuesto'); assert.strictEqual(r[0].unidades, 2);
});

caso('2. envío, recargo, descuentos y totales no son stock', () => {
  const r = leer([
    'Gastos de envío 1 5,95 5,95', 'Envío urgente 1 9,90 9,90', 'Recargo de equivalencia 5,2 % 1 23,68 23,68',
    'Importe total 1 1.234,56 1.234,56', 'Descuento comercial 1 10,00 10,00', 'Total líneas 1 50,00 50,00',
    'Suma 1 50,00 50,00', 'Portes 1 4,00 4,00', 'IVA 21% 1 10,50 10,50', 'Batería iPhone 12 2 13,00 26,00'
  ].join('\n'));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].cat, 'Bateria');
});

caso('3. «precio uds importe» con uds sin decimales', () => {
  const r = leer('Pantalla iPhone 11 Incell 15,00 2 30,00\nBatería iPhone 12 3 48,00 144,00\nCable USB-C 2,50 4 10,00\nPantalla Galaxy A52 OLED 1.050,00 2 2.100,00');
  assert.deepStrictEqual(r.map((p) => [p.unidades, p.coste]), [[2, 15], [3, 48], [4, 2.5], [2, 1050]]);
});

console.log(n + ' casos OK');
