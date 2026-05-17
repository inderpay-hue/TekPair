#!/usr/bin/env python3
"""
PATCH: cambiarPassword usa /api/login (no /api/cambiar-password)
==================================================================
El endpoint /api/cambiar-password se eliminó (superaba el límite de 12
funciones de Vercel Hobby). La lógica está ahora dentro de /api/login
como action 'cambiar-password'.

Este patch ajusta la función cambiarPassword() del frontend para que
llame a /api/login con action.

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

A_FETCH = """    var r = await fetch('/api/cambiar-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: U.email, password_actual: actual, password_nueva: nueva })
    });"""

n = dash.count(A_FETCH)
print(f"  llamada fetch a cambiar-password: {n} (esperado 1)")

if "/api/cambiar-password" not in dash:
    print("  ⚠️  Ya no hay referencia a /api/cambiar-password. Patch ya aplicado.")
    sys.exit(0)

if n != 1:
    print("  ❌ ABORTO: bloque no único o no encontrado")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCH ═══")

NUEVO_FETCH = """    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cambiar-password', email: U.email, password_actual: actual, password_nueva: nueva })
    });"""

dash = dash.replace(A_FETCH, NUEVO_FETCH, 1)
print("  ✓ cambiarPassword ahora llama a /api/login con action")

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

if "action: 'cambiar-password'" in final:
    print("  ✓ action añadida al body")
else:
    print("  ✗ action no encontrada")
    todo_ok = False

if "/api/cambiar-password" not in final:
    print("  ✓ ya no se llama al endpoint eliminado")
else:
    print("  ✗ todavía hay referencia a /api/cambiar-password")
    todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH APLICADO Y VERIFICADO")
    print()
    print("  git add dashboard.html api/login.js")
    print("  git commit -m 'fix(seguridad): cambio de contrasena dentro de login (limite Vercel)'")
    print("  git push origin main")
    print()
    print("Ahora son 12 funciones serverless. El deploy deberia funcionar.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
