#!/usr/bin/env python3
"""
PATCH: Facturas y Citas en el menú móvil
==========================================
La pantalla "Más opciones" del móvil no tenía acceso a Facturas
(creada hoy) ni a Citas. Este patch las añade como tarjetas.

Solo toca dashboard.html.
"""

import sys
import os

DASH = "dashboard.html"

if not os.path.exists(DASH):
    print(f"❌ {DASH} no encontrado")
    sys.exit(1)

dash = open(DASH, "r", encoding="utf-8").read()

print("═══ VERIFICACIÓN PREVIA ═══")

# Anchor SIN emoji: el inicio del botón Clientes en pMas
A_CLIENTES = '    <button class="qbtn" style="background:#0F172A" onclick="navTo(\'pClis\')">'

n = dash.count(A_CLIENTES)
print(f"  botón Clientes (pMas): {n} (esperado 1)")

if n != 1:
    print("  ❌ ABORTO: anchor no único")
    sys.exit(1)

if "navTo('pFacturas')" in dash and "qbtn" in dash[dash.index("navTo('pFacturas')")-200:dash.index("navTo('pFacturas')")]:
    # comprobación aproximada de si ya está en el grid
    pass

if ">Facturas</button>" in dash:
    print("  ⚠️  Facturas ya está en el menú móvil. Sin cambios.")
    sys.exit(0)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCH ═══")

NUEVOS_BOTONES = (
    '    <button class="qbtn" style="background:#10B981" onclick="navTo(\'pFacturas\')">'
    '<span class="qicon">\U0001f9fe</span>Facturas</button>\n'
    '    <button class="qbtn" style="background:#0EA5E9" onclick="navTo(\'pCitas\')">'
    '<span class="qicon">\U0001f4c5</span>Citas</button>\n'
)

dash = dash.replace(A_CLIENTES, NUEVOS_BOTONES + A_CLIENTES, 1)
print("  ✓ tarjeta Facturas añadida")
print("  ✓ tarjeta Citas añadida")

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
    ("navTo('pFacturas')", "navega a Facturas"),
    (">Facturas</button>", "tarjeta Facturas"),
    (">Citas</button>", "tarjeta Citas"),
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
    print("  git commit -m 'feat(movil): Facturas y Citas en el menu Mas opciones'")
    print("  git push origin main")
    print()
    print("En el movil, 'Mas opciones' ahora tiene Facturas y Citas.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
