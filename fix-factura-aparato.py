#!/usr/bin/env python3
"""
PATCH: Detalle del aparato en la factura de reparación
========================================================
Añade marca, modelo, IMEI y avería a las facturas de reparación.

1. dashboard.html · factRep: añade imei a los datos
2. factura.js · payload INSERT: guarda origen_detalle (marca/modelo/imei/averia)
3. factura.js · generarFacturaPDF: muestra sección "Aparato reparado"

Requiere ANTES (ya hecho): ALTER TABLE facturas ADD COLUMN origen_detalle JSONB;
"""

import sys
import os

DASH = "dashboard.html"
FACT = "factura.js"


def leer(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read()


def escribir(p, c):
    with open(p, "w", encoding="utf-8") as f:
        f.write(c)


def check(contenido, anchor, nombre):
    n = contenido.count(anchor)
    if n != 1:
        print(f"  ❌ ABORTO: '{nombre}' aparece {n} veces (esperado 1)")
        return False
    print(f"  ✓ '{nombre}' único")
    return True


print("═══ VERIFICACIÓN PREVIA ═══")

for f in (DASH, FACT):
    if not os.path.exists(f):
        print(f"❌ {f} no encontrado")
        sys.exit(1)

dash = leer(DASH)
fact = leer(FACT)

# Anchors
A_FACTREP = """    modelo: r.modelo || '',
    averia: r.averia || '',"""

A_PAYLOAD = """        metodo_pago: d.pago || d.pagoFinal || '',
        estado: 'emitida'"""

A_TITULODOC = "    var tituloDoc = esSimplificada ? 'FACTURA SIMPLIFICADA' : 'FACTURA';"

A_CSS = "      '@media print { body { padding:16px 20px; } @page { margin:1cm; } }' +"

A_TABLA = "      '<table><thead><tr>' +"

ok = True
ok &= check(dash, A_FACTREP, "dashboard factRep")
ok &= check(fact, A_PAYLOAD, "factura.js payload")
ok &= check(fact, A_TITULODOC, "factura.js tituloDoc")
ok &= check(fact, A_CSS, "factura.js CSS @media")
ok &= check(fact, A_TABLA, "factura.js inicio tabla")

if "origen_detalle" in fact and "class=\\\"aparato\\\"" in fact:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

dash_body_antes = dash.count("</body>")
dash_html_antes = dash.count("</html>")


# ═══ CAMBIO 1: dashboard.html factRep — añadir imei ═══
print("═══ PATCH dashboard.html ═══")

dash = dash.replace(A_FACTREP, """    modelo: r.modelo || '',
    imei: r.imei || '',
    averia: r.averia || '',""", 1)
print("  ✓ imei añadido a factRep")
escribir(DASH, dash)


# ═══ CAMBIO 2: factura.js payload — origen_detalle ═══
print("\n═══ PATCH factura.js ═══")

fact = fact.replace(A_PAYLOAD, """        metodo_pago: d.pago || d.pagoFinal || '',
        origen_detalle: (FACT.origen === 'reparacion') ? { marca: d.marca || '', modelo: d.modelo || '', imei: d.imei || '', averia: d.averia || '' } : null,
        estado: 'emitida'""", 1)
print("  ✓ origen_detalle añadido al payload")

# ═══ CAMBIO 3: construir aptHtml ═══
NUEVO_TITULODOC = A_TITULODOC + """

    // Detalle del aparato (solo facturas de reparación)
    var aptHtml = '';
    var od = f.origen_detalle || {};
    if (od.marca || od.modelo || od.imei || od.averia) {
      var aparatoNom = [od.marca, od.modelo].filter(Boolean).join(' ');
      aptHtml = '<div class="aparato"><h3>Aparato reparado</h3>' +
        '<div class="apt-row"><strong>' + _esc(aparatoNom || 'Dispositivo') + '</strong>' +
        (od.imei ? ' &middot; IMEI: ' + _esc(od.imei) : '') + '</div>' +
        (od.averia ? '<div class="apt-averia">Aver\\u00eda: ' + _esc(od.averia) + '</div>' : '') +
        '</div>';
    }"""

fact = fact.replace(A_TITULODOC, NUEVO_TITULODOC, 1)
print("  ✓ variable aptHtml construida")

# ═══ CAMBIO 4: CSS de .aparato ═══
NUEVO_CSS = """      '.aparato { background:#fff7ed; border-left:3px solid #f59e0b; border-radius:6px; padding:12px 16px; margin-bottom:24px; }' +
      '.aparato h3 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#f59e0b; margin-bottom:6px; font-weight:700; }' +
      '.aparato .apt-row { font-size:13px; }' +
      '.aparato .apt-averia { font-size:12px; color:#666; margin-top:3px; }' +
      '@media print { body { padding:16px 20px; } @page { margin:1cm; } }' +"""

fact = fact.replace(A_CSS, NUEVO_CSS, 1)
print("  ✓ CSS de .aparato añadido")

# ═══ CAMBIO 5: insertar aptHtml en el HTML ═══
fact = fact.replace(A_TABLA, "      aptHtml +\n" + A_TABLA, 1)
print("  ✓ aptHtml insertado antes de la tabla")

escribir(FACT, fact)


# ═══ Verificación ═══
print("\n═══ VERIFICACIÓN DE INTEGRIDAD ═══")

dash_final = leer(DASH)
fact_final = leer(FACT)

todo_ok = True
for nombre, antes, despues in [
    ("</body> dashboard", dash_body_antes, dash_final.count("</body>")),
    ("</html> dashboard", dash_html_antes, dash_final.count("</html>")),
]:
    est = "✓" if antes == despues else "✗ ROTO"
    if antes != despues:
        todo_ok = False
    print(f"  {nombre}: {antes} → {despues} {est}")

checks = [
    (dash_final, "imei: r.imei || ''", "imei en factRep"),
    (fact_final, "origen_detalle: (FACT.origen", "origen_detalle en payload"),
    (fact_final, "var aptHtml = ''", "variable aptHtml"),
    (fact_final, "Aparato reparado", "sección aparato en PDF"),
    (fact_final, ".aparato { background", "CSS aparato"),
    (fact_final, "aptHtml +\n      '<table>", "aptHtml insertado"),
]
for contenido, needle, label in checks:
    if needle in contenido:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH APLICADO Y VERIFICADO")
    print()
    print("  node -c factura.js && echo OK")
    print()
    print("  git add dashboard.html factura.js")
    print("  git commit -m 'feat(facturas): detalle del aparato en factura'")
    print("  git push origin test-factura-pdf")
    print()
    print("Emite una factura de REPARACION: el PDF mostrara una seccion")
    print("'Aparato reparado' con marca, modelo, IMEI y averia.")
else:
    print("⚠️  Algo falló. Revertir: git checkout dashboard.html factura.js")
    sys.exit(1)
