#!/usr/bin/env python3
"""
PATCH FASE D-1: factura.js — facturas rectificativas (abonos)
===============================================================
1. _obtenerSiguienteNumero acepta nº de serie (serie 2 = abonos R-XXXX)
2. window.emitirAbonoFactura(facturaOriginal): crea el abono (importes negativos)
3. generarFacturaPDF soporta abonos (título + referencia a la original)

Requiere ANTES (ya hecho):
  ALTER TABLE facturas ADD COLUMN rectifica_a UUID;
  ALTER TABLE facturas ADD COLUMN rectifica_numero TEXT;
"""

import sys
import os

FACT = "factura.js"

if not os.path.exists(FACT):
    print(f"❌ {FACT} no encontrado")
    sys.exit(1)

fact = open(FACT, "r", encoding="utf-8").read()


def check(anchor, nombre):
    n = fact.count(anchor)
    if n != 1:
        print(f"  ❌ ABORTO: '{nombre}' aparece {n} veces (esperado 1)")
        return False
    print(f"  ✓ '{nombre}' único")
    return True


print("═══ VERIFICACIÓN PREVIA ═══")

A_FUNC_NUM = "  function _obtenerSiguienteNumero() {"
A_PSERIE = "        p_serie: 1"
A_TITULO = "    var tituloDoc = esSimplificada ? 'FACTURA SIMPLIFICADA' : 'FACTURA';"
A_FECHA = """          '<div class="fecha">Fecha: ' + _esc(fechaTxt) + '</div>' +"""
A_CSS_FECHA = "      '.doc-meta .fecha { font-size:12px; color:#666; margin-top:4px; }' +"
A_CONSOLE = "  console.log('[factura.js] módulo cargado');"

ok = True
ok &= check(A_FUNC_NUM, "_obtenerSiguienteNumero")
ok &= check(A_PSERIE, "p_serie")
ok &= check(A_TITULO, "tituloDoc")
ok &= check(A_FECHA, "cabecera fecha")
ok &= check(A_CSS_FECHA, "CSS fecha")
ok &= check(A_CONSOLE, "console.log final")

if "emitirAbonoFactura" in fact:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. Nada modificado.")
    sys.exit(1)

print("✓ Verificación OK\n")

print("═══ PATCHES ═══")

# ─── A: _obtenerSiguienteNumero acepta serie ───
fact = fact.replace(A_FUNC_NUM, "  function _obtenerSiguienteNumero(serie) {", 1)
fact = fact.replace(A_PSERIE, "        p_serie: serie || 1", 1)
print("  ✓ _obtenerSiguienteNumero acepta nº de serie")

# ─── B: tituloDoc considera abono ───
fact = fact.replace(
    A_TITULO,
    """    var esAbono = !!f.rectifica_a;
    var tituloDoc = esAbono ? 'FACTURA RECTIFICATIVA (ABONO)' : (esSimplificada ? 'FACTURA SIMPLIFICADA' : 'FACTURA');""",
    1
)
print("  ✓ título del PDF soporta abono")

# ─── C: cabecera muestra referencia ───
fact = fact.replace(
    A_FECHA,
    A_FECHA + """
          (esAbono && f.rectifica_numero ? '<div class="rectif">Rectifica a: ' + _esc(f.rectifica_numero) + '</div>' : '') +""",
    1
)
print("  ✓ cabecera muestra factura rectificada")

# ─── D: CSS .rectif ───
fact = fact.replace(
    A_CSS_FECHA,
    A_CSS_FECHA + "\n      '.doc-meta .rectif { font-size:11px; color:#dc2626; font-weight:600; margin-top:3px; }' +",
    1
)
print("  ✓ CSS de .rectif")

# ─── E: función emitirAbonoFactura ───
FUNC_ABONO = r'''  // ────────── Emitir factura rectificativa (abono) ──────────
  window.emitirAbonoFactura = function(orig) {
    if (!orig || !orig.id) { _toast('Factura original no válida', 'err'); return; }
    if (orig.rectifica_a) { _toast('Esto ya es un abono, no se puede abonar', 'err'); return; }

    _obtenerSiguienteNumero(2).then(function(numInfo) {
      // Líneas con importes negativos
      var lineasNeg = (orig.lineas || []).map(function(l) {
        return {
          desc: l.desc || l.nombre || '-',
          cantidad: parseFloat(l.cantidad) || 1,
          precio: -(parseFloat(l.precio) || 0),
          total: -(parseFloat(l.total) || 0)
        };
      });

      var payload = {
        tienda_id: window.TIENDA_ID,
        numero: numInfo.numero,
        serie: 2,
        secuencia: numInfo.secuencia,
        fecha_emision: new Date().toISOString().slice(0, 10),
        tipo: orig.tipo || 'completa',
        origen_tipo: orig.origen_tipo || null,
        origen_id: orig.origen_id || null,
        cliente_id: orig.cliente_id || null,
        cliente_snapshot: orig.cliente_snapshot || {},
        emisor_snapshot: orig.emisor_snapshot || {},
        origen_detalle: orig.origen_detalle || null,
        lineas: lineasNeg,
        base_imponible: -(parseFloat(orig.base_imponible) || 0),
        iva_pct: parseFloat(orig.iva_pct) || 0,
        iva_importe: -(parseFloat(orig.iva_importe) || 0),
        total: -(parseFloat(orig.total) || 0),
        metodo_pago: orig.metodo_pago || '',
        rectifica_a: orig.id,
        rectifica_numero: orig.numero || '',
        estado: 'emitida'
      };

      return fetch(window.SUPABASE_URL + '/rest/v1/facturas', {
        method: 'POST',
        headers: _supabaseHeaders(),
        body: JSON.stringify(payload)
      }).then(function(r) {
        if (!r.ok) {
          return r.json().then(function(err) {
            throw new Error('INSERT abono ' + r.status + ': ' + JSON.stringify(err));
          });
        }
        return r.json();
      }).then(function(arr) {
        var ab = Array.isArray(arr) ? arr[0] : arr;
        _toast('✓ Abono ' + ab.numero + ' generado', 'ok');
        if (typeof window.generarFacturaPDF === 'function') {
          window.generarFacturaPDF(ab);
        }
      });
    }).catch(function(err) {
      console.error('Error generando abono:', err);
      _toast('Error generando abono: ' + err.message, 'err');
    });
  };

'''

fact = fact.replace(A_CONSOLE, FUNC_ABONO + A_CONSOLE, 1)
print("  ✓ función emitirAbonoFactura añadida")

open(FACT, "w", encoding="utf-8").write(fact)


# ─── Verificación ───
print("\n═══ VERIFICACIÓN ═══")

final = open(FACT, "r", encoding="utf-8").read()
checks = [
    ("function _obtenerSiguienteNumero(serie)", "serie parametrizada"),
    ("p_serie: serie || 1", "p_serie dinámico"),
    ("var esAbono = !!f.rectifica_a", "detección de abono"),
    ("FACTURA RECTIFICATIVA (ABONO)", "título abono"),
    ("window.emitirAbonoFactura = function", "función emitirAbonoFactura"),
    ("rectifica_a: orig.id", "enlace al original"),
]
todo_ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

print()
if todo_ok:
    print("🎉 PATCH FASE D-1 APLICADO")
    print()
    print("  node -c factura.js && echo OK")
    print()
    print("Sigue el PATCH 2 (dashboard.html): hook en cambiarEstado + listado.")
    print("NO subas todavía — espera el patch 2.")
else:
    print("⚠️  Algo falló. git checkout factura.js")
    sys.exit(1)
