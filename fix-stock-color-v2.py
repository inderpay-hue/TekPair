#!/usr/bin/env python3
"""
PATCH v2: Stock — color visible + pestaña Accesorios
======================================================
(v2: localiza la línea del producto por contenido ASCII, sin depender
 del carácter '·')

1. renderStock: el color se muestra SIEMPRE (no solo con capacidad)
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

print("═══ VERIFICACIÓN PREVIA ═══")

# Anchors ASCII-seguros (sin el carácter ·)
A_BUSQUEDA = "    if (q && !(s.marca + ' ' + s.modelo + ' ' + (s.imei || '') + ' ' + (s.categoria || '')).toLowerCase().includes(q)) return false;"
A_TAB_REP = '    <button class="stock-tab-btn" data-cat="Repuesto">Repuestos</button>'
A_SELECT = "<option>Repuesto</option><option>Otro</option>"

ok = True
for anchor, nombre in [
    (A_BUSQUEDA, "filtro búsqueda"),
    (A_TAB_REP, "pestaña Repuestos"),
    (A_SELECT, "select categoría"),
]:
    n = dash.count(anchor)
    if n == 1:
        print(f"  ✓ '{nombre}' único")
    else:
        print(f"  ❌ '{nombre}': {n} (esperado 1)")
        ok = False

# Localizar la línea del producto por contenido (sin el ·)
lineas = dash.split("\n")
idx_producto = -1
for i, ln in enumerate(lineas):
    if "s.capacidad ?" in ln and "s.color" in ln and "<br><span" in ln:
        if idx_producto != -1:
            print("  ❌ línea del producto: más de una coincidencia")
            ok = False
        idx_producto = i

if idx_producto == -1:
    print("  ❌ línea del producto (renderStock) no encontrada")
    ok = False
else:
    print(f"  ✓ línea del producto localizada (línea {idx_producto + 1})")

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

# ─── 1: color siempre visible (reemplazo de línea por índice) ───
indent = lineas[idx_producto][:len(lineas[idx_producto]) - len(lineas[idx_producto].lstrip())]
NUEVA_LINEA = indent + "((s.capacidad || s.color) ? '<br><span style=\"font-size:9px;color:var(--muted)\">' + [s.capacidad, s.color].filter(Boolean).join(' \u00b7 ') + '</span>' : '') +"
linea_vieja = lineas[idx_producto]
lineas[idx_producto] = NUEVA_LINEA
dash = "\n".join(lineas)
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
    print("  git push origin main")
    print()
    print("La lista de stock muestra el color de cada producto,")
    print("y hay una pestaña/categoria de Accesorios.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
