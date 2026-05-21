#!/usr/bin/env python3
"""
PATCH: Modal de novedades que aparece UNA SOLA VEZ al iniciar sesion.
- Modal nuevo con las 4 novedades del mes
- Boton "Vale, ya lo vi" guarda en localStorage que ya lo viste
- Para futuras novedades: solo hay que cambiar NEWS_VERSION
  y el modal volvera a aparecer (porque el localStorage no coincide)

No anade funciones serverless.
"""

import sys
import os

DASH = "dashboard.html"

if not os.path.exists(DASH):
    print(f"❌ {DASH} no encontrado")
    sys.exit(1)

dash = open(DASH, "r", encoding="utf-8").read()

print("═══ VERIFICACIÓN PREVIA ═══\n")

if "id=\"mNovedades\"" in dash or "NEWS_VERSION" in dash:
    print("  ⚠️  Patch ya aplicado.")
    sys.exit(0)

# Anchors
ANCHOR_MODAL = '<!-- GASTO -->'
ANCHOR_FUNC = '// Renderizar banner de plan (trial, próximo cobro, expirado, etc.)\nfunction renderPlanBanner() {'
ANCHOR_REFRESH = '      renderPlanBanner();\n      aplicarBloqueosPlan();'

for nombre, anchor in [
    ("modal_gasto", ANCHOR_MODAL),
    ("func_renderPlanBanner", ANCHOR_FUNC),
    ("refrescarPlan_render", ANCHOR_REFRESH),
]:
    n = dash.count(anchor)
    if n == 1:
        print(f"  ✓ {nombre}")
    else:
        print(f"  ❌ {nombre}: {n} (esperado 1)")
        sys.exit(1)

print("\n✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCH ═══")

# ─── 1. Modal HTML antes del modal de Gasto ───
MODAL_HTML = '''<!-- NOVEDADES -->
<div class="modal-bg" id="mNovedades">
<div class="modal" style="max-width:560px">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div>
      <div style="font-size:11px;font-weight:800;color:#10B981;letter-spacing:1.5px;margin-bottom:6px">\u2728 BRIEFING DEL EQUIPO</div>
      <div class="modal-title" style="margin:0">Novedades de producto</div>
    </div>
    <button onclick="cerrarNovedades()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);padding:0 4px;line-height:1">&times;</button>
  </div>
  <div style="font-size:13px;color:var(--muted);margin-bottom:18px">Lo \u00faltimo que estamos lanzando en TekPair.</div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px">
    <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:14px;position:relative">
      <div style="position:absolute;top:10px;right:10px;background:#10B981;color:#04150F;font-size:9px;font-weight:800;padding:3px 7px;border-radius:5px;letter-spacing:0.5px">NUEVO</div>
      <div style="font-size:24px;margin-bottom:6px">\ud83d\udccd</div>
      <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">Ubicaciones m\u00faltiples</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.4">Asigna cada producto a una tienda o almac\u00e9n. <strong style="color:#10B981">Plan TOP</strong></div>
    </div>
    <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:14px;position:relative">
      <div style="position:absolute;top:10px;right:10px;background:#10B981;color:#04150F;font-size:9px;font-weight:800;padding:3px 7px;border-radius:5px;letter-spacing:0.5px">NUEVO</div>
      <div style="font-size:24px;margin-bottom:6px">\ud83d\udcb0</div>
      <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">Programa de afiliados</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.4">Trae clientes con tu c\u00f3digo y cobra 20% recurrente.</div>
    </div>
    <div style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.25);border-radius:12px;padding:14px;position:relative">
      <div style="position:absolute;top:10px;right:10px;background:rgba(251,191,36,0.2);color:#92400e;font-size:9px;font-weight:800;padding:3px 7px;border-radius:5px;letter-spacing:0.5px">PR\u00d3XIMO</div>
      <div style="font-size:24px;margin-bottom:6px">\ud83d\udcc4</div>
      <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">Gastos con PDF</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.4">Sube la factura de cada gasto e informe trimestral en un clic.</div>
    </div>
    <div style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.25);border-radius:12px;padding:14px;position:relative">
      <div style="position:absolute;top:10px;right:10px;background:rgba(251,191,36,0.2);color:#92400e;font-size:9px;font-weight:800;padding:3px 7px;border-radius:5px;letter-spacing:0.5px">PR\u00d3XIMO</div>
      <div style="font-size:24px;margin-bottom:6px">\ud83d\udcca</div>
      <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">Resumen para gestor</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.4">IVA repercutido vs soportado del trimestre, listo para imprimir.</div>
    </div>
  </div>

  <div class="modal-actions">
    <button class="btn-secondary" onclick="cerrarNovedades()">Recordar m\u00e1s tarde</button>
    <button class="btn-primary" style="background:#10B981" onclick="cerrarNovedadesPermanente()">Vale, ya lo vi</button>
  </div>
</div>
</div>

'''

dash = dash.replace(ANCHOR_MODAL, MODAL_HTML + ANCHOR_MODAL, 1)
print("  ✓ Modal HTML añadido")

# ─── 2. Funciones JS antes de renderPlanBanner ───
FUNCIONES = '''// ═══ NOVEDADES ═══
// Cambia esto cuando haya novedades nuevas: el modal volverá a aparecer
var NEWS_VERSION = '2026-05-20';
var NEWS_KEY = 'tk_news_seen';

function mostrarNovedadesSiHayNuevas() {
  try {
    var seen = localStorage.getItem(NEWS_KEY);
    if (seen === NEWS_VERSION) return; // Ya lo vio en esta versión
    // Pequeño retraso para que cargue todo lo demás primero
    setTimeout(function() {
      if (typeof openM === 'function' && document.getElementById('mNovedades')) {
        openM('mNovedades');
      }
    }, 1500);
  } catch(e) { /* localStorage falla en privado/incógnito, no pasa nada */ }
}

function cerrarNovedades() {
  if (typeof closeM === 'function') closeM('mNovedades');
}

function cerrarNovedadesPermanente() {
  try { localStorage.setItem(NEWS_KEY, NEWS_VERSION); } catch(e){}
  cerrarNovedades();
}

'''

dash = dash.replace(ANCHOR_FUNC, FUNCIONES + ANCHOR_FUNC, 1)
print("  ✓ Funciones JS añadidas (mostrar/cerrar/persistir)")

# ─── 3. Llamar a mostrarNovedadesSiHayNuevas tras refrescar plan ───
OLD_REFRESH = ANCHOR_REFRESH
NEW_REFRESH = OLD_REFRESH + '\n      mostrarNovedadesSiHayNuevas();'

dash = dash.replace(OLD_REFRESH, NEW_REFRESH, 1)
print("  ✓ Llamada al modal añadida tras refrescar plan (al login)")

open(DASH, "w", encoding="utf-8").write(dash)

# Verificación
print("\n═══ VERIFICACIÓN DE INTEGRIDAD ═══")

final = open(DASH, "r", encoding="utf-8").read()

todo_ok = True
for nombre, antes, despues in [
    ("</body>", body_antes, final.count("</body>")),
    ("</html>", html_antes, final.count("</html>")),
]:
    est = "✓" if antes == despues else "✗ ROTO"
    if antes != despues: todo_ok = False
    print(f"  {nombre}: {antes} → {despues} {est}")

checks = [
    ('id="mNovedades"', "modal HTML"),
    ("NEWS_VERSION = '2026-05-20'", "constante de versión"),
    ("function mostrarNovedadesSiHayNuevas", "función mostrar"),
    ("function cerrarNovedadesPermanente", "función cerrar permanente"),
    ("mostrarNovedadesSiHayNuevas();", "llamada al login"),
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
    print("  git commit -m 'feat(novedades): modal de novedades al iniciar sesión'")
    print("  git push origin main")
    print()
    print("Al iniciar sesión, el usuario verá el modal con las 4 novedades.")
    print("Si pulsa 'Vale, ya lo vi' no vuelve a aparecer hasta la próxima novedad.")
    print()
    print("Para LA PRÓXIMA novedad, solo cambia NEWS_VERSION a otra fecha")
    print("(ej. '2026-06-15') y todos los usuarios verán el modal de nuevo.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
