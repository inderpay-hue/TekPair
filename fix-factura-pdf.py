#!/usr/bin/env python3
"""
PATCH FASE B: PDF de factura
==============================
Añade window.generarFacturaPDF(f) a factura.js — genera el HTML de una
factura legal española (nombre de tienda destacado) y lanza window.print(),
igual que TekPair ya hace con los tickets. Se llama automáticamente al emitir.

Solo toca factura.js.
"""

import sys
import os

FACT = "factura.js"

if not os.path.exists(FACT):
    print(f"❌ {FACT} no encontrado")
    sys.exit(1)

with open(FACT, "r", encoding="utf-8") as f:
    fact = f.read()

# ─── Verificación ───
print("═══ VERIFICACIÓN PREVIA ═══")

ANCHOR_FASE3 = """        _toast('✓ Factura ' + f.numero + ' emitida', 'ok');
        window.cerrarModalFactura();
        // Fase 3: aquí se llamará al PDF"""

ANCHOR_CONSOLE = "  console.log('[factura.js] módulo cargado');"

n1 = fact.count(ANCHOR_FASE3)
n2 = fact.count(ANCHOR_CONSOLE)
print(f"  anchor Fase 3: {n1} (esperado 1)")
print(f"  anchor console.log: {n2} (esperado 1)")

if n1 != 1 or n2 != 1:
    print("  ❌ ABORTO: anchors no únicos")
    sys.exit(1)

if "generarFacturaPDF" in fact:
    print("  ⚠️  Ya aplicado (generarFacturaPDF existe). Sin cambios.")
    sys.exit(0)

print("✓ Verificación OK\n")

# ─── CAMBIO 1: llamar generarFacturaPDF tras emitir ───
print("═══ PATCH: llamada automática al PDF ═══")

NUEVO_FASE3 = """        _toast('✓ Factura ' + f.numero + ' emitida', 'ok');
        window.cerrarModalFactura();
        try { window.generarFacturaPDF(f); } catch (e) { console.warn('[factura.js] PDF:', e); }"""

fact = fact.replace(ANCHOR_FASE3, NUEVO_FASE3, 1)
print("  ✓ generarFacturaPDF se llama al emitir")

# ─── CAMBIO 2: añadir la función generarFacturaPDF ───
print("\n═══ PATCH: función generarFacturaPDF ═══")

FUNCION_PDF = r'''  // ────────── Generar PDF de la factura (ventana imprimible) ──────────
  function _fmtImporte(n) {
    return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' \u20ac';
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.generarFacturaPDF = function(f) {
    if (!f) { _toast('No hay datos de factura para el PDF', 'err'); return; }

    var emi = f.emisor_snapshot || {};
    var cli = f.cliente_snapshot || {};
    var lineas = f.lineas || [];
    var esSimplificada = (f.tipo === 'simplificada');

    // Fecha legible
    var fechaTxt = f.fecha_emision || '';
    try {
      var d = new Date(f.fecha_emision);
      if (!isNaN(d)) fechaTxt = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {}

    // Datos emisor
    var emiNombre = emi.razon_social || emi.nombre || 'Mi Tienda';
    var emiLineas = [];
    if (emi.cif) emiLineas.push('CIF/NIF: ' + emi.cif);
    if (emi.dir) emiLineas.push(emi.dir);
    var emiCP = [emi.cp, emi.ciudad].filter(Boolean).join(' ');
    if (emiCP) emiLineas.push(emiCP);
    if (emi.provincia) emiLineas.push(emi.provincia);
    if (emi.tel) emiLineas.push('Tel: ' + emi.tel);
    if (emi.email) emiLineas.push(emi.email);

    // Datos cliente
    var cliNombre, cliLineas = [];
    if (esSimplificada) {
      cliNombre = ((cli.nombre || '') + ' ' + (cli.apellidos || '')).trim() || 'Cliente';
      if (cli.nif) cliLineas.push('NIF: ' + cli.nif);
    } else {
      cliNombre = cli.nombre_fiscal || 'Cliente';
      if (cli.nif) cliLineas.push('NIF/CIF: ' + cli.nif);
      if (cli.dir_fiscal) cliLineas.push(cli.dir_fiscal);
      var cliCP = [cli.cp, cli.ciudad].filter(Boolean).join(' ');
      if (cliCP) cliLineas.push(cliCP);
      if (cli.provincia) cliLineas.push(cli.provincia);
    }

    // Filas de la tabla
    var filasHtml = '';
    lineas.forEach(function(ln) {
      var cant = parseFloat(ln.cantidad) || 1;
      var precio = parseFloat(ln.precio) || 0;
      var tot = parseFloat(ln.total);
      if (isNaN(tot)) tot = cant * precio;
      filasHtml +=
        '<tr>' +
        '<td class="desc">' + _esc(ln.desc || ln.nombre || '-') + '</td>' +
        '<td class="num">' + cant + '</td>' +
        '<td class="num">' + _fmtImporte(precio) + '</td>' +
        '<td class="num">' + _fmtImporte(tot) + '</td>' +
        '</tr>';
    });

    var emiInfoHtml = emiLineas.map(function(l){ return '<div>' + _esc(l) + '</div>'; }).join('');
    var cliInfoHtml = cliLineas.map(function(l){ return '<div>' + _esc(l) + '</div>'; }).join('');

    var tituloDoc = esSimplificada ? 'FACTURA SIMPLIFICADA' : 'FACTURA';

    var html =
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<title>Factura ' + _esc(f.numero) + '</title>' +
      '<style>' +
      '* { margin:0; padding:0; box-sizing:border-box; }' +
      'body { font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#1a1a2e; padding:32px 40px; font-size:13px; line-height:1.5; }' +
      '.cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #10B981; padding-bottom:18px; margin-bottom:24px; }' +
      '.marca { font-size:28px; font-weight:800; color:#10B981; letter-spacing:-0.5px; }' +
      '.marca .sub { display:block; font-size:11px; font-weight:500; color:#888; letter-spacing:0.5px; margin-top:2px; }' +
      '.doc-meta { text-align:right; }' +
      '.doc-meta .tipo { font-size:16px; font-weight:700; color:#1a1a2e; }' +
      '.doc-meta .numero { font-size:15px; color:#10B981; font-weight:700; margin-top:4px; }' +
      '.doc-meta .fecha { font-size:12px; color:#666; margin-top:4px; }' +
      '.bloques { display:flex; gap:24px; margin-bottom:28px; }' +
      '.bloque { flex:1; background:#f7f8fa; border-radius:8px; padding:14px 16px; }' +
      '.bloque h3 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#10B981; margin-bottom:8px; font-weight:700; }' +
      '.bloque .nom { font-size:14px; font-weight:700; margin-bottom:4px; }' +
      '.bloque div { font-size:12px; color:#444; }' +
      'table { width:100%; border-collapse:collapse; margin-bottom:20px; }' +
      'thead th { background:#1a1a2e; color:#fff; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; padding:9px 12px; text-align:left; }' +
      'thead th.num { text-align:right; }' +
      'tbody td { padding:9px 12px; border-bottom:1px solid #e8e8ee; font-size:12px; }' +
      'tbody td.num { text-align:right; white-space:nowrap; }' +
      'tbody td.desc { font-weight:500; }' +
      'tbody tr:last-child td { border-bottom:2px solid #1a1a2e; }' +
      '.totales { display:flex; justify-content:flex-end; }' +
      '.totales-box { width:280px; }' +
      '.totales-box .fila { display:flex; justify-content:space-between; padding:6px 12px; font-size:13px; }' +
      '.totales-box .fila.total { background:#10B981; color:#fff; font-weight:800; font-size:16px; border-radius:6px; padding:10px 12px; margin-top:6px; }' +
      '.pie { margin-top:36px; padding-top:14px; border-top:1px solid #e8e8ee; font-size:11px; color:#888; }' +
      '.pie .pago { color:#1a1a2e; font-weight:600; font-size:12px; margin-bottom:6px; }' +
      '@media print { body { padding:16px 20px; } @page { margin:1cm; } }' +
      '</style></head><body>' +
      '<div class="cab">' +
        '<div><div class="marca">' + _esc(emiNombre) + '<span class="sub">' + (emi.web ? _esc(emi.web) : 'Factura') + '</span></div></div>' +
        '<div class="doc-meta">' +
          '<div class="tipo">' + tituloDoc + '</div>' +
          '<div class="numero">' + _esc(f.numero) + '</div>' +
          '<div class="fecha">Fecha: ' + _esc(fechaTxt) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bloques">' +
        '<div class="bloque"><h3>Emisor</h3><div class="nom">' + _esc(emiNombre) + '</div>' + emiInfoHtml + '</div>' +
        '<div class="bloque"><h3>' + (esSimplificada ? 'Cliente' : 'Facturar a') + '</h3><div class="nom">' + _esc(cliNombre) + '</div>' + cliInfoHtml + '</div>' +
      '</div>' +
      '<table><thead><tr>' +
        '<th>Descripci\u00f3n</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th>' +
      '</tr></thead><tbody>' + filasHtml + '</tbody></table>' +
      '<div class="totales"><div class="totales-box">' +
        '<div class="fila"><span>Base imponible</span><span>' + _fmtImporte(f.base_imponible) + '</span></div>' +
        '<div class="fila"><span>IVA (' + (parseFloat(f.iva_pct) || 0) + '%)</span><span>' + _fmtImporte(f.iva_importe) + '</span></div>' +
        '<div class="fila total"><span>TOTAL</span><span>' + _fmtImporte(f.total) + '</span></div>' +
      '</div></div>' +
      '<div class="pie">' +
        (f.metodo_pago ? '<div class="pago">Forma de pago: ' + _esc(f.metodo_pago) + '</div>' : '') +
        '<div>Documento generado por TekPair. Conserve esta factura como justificante.</div>' +
      '</div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
      '</body></html>';

    var w = window.open('', '_blank');
    if (!w) { _toast('Activa las ventanas emergentes para ver el PDF', 'err'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

'''

fact = fact.replace(ANCHOR_CONSOLE, FUNCION_PDF + ANCHOR_CONSOLE, 1)
print("  ✓ función generarFacturaPDF añadida")
print("  ✓ helpers _fmtImporte y _esc añadidos")

with open(FACT, "w", encoding="utf-8") as f:
    f.write(fact)

# ─── Verificación ───
print("\n═══ VERIFICACIÓN ═══")

with open(FACT, "r", encoding="utf-8") as f:
    final = f.read()

checks = [
    ("window.generarFacturaPDF = function", "función PDF definida"),
    ("window.generarFacturaPDF(f);", "llamada automática al emitir"),
    ("function _fmtImporte", "helper formato importe"),
    ("FACTURA SIMPLIFICADA", "soporte tipo simplificada"),
]
ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        ok = False

if ok:
    print("\n🎉 PATCH FASE B (PDF) APLICADO")
    print("\n  node -c factura.js && echo OK")
    print("\n  git add factura.js")
    print("  git commit -m 'feat(facturas): generar PDF al emitir factura'")
    print("  git push origin main   (o rama de prueba)")
    print("\nAl emitir una factura se abrira una ventana con el PDF listo")
    print("para imprimir o guardar.")
else:
    print("\n⚠️  Falló. git checkout factura.js")
    sys.exit(1)
