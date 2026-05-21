#!/usr/bin/env python3
"""
PATCH: Actualizar el banner de novedades existente con el contenido del mes.

NO crea nada nuevo - actualiza el contenido del banner viejo (15mayo 2026)
para que muestre las novedades actuales y vuelva a aparecer (cambiamos la
clave de localStorage).

Cambios:
  1. NOVEDADES MAYO 2026 -> NOVEDADES MAYO 2026 (mantiene mes)
  2. Las 3 viejas (anticipos, pagos multiples, cliente TPV) -> 3 nuevas
  3. "Proximamente facturas" -> "Proximamente gastos PDF + resumen gestor"
  4. Clave localStorage: tk_novedades_15may2026 -> tk_novedades_20may2026
     (con esto, todos los usuarios verán el modal de nuevo)
"""

import sys, os

DASH = "dashboard.html"
dash = open(DASH, "r", encoding="utf-8").read()

print("═══ Actualizar contenido del banner de novedades ═══\n")

# ─── Cambio 1: Las 3 tarjetas de novedades ───
OLD_TARJETAS = '''            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
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
            '</div>' '''

NEW_TARJETAS = '''            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
              '<div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:4px">📍 Ubicaciones múltiples en stock</div>' +
              '<div style="font-size:13px;color:#64748B;line-height:1.5">Asigna cada producto a una tienda o almacén. Define tus ubicaciones desde Ajustes y filtra desde la lista de stock. <strong style="color:#10B981">Exclusivo plan TOP</strong>.</div>' +
            '</div>' +
            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
              '<div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:4px">💰 Programa de afiliados</div>' +
              '<div style="font-size:13px;color:#64748B;line-height:1.5">Si traes clientes a TekPair con tu código, cobras 20% recurrente sobre cada pago. Disponible para cualquier usuario interesado.</div>' +
            '</div>' +
            '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F1F5F9">' +
              '<div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:4px">🧾 Numeración de facturas mejorada</div>' +
              '<div style="font-size:13px;color:#64748B;line-height:1.5">Comisiones calculadas sobre base imponible (sin IVA) para cuentas más limpias contablemente.</div>' +
            '</div>' +
            '<div style="background:#FEF3C7;border-radius:10px;padding:12px;font-size:12px;color:#92400E;line-height:1.5">' +
              '🔨 <strong>Próximamente:</strong> adjuntar PDFs a cada gasto + resumen trimestral para tu gestor (IVA repercutido vs soportado).' +
            '</div>' '''

n = dash.count(OLD_TARJETAS)
if n != 1:
    print(f"❌ Tarjetas viejas no encontradas únicamente (count={n})")
    sys.exit(1)

dash = dash.replace(OLD_TARJETAS, NEW_TARJETAS, 1)
print("  ✓ 3 tarjetas de novedades actualizadas")
print("  ✓ Bloque 'próximamente' actualizado")

# ─── Cambio 2: clave localStorage ───
# Se hace en DOS sitios: el if que comprueba y el set al cerrar
n1 = dash.count("'tk_novedades_15may2026'")
if n1 != 2:
    print(f"❌ Clave localStorage debería aparecer 2 veces (count={n1})")
    sys.exit(1)

dash = dash.replace("'tk_novedades_15may2026'", "'tk_novedades_20may2026'")
print(f"  ✓ Clave localStorage actualizada (2 sitios) → vuelve a aparecer para todos")

open(DASH, "w", encoding="utf-8").write(dash)

# Verificación
final = open(DASH, "r", encoding="utf-8").read()

print("\n═══ VERIFICACIÓN ═══")
checks = [
    ("📍 Ubicaciones múltiples en stock", "tarjeta 1: ubicaciones"),
    ("💰 Programa de afiliados", "tarjeta 2: afiliados"),
    ("🧾 Numeración de facturas mejorada", "tarjeta 3: comisiones"),
    ("adjuntar PDFs a cada gasto + resumen trimestral", "próximamente"),
    ("'tk_novedades_20may2026'", "clave nueva"),
]
todo_ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

# La vieja NO debe estar
if "tk_novedades_15may2026" in final:
    print(f"  ✗ La clave vieja sigue ahí")
    todo_ok = False
else:
    print(f"  ✓ Clave vieja eliminada")

print()
if todo_ok:
    print("🎉 PATCH APLICADO")
    print()
    print("  git add dashboard.html")
    print("  git commit -m 'feat(novedades): actualizar banner con novedades de mayo'")
    print("  git push origin main")
    print()
    print("Tras el deploy, todos los usuarios verán el modal de novedades")
    print("la próxima vez que entren (porque la clave cambió).")
    print()
    print("Para FUTURAS novedades:")
    print("  - Edita las 3 tarjetas del banner")
    print("  - Cambia 'tk_novedades_20may2026' por una fecha más reciente")
    print("  - Sube y todos los usuarios lo verán de nuevo")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
