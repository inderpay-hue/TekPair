#!/usr/bin/env python3
"""
PATCH SEGURO: Botones de factura en TPV y dashboard
=====================================================
Lección de ayer: NO usar </body> (6 ocurrencias). Usar anchors únicos.

Anchors únicos verificados:
- dashboard.html: '// ═══ /SISTEMA PAGOS REPARACIÓN ═══' (1 vez)
- tpv.html: '<!-- BOTÓN FLOTANTE MÓVIL (solo visible <769px) -->' (1 vez)

Este patch VERIFICA cada anchor antes de tocar nada. Si algo no cuadra, ABORTA.
"""

import sys
import os

TPV = "tpv.html"
DASH = "dashboard.html"


def leer(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def escribir(path, contenido):
    with open(path, "w", encoding="utf-8") as f:
        f.write(contenido)


def verificar_anchor(contenido, anchor, nombre, esperado=1):
    n = contenido.count(anchor)
    if n != esperado:
        print(f"  ❌ ABORTO: anchor '{nombre}' aparece {n} veces (esperado {esperado})")
        return False
    print(f"  ✓ anchor '{nombre}' único ({n})")
    return True


# ════════════════════════════════════════════════
# VERIFICACIÓN PREVIA - antes de tocar nada
# ════════════════════════════════════════════════
print("═══ VERIFICACIÓN PREVIA ═══")

for f in (TPV, DASH):
    if not os.path.exists(f):
        print(f"❌ {f} no encontrado")
        sys.exit(1)

tpv = leer(TPV)
dash = leer(DASH)

# Anchors
ANCHOR_TPV = "<!-- BOTÓN FLOTANTE MÓVIL (solo visible <769px) -->"
ANCHOR_DASH = "// ═══ /SISTEMA PAGOS REPARACIÓN ═══"

# Patrones de los botones existentes (para insertar al lado)
BTN_REIMPRIMIR = """      '<button class="caja-btn" style="flex-shrink:0;padding:6px 9px" onclick="reimprimirVenta(\\'' + v.id + '\\')" title="Reimprimir ticket">\\ud83d\\udda8</button>' +"""

BTN_DEL_DASH = """    var btnDel = tienePerm('reps_eliminar') ? '<button data-rid="' + r.id + '" class="btn-del-r" style="background:var(--red);color:white;border:none;padding:3px 8px;border-radius:5px;font-size:10px;cursor:pointer;margin-left:3px" title="Eliminar reparación">🗑️</button>' : '';"""

CELDA_DASH = """      + '<td>' + btnE + btnEdit + btnLink + btnWA + btnDel + '</td></tr>';"""

LISTENER_DEL = """  el.querySelectorAll('.btn-del-r').forEach(function(btn) {
    btn.addEventListener('click', function() { eliminarReparacion(this.dataset.rid); });
  });"""

ok = True
ok &= verificar_anchor(tpv, ANCHOR_TPV, "TPV flotante móvil")
ok &= verificar_anchor(tpv, BTN_REIMPRIMIR, "TPV botón reimprimir")
ok &= verificar_anchor(dash, ANCHOR_DASH, "DASH pagos reparación")
ok &= verificar_anchor(dash, BTN_DEL_DASH, "DASH botón eliminar")
ok &= verificar_anchor(dash, CELDA_DASH, "DASH celda acciones")
ok &= verificar_anchor(dash, LISTENER_DEL, "DASH listener del")

# Verificar que no está ya aplicado
if "factVenta" in tpv or "factRep" in dash:
    print("  ⚠️  Patch ya aplicado (factVenta/factRep presentes). Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. NO se ha tocado ningún archivo.")
    sys.exit(1)

print("✓ Todas las verificaciones OK\n")

# Guardar counts de integridad
tpv_body_antes = tpv.count("</body>")
dash_body_antes = dash.count("</body>")
tpv_html_antes = tpv.count("</html>")
dash_html_antes = dash.count("</html>")


# ════════════════════════════════════════════════
# PATCH TPV.html
# ════════════════════════════════════════════════
print("═══ PATCH tpv.html ═══")

# 1. Botón factura junto al de reimprimir
nuevo_btn_tpv = BTN_REIMPRIMIR + """
      '<button class="caja-btn" style="flex-shrink:0;padding:6px 9px;background:#10B981;color:white" onclick="factVenta(\\'' + v.id + '\\')" title="Generar factura">\\ud83d\\udcc4</button>' +"""
tpv = tpv.replace(BTN_REIMPRIMIR, nuevo_btn_tpv, 1)
print("  ✓ Botón 📄 en histórico de ventas")

# 2. Script factura.js + función factVenta antes del anchor flotante
codigo_tpv = """<script src="factura.js" defer></script>
<script>
function factVenta(id) {
  var v = DB.ventas.find(function(x){ return x.id === id; });
  if (!v) { toast('Venta no encontrada', 'err'); return; }
  var cli = v.clienteId ? DB.clis.find(function(c){ return c.id === v.clienteId; }) : null;
  var datos = {
    id: v.id,
    fecha: v.fecha,
    total: parseFloat(v.total) || 0,
    iva: parseFloat(v.iva) || 0,
    pago: v.pago || '',
    items: (v.items && v.items.length) ? v.items.map(function(i){
      return { nombre: i.nombre || 'Producto', cantidad: parseFloat(i.qty || i.cantidad) || 1, precio: parseFloat(i.precio) || 0 };
    }) : [{ nombre: v.modelo || 'Venta', cantidad: 1, precio: parseFloat(v.total) || 0 }],
    cliente: cli
  };
  if (typeof window.abrirModalFactura !== 'function') {
    toast('Modulo factura cargando, reintenta en un momento', 'err'); return;
  }
  window.abrirModalFactura('venta', datos);
}
</script>
"""
tpv = tpv.replace(ANCHOR_TPV, codigo_tpv + ANCHOR_TPV, 1)
print("  ✓ <script factura.js> + funcion factVenta")

escribir(TPV, tpv)
tpv_final = leer(TPV)
print(f"  📄 tpv.html: {len(leer(TPV))} caracteres")


# ════════════════════════════════════════════════
# PATCH dashboard.html
# ════════════════════════════════════════════════
print("\n═══ PATCH dashboard.html ═══")

# 1. Variable btnFact tras btnDel
nuevo_btndel = BTN_DEL_DASH + """
    var btnFact = (r.estado === 'Entregado') ? '<button data-rid="' + r.id + '" class="btn-fact-r" style="background:#10B981;color:white;border:none;padding:3px 8px;border-radius:5px;font-size:10px;cursor:pointer;margin-left:3px" title="Generar factura">📄</button>' : '';"""
dash = dash.replace(BTN_DEL_DASH, nuevo_btndel, 1)
print("  ✓ Variable btnFact")

# 2. Incluir btnFact en la celda
dash = dash.replace(
    CELDA_DASH,
    """      + '<td>' + btnE + btnEdit + btnLink + btnWA + btnFact + btnDel + '</td></tr>';""",
    1
)
print("  ✓ btnFact en celda de acciones")

# 3. Listener btn-fact-r
nuevo_listener = LISTENER_DEL + """
  el.querySelectorAll('.btn-fact-r').forEach(function(btn) {
    btn.addEventListener('click', function() { factRep(this.dataset.rid); });
  });"""
dash = dash.replace(LISTENER_DEL, nuevo_listener, 1)
print("  ✓ Listener btn-fact-r")

# 4. Función factRep + carga dinámica de factura.js tras el anchor
codigo_dash = ANCHOR_DASH + """

// ═══ FACTURAS ═══
(function() {
  var s = document.createElement('script');
  s.src = 'factura.js';
  s.defer = true;
  document.body.appendChild(s);
})();

function factRep(id) {
  var r = DB.reps.find(function(x){ return x.id === id; });
  if (!r) { toast('Reparacion no encontrada', 'err'); return; }
  var cli = null;
  if (r.cliId) cli = DB.clis.find(function(c){ return c.id === r.cliId; });
  if (!cli && r.clienteNombre) cli = { nombre: r.clienteNombre, apellidos: '' };
  var datos = {
    id: r.id,
    fecha: r.fecha,
    fechaEntregaReal: r.fechaEntregaReal,
    total: parseFloat(r.total) || 0,
    iva: parseFloat(r.iva) || 0,
    pagoFinal: r.pagoFinal || '',
    marca: r.marca || '',
    modelo: r.modelo || '',
    averia: r.averia || '',
    servicios: r.servicios || [],
    componentes: r.componentes || [],
    cliente: cli
  };
  if (typeof window.abrirModalFactura !== 'function') {
    toast('Modulo factura cargando, reintenta en un momento', 'err'); return;
  }
  window.abrirModalFactura('reparacion', datos);
}
// ═══ /FACTURAS ═══"""
dash = dash.replace(ANCHOR_DASH, codigo_dash, 1)
print("  ✓ funcion factRep + carga dinamica factura.js")

escribir(DASH, dash)
print(f"  📄 dashboard.html: {len(leer(DASH))} caracteres")


# ════════════════════════════════════════════════
# VERIFICACIÓN DE INTEGRIDAD
# ════════════════════════════════════════════════
print("\n═══ VERIFICACIÓN DE INTEGRIDAD ═══")

tpv_final = leer(TPV)
dash_final = leer(DASH)

checks = [
    ("</body> en tpv", tpv_body_antes, tpv_final.count("</body>")),
    ("</html> en tpv", tpv_html_antes, tpv_final.count("</html>")),
    ("</body> en dashboard", dash_body_antes, dash_final.count("</body>")),
    ("</html> en dashboard", dash_html_antes, dash_final.count("</html>")),
]

todo_ok = True
for nombre, antes, despues in checks:
    estado = "✓" if antes == despues else "✗ ROTO"
    if antes != despues:
        todo_ok = False
    print(f"  {nombre}: {antes} → {despues} {estado}")

# Verificar que las funciones se añadieron
contenido_checks = [
    (tpv_final, "factVenta", "funcion factVenta en tpv"),
    (tpv_final, 'factura.js', "script factura.js en tpv"),
    (dash_final, "factRep", "funcion factRep en dashboard"),
    (dash_final, "btn-fact-r", "boton/listener factura en dashboard"),
]
for contenido, needle, label in contenido_checks:
    if needle in contenido:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH APLICADO Y VERIFICADO")
    print()
    print("SIGUIENTE PASO - PROBAR LOCAL (obligatorio antes de push):")
    print("  python3 -m http.server 8000")
    print("  Abrir http://localhost:8000/dashboard.html y tpv.html")
    print("  Verificar botones 📄 + abrir modal (NO emitir factura real)")
    print()
    print("Si todo OK, parar server (Ctrl+C) y:")
    print("  git add tpv.html dashboard.html")
    print("  git commit -m 'feat(facturas): botones emitir factura en TPV y reparaciones'")
    print("  git push origin main")
else:
    print("⚠️  INTEGRIDAD FALLIDA. Revertir con:")
    print("  cp tpv.html.bak-pre-facturas tpv.html")
    print("  cp dashboard.html.bak-pre-facturas dashboard.html")
    sys.exit(1)
