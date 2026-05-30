#!/usr/bin/env python3
"""
fix-gastos-zip.py
=================
Refactor de la tarjeta "Informe para el gestor":
- Antes: 4 botones que generaban PDF directamente
- Después: 
    Fila 1: selector de periodo (Hoy / Mensual / Trimestral / Anual) con estado activo
    Fila 2: 2 botones de acción (📄 PDF informe) (📦 ZIP completo del periodo)

El ZIP incluye:
- Informe.pdf del periodo (HTML→print rasterizado NO; el informe se genera como HTML
  y se incluye como Informe.html con instrucciones para abrir/imprimir).
  ALTERNATIVA usada aquí: meter el HTML del informe como string en `Informe.html`
  y además exportarlo como archivo. El gestor lo abre en navegador.
- 1 archivo por factura con nombre: "YYYY-MM-DD_Concepto_NumFactura.ext"

JSZip se carga dinámicamente desde CDN solo cuando se pulsa el botón ZIP.

Uso:
    cd ~/Downloads/tekpair2
    python3 fix-gastos-zip.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "dashboard.html"

if not HTML.exists():
    print(f"ERROR: no se encuentra {HTML}")
    sys.exit(1)

raw = HTML.read_bytes()
text = raw.decode("utf-8", errors="surrogateescape")
size_before = len(raw)
print(f"[0/3] Leído dashboard.html ({size_before} bytes)")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 1: Reemplazar la tarjeta del informe con selector + 2 botones acción
# ─────────────────────────────────────────────────────────────────────────────
OLD_CARD = """  <div class="card" style="margin-bottom:14px;padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:700;font-size:15px">📄 Informe para el gestor</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Genera PDF con desglose IVA y categorías</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
      <button class="btn-sm" onclick="generarPDFGastos('hoy')" style="background:#F3F4F6;color:#111">📅 Hoy</button>
      <button class="btn-sm" onclick="generarPDFGastos('mes')" style="background:#F3F4F6;color:#111">📆 Mensual</button>
      <button class="btn-sm" onclick="generarPDFGastos('trimestre')" style="background:var(--red);color:white;font-weight:700">⭐ Trimestral</button>
      <button class="btn-sm" onclick="generarPDFGastos('anio')" style="background:#F3F4F6;color:#111">📊 Anual</button>
    </div>
  </div>"""

NEW_CARD = """  <div class="card" style="margin-bottom:14px;padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:700;font-size:15px">📄 Informe para el gestor</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Genera PDF o ZIP completo (informe + facturas adjuntas)</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Periodo</div>
    <div id="gPeriodoSel" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px">
      <button class="btn-sm gPeriodo" data-p="hoy" onclick="setGPeriodo('hoy')" style="background:#F3F4F6;color:#111">📅 Hoy</button>
      <button class="btn-sm gPeriodo" data-p="mes" onclick="setGPeriodo('mes')" style="background:#F3F4F6;color:#111">📆 Mensual</button>
      <button class="btn-sm gPeriodo" data-p="trimestre" onclick="setGPeriodo('trimestre')" style="background:var(--red);color:white;font-weight:700">⭐ Trimestral</button>
      <button class="btn-sm gPeriodo" data-p="anio" onclick="setGPeriodo('anio')" style="background:#F3F4F6;color:#111">📊 Anual</button>
    </div>
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Generar</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn-sm" onclick="generarPDFGastos(window.GPERIODO || 'trimestre')" style="background:#111;color:white">📄 PDF informe</button>
      <button class="btn-sm" onclick="generarZipGastos(window.GPERIODO || 'trimestre')" style="background:#0EA5E9;color:white">📦 ZIP completo</button>
    </div>
  </div>"""

if OLD_CARD not in text:
    print("ERROR P1: no encuentro la tarjeta Informe (post-Fase 1)")
    sys.exit(1)
text = text.replace(OLD_CARD, NEW_CARD, 1)
print("[1/3] Tarjeta Informe: selector de periodo + 2 botones acción (PDF / ZIP)")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 2: Insertar funciones JS para gestionar selector y ZIP
# Se insertan justo antes de "function generarPDFGastos" (anchor estable)
# ─────────────────────────────────────────────────────────────────────────────
ANCHOR = "function generarPDFGastos(periodo) {"

ZIP_FN = r"""// ═══ SELECTOR DE PERIODO Y GENERACIÓN ZIP (informe + facturas) ═══

window.GPERIODO = 'trimestre'; // periodo por defecto

function setGPeriodo(p) {
  window.GPERIODO = p;
  // Pinta el botón activo en rojo, el resto en gris
  document.querySelectorAll('.gPeriodo').forEach(function(b) {
    if (b.getAttribute('data-p') === p) {
      b.style.background = 'var(--red)';
      b.style.color = 'white';
      b.style.fontWeight = '700';
    } else {
      b.style.background = '#F3F4F6';
      b.style.color = '#111';
      b.style.fontWeight = '';
    }
  });
}

// Cargar JSZip dinámicamente solo cuando hace falta
function cargarJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = function() {
      if (window.JSZip) resolve(window.JSZip);
      else reject(new Error('JSZip no se cargó'));
    };
    s.onerror = function() { reject(new Error('No se pudo descargar JSZip')); };
    document.head.appendChild(s);
  });
}

// Calcula rango [ini, fin] + etiqueta legible para un periodo dado
function calcPeriodoGasto(periodo) {
  var hoy = new Date();
  var y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  if (periodo === 'hoy') {
    return { ini: new Date(y,m,d,0,0,0), fin: new Date(y,m,d,23,59,59), etiqueta: 'Hoy_' + y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0') };
  }
  if (periodo === 'mes') {
    return { ini: new Date(y,m,1,0,0,0), fin: new Date(y,m+1,0,23,59,59), etiqueta: 'Mes_' + y + '-' + String(m+1).padStart(2,'0') };
  }
  if (periodo === 'trimestre') {
    var q = Math.floor(m/3);
    var mIni = q*3, mFin = mIni+2;
    return { ini: new Date(y,mIni,1,0,0,0), fin: new Date(y,mFin+1,0,23,59,59), etiqueta: 'Q' + (q+1) + '_' + y };
  }
  if (periodo === 'anio') {
    return { ini: new Date(y,0,1,0,0,0), fin: new Date(y,11,31,23,59,59), etiqueta: 'Anio_' + y };
  }
  return null;
}

// Sanea un string para usarlo como parte de un nombre de archivo
function sanitizeFileName(s) {
  return String(s || '')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .substring(0, 80);
}

// Descarga un Blob al disco con un nombre dado
function descargarBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// Genera el HTML del informe (reutiliza la lógica de generarPDFGastos pero devuelve string)
function generarHtmlInforme(periodo) {
  // Replicamos cálculo de generarPDFGastos pero sin abrir ventana
  var rango = calcPeriodoGasto(periodo);
  if (!rango) return null;
  var ini = rango.ini, fin = rango.fin;
  var lista = (DB.gastos || []).filter(function(g) {
    if (!g.fecha) return false;
    var parts = String(g.fecha).split('-');
    if (parts.length < 3) return false;
    var gd = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10), 12, 0, 0);
    return gd >= ini && gd <= fin;
  });
  lista.sort(function(a,b){ return (a.fecha||'').localeCompare(b.fecha||''); });
  var totalBase=0, totalIva=0, totalTotal=0;
  var porCategoria = {};
  var porTipoIva = {0:{base:0,iva:0,total:0,n:0},4:{base:0,iva:0,total:0,n:0},10:{base:0,iva:0,total:0,n:0},21:{base:0,iva:0,total:0,n:0}};
  var detalle = lista.map(function(g){
    var imp = parseFloat(g.importe) || 0;
    var ivaT = (g.iva_tipo != null) ? parseInt(g.iva_tipo,10) : 21;
    if ([0,4,10,21].indexOf(ivaT) < 0) ivaT = 21;
    var base = ivaT === 0 ? imp : imp / (1 + ivaT/100);
    var ivaE = imp - base;
    var cat = g.categoria || 'Otros';
    totalBase += base; totalIva += ivaE; totalTotal += imp;
    if (!porCategoria[cat]) porCategoria[cat] = {base:0,iva:0,total:0,n:0};
    porCategoria[cat].base += base; porCategoria[cat].iva += ivaE; porCategoria[cat].total += imp; porCategoria[cat].n++;
    porTipoIva[ivaT].base += base; porTipoIva[ivaT].iva += ivaE; porTipoIva[ivaT].total += imp; porTipoIva[ivaT].n++;
    return {fecha:g.fecha, concepto:g.concepto||'', categoria:cat, ivaT:ivaT, base:base, ivaE:ivaE, total:imp, estado:g.estado||'Pagado', tieneAdj:!!g.adjunto_url};
  });
  var nTienda = (typeof TIENDA !== 'undefined' && TIENDA.nombre) ? TIENDA.nombre : 'TekPair';
  var dirTienda = (typeof TIENDA !== 'undefined' && TIENDA.direccion) ? TIENDA.direccion : '';
  var cifTienda = (typeof TIENDA !== 'undefined' && TIENDA.cif) ? TIENDA.cif : '';
  var emitido = new Date().toLocaleString('es');
  var etiqueta = rango.etiqueta.replace(/_/g, ' ');
  var filasDet = detalle.length ? detalle.map(function(r){
    return '<tr><td>'+r.fecha+'</td><td>'+esc(r.concepto)+'</td><td>'+esc(r.categoria)+'</td><td class="r">'+cur(r.base)+'</td><td class="r">'+r.ivaT+'%</td><td class="r">'+cur(r.ivaE)+'</td><td class="r b">'+cur(r.total)+'</td><td>'+r.estado+'</td><td style="text-align:center">'+(r.tieneAdj?'✓':'—')+'</td></tr>';
  }).join('') : '<tr><td colspan="9" style="text-align:center;color:#999;padding:20px">Sin gastos en el periodo</td></tr>';
  var filasCat = Object.keys(porCategoria).sort().map(function(k){
    var c = porCategoria[k];
    return '<tr><td>'+esc(k)+'</td><td class="r">'+c.n+'</td><td class="r">'+cur(c.base)+'</td><td class="r">'+cur(c.iva)+'</td><td class="r b">'+cur(c.total)+'</td></tr>';
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#999">-</td></tr>';
  var filasIva = [21,10,4,0].map(function(t){
    var v = porTipoIva[t];
    return '<tr><td>'+t+'%</td><td class="r">'+v.n+'</td><td class="r">'+cur(v.base)+'</td><td class="r">'+cur(v.iva)+'</td><td class="r b">'+cur(v.total)+'</td></tr>';
  }).join('');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Informe de gastos - '+etiqueta+'</title>' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111;font-size:12px}h1{font-size:20px;margin:0 0 4px 0}h2{font-size:14px;margin:18px 0 6px 0;border-bottom:2px solid #DC2626;padding-bottom:3px;color:#111}.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #DC2626;padding-bottom:10px;margin-bottom:14px}.tienda{font-weight:700;font-size:14px}.meta{font-size:11px;color:#555;text-align:right}table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #ddd;padding:6px 8px;font-size:11px;text-align:left}th{background:#F3F4F6;font-weight:700}.r{text-align:right}.b{font-weight:700}.kpi{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:10px 0}.kpi .c{border:1px solid #ddd;padding:10px;border-radius:6px;background:#FAFAFA}.kpi .l{font-size:10px;color:#666;text-transform:uppercase}.kpi .v{font-size:18px;font-weight:700;margin-top:4px}.firmas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:60px;font-size:11px}.firmas .f{border-top:1px solid #999;padding-top:6px;text-align:center}@media print{body{margin:12mm}h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}</style></head><body>' +
    '<div class="hd"><div><div class="tienda">'+esc(nTienda)+'</div>'+(dirTienda?'<div style="font-size:11px;color:#555">'+esc(dirTienda)+'</div>':'')+(cifTienda?'<div style="font-size:11px;color:#555">CIF/NIF: '+esc(cifTienda)+'</div>':'')+'</div><div class="meta">Emitido: '+emitido+'<br>Periodo: <b>'+esc(etiqueta)+'</b></div></div>' +
    '<h1>Informe de gastos para el gestor</h1>' +
    '<div style="color:#555;font-size:11px;margin-bottom:8px">Periodo: <b>'+esc(etiqueta)+'</b> · '+detalle.length+' gasto(s)</div>' +
    '<div class="kpi"><div class="c"><div class="l">Base imponible</div><div class="v">'+cur(totalBase)+'</div></div><div class="c"><div class="l">IVA soportado</div><div class="v">'+cur(totalIva)+'</div></div><div class="c"><div class="l">Total gastos</div><div class="v" style="color:#DC2626">'+cur(totalTotal)+'</div></div></div>' +
    '<h2>Detalle de gastos</h2><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="r">Base</th><th class="r">IVA%</th><th class="r">IVA €</th><th class="r">Total</th><th>Estado</th><th>Justif.</th></tr></thead><tbody>'+filasDet+'</tbody></table>' +
    '<h2>Resumen por categoría</h2><table><thead><tr><th>Categoría</th><th class="r">Nº</th><th class="r">Base</th><th class="r">IVA €</th><th class="r">Total</th></tr></thead><tbody>'+filasCat+'</tbody></table>' +
    '<h2>Resumen por tipo de IVA (modelo 303)</h2><table><thead><tr><th>Tipo</th><th class="r">Nº</th><th class="r">Base imponible</th><th class="r">Cuota IVA</th><th class="r">Total</th></tr></thead><tbody>'+filasIva+'<tr style="background:#FEE2E2"><td class="b">TOTAL</td><td class="r b">'+detalle.length+'</td><td class="r b">'+cur(totalBase)+'</td><td class="r b">'+cur(totalIva)+'</td><td class="r b">'+cur(totalTotal)+'</td></tr></tbody></table>' +
    '<div class="firmas"><div class="f">Firma y sello — Tienda</div><div class="f">Recibido — Gestor</div></div>' +
    '<div style="text-align:center;font-size:10px;color:#999;margin-top:30px;padding-top:10px;border-top:1px solid #eee">Generado por TekPair &middot; tekpair.tech</div>' +
    '</body></html>';
}

// Genera README.txt con resumen del periodo y lista de archivos
function generarReadmeGastos(periodo, lista, etiqueta) {
  var nTienda = (typeof TIENDA !== 'undefined' && TIENDA.nombre) ? TIENDA.nombre : 'TekPair';
  var cifTienda = (typeof TIENDA !== 'undefined' && TIENDA.cif) ? TIENDA.cif : '';
  var emitido = new Date().toLocaleString('es');
  var total = 0;
  lista.forEach(function(g){ total += parseFloat(g.importe) || 0; });
  var lines = [
    'GASTOS — ' + etiqueta,
    '='.repeat(60),
    '',
    'Tienda: ' + nTienda,
    cifTienda ? 'CIF/NIF: ' + cifTienda : '',
    'Generado: ' + emitido,
    'Periodo: ' + etiqueta,
    'Total gastos: ' + lista.length,
    'Importe total: ' + total.toFixed(2) + ' €',
    '',
    'CONTENIDO DE ESTE ZIP',
    '-'.repeat(60),
    '  Informe.html    → abrir en navegador para ver/imprimir el informe completo',
    '  README.txt      → este archivo',
    '  facturas/       → carpeta con un PDF/imagen por cada gasto con justificante',
    '',
    'GASTOS DEL PERIODO',
    '-'.repeat(60)
  ].filter(function(l){ return l !== ''; });
  lista.forEach(function(g, i) {
    var ivaT = (g.iva_tipo != null) ? g.iva_tipo : 21;
    lines.push(
      String(i+1).padStart(3,'0') + '. ' + (g.fecha || '????-??-??') + ' · ' +
      (parseFloat(g.importe) || 0).toFixed(2) + ' € (IVA ' + ivaT + '%) · ' +
      (g.categoria || 'Otros') + ' · ' +
      (g.concepto || 'sin concepto') +
      (g.proveedor_nombre ? ' [' + g.proveedor_nombre + ']' : '') +
      (g.numero_factura ? ' · Nº ' + g.numero_factura : '') +
      (g.adjunto_url ? ' · ADJUNTO ✓' : ' · sin adjunto')
    );
  });
  lines.push('');
  lines.push('Generado por TekPair · tekpair.tech');
  return lines.join('\n');
}

// Función principal: genera el ZIP con informe + README + facturas
async function generarZipGastos(periodo) {
  if (!tienePerm('gastos_ver')) { toast('Sin permiso', 'err'); return; }
  if (!SB_KEY || !TIENDA_ID) { toast('Sin conexión Supabase', 'err'); return; }
  toast('Preparando ZIP...', 'ok');
  try {
    var rango = calcPeriodoGasto(periodo);
    if (!rango) { toast('Periodo inválido', 'err'); return; }
    var etiqueta = rango.etiqueta.replace(/_/g, ' ');

    // Filtrar gastos del periodo
    var lista = (DB.gastos || []).filter(function(g) {
      if (!g.fecha) return false;
      var parts = String(g.fecha).split('-');
      if (parts.length < 3) return false;
      var gd = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10), 12, 0, 0);
      return gd >= rango.ini && gd <= rango.fin;
    });
    lista.sort(function(a,b){ return (a.fecha||'').localeCompare(b.fecha||''); });

    if (lista.length === 0) {
      toast('No hay gastos en este periodo', 'err');
      return;
    }

    var conAdj = lista.filter(function(g){ return !!g.adjunto_url; });
    if (conAdj.length === 0) {
      if (!confirm('Ningún gasto del periodo tiene factura adjunta. ¿Generar ZIP igualmente (solo con informe y README)?')) return;
    }

    var JSZipLib = await cargarJSZip();
    var zip = new JSZipLib();
    var htmlInforme = generarHtmlInforme(periodo);
    if (htmlInforme) zip.file('Informe.html', htmlInforme);
    zip.file('README.txt', generarReadmeGastos(periodo, lista, etiqueta));

    var facturasFolder = zip.folder('facturas');
    var bajados = 0, fallidos = 0;
    for (var i = 0; i < conAdj.length; i++) {
      var g = conAdj[i];
      try {
        var signed = await sbStorageSignedUrl('gastos-adjuntos', g.adjunto_url, 3600);
        if (!signed) { fallidos++; continue; }
        var resp = await fetch(signed);
        if (!resp.ok) { fallidos++; continue; }
        var blob = await resp.blob();
        var ext = (g.adjunto_url.split('.').pop() || 'bin').toLowerCase();
        var nombre = String(i+1).padStart(3,'0') + '_' +
          (g.fecha || 'sin-fecha') + '_' +
          sanitizeFileName(g.categoria || 'Otros') + '_' +
          sanitizeFileName(g.concepto || 'gasto') +
          (g.numero_factura ? '_' + sanitizeFileName(g.numero_factura) : '') +
          '.' + ext;
        facturasFolder.file(nombre, blob);
        bajados++;
      } catch (e) {
        console.warn('Fallo bajando adjunto', g.id, e);
        fallidos++;
      }
    }

    var zipName = 'Gastos_' + rango.etiqueta + '.zip';
    var zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    descargarBlob(zipBlob, zipName);

    var msg = 'ZIP generado: ' + bajados + ' factura(s)';
    if (fallidos > 0) msg += ' · ' + fallidos + ' fallido(s)';
    toast(msg, 'ok');
    try { if (typeof audit === 'function') audit('exportar', 'gastos_zip', {periodo: periodo, etiqueta: etiqueta, n_gastos: lista.length, n_facturas: bajados, fallidos: fallidos}); } catch(e){}
  } catch (e) {
    console.error('generarZipGastos:', e);
    toast('Error al generar ZIP: ' + (e.message || e), 'err');
  }
}

"""

if ANCHOR not in text:
    print("ERROR P2: no encuentro anchor generarPDFGastos")
    sys.exit(1)
if text.count(ANCHOR) != 1:
    print(f"ERROR P2: anchor aparece {text.count(ANCHOR)} veces, esperaba 1")
    sys.exit(1)
text = text.replace(ANCHOR, ZIP_FN + ANCHOR, 1)
print("[2/3] Funciones ZIP insertadas (setGPeriodo, calcPeriodoGasto, generarHtmlInforme, generarReadmeGastos, generarZipGastos)")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 3: Inicializar GPERIODO al cargar app (no estrictamente necesario,
#          el || 'trimestre' en onclick ya cubre, pero asegura UI consistente)
# ─────────────────────────────────────────────────────────────────────────────
# Lo metemos como script al final del body, similar a otros hooks
INIT_HOOK = """<script>
// Inicializar selector de periodo al cargar dashboard
window.addEventListener('DOMContentLoaded', function(){
  try {
    if (typeof setGPeriodo === 'function' && document.getElementById('gPeriodoSel')) {
      setGPeriodo(window.GPERIODO || 'trimestre');
    }
  } catch(e){}
});
</script>
</body>"""

if "</body>" not in text:
    print("ERROR P3: no encuentro </body>")
    sys.exit(1)
idx = text.rfind("</body>")
text = text[:idx] + INIT_HOOK[:-len("</body>")] + "</body>" + text[idx+len("</body>"):]
print("[3/3] Init hook insertado para activar Trimestral por defecto")

# ─────────────────────────────────────────────────────────────────────────────
new_raw = text.encode("utf-8", errors="surrogateescape")
HTML.write_bytes(new_raw)
size_after = len(new_raw)
delta = size_after - size_before
print(f"\nEscrito dashboard.html: {size_before} → {size_after} bytes ({'+' if delta >= 0 else ''}{delta})")

print("\nVerificación rápida:")
for needle in ["generarZipGastos", "setGPeriodo", "cargarJSZip", "generarHtmlInforme", "generarReadmeGastos",
               "gPeriodoSel", "window.GPERIODO", "📦 ZIP completo"]:
    n = new_raw.count(needle.encode("utf-8"))
    print(f"  {needle:25s} → {n} ocurrencia(s)")

print("\nOK. Recuerda commit + push, espera 45s Vercel, prueba en producción.")
