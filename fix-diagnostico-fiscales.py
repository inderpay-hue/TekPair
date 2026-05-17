#!/usr/bin/env python3
"""
PATCH DIAGNÓSTICO: factura.js — guardado datos fiscales con feedback visible
=============================================================================
Reemplaza _guardarDatosFiscalesCliente con una versión que muestra TOASTS
en pantalla indicando exactamente qué pasa. Así diagnosticamos sin F12.

Solo toca factura.js (archivo independiente, riesgo bajo).
"""

import sys
import os

FACT = "factura.js"

if not os.path.exists(FACT):
    print(f"❌ {FACT} no encontrado")
    sys.exit(1)

with open(FACT, "r", encoding="utf-8") as f:
    fact = f.read()

# La función actual (tal como la dejó el patch anterior)
FUNC_VIEJA_INICIO = "  // ────────── Guardar datos fiscales en el cliente ──────────"
FUNC_VIEJA_FIN = "  // ────────── Llamar función SQL siguiente_numero_factura ──────────"

idx_ini = fact.find(FUNC_VIEJA_INICIO)
idx_fin = fact.find(FUNC_VIEJA_FIN)

if idx_ini == -1 or idx_fin == -1:
    print("❌ No encuentro la función _guardarDatosFiscalesCliente.")
    print(f"   inicio: {idx_ini}, fin: {idx_fin}")
    sys.exit(1)

if idx_ini >= idx_fin:
    print("❌ Marcadores en orden incorrecto")
    sys.exit(1)

print("✓ Función localizada")

# Nueva función con diagnóstico visible
FUNC_NUEVA = '''  // ────────── Guardar datos fiscales en el cliente (CON DIAGNÓSTICO) ──────────
  function _guardarDatosFiscalesCliente() {
    var d = FACT.datos;

    // Diagnóstico 1: ¿hay cliente?
    if (!d.cliente) {
      _toast('DIAG: no hay objeto cliente en la factura', 'err');
      return;
    }
    if (!d.cliente.id) {
      _toast('DIAG: el cliente no tiene id (no vinculado)', 'err');
      return;
    }

    var body = {};
    if (FACT.tipo === 'completa') {
      body.nombre_fiscal = ((document.getElementById('factCliNomFiscal') || {}).value || '').trim();
      body.dir_fiscal = ((document.getElementById('factCliDir') || {}).value || '').trim();
      body.cp = ((document.getElementById('factCliCp') || {}).value || '').trim();
      body.ciudad = ((document.getElementById('factCliCiudad') || {}).value || '').trim();
      body.provincia = ((document.getElementById('factCliProv') || {}).value || '').trim();
    }
    var nif = ((document.getElementById('factCliNif') || {}).value || '').trim();
    if (nif) body.dni = nif;

    if (Object.keys(body).length === 0) {
      _toast('DIAG: no hay datos fiscales que guardar (body vacio)', 'err');
      return;
    }

    _toast('DIAG: guardando en cliente id=' + d.cliente.id, 'ok');

    var url = window.SUPABASE_URL + '/rest/v1/clientes?id=eq.' + encodeURIComponent(d.cliente.id);

    fetch(url, {
      method: 'PATCH',
      headers: _supabaseHeaders(),
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(txt) {
          _toast('DIAG: PATCH fallo ' + r.status + ': ' + (txt || '').slice(0, 120), 'err');
        });
      }
      return r.json().then(function(arr) {
        if (Array.isArray(arr) && arr.length === 0) {
          _toast('DIAG: PATCH ok pero 0 filas (id no coincide?)', 'err');
        } else {
          _toast('DIAG: datos fiscales guardados OK', 'ok');
          // Actualizar el cliente en memoria
          try {
            if (window.DB && Array.isArray(window.DB.clis)) {
              var cli = window.DB.clis.find(function(c){ return c.id === d.cliente.id; });
              if (cli) {
                if (body.nombre_fiscal != null) cli.nombreFiscal = body.nombre_fiscal;
                if (body.dir_fiscal != null) cli.dirFiscal = body.dir_fiscal;
                if (body.cp != null) cli.cp = body.cp;
                if (body.ciudad != null) cli.ciudad = body.ciudad;
                if (body.provincia != null) cli.provincia = body.provincia;
                if (body.dni != null) cli.dni = body.dni;
              }
            }
          } catch (e) { /* no critico */ }
        }
      });
    }).catch(function(e) {
      _toast('DIAG: excepcion PATCH: ' + (e && e.message ? e.message : e), 'err');
    });
  }

'''

fact_nuevo = fact[:idx_ini] + FUNC_NUEVA + fact[idx_fin:]

with open(FACT, "w", encoding="utf-8") as f:
    f.write(fact_nuevo)

print(f"📄 factura.js: {len(fact)} → {len(fact_nuevo)} ({len(fact_nuevo) - len(fact):+d})")

# Verificar
with open(FACT, "r", encoding="utf-8") as f:
    final = f.read()

checks = [
    ("DIAG: guardando en cliente", "toast de inicio"),
    ("DIAG: PATCH fallo", "toast de error PATCH"),
    ("DIAG: datos fiscales guardados OK", "toast de éxito"),
    ("DIAG: PATCH ok pero 0 filas", "toast de 0 filas"),
]
ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        ok = False

if ok:
    print("\n🎉 PATCH DIAGNÓSTICO APLICADO")
    print("\nVerifica sintaxis:")
    print("  node -c factura.js && echo OK")
    print("\nLuego sube a la rama de prueba:")
    print("  git add factura.js")
    print("  git commit -m 'diag: feedback visible guardado datos fiscales'")
    print("  git push origin test-datos-fiscales")
    print("\nDespués emite una factura completa en la preview.")
    print("Los toast DIAG te diran exactamente que pasa.")
else:
    print("\n⚠️  Algo falló. Revertir: git checkout factura.js")
    sys.exit(1)
