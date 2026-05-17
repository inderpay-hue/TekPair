#!/usr/bin/env python3
"""
PATCH: Popup de Novedades
===========================
Muestra un popup con las novedades de la versión al entrar a la app.
Solo se muestra una vez por versión (usa localStorage).

Reutilizable: en futuras actualizaciones solo cambia NOVEDADES_VERSION
y el contenido en NOVEDADES_ITEMS.

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

A_VISIBILITY = "  window.addEventListener('visibilitychange', function(){ if (!document.hidden) syncCompleto(true); });"
A_INITDESKTOP = "function initDesktop() {"

ok = True
for anchor, nombre in [
    (A_VISIBILITY, "listener visibilitychange"),
    (A_INITDESKTOP, "function initDesktop"),
]:
    n = dash.count(anchor)
    if n == 1:
        print(f"  ✓ '{nombre}' único")
    else:
        print(f"  ❌ '{nombre}': {n} (esperado 1)")
        ok = False

if "mostrarNovedades" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── 1: llamada en el arranque ───
dash = dash.replace(
    A_VISIBILITY,
    A_VISIBILITY + "\n  setTimeout(mostrarNovedades, 800);",
    1
)
print("  ✓ mostrarNovedades se llama al arrancar")

# ─── 2: funciones del popup ───
FUNCIONES = r'''// ────────── Popup de Novedades ──────────
// Para una nueva actualización: cambia NOVEDADES_VERSION y NOVEDADES_ITEMS.
var NOVEDADES_VERSION = '2026-05-17';
var NOVEDADES_ITEMS = [
  { emoji: '\ud83e\uddfe', titulo: 'Facturaci\u00f3n completa', texto: 'Emite facturas en PDF desde el TPV, ventas y reparaciones. Nueva secci\u00f3n Facturas con buscador y filtros.' },
  { emoji: '\ud83d\udcb0', titulo: 'Abonos autom\u00e1ticos', texto: 'Al devolver una reparaci\u00f3n o reembolsar una venta, TekPair genera la factura rectificativa por ti.' },
  { emoji: '\ud83d\udce6', titulo: 'Stock por color', texto: 'Distingue productos del mismo modelo en distintos colores. Nueva categor\u00eda Accesorios.' },
  { emoji: '\ud83d\udd27', titulo: 'Componentes mejorados', texto: 'Al a\u00f1adir piezas a una reparaci\u00f3n ves su color y puedes ajustar el precio.' }
];

function mostrarNovedades() {
  try {
    if (localStorage.getItem('tekpair_novedades') === NOVEDADES_VERSION) return;
  } catch (e) { return; }

  var items = NOVEDADES_ITEMS.map(function(n) {
    return '<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:24px;flex-shrink:0">' + n.emoji + '</div>' +
      '<div><div style="font-weight:700;font-size:14px;margin-bottom:2px">' + n.titulo + '</div>' +
      '<div style="font-size:12px;color:var(--muted);line-height:1.5">' + n.texto + '</div></div>' +
      '</div>';
  }).join('');

  var wrap = document.createElement('div');
  wrap.className = 'modal-bg open';
  wrap.id = 'mNovedades';
  wrap.innerHTML =
    '<div class="modal" style="max-width:460px">' +
      '<div style="text-align:center;margin-bottom:6px">' +
        '<div style="font-size:32px">\u2728</div>' +
        '<div class="modal-title" style="margin:4px 0 2px">\u00a1Novedades en TekPair!</div>' +
        '<div style="font-size:12px;color:var(--muted)">Esto es lo nuevo que ya tienes disponible</div>' +
      '</div>' +
      '<div style="margin:10px 0">' + items + '</div>' +
      '<div style="font-size:11px;color:var(--muted);text-align:center;margin:8px 0 4px">' +
        '\u00bfVes alg\u00fan fallo o tienes una sugerencia? Escr\u00edbenos desde la secci\u00f3n de Ayuda.' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-primary" style="width:100%;background:#10B981" onclick="cerrarNovedades()">Entendido</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);
}

function cerrarNovedades() {
  try { localStorage.setItem('tekpair_novedades', NOVEDADES_VERSION); } catch (e) {}
  var m = document.getElementById('mNovedades');
  if (m) m.parentNode.removeChild(m);
}

'''

dash = dash.replace(A_INITDESKTOP, FUNCIONES + A_INITDESKTOP, 1)
print("  ✓ funciones del popup añadidas")

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
    ("function mostrarNovedades()", "función mostrarNovedades"),
    ("function cerrarNovedades()", "función cerrarNovedades"),
    ("setTimeout(mostrarNovedades, 800)", "llamada al arrancar"),
    ("NOVEDADES_VERSION = '2026-05-17'", "versión definida"),
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
    print("  git commit -m 'feat: popup de novedades al entrar'")
    print("  git push origin main")
    print()
    print("Al entrar a la app aparece el popup de novedades (una vez).")
    print("Para futuras actualizaciones: cambia NOVEDADES_VERSION y NOVEDADES_ITEMS.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
