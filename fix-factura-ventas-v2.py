#!/usr/bin/env python3
"""
PATCH v2: Botón de factura en la sección Ventas del dashboard
===============================================================
(v2: anchors sin emojis para evitar problemas de variation selectors)

1. Botón 📄 en cada venta de la lista + listener
2. Función factVenta (igual que la del TPV)

Solo toca dashboard.html.
"""

import sys
import os

DASH = "dashboard.html"

if not os.path.exists(DASH):
    print(f"❌ {DASH} no encontrado")
    sys.exit(1)

dash = open(DASH, "r", encoding="utf-8").read()


def check(anchor, nombre):
    n = dash.count(anchor)
    if n != 1:
        print(f"  ❌ ABORTO: '{nombre}' aparece {n} veces (esperado 1)")
        return False
    print(f"  ✓ '{nombre}' único")
    return True


print("═══ VERIFICACIÓN PREVIA ═══")

# Anchors SIN emojis
A_CELDA = "      '<td style=\"display:flex;gap:3px\">' + btnR + btnF + btnImpr + '</td></tr>';"

A_LISTENER = """  el.querySelectorAll('.btn-impr-v').forEach(function(btn) {
    btn.addEventListener('click', function() { imprimirTicketVenta(this.dataset.vid); });
  });"""

A_FACTREP = "function factRep(id) {"

ok = True
ok &= check(A_CELDA, "celda acciones renderVentas")
ok &= check(A_LISTENER, "listener btn-impr-v")
ok &= check(A_FACTREP, "function factRep")

if "btn-fact-v" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")

print("═══ PATCHES ═══")

# ─── 1: declarar btnFact + añadirlo a la celda (un solo replace) ───
NUEVA_CELDA = (
    "    var btnFact = !v.reembolsado ? '<button data-vid=\"' + v.id + "
    "'\" class=\"btn-fact-v\" style=\"background:#10B981;color:white;border:none;"
    "padding:3px 8px;border-radius:5px;font-size:11px;cursor:pointer\" "
    "title=\"Generar factura\">\U0001f4c4</button>' : '';\n"
    "      '<td style=\"display:flex;gap:3px\">' + btnR + btnF + btnFact + btnImpr + '</td></tr>';"
)

dash = dash.replace(A_CELDA, NUEVA_CELDA, 1)
print("  ✓ botón 📄 declarado y añadido a la fila")

# ─── 2: listener ───
dash = dash.replace(
    A_LISTENER,
    A_LISTENER + """
  el.querySelectorAll('.btn-fact-v').forEach(function(btn) {
    btn.addEventListener('click', function() { factVenta(this.dataset.vid); });
  });""",
    1
)
print("  ✓ listener del botón factura")

# ─── 3: función factVenta ───
FUNC = """// Generar factura de una venta (desde la sección Ventas)
function factVenta(id) {
  var v = DB.ventas.find(function(x) { return x.id === id; });
  if (!v) { toast('Venta no encontrada', 'err'); return; }
  var cli = v.clienteId ? DB.clis.find(function(c) { return c.id === v.clienteId; }) : null;
  var datos = {
    id: v.id,
    fecha: v.fecha,
    total: parseFloat(v.total) || 0,
    iva: parseFloat(v.iva) || 0,
    pago: v.pago || '',
    items: (v.items && v.items.length) ? v.items.map(function(i) {
      return { nombre: i.nombre || 'Producto', cantidad: parseFloat(i.qty || i.cantidad) || 1, precio: parseFloat(i.precio) || 0 };
    }) : [{ nombre: v.modelo || 'Venta', cantidad: 1, precio: parseFloat(v.total) || 0 }],
    cliente: cli
  };
  if (typeof window.abrirModalFactura !== 'function') {
    toast('Modulo factura cargando, reintenta en un momento', 'err'); return;
  }
  window.abrirModalFactura('venta', datos);
}

function factRep(id) {"""

dash = dash.replace(A_FACTREP, FUNC, 1)
print("  ✓ función factVenta")

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
    ('class="btn-fact-v"', "botón factura en ventas"),
    ("btnR + btnF + btnFact + btnImpr", "botón en la fila"),
    (".btn-fact-v').forEach", "listener"),
    ("function factVenta(id)", "función factVenta"),
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
    print("  git commit -m 'feat(facturas): facturar ventas desde el dashboard'")
    print("  git push origin test-fase-d")
    print()
    print("En Dashboard > Ventas, cada venta tendra un boton para facturar.")
else:
    print("⚠️  Algo falló. git checkout dashboard.html")
    sys.exit(1)
