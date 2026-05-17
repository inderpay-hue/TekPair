#!/usr/bin/env python3
"""
ARREGLO: renderVentas roto
============================
El patch v2 insertó 'var btnFact = ...' EN MEDIO de la expresión
'html += ... +', lo que rompe el JavaScript del dashboard.

Este fix:
1. Elimina la declaración mal ubicada (en medio del html +=)
2. La reinserta correctamente ANTES del 'html +=' (junto a btnR/btnF/btnImpr)

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

# La línea mal ubicada (la que YO inserté mal con el v2)
LINEA_MALA = "\n    var btnFact = !v.reembolsado ? '<button data-vid=\"' + v.id + '\" class=\"btn-fact-v\" style=\"background:#10B981;color:white;border:none;padding:3px 8px;border-radius:5px;font-size:11px;cursor:pointer\" title=\"Generar factura\">\U0001f4c4</button>' : '';"

# Punto correcto donde debe ir: antes del html += '<tr style=...
ANCHOR_HTML = "    html += '<tr style=\"' + (v.reembolsado ? 'opacity:.55' : '') + '\">' +"

n_mala = dash.count(LINEA_MALA)
n_anchor = dash.count(ANCHOR_HTML)

print(f"  línea mal ubicada: {n_mala} (esperado 1)")
print(f"  anchor html += : {n_anchor} (esperado 1)")

if n_mala != 1:
    print("  ❌ No se encontró la línea mal ubicada exacta.")
    print("     Puede que el emoji difiera. Abortando para revisión manual.")
    sys.exit(1)

if n_anchor != 1:
    print("  ❌ No se encontró el anchor html +=.")
    sys.exit(1)

# Comprobar que efectivamente está rota (la línea mala seguida de '<td')
if LINEA_MALA + "\n      '<td style=\"display:flex;gap:3px\">'" not in dash:
    print("  ⚠️  La estructura no es la esperada. Abortando.")
    sys.exit(1)

print("✓ Bug localizado\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ ARREGLO ═══")

# ─── 1: eliminar la línea mal ubicada ───
dash = dash.replace(LINEA_MALA, "", 1)
print("  ✓ declaración mal ubicada eliminada")

# ─── 2: reinsertar btnFact en el sitio correcto (antes del html +=) ───
DECLARACION = "    var btnFact = !v.reembolsado ? '<button data-vid=\"' + v.id + '\" class=\"btn-fact-v\" style=\"background:#10B981;color:white;border:none;padding:3px 8px;border-radius:5px;font-size:11px;cursor:pointer\" title=\"Generar factura\">\U0001f4c4</button>' : '';\n"

dash = dash.replace(ANCHOR_HTML, DECLARACION + ANCHOR_HTML, 1)
print("  ✓ btnFact declarado correctamente antes del html +=")

open(DASH, "w", encoding="utf-8").write(dash)


# ─── Verificación ───
print("\n═══ VERIFICACIÓN ═══")

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

# La declaración debe estar JUSTO antes de html += (no en medio)
if "btnFact = !v.reembolsado" in final:
    pos_decl = final.index("var btnFact = !v.reembolsado")
    pos_html = final.index("html += '<tr style=")
    # La declaración debe estar antes y cerca del html +=
    if 0 < pos_html - pos_decl < 400:
        print("  ✓ btnFact declarado antes del html += (correcto)")
    else:
        print("  ✗ btnFact en posición incorrecta")
        todo_ok = False
else:
    print("  ✗ no se encuentra la declaración")
    todo_ok = False

# No debe quedar 'var btnFact' después de un '+ ' (en medio de expresión)
if "+ '</td>' +\n    var btnFact" in final or "cur(v.total) + '</td>' +\n    var" in final:
    print("  ✗ AÚN hay una declaración en medio de la expresión")
    todo_ok = False
else:
    print("  ✓ no hay declaraciones en medio del html +=")

# El botón sigue en la fila
if "btnR + btnF + btnFact + btnImpr" in final:
    print("  ✓ btnFact sigue en la fila de la tabla")
else:
    print("  ✗ btnFact no está en la fila")
    todo_ok = False

print()
if todo_ok:
    print("🎉 ARREGLO APLICADO Y VERIFICADO")
    print()
    print("  git add dashboard.html")
    print("  git commit -m 'fix(facturas): corregir renderVentas roto'")
    print("  git push origin test-fase-d")
    print()
    print("El dashboard volvera a cargar normalmente, con el boton de")
    print("factura en cada venta.")
else:
    print("⚠️  El arreglo no quedó bien. git checkout dashboard.html")
    print("    y avísame para revisarlo manualmente.")
    sys.exit(1)
