#!/usr/bin/env python3
"""
PATCH: Stock — color visible + pestaña Accesorios
===================================================
1. renderStock: el color se muestra SIEMPRE (no solo cuando hay capacidad)
   -> así se distinguen "Pantalla iPhone 8 · Blanco" de "· Negro"
2. Búsqueda de stock incluye el color
3. Nueva categoría "Accesorio" + su pestaña

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

# 1. Línea del producto en renderStock (color atado a capacidad)
A_PRODUCTO = "      (s.capacidad ? '<br><span style=\"font-size:9px;color:var(--muted)\">' + s.capacidad + (s.color ? ' \u00b7 ' + s.color : '') + '</span>' : '') +"

# 2. Filtro de búsqueda de renderStock
A_BUSQUEDA = "    if (q && !(s.marca + ' ' + s.modelo + ' ' + (s.imei || '') + ' ' + (s.categoria || '')).toLowerCase().includes(q)) return false;"

# 3. Pestaña Repuestos (para añadir Accesorios después)
A_TAB_REP = '    <button class="stock-tab-btn" data-cat="Repuesto">Repuestos</button>'

# 4. Select de categoría
A_SELECT = "<option>Repuesto</option><option>Otro</option>"

ok = True
ok &= check(A_PRODUCTO, "línea producto renderStock")
ok &= check(A_BUSQUEDA, "filtro búsqueda")
ok &= check(A_TAB_REP, "pestaña Repuestos")
ok &= check(A_SELECT, "select categoría")

if 'data-cat="Accesorio"' in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── 1: color siempre visible ───
NUEVO_PRODUCTO = "      ((s.capacidad || s.color) ? '<br><span style=\"font-size:9px;color:var(--muted)\">' + [s.capacidad, s.color].filter(Boolean).join(' \u00b7 ') + '</span>' : '') +"
dash = dash.replace(A_PRODUCTO, NUEVO_PRODUCTO, 1)
print("  ✓ color visible siempre en la lista")

# ─── 2: búsqueda incluye color ───
NUEVA_BUSQUEDA = "    if (q && !(s.marca + ' ' + s.modelo + ' ' + (s.imei || '') + ' ' + (s.color || '') + ' ' + (s.categoria || '')).toLowerCase().includes(q)) return false;"
dash = dash.replace(A_BUSQUEDA, NUEVA_BUSQUEDA, 1)
print("  ✓ búsqueda incluye el color")

# ─── 3: pestaña Accesorios ───
dash = dash.replace(
    A_TAB_REP,
    A_TAB_REP + '\n    <button class="stock-tab-btn" data-cat="Accesorio">Accesorios</button>',
    1
)
print("  ✓ pestaña Accesorios")

# ─── 4: opción Accesorio en el select ───
dash = dash.replace(
    A_SELECT,
    "<option>Repuesto</option><option>Accesorio</option><option>Otro</option>",
    1
)
print("  ✓ categoría Accesorio en el modal")

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
    ("[s.capacidad, s.color].filter(Boolean)", "color visible"),
    ("(s.color || '') + ' ' + (s.categoria", "búsqueda con color"),
    ('data-cat="Accesorio"', "pestaña Accesorios"),
    ("<option>Accesorio</option>", "categoría Accesorio"),
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
    print("  git commit -m 'feat(stock): color visible + categoria Accesorios'")
    print("  git push origin main   (o rama de prueba)")
    print()
    print("Ahora la lista de stock muestra el color de cada producto,")
    print("y hay una pestaña/categoria de Accesorios.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
