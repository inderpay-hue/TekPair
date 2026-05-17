#!/usr/bin/env python3
"""
PATCH Fase 1: Cambiar contraseña desde Ajustes
================================================
Añade a la página de Ajustes una tarjeta "Seguridad" con el formulario
para cambiar la contraseña, y la función cambiarPassword().

Requiere que /api/cambiar-password.js esté subido (ya está).

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

A_BOTON_GUARDAR = '  <button class="btn-primary" onclick="guardarAjustes()">Guardar ajustes</button>'
A_CARGAR_AJUSTES = "function cargarAjustes() {"

ok = True
for anchor, nombre in [
    (A_BOTON_GUARDAR, "botón Guardar ajustes"),
    (A_CARGAR_AJUSTES, "function cargarAjustes"),
]:
    n = dash.count(anchor)
    if n == 1:
        print(f"  ✓ '{nombre}' único")
    else:
        print(f"  ❌ '{nombre}': {n} (esperado 1)")
        ok = False

if "cambiarPassword" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── 1: tarjeta Seguridad antes del botón Guardar ───
TARJETA = '''  <div class="card">
    <div class="card-title">\U0001f512 Seguridad</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Cambia tu contrase\u00f1a de acceso a TekPair.</div>
    <div class="fg"><label class="fl">Contrase\u00f1a actual</label><input class="fi" id="pwActual" type="password" placeholder="Tu contrase\u00f1a actual" autocomplete="current-password"></div>
    <div class="fg"><label class="fl">Nueva contrase\u00f1a</label><input class="fi" id="pwNueva" type="password" placeholder="M\u00ednimo 6 caracteres" autocomplete="new-password"></div>
    <div class="fg"><label class="fl">Repetir nueva contrase\u00f1a</label><input class="fi" id="pwNueva2" type="password" placeholder="Repite la nueva contrase\u00f1a" autocomplete="new-password"></div>
    <button type="button" class="btn-primary" style="background:var(--blue);width:100%" onclick="cambiarPassword()">Cambiar contrase\u00f1a</button>
  </div>
'''

dash = dash.replace(A_BOTON_GUARDAR, TARJETA + A_BOTON_GUARDAR, 1)
print("  ✓ tarjeta Seguridad añadida a Ajustes")

# ─── 2: función cambiarPassword ───
FUNCION = '''async function cambiarPassword() {
  var actual = (document.getElementById('pwActual').value || '');
  var nueva = (document.getElementById('pwNueva').value || '');
  var nueva2 = (document.getElementById('pwNueva2').value || '');
  if (!actual || !nueva || !nueva2) { toast('Rellena todos los campos', 'err'); return; }
  if (nueva.length < 6) { toast('La nueva contrase\\u00f1a debe tener al menos 6 caracteres', 'err'); return; }
  if (nueva !== nueva2) { toast('Las contrase\\u00f1as nuevas no coinciden', 'err'); return; }
  if (nueva === actual) { toast('La nueva contrase\\u00f1a no puede ser igual a la actual', 'err'); return; }
  if (typeof U === 'undefined' || !U || !U.email) { toast('No se pudo identificar tu usuario', 'err'); return; }
  try {
    var r = await fetch('/api/cambiar-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: U.email, password_actual: actual, password_nueva: nueva })
    });
    var data = await r.json();
    if (data && data.ok) {
      toast('Contrase\\u00f1a cambiada correctamente', 'ok');
      document.getElementById('pwActual').value = '';
      document.getElementById('pwNueva').value = '';
      document.getElementById('pwNueva2').value = '';
    } else {
      toast((data && data.error) || 'No se pudo cambiar la contrase\\u00f1a', 'err');
    }
  } catch (e) {
    toast('Error de conexi\\u00f3n', 'err');
  }
}

'''

dash = dash.replace(A_CARGAR_AJUSTES, FUNCION + A_CARGAR_AJUSTES, 1)
print("  ✓ función cambiarPassword añadida")

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
    ('id="pwActual"', "campo contraseña actual"),
    ('id="pwNueva2"', "campo repetir contraseña"),
    ("async function cambiarPassword()", "función cambiarPassword"),
    ("/api/cambiar-password", "llamada al endpoint"),
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
    print("  git add dashboard.html api/cambiar-password.js")
    print("  git commit -m 'feat(seguridad): cambiar contrasena desde Ajustes'")
    print("  git push origin main")
    print()
    print("En Ajustes aparece la tarjeta Seguridad para cambiar la contrasena.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
