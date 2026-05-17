#!/usr/bin/env python3
"""
PATCH: Componentes en Nueva Reparación — color + precio editable
==================================================================
1. busComp: el buscador de componentes muestra el color
2. addPart: el nombre del componente añadido incluye el color
3. renderParts: el precio del componente es editable (input)

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

# Anchors ASCII-seguros
A_ADDPART = "  if (!ya) SEL.selParts.push({id: s.id, nombre: s.marca + ' ' + s.modelo, precio: s.precioV});"

A_SPAN_PRECIO = "      '<span style=\"color:var(--green)\">' + cur(p.precio) + '</span>' +"

A_LISTENER_DEL = """  document.querySelectorAll('.part-del').forEach(function(btn) {
    btn.addEventListener('click', function() {
      SEL.selParts.splice(parseInt(this.dataset.idx), 1);
      renderParts(); calcR();
    });
  });"""

ok = True
for anchor, nombre in [
    (A_ADDPART, "addPart push"),
    (A_SPAN_PRECIO, "span precio renderParts"),
    (A_LISTENER_DEL, "listener part-del"),
]:
    n = dash.count(anchor)
    if n == 1:
        print(f"  ✓ '{nombre}' único")
    else:
        print(f"  ❌ '{nombre}': {n} (esperado 1)")
        ok = False

# Línea del dropdown de busComp (tiene el carácter ·, la busco por contenido)
lineas = dash.split("\n")
idx_drop = -1
for i, ln in enumerate(lineas):
    if "s.modelo + ' (' + s.marca + ')" in ln and "Stock: ' + s.unidades" in ln:
        if idx_drop != -1:
            print("  ❌ línea dropdown busComp: más de una coincidencia")
            ok = False
        idx_drop = i

if idx_drop == -1:
    print("  ❌ línea dropdown de busComp no encontrada")
    ok = False
else:
    print(f"  ✓ línea dropdown busComp localizada (línea {idx_drop + 1})")

if "part-precio" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── 1: busComp dropdown muestra color (reemplazo de línea por índice) ───
indent = lineas[idx_drop][:len(lineas[idx_drop]) - len(lineas[idx_drop].lstrip())]
NUEVA_DROP = indent + "s.modelo + ' (' + s.marca + ')' + (s.color ? ' \u00b7 ' + s.color : '') + ' \u00b7 Stock: ' + s.unidades + (ya ? ' \u2713' : '') +"
lineas[idx_drop] = NUEVA_DROP
dash = "\n".join(lineas)
print("  ✓ buscador de componentes muestra el color")

# ─── 2: addPart — nombre incluye color ───
dash = dash.replace(
    A_ADDPART,
    "  if (!ya) SEL.selParts.push({id: s.id, nombre: s.marca + ' ' + s.modelo + (s.color ? ' (' + s.color + ')' : ''), precio: s.precioV});",
    1
)
print("  ✓ nombre del componente incluye el color")

# ─── 3: renderParts — precio editable (input) ───
NUEVO_INPUT = "      '<input type=\"number\" step=\"0.01\" min=\"0\" data-idx=\"' + i + '\" class=\"part-precio\" value=\"' + (p.precio || 0) + '\" style=\"width:74px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;text-align:right;color:var(--green);font-weight:700\">' +"
dash = dash.replace(A_SPAN_PRECIO, NUEVO_INPUT, 1)
print("  ✓ precio del componente editable")

# ─── 4: listener del input de precio ───
dash = dash.replace(
    A_LISTENER_DEL,
    A_LISTENER_DEL + """
  document.querySelectorAll('.part-precio').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var idx = parseInt(this.dataset.idx);
      if (SEL.selParts[idx]) { SEL.selParts[idx].precio = parseFloat(this.value) || 0; calcR(); }
    });
  });""",
    1
)
print("  ✓ listener para editar el precio")

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
    ("(s.color ? ' \u00b7 ' + s.color : '') + ' \u00b7 Stock:", "color en buscador"),
    ("s.modelo + (s.color ? ' (' + s.color", "color en nombre"),
    ('class="part-precio"', "input de precio"),
    (".part-precio').forEach", "listener de precio"),
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
    print("  git commit -m 'feat(reparacion): color y precio editable en componentes'")
    print("  git push origin main")
    print()
    print("En Nueva Reparacion, el buscador de componentes muestra el color")
    print("y el precio de cada componente se puede modificar.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
