#!/usr/bin/env python3
"""
PATCH: Evitar facturas duplicadas
===================================
Si una reparación/venta YA tiene factura, al pulsar 📄 se muestra el PDF
de la factura existente en vez de emitir una nueva.

Comprueba origen_tipo + origen_id en la tabla facturas antes de abrir
el modal de emisión.

Solo toca factura.js.
"""

import sys
import os

FACT = "factura.js"

if not os.path.exists(FACT):
    print(f"❌ {FACT} no encontrado")
    sys.exit(1)

fact = open(FACT, "r", encoding="utf-8").read()

# Anchor: la función abrirModalFactura completa
A_ABRIR = """  window.abrirModalFactura = function(origen, datos) {
    if (!window.SUPABASE_URL || !window.SB_KEY || !window.TIENDA_ID) {
      _toast('Faltan credenciales. Recarga la página.', 'err');
      return;
    }

    _inyectarModal();

    FACT.origen = origen;
    FACT.datos = datos;
    FACT.tipo = 'simplificada';

    _renderOrigen();
    window.setTipoFactura('simplificada');

    document.getElementById('mFactura').style.display = 'flex';
  };"""

print("═══ VERIFICACIÓN PREVIA ═══")
n = fact.count(A_ABRIR)
print(f"  abrirModalFactura: {n} (esperado 1)")
if n != 1:
    print("  ❌ ABORTO: función no encontrada o ya modificada")
    sys.exit(1)

if "_mostrarModalEmision" in fact:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

print("✓ Verificación OK\n")

# Nueva versión
NUEVO = """  // Abre el modal de emisión (flujo de creación de factura)
  function _mostrarModalEmision(origen, datos) {
    _inyectarModal();

    FACT.origen = origen;
    FACT.datos = datos;
    FACT.tipo = 'simplificada';

    _renderOrigen();
    window.setTipoFactura('simplificada');

    document.getElementById('mFactura').style.display = 'flex';
  }

  window.abrirModalFactura = function(origen, datos) {
    if (!window.SUPABASE_URL || !window.SB_KEY || !window.TIENDA_ID) {
      _toast('Faltan credenciales. Recarga la página.', 'err');
      return;
    }

    // Si esta reparación/venta ya tiene factura, mostrar su PDF (no emitir otra)
    var oid = datos && datos.id;
    if (!oid) {
      _mostrarModalEmision(origen, datos);
      return;
    }

    var url = window.SUPABASE_URL + '/rest/v1/facturas' +
      '?tienda_id=eq.' + encodeURIComponent(window.TIENDA_ID) +
      '&origen_tipo=eq.' + encodeURIComponent(origen) +
      '&origen_id=eq.' + encodeURIComponent(oid) +
      '&select=*&limit=1';

    fetch(url, { headers: _supabaseHeaders() })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(arr) {
        if (Array.isArray(arr) && arr.length > 0) {
          // Ya existe factura para este origen → mostrar PDF, no emitir
          var existente = arr[0];
          _toast('Esta ' + (origen === 'reparacion' ? 'reparación' : 'venta') +
                 ' ya tiene factura (' + existente.numero + ')', 'ok');
          if (typeof window.generarFacturaPDF === 'function') {
            window.generarFacturaPDF(existente);
          }
        } else {
          // No tiene factura → abrir modal de emisión
          _mostrarModalEmision(origen, datos);
        }
      })
      .catch(function(e) {
        // Si la comprobación falla, no bloquear: abrir modal igualmente
        console.warn('[factura.js] no se pudo comprobar factura previa:', e);
        _mostrarModalEmision(origen, datos);
      });
  };"""

fact = fact.replace(A_ABRIR, NUEVO, 1)
open(FACT, "w", encoding="utf-8").write(fact)

print("═══ PATCH ═══")
print("  ✓ abrirModalFactura comprueba factura previa")
print("  ✓ _mostrarModalEmision separada")

# Verificar
final = open(FACT, "r", encoding="utf-8").read()
checks = [
    ("function _mostrarModalEmision", "función emisión separada"),
    ("ya tiene factura", "aviso de factura existente"),
    ("origen_id=eq.", "consulta por origen"),
    ("generarFacturaPDF(existente)", "muestra PDF de la existente"),
]
ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        ok = False

print()
if ok:
    print("🎉 PATCH APLICADO Y VERIFICADO")
    print()
    print("  node -c factura.js && echo OK")
    print()
    print("  git add factura.js")
    print("  git commit -m 'fix(facturas): evitar facturas duplicadas'")
    print("  git push origin test-fase-c   (o la rama actual)")
    print()
    print("Ahora: 1ª vez que pulsas 📄 -> emite factura.")
    print("       Siguientes veces -> solo muestra el PDF, sin duplicar.")
else:
    print("⚠️  Algo falló. git checkout factura.js")
    sys.exit(1)
