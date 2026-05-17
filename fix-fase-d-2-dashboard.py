#!/usr/bin/env python3
"""
PATCH FASE D-2: dashboard.html — abonos automáticos + listado
================================================================
1. cambiarEstado: al marcar Devuelto/Rechazado/Sin Solución, si la
   reparación tiene factura → ofrece generar el abono.
2. _ofrecerAbonoFactura(r): busca la factura, comprueba y lanza el abono.
3. filtrarFacturas: badges "Abono" (rojo) y "Abonada" en la tabla.

Requiere el PATCH FASE D-1 ya aplicado en factura.js.
"""

import sys
import os

DASH = "dashboard.html"

if not os.path.exists(DASH):
    print(f"❌ {DASH} no encontrado")
    sys.exit(1)

dash = open(DASH, "r", encoding="utf-8").read()


def check(anchor, nombre):
    n = dash.count(anchor)
    if n != 1:
        print(f"  ❌ ABORTO: '{nombre}' aparece {n} veces (esperado 1)")
        return False
    print(f"  ✓ '{nombre}' único")
    return True


print("═══ VERIFICACIÓN PREVIA ═══")

A_HOOK = """  guardarDatos();
  if (SB_KEY && TIENDA_ID) sbPatch('reparaciones', 'id=eq.' + id, {estado: estado});"""

A_FIN_FACT = "// ═══ /FACTURAS ═══"

A_FOREACH = """  lista.forEach(function(f, idx) {
    var fechaTxt = f.fecha_emision || '';
    try {
      var d = new Date(f.fecha_emision);
      if (!isNaN(d)) fechaTxt = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {}
    var tipoBadge = f.tipo === 'simplificada'
      ? '<span class="badge bo">Simplificada</span>'
      : '<span class="badge bp">Completa</span>';
    var origenTxt = f.origen_tipo === 'reparacion' ? '🔧 Reparación' : (f.origen_tipo === 'venta' ? '🛒 Venta' : '—');
    html += '<tr>' +
      '<td><strong>' + (f.numero || '—') + '</strong></td>' +
      '<td style="font-size:11px">' + fechaTxt + '</td>' +
      '<td>' + _factClienteNom(f) + '</td>' +
      '<td>' + tipoBadge + '</td>' +
      '<td style="font-size:11px">' + origenTxt + '</td>' +
      '<td style="font-size:11px">' + cur(f.base_imponible) + '</td>' +
      '<td style="font-size:11px">' + cur(f.iva_importe) + ' <span style="color:var(--muted)">(' + (parseFloat(f.iva_pct) || 0) + '%)</span></td>' +
      '<td style="font-weight:700;color:var(--green)">' + cur(f.total) + '</td>' +
      '<td><button data-fidx="' + idx + '" class="btn-pdf-f" style="background:#10B981;color:white;border:none;padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer" title="Ver / descargar PDF">📄 PDF</button></td>' +
      '</tr>';
  });"""

ok = True
ok &= check(A_HOOK, "hook cambiarEstado")
ok &= check(A_FIN_FACT, "fin sección FACTURAS")
ok &= check(A_FOREACH, "forEach filtrarFacturas")

if "_ofrecerAbonoFactura" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── A: hook en cambiarEstado ───
dash = dash.replace(
    A_HOOK,
    A_HOOK + "\n  if (entrandoCancelacion) { _ofrecerAbonoFactura(r); }",
    1
)
print("  ✓ hook de abono en cambiarEstado")

# ─── B: función _ofrecerAbonoFactura ───
FUNC = r'''// ─── Abono automático al cancelar una reparación facturada ───
function _ofrecerAbonoFactura(r) {
  if (!SB_KEY || !TIENDA_ID || !r || !r.id) return;
  sbGet('facturas', 'tienda_id=eq.' + TIENDA_ID + '&origen_tipo=eq.reparacion&origen_id=eq.' + r.id)
    .then(function(facturas) {
      if (!Array.isArray(facturas) || !facturas.length) return;
      // La factura original es la que NO rectifica a otra
      var original = facturas.filter(function(f) { return !f.rectifica_a; })[0];
      if (!original) return;
      // ¿Ya tiene un abono?
      var yaAbonada = facturas.some(function(f) { return f.rectifica_a === original.id; });
      if (yaAbonada) {
        toast('La factura ' + original.numero + ' ya tiene abono', 'ok');
        return;
      }
      if (confirm('Esta reparación tiene la factura ' + original.numero +
                  '.\n\n¿Generar factura de abono (rectificativa) por la devolución?')) {
        if (typeof window.emitirAbonoFactura === 'function') {
          window.emitirAbonoFactura(original);
        } else {
          toast('Módulo de factura no disponible', 'err');
        }
      }
    })
    .catch(function(e) { console.warn('[abono] error:', e); });
}
// ═══ /FACTURAS ═══'''

dash = dash.replace(A_FIN_FACT, FUNC, 1)
print("  ✓ función _ofrecerAbonoFactura")

# ─── C: forEach con badges ───
NUEVO_FOREACH = r'''  lista.forEach(function(f, idx) {
    var fechaTxt = f.fecha_emision || '';
    try {
      var d = new Date(f.fecha_emision);
      if (!isNaN(d)) fechaTxt = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {}
    var tipoBadge = f.tipo === 'simplificada'
      ? '<span class="badge bo">Simplificada</span>'
      : '<span class="badge bp">Completa</span>';
    var origenTxt = f.origen_tipo === 'reparacion' ? '🔧 Reparación' : (f.origen_tipo === 'venta' ? '🛒 Venta' : '—');
    var esAbono = !!f.rectifica_a;
    var abonada = _FACTURAS.some(function(x) { return x.rectifica_a === f.id; });
    var numBadge = '';
    if (esAbono) numBadge = ' <span class="badge" style="background:#fee2e2;color:#dc2626">Abono</span>';
    else if (abonada) numBadge = ' <span class="badge" style="background:#fef3c7;color:#b45309">Abonada</span>';
    var colorTotal = (parseFloat(f.total) || 0) < 0 ? '#dc2626' : 'var(--green)';
    html += '<tr>' +
      '<td><strong>' + (f.numero || '—') + '</strong>' + numBadge + '</td>' +
      '<td style="font-size:11px">' + fechaTxt + '</td>' +
      '<td>' + _factClienteNom(f) + '</td>' +
      '<td>' + tipoBadge + '</td>' +
      '<td style="font-size:11px">' + origenTxt + '</td>' +
      '<td style="font-size:11px">' + cur(f.base_imponible) + '</td>' +
      '<td style="font-size:11px">' + cur(f.iva_importe) + ' <span style="color:var(--muted)">(' + (parseFloat(f.iva_pct) || 0) + '%)</span></td>' +
      '<td style="font-weight:700;color:' + colorTotal + '">' + cur(f.total) + '</td>' +
      '<td><button data-fidx="' + idx + '" class="btn-pdf-f" style="background:#10B981;color:white;border:none;padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer" title="Ver / descargar PDF">📄 PDF</button></td>' +
      '</tr>';
  });'''

dash = dash.replace(A_FOREACH, NUEVO_FOREACH, 1)
print("  ✓ badges Abono/Abonada en el listado")

open(DASH, "w", encoding="utf-8").write(dash)


# ─── Verificación ───
print("\n═══ VERIFICACIÓN DE INTEGRIDAD ═══")

final = open(DASH, "r", encoding="utf-8").read()

todo_ok = True
for nombre, antes, despues in [
    ("</body>", body_antes, final.count("</body>")),
    ("</html>", html_antes, final.count("</html>")),
]:
    est = "✓" if antes == despues else "✗ ROTO"
    if antes != despues:
        todo_ok = False
    print(f"  {nombre}: {antes} → {despues} {est}")

checks = [
    ("if (entrandoCancelacion) { _ofrecerAbonoFactura(r); }", "hook en cambiarEstado"),
    ("function _ofrecerAbonoFactura(r)", "función _ofrecerAbonoFactura"),
    ("var esAbono = !!f.rectifica_a", "detección abono en listado"),
    (">Abono</span>", "badge Abono"),
    (">Abonada</span>", "badge Abonada"),
]
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH FASE D-2 APLICADO Y VERIFICADO")
    print()
    print("  node -c factura.js && echo OK")
    print()
    print("  git checkout -b test-fase-d")
    print("  git add dashboard.html factura.js")
    print("  git commit -m 'feat(facturas): facturas rectificativas (abonos)'")
    print("  git push origin test-fase-d")
    print()
    print("PRUEBA: marca una reparación con factura como 'Devuelto'")
    print("  -> pregunta si generar abono -> genera R-XXXX en negativo + PDF")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
