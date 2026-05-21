#!/usr/bin/env python3
"""
PATCH: Desactivar el banner de novedades.

Solo añade un 'return;' al inicio del setTimeout para que la función
no se ejecute. Todo el código se queda intacto para futuras reactivaciones.

Para REACTIVAR en el futuro:
  Eliminar el 'return; // DESACTIVADO' del setTimeout
"""

import sys, os

DASH = "dashboard.html"
dash = open(DASH, "r", encoding="utf-8").read()

print("═══ Desactivar banner novedades ═══\n")

# Anchor: el inicio del setTimeout del banner
OLD = '''// ═══ BANNER NOVEDADES MAYO 2026 ═══
setTimeout(function() {
  try {
    if (localStorage.getItem('tk_novedades_15may2026')) return;'''

NEW = '''// ═══ BANNER NOVEDADES MAYO 2026 (DESACTIVADO) ═══
setTimeout(function() {
  return; // DESACTIVADO - quita esta linea para reactivar
  try {
    if (localStorage.getItem('tk_novedades_15may2026')) return;'''

n = dash.count(OLD)
if n == 0:
    if "return; // DESACTIVADO" in dash:
        print("  ⚠️  Banner ya está desactivado. Sin cambios.")
        sys.exit(0)
    print(f"❌ Anchor no encontrado")
    sys.exit(1)

if n > 1:
    print(f"❌ Anchor aparece {n} veces (esperado 1)")
    sys.exit(1)

dash = dash.replace(OLD, NEW, 1)
open(DASH, "w", encoding="utf-8").write(dash)

print("  ✓ Banner desactivado con 'return;' al inicio del setTimeout")
print("  ✓ Todo el código se queda intacto")
print()
print("🎉 LISTO")
print()
print("  git add dashboard.html")
print("  git commit -m 'chore(novedades): desactivar banner (en pausa)'")
print("  git push origin main")
print()
print("Para REACTIVAR en el futuro:")
print("  - Editar la línea 'return; // DESACTIVADO' y quitarla")
print("  - Cambiar la clave 'tk_novedades_15may2026' por una nueva fecha")
print("  - Actualizar el contenido del modal")
