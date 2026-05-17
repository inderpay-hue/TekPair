#!/usr/bin/env python3
"""
PATCH: Guardar datos fiscales en el cliente al emitir factura
===============================================================
1. dashboard.html · mapCli: mapea los campos fiscales (para precargarlos)
2. factura.js · al emitir factura, guarda los datos fiscales en el cliente
   (PATCH a tabla clientes) para que la próxima factura ya venga rellenada.

Verifica cada anchor antes de tocar. Aborta si algo no es único.
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


# ─── Verificación previa ───
print("═══ VERIFICACIÓN PREVIA ═══")

for f in (DASH, FACT):
    if not os.path.exists(f):
        print(f"❌ {f} no encontrado")
        sys.exit(1)

dash = leer(DASH)
fact = leer(FACT)

# Anchors
MAPCLI_OLD = """  return {id:c.id, nombre:c.nombre||'', apellidos:c.apellidos||'', tel:c.tel||'', email:c.email||'', dni:c.dni||'', fechaNac:c.fecha_nac||''};"""

FACT_THEN = """      }).then(function(facturas) {
        var f = Array.isArray(facturas) ? facturas[0] : facturas;
        _toast('✓ Factura ' + f.numero + ' emitida', 'ok');
        window.cerrarModalFactura();
        // Fase 3: aquí se llamará al PDF
      });"""

FACT_OBTENER = """  // ────────── Llamar función SQL siguiente_numero_factura ──────────
  function _obtenerSiguienteNumero() {"""

ok = True
ok &= check(dash, MAPCLI_OLD, "dashboard mapCli return")
ok &= check(fact, FACT_THEN, "factura.js .then tras INSERT")
ok &= check(fact, FACT_OBTENER, "factura.js antes de _obtenerSiguienteNumero")

if "nombreFiscal" in dash and "_guardarDatosFiscalesCliente" in fact:
    print("  ⚠️  Patch ya aplicado. Sin cambios.")
    sys.exit(0)

if not ok:
    print("\n❌ Verificación fallida. NO se ha tocado nada.")
    sys.exit(1)

print("✓ Verificación OK\n")

dash_body_antes = dash.count("</body>")
dash_html_antes = dash.count("</html>")


# ═══ CAMBIO 1: dashboard.html mapCli ═══
print("═══ PATCH dashboard.html ═══")

MAPCLI_NEW = """  return {id:c.id, nombre:c.nombre||'', apellidos:c.apellidos||'', tel:c.tel||'', email:c.email||'', dni:c.dni||'', fechaNac:c.fecha_nac||'', nombreFiscal:c.nombre_fiscal||'', dirFiscal:c.dir_fiscal||'', cp:c.cp||'', provincia:c.provincia||'', ciudad:c.ciudad||''};"""

dash = dash.replace(MAPCLI_OLD, MAPCLI_NEW, 1)
print("  ✓ mapCli ahora mapea campos fiscales")
escribir(DASH, dash)


# ═══ CAMBIO 2: factura.js ═══
print("\n═══ PATCH factura.js ═══")

# 2a. Añadir función _guardarDatosFiscalesCliente antes de _obtenerSiguienteNumero
FUNC_GUARDAR = """  // ────────── Guardar datos fiscales en el cliente ──────────
  // Tras emitir, guarda los datos fiscales en la ficha del cliente
  // para que la próxima factura a ese cliente venga ya rellenada.
  function _guardarDatosFiscalesCliente() {
    var d = FACT.datos;
    if (!d.cliente || !d.cliente.id) return; // sin cliente asignado, nada que guardar
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
    if (Object.keys(body).length === 0) return;
    fetch(window.SUPABASE_URL + '/rest/v1/clientes?id=eq.' + encodeURIComponent(d.cliente.id), {
      method: 'PATCH',
      headers: _supabaseHeaders(),
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) { console.warn('[factura.js] no se pudieron guardar datos fiscales del cliente'); return; }
      // Actualizar el cliente en memoria para esta sesión
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
      } catch (e) { /* no crítico */ }
    }).catch(function(e) {
      console.warn('[factura.js] error guardando datos fiscales:', e);
    });
  }

"""

fact = fact.replace(FACT_OBTENER, FUNC_GUARDAR + FACT_OBTENER, 1)
print("  ✓ función _guardarDatosFiscalesCliente añadida")

# 2b. Llamar la función tras emitir
FACT_THEN_NEW = """      }).then(function(facturas) {
        var f = Array.isArray(facturas) ? facturas[0] : facturas;
        _guardarDatosFiscalesCliente();
        _toast('✓ Factura ' + f.numero + ' emitida', 'ok');
        window.cerrarModalFactura();
        // Fase 3: aquí se llamará al PDF
      });"""

fact = fact.replace(FACT_THEN, FACT_THEN_NEW, 1)
print("  ✓ llamada a _guardarDatosFiscalesCliente tras emitir")

escribir(FACT, fact)


# ═══ Verificación de integridad ═══
print("\n═══ VERIFICACIÓN DE INTEGRIDAD ═══")

dash_final = leer(DASH)
fact_final = leer(FACT)

checks_int = [
    ("</body> en dashboard", dash_body_antes, dash_final.count("</body>")),
    ("</html> en dashboard", dash_html_antes, dash_final.count("</html>")),
]
todo_ok = True
for nombre, antes, despues in checks_int:
    estado = "✓" if antes == despues else "✗ ROTO"
    if antes != despues:
        todo_ok = False
    print(f"  {nombre}: {antes} → {despues} {estado}")

checks_cont = [
    (dash_final, "nombreFiscal:c.nombre_fiscal", "mapCli fiscal en dashboard"),
    (fact_final, "_guardarDatosFiscalesCliente", "función en factura.js"),
    (fact_final, "_guardarDatosFiscalesCliente();", "llamada en factura.js"),
]
for contenido, needle, label in checks_cont:
    if needle in contenido:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

# JS válido
print()
if todo_ok:
    print("🎉 PATCH APLICADO Y VERIFICADO")
    print()
    print("Verifica sintaxis JS de factura.js:")
    print("  node -c factura.js && echo OK")
    print()
    print("Luego deploy preview para probar:")
    print("  git checkout -b test-datos-fiscales")
    print("  git add dashboard.html factura.js")
    print("  git commit -m 'feat(facturas): guardar datos fiscales en cliente'")
    print("  git push origin test-datos-fiscales")
else:
    print("⚠️  INTEGRIDAD FALLIDA. Revertir:")
    print("  git checkout dashboard.html factura.js")
    sys.exit(1)
