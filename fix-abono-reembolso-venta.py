#!/usr/bin/env python3
"""
PATCH: Abono automático al reembolsar una venta
=================================================
Generaliza _ofrecerAbonoFactura para que sirva tanto para reparaciones
(al marcar Devuelto) como para ventas (al reembolsar).

1. _ofrecerAbonoFactura(origenTipo, origenId)  — versión genérica
2. cambiarEstado: hook actualizado a la nueva firma
3. reembolsarVenta: nuevo hook para ofrecer el abono

Solo toca dashboard.html.
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

# Función actual (tal como la insertó el patch fase-d-2)
A_FUNC = """function _ofrecerAbonoFactura(r) {
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
                  '.\\n\\n¿Generar factura de abono (rectificativa) por la devolución?')) {
        if (typeof window.emitirAbonoFactura === 'function') {
          window.emitirAbonoFactura(original);
        } else {
          toast('Módulo de factura no disponible', 'err');
        }
      }
    })
    .catch(function(e) { console.warn('[abono] error:', e); });
}"""

A_HOOK_REP = "  if (entrandoCancelacion) { _ofrecerAbonoFactura(r); }"

A_REEMBOLSO = """  toast('Venta reembolsada', 'ok');
  renderVentas();
  renderDash();"""

ok = True
ok &= check(A_FUNC, "función _ofrecerAbonoFactura")
ok &= check(A_HOOK_REP, "hook reparaciones")
ok &= check(A_REEMBOLSO, "fin reembolsarVenta")

if "_ofrecerAbonoFactura('venta'" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── 1: función genérica ───
FUNC_NUEVA = """function _ofrecerAbonoFactura(origenTipo, origenId) {
  if (!SB_KEY || !TIENDA_ID || !origenId) return;
  sbGet('facturas', 'tienda_id=eq.' + TIENDA_ID + '&origen_tipo=eq.' + origenTipo + '&origen_id=eq.' + origenId)
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
      var nom = origenTipo === 'reparacion' ? 'reparación' : 'venta';
      if (confirm('Esta ' + nom + ' tiene la factura ' + original.numero +
                  '.\\n\\n¿Generar factura de abono (rectificativa) por la devolución?')) {
        if (typeof window.emitirAbonoFactura === 'function') {
          window.emitirAbonoFactura(original);
        } else {
          toast('Módulo de factura no disponible', 'err');
        }
      }
    })
    .catch(function(e) { console.warn('[abono] error:', e); });
}"""

dash = dash.replace(A_FUNC, FUNC_NUEVA, 1)
print("  ✓ _ofrecerAbonoFactura ahora es genérica (reparación + venta)")

# ─── 2: hook de reparaciones a la nueva firma ───
dash = dash.replace(
    A_HOOK_REP,
    "  if (entrandoCancelacion) { _ofrecerAbonoFactura('reparacion', r.id); }",
    1
)
print("  ✓ hook de reparaciones actualizado")

# ─── 3: hook en reembolsarVenta ───
dash = dash.replace(
    A_REEMBOLSO,
    A_REEMBOLSO + "\n  _ofrecerAbonoFactura('venta', id);",
    1
)
print("  ✓ hook de abono en reembolsarVenta")

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
    ("function _ofrecerAbonoFactura(origenTipo, origenId)", "función genérica"),
    ("_ofrecerAbonoFactura('reparacion', r.id)", "hook reparaciones"),
    ("_ofrecerAbonoFactura('venta', id)", "hook ventas"),
    ("origen_tipo=eq.' + origenTipo", "consulta dinámica por tipo"),
]
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH APLICADO Y VERIFICADO")
    print()
    print("  git add dashboard.html")
    print("  git commit -m 'feat(facturas): abono automatico al reembolsar venta'")
    print("  git push origin test-fase-d")
    print()
    print("Al reembolsar una venta con factura, se ofrece generar el abono.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
