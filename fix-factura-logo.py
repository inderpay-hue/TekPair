#!/usr/bin/env python3
"""
PATCH: Logo de la tienda en la factura PDF
============================================
TekPair guarda el logo en TIENDA.logo_url. Este patch lo añade al PDF.

1. _snapshotEmisor: incluye el logo en el snapshot de futuras facturas
2. generarFacturaPDF: muestra el logo en la cabecera (con fallback a
   TIENDA.logo_url para que funcione también en facturas ya emitidas)

Solo toca factura.js.
"""

import sys
import os

FACT = "factura.js"

if not os.path.exists(FACT):
    print(f"❌ {FACT} no encontrado")
    sys.exit(1)

fact = open(FACT, "r", encoding="utf-8").read()


def check(anchor, nombre):
    n = fact.count(anchor)
    if n != 1:
        print(f"  ❌ ABORTO: '{nombre}' aparece {n} veces (esperado 1)")
        return False
    print(f"  ✓ '{nombre}' único")
    return True


print("═══ VERIFICACIÓN PREVIA ═══")

A_SNAPSHOT = """      web: t.web || ''
    };"""

A_EMINOMBRE = "    var emiNombre = emi.razon_social || emi.nombre || 'Mi Tienda';"

A_CABECERA = """        '<div><div class="marca">' + _esc(emiNombre) + '<span class="sub">' + (emi.web ? _esc(emi.web) : 'Factura') + '</span></div></div>' +"""

A_CSS_MARCA = "      '.marca { font-size:28px; font-weight:800; color:#10B981; letter-spacing:-0.5px; }' +"

ok = True
ok &= check(A_SNAPSHOT, "_snapshotEmisor cierre")
ok &= check(A_EMINOMBRE, "emiNombre")
ok &= check(A_CABECERA, "cabecera marca")
ok &= check(A_CSS_MARCA, "CSS .marca")

if "emiLogo" in fact:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")


# ═══ CAMBIO 1: _snapshotEmisor — añadir logo ═══
print("═══ PATCHES ═══")

fact = fact.replace(A_SNAPSHOT, """      web: t.web || '',
      logo: t.logo_url || ''
    };""", 1)
print("  ✓ _snapshotEmisor incluye logo")

# ═══ CAMBIO 2: variable emiLogo ═══
fact = fact.replace(
    A_EMINOMBRE,
    A_EMINOMBRE + "\n    var emiLogo = emi.logo || (window.TIENDA && window.TIENDA.logo_url) || '';",
    1
)
print("  ✓ variable emiLogo (con fallback a TIENDA.logo_url)")

# ═══ CAMBIO 3: cabecera con logo ═══
NUEVA_CABECERA = """        '<div class="marca-wrap">' +
          (emiLogo ? '<img class="logo-img" src="' + _esc(emiLogo) + '" alt="">' : '') +
          '<div class="marca">' + _esc(emiNombre) + '<span class="sub">' + (emi.web ? _esc(emi.web) : 'Factura') + '</span></div>' +
        '</div>' +"""

fact = fact.replace(A_CABECERA, NUEVA_CABECERA, 1)
print("  ✓ cabecera muestra el logo")

# ═══ CAMBIO 4: CSS ═══
NUEVO_CSS = """      '.marca-wrap { display:flex; align-items:center; gap:14px; }' +
      '.logo-img { max-height:60px; max-width:160px; object-fit:contain; }' +
      '.marca { font-size:28px; font-weight:800; color:#10B981; letter-spacing:-0.5px; }' +"""

fact = fact.replace(A_CSS_MARCA, NUEVO_CSS, 1)
print("  ✓ CSS de .marca-wrap y .logo-img")

open(FACT, "w", encoding="utf-8").write(fact)


# ═══ Verificación ═══
print("\n═══ VERIFICACIÓN ═══")

final = open(FACT, "r", encoding="utf-8").read()

checks = [
    ("logo: t.logo_url", "logo en _snapshotEmisor"),
    ("var emiLogo =", "variable emiLogo"),
    ('class="marca-wrap"', "cabecera con logo"),
    ("logo-img { max-height", "CSS logo"),
]
todo_ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH LOGO APLICADO Y VERIFICADO")
    print()
    print("  node -c factura.js && echo OK")
    print()
    print("  git add factura.js")
    print("  git commit -m 'feat(facturas): logo de la tienda en el PDF'")
    print("  git push origin test-factura-pdf")
    print()
    print("El PDF mostrara el logo de la tienda junto al nombre.")
    print("(Necesitas tener un logo subido en Ajustes > Logo de la tienda)")
else:
    print("⚠️  Algo falló. Revertir: git checkout factura.js")
    sys.exit(1)
