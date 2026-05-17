#!/usr/bin/env python3
"""
PATCH FASE C: Pantalla de listado de facturas
================================================
Añade una sección "Facturas" al dashboard:
1. Item en el sidebar
2. Página pFacturas (buscador + filtros tipo/mes + tabla completa)
3. Hook en navTo
4. Función renderFacturas() + helpers

Solo toca dashboard.html. Reusa window.generarFacturaPDF (ya existe).
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

A_SIDEBAR = """    <div class="sidebar-ni" data-p="pReps" onclick="navTo('pReps');setSidebarActive(this)">
      <span class="sidebar-ni-icon">🔧</span>Reparaciones
    </div>"""

A_PAGE_CITAS = "<!-- PAGE: CITAS -->"

A_NAVTO = "  if (id === 'pUsuarios') cargarUsuarios();"

A_FIN_FACTURAS = "// ═══ /FACTURAS ═══"

ok = True
ok &= check(A_SIDEBAR, "sidebar Reparaciones")
ok &= check(A_PAGE_CITAS, "comentario PAGE CITAS")
ok &= check(A_NAVTO, "navTo cargarUsuarios")
ok &= check(A_FIN_FACTURAS, "fin sección FACTURAS")

if "renderFacturas" in dash:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

body_antes = dash.count("</body>")
html_antes = dash.count("</html>")


# ═══ CAMBIO 1: item sidebar ═══
print("═══ PATCHES ═══")

NUEVO_SIDEBAR = A_SIDEBAR + """
    <div class="sidebar-ni" data-p="pFacturas" onclick="navTo('pFacturas');setSidebarActive(this)">
      <span class="sidebar-ni-icon">🧾</span>Facturas
    </div>"""

dash = dash.replace(A_SIDEBAR, NUEVO_SIDEBAR, 1)
print("  ✓ item Facturas en sidebar")


# ═══ CAMBIO 2: página pFacturas ═══
PAGINA = '''<!-- PAGE: FACTURAS -->
<div class="page" id="pFacturas">
  <div class="sec-header" style="margin-bottom:10px">
    <div class="sec-title">Facturas</div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
    <input class="fi" id="factBuscar" placeholder="🔍 Buscar por número o cliente..." oninput="filtrarFacturas()" autocomplete="off" style="flex:1;min-width:180px">
    <select class="fi" id="factFiltroTipo" onchange="filtrarFacturas()" style="width:auto">
      <option value="">Todos los tipos</option>
      <option value="completa">Completa</option>
      <option value="simplificada">Simplificada</option>
    </select>
    <select class="fi" id="factFiltroMes" onchange="filtrarFacturas()" style="width:auto">
      <option value="">Todos los meses</option>
    </select>
  </div>
  <div id="factResumen" style="display:flex;gap:14px;margin-bottom:10px;font-size:12px;color:var(--muted)"></div>
  <div id="listaFacturas"></div>
</div>

'''

dash = dash.replace(A_PAGE_CITAS, PAGINA + A_PAGE_CITAS, 1)
print("  ✓ página pFacturas")


# ═══ CAMBIO 3: hook en navTo ═══
dash = dash.replace(
    A_NAVTO,
    A_NAVTO + "\n  if (id === 'pFacturas') renderFacturas();",
    1
)
print("  ✓ hook renderFacturas en navTo")


# ═══ CAMBIO 4: función renderFacturas + helpers ═══
FUNCIONES = r'''
// ─── Listado de facturas (Fase C) ───
var _FACTURAS = [];

function renderFacturas() {
  var cont = document.getElementById('listaFacturas');
  if (cont) cont.innerHTML = '<div class="empty">Cargando facturas...</div>';
  sbGet('facturas', 'tienda_id=eq.' + TIENDA_ID + '&order=created_at.desc').then(function(data) {
    _FACTURAS = Array.isArray(data) ? data : [];
    // Poblar filtro de meses
    var meses = {};
    _FACTURAS.forEach(function(f) {
      var m = (f.fecha_emision || '').slice(0, 7);
      if (m) meses[m] = true;
    });
    var selMes = document.getElementById('factFiltroMes');
    if (selMes) {
      var actual = selMes.value;
      var opts = '<option value="">Todos los meses</option>';
      Object.keys(meses).sort().reverse().forEach(function(m) {
        opts += '<option value="' + m + '">' + _mesLargo(m) + '</option>';
      });
      selMes.innerHTML = opts;
      selMes.value = actual;
    }
    filtrarFacturas();
  }).catch(function(e) {
    if (cont) cont.innerHTML = '<div class="empty">Error cargando facturas</div>';
    console.warn('[facturas] error:', e);
  });
}

function _mesLargo(ym) {
  var nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var p = ym.split('-');
  if (p.length < 2) return ym;
  var idx = parseInt(p[1], 10) - 1;
  return (nombres[idx] || ym) + ' ' + p[0];
}

function _factClienteNom(f) {
  var c = f.cliente_snapshot || {};
  if (f.tipo === 'simplificada') {
    return ((c.nombre || '') + ' ' + (c.apellidos || '')).trim() || 'Cliente';
  }
  return c.nombre_fiscal || 'Cliente';
}

function filtrarFacturas() {
  var q = (document.getElementById('factBuscar') || {}).value || '';
  var tipo = (document.getElementById('factFiltroTipo') || {}).value || '';
  var mes = (document.getElementById('factFiltroMes') || {}).value || '';
  q = q.toLowerCase().trim();

  var lista = _FACTURAS.filter(function(f) {
    if (tipo && f.tipo !== tipo) return false;
    if (mes && (f.fecha_emision || '').slice(0, 7) !== mes) return false;
    if (q) {
      var hay = ((f.numero || '') + ' ' + _factClienteNom(f)).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  var cont = document.getElementById('listaFacturas');
  var resumen = document.getElementById('factResumen');

  if (!lista.length) {
    if (cont) cont.innerHTML = '<div class="empty">Sin facturas</div>';
    if (resumen) resumen.innerHTML = '';
    return;
  }

  var totalSuma = lista.reduce(function(a, f) { return a + (parseFloat(f.total) || 0); }, 0);
  if (resumen) {
    resumen.innerHTML = '<span><strong>' + lista.length + '</strong> factura' + (lista.length !== 1 ? 's' : '') + '</span>' +
      '<span>Total facturado: <strong style="color:var(--green)">' + cur(totalSuma) + '</strong></span>';
  }

  var html = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    '<th>Número</th><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Origen</th>' +
    '<th>Base</th><th>IVA</th><th>Total</th><th></th>' +
    '</tr></thead><tbody>';

  lista.forEach(function(f, idx) {
    var fechaTxt = f.fecha_emision || '';
    try {
      var d = new Date(f.fecha_emision);
      if (!isNaN(d)) fechaTxt = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {}
    var tipoBadge = f.tipo === 'simplificada'
      ? '<span class="badge bo">Simplificada</span>'
      : '<span class="badge bp">Completa</span>';
    var origenTxt = f.origen_tipo === 'reparacion' ? '🔧 Reparación' : (f.origen_tipo === 'venta' ? '🛒 Venta' : '—');
    html += '<tr>' +
      '<td><strong>' + (f.numero || '—') + '</strong></td>' +
      '<td style="font-size:11px">' + fechaTxt + '</td>' +
      '<td>' + _factClienteNom(f) + '</td>' +
      '<td>' + tipoBadge + '</td>' +
      '<td style="font-size:11px">' + origenTxt + '</td>' +
      '<td style="font-size:11px">' + cur(f.base_imponible) + '</td>' +
      '<td style="font-size:11px">' + cur(f.iva_importe) + ' <span style="color:var(--muted)">(' + (parseFloat(f.iva_pct) || 0) + '%)</span></td>' +
      '<td style="font-weight:700;color:var(--green)">' + cur(f.total) + '</td>' +
      '<td><button data-fidx="' + idx + '" class="btn-pdf-f" style="background:#10B981;color:white;border:none;padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer" title="Ver / descargar PDF">📄 PDF</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  if (cont) {
    cont.innerHTML = html;
    cont.querySelectorAll('.btn-pdf-f').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var f = lista[parseInt(this.dataset.fidx, 10)];
        if (f && typeof window.generarFacturaPDF === 'function') {
          window.generarFacturaPDF(f);
        } else {
          toast('Módulo de factura no disponible', 'err');
        }
      });
    });
  }
}
// ═══ /FACTURAS ═══'''

dash = dash.replace(A_FIN_FACTURAS, FUNCIONES, 1)
print("  ✓ función renderFacturas + helpers")

open(DASH, "w", encoding="utf-8").write(dash)


# ═══ Verificación ═══
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
    ('data-p="pFacturas"', "item sidebar"),
    ('id="pFacturas"', "página pFacturas"),
    ("if (id === 'pFacturas') renderFacturas()", "hook navTo"),
    ("function renderFacturas()", "función renderFacturas"),
    ("function filtrarFacturas()", "función filtrarFacturas"),
    ("btn-pdf-f", "botón PDF por factura"),
]
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH FASE C APLICADO Y VERIFICADO")
    print()
    print("  git add dashboard.html")
    print("  git commit -m 'feat(facturas): pantalla listado de facturas'")
    print("  git push origin main   (o rama de prueba)")
    print()
    print("En el dashboard aparecera 'Facturas' en el menu lateral:")
    print("  tabla completa + buscador + filtros tipo/mes + boton PDF por factura.")
else:
    print("⚠️  Algo falló. Revertir: git checkout dashboard.html")
    sys.exit(1)
