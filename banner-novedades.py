#!/usr/bin/env python3
"""
PATCH: Banner in-app de novedades mayo 2026
=============================================
- Anchor único: '// ═══ /SISTEMA PAGOS REPARACIÓN ═══' (solo aparece 1 vez)
- Verifica que aparece exactamente 1 vez antes de aplicar
- Solo AÑADE código (no modifica nada existente)
- localStorage: tk_novedades_15may2026 (no se repite)
"""

import sys
import os

DASHBOARD = "dashboard.html"
ANCHOR = "// ═══ /SISTEMA PAGOS REPARACIÓN ═══"

if not os.path.exists(DASHBOARD):
    print(f"❌ {DASHBOARD} no encontrado")
    sys.exit(1)

with open(DASHBOARD, "r", encoding="utf-8") as f:
    content = f.read()

# ───── VERIFICACIÓN CRÍTICA ─────
ocurrencias = content.count(ANCHOR)
print(f"Anchor encontrado {ocurrencias} veces")
if ocurrencias != 1:
    print(f"❌ ABORTO: el anchor debe aparecer exactamente 1 vez (encontradas: {ocurrencias})")
    sys.exit(1)

# ───── Verificar que el banner NO está ya añadido ─────
if "tk_novedades_15may2026" in content:
    print("⚠️  Banner ya añadido. Sin cambios.")
    sys.exit(0)

orig_len = len(content)
print(f"📄 {DASHBOARD}: {orig_len} caracteres iniciales\n")


# ───── Código del banner ─────
banner_code = """

// ═══ BANNER NOVEDADES MAYO 2026 ═══
setTimeout(function() {
  try {
    if (localStorage.getItem('tk_novedades_15may2026')) return;
    if (typeof DB === 'undefined' || !DB.ventas) return;
    if (document.getElementById('mNovedades')) return;

    var html = '' +
      '<div id="mNovedades" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px">' +
        '<div style="background:white;max-width:480px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:nFadeIn .3s ease-out">' +
          '<div style="background:linear-gradient(135deg,#10B981,#059669);color:white;padding:20px 24px;position:relative">' +
            '<div style="font-size:11px;font-weight:700;letter-spacing:.5px;opacity:.9;margin-bottom:4px">NOVEDADES · MAYO 2026</div>' +
            '<div style="font-size:20px;font-weight:800">🎉 Nuevas mejoras en TekPair</div>' +
            '<button onclick="cerrarBannerNovedades()" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,.2);border:none;color:white;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1">×</button>' +
          '</div>' +
          '<div style="padding:20px 24px">' +
            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
              '<div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:4px">💰 Anticipos en el día correcto</div>' +
              '<div style="font-size:13px;color:#64748B;line-height:1.5">Los anticipos ahora cuentan en el día que se cobran. Tu cierre del día cuadra a la primera, sin descuadres.</div>' +
            '</div>' +
            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
              '<div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:4px">💳 Pagos múltiples por reparación</div>' +
              '<div style="font-size:13px;color:#64748B;line-height:1.5">Registra varios cobros (anticipo, parciales, final) con su fecha y método. Ideal para reparaciones a plazos.</div>' +
            '</div>' +
            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
              '<div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:4px">👤 Cliente en el TPV</div>' +
              '<div style="font-size:13px;color:#64748B;line-height:1.5">Asigna un cliente a cada venta desde el carrito del TPV. Pincha en 👤 dentro del ticket.</div>' +
            '</div>' +
            '<div style="background:#FEF3C7;border-radius:10px;padding:12px;font-size:12px;color:#92400E;line-height:1.5">' +
              '🔨 <strong>Próximamente:</strong> módulo de facturas con numeración correlativa, datos fiscales y PDF descargable.' +
            '</div>' +
          '</div>' +
          '<div style="padding:14px 24px 20px;display:flex;gap:10px">' +
            '<button onclick="cerrarBannerNovedades()" style="flex:1;padding:11px;border-radius:10px;border:none;background:#10B981;color:white;cursor:pointer;font-weight:700;font-size:14px">Entendido, gracias</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<style>@keyframes nFadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}</style>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);
  } catch (e) {
    console.error('Banner novedades:', e);
  }
}, 1500);

window.cerrarBannerNovedades = function() {
  try { localStorage.setItem('tk_novedades_15may2026', '1'); } catch(e) {}
  var el = document.getElementById('mNovedades');
  if (el) el.remove();
};
// ═══ /BANNER NOVEDADES ═══
"""

# ───── Insertar después del anchor ─────
nuevo = content.replace(ANCHOR, ANCHOR + banner_code, 1)

if nuevo == content:
    print("❌ El replace no hizo cambios")
    sys.exit(1)

with open(DASHBOARD, "w", encoding="utf-8") as f:
    f.write(nuevo)

new_len = len(nuevo)
print(f"📄 {DASHBOARD}: {new_len} caracteres ({new_len - orig_len:+d})")

# ───── Verificación final ─────
print("\nVERIFICACIÓN:")
with open(DASHBOARD, "r", encoding="utf-8") as f:
    final = f.read()

checks = [
    ("BANNER NOVEDADES MAYO 2026", "Marca de inicio"),
    ("tk_novedades_15may2026", "localStorage key"),
    ("/BANNER NOVEDADES", "Marca de fin"),
    ("cerrarBannerNovedades", "Función de cierre"),
]
all_ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        all_ok = False

# Verificar que NO hemos roto nada: número de </body> y </html> debe ser igual
old_bodies = content.count("</body>")
new_bodies = final.count("</body>")
old_htmls = content.count("</html>")
new_htmls = final.count("</html>")

print(f"\nIntegridad HTML (debe ser igual antes y después):")
print(f"  </body>: {old_bodies} → {new_bodies} {'✓' if old_bodies == new_bodies else '✗'}")
print(f"  </html>: {old_htmls} → {new_htmls} {'✓' if old_htmls == new_htmls else '✗'}")

if all_ok and old_bodies == new_bodies and old_htmls == new_htmls:
    print("\n🎉 BANNER AÑADIDO CORRECTAMENTE")
    print("\nSiguiente: commit + push")
    print("  git add dashboard.html")
    print("  git commit -m 'feat(banner): banner in-app de novedades mayo 2026'")
    print("  git push origin main")
    print("\nProbar:")
    print("  1. Limpia SW")
    print("  2. Abre incógnito")
    print("  3. Login → entra al dashboard")
    print("  4. Espera 1.5s → aparece banner")
    print("  5. Click 'Entendido' → desaparece y no vuelve")
else:
    print("\n⚠️  Algo no cuadra. Revertir con:")
    print("  cp dashboard.html.bak-pre-facturas dashboard.html")
    sys.exit(1)
