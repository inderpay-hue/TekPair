#!/usr/bin/env python3
"""
PATCH DIAGNÓSTICO v2: factura.js — usa alert() (popup bloqueante)
==================================================================
El toast desaparecía tapado por '✓ Factura emitida'. Ahora usa alert(),
un popup que se queda hasta que le des OK. Imposible no verlo.

Muestra: cliente.id, URL, status HTTP y cuerpo de la respuesta.
Solo toca factura.js.
"""

import sys
import os

FACT = "factura.js"

if not os.path.exists(FACT):
    print(f"❌ {FACT} no encontrado")
    sys.exit(1)

with open(FACT, "r", encoding="utf-8") as f:
    fact = f.read()

# Localizar la función actual (la versión diagnóstica con toasts)
INI = "  // ────────── Guardar datos fiscales en el cliente"
FIN = "  // ────────── Llamar función SQL siguiente_numero_factura ──────────"

idx_ini = fact.find(INI)
idx_fin = fact.find(FIN)

if idx_ini == -1 or idx_fin == -1 or idx_ini >= idx_fin:
    print(f"❌ No localizo la función. ini={idx_ini} fin={idx_fin}")
    sys.exit(1)

print("✓ Función localizada")

FUNC_NUEVA = '''  // ────────── Guardar datos fiscales en el cliente (DIAG con alert) ──────────
  function _guardarDatosFiscalesCliente() {
    var d = FACT.datos;

    if (!d.cliente) {
      alert('DIAG 1: la factura NO tiene objeto cliente. No se puede guardar.');
      return;
    }
    if (!d.cliente.id) {
      alert('DIAG 2: el cliente NO tiene id (campo id vacio). cliente=' + JSON.stringify(d.cliente).slice(0,200));
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
      alert('DIAG 3: no hay datos fiscales que guardar (formulario vacio).');
      return;
    }

    var url = window.SUPABASE_URL + '/rest/v1/clientes?id=eq.' + encodeURIComponent(d.cliente.id);

    alert('DIAG 4: voy a guardar.\\n\\ncliente.id = ' + d.cliente.id +
          '\\n\\nURL = ' + url +
          '\\n\\nbody = ' + JSON.stringify(body));

    fetch(url, {
      method: 'PATCH',
      headers: _supabaseHeaders(),
      body: JSON.stringify(body)
    }).then(function(r) {
      return r.text().then(function(txt) {
        alert('DIAG 5: respuesta del PATCH.\\n\\nstatus = ' + r.status +
              '\\n\\nrespuesta = ' + (txt || '(vacia)').slice(0, 400));
        if (r.ok) {
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
      alert('DIAG 6: EXCEPCION en el PATCH.\\n\\n' + (e && e.message ? e.message : e));
    });
  }

'''

fact_nuevo = fact[:idx_ini] + FUNC_NUEVA + fact[idx_fin:]

with open(FACT, "w", encoding="utf-8") as f:
    f.write(fact_nuevo)

print(f"📄 factura.js: {len(fact)} → {len(fact_nuevo)} ({len(fact_nuevo) - len(fact):+d})")

with open(FACT, "r", encoding="utf-8") as f:
    final = f.read()

checks = [
    ("DIAG 4: voy a guardar", "alert pre-PATCH"),
    ("DIAG 5: respuesta del PATCH", "alert respuesta"),
    ("DIAG 6: EXCEPCION", "alert excepción"),
]
ok = True
for needle, label in checks:
    if needle in final:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        ok = False

if ok:
    print("\n🎉 PATCH DIAGNÓSTICO v2 (alert) APLICADO")
    print("\n  node -c factura.js && echo OK")
    print("  git add factura.js")
    print("  git commit -m 'diag: alerts para guardado datos fiscales'")
    print("  git push origin test-datos-fiscales")
    print("\nLuego emite factura completa. Saldran POPUPS DIAG 4 y DIAG 5.")
    print("Copia el texto de ESOS DOS popups.")
else:
    print("\n⚠️  Falló. git checkout factura.js")
    sys.exit(1)
