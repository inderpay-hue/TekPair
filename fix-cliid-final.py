#!/usr/bin/env python3
"""
PATCH FINAL: arreglar bug datos fiscales + limpiar diagnóstico
================================================================
BUG: factRep usaba r.cliId pero mapRep produce r.clienteId.
     → nunca encontraba el cliente → guardado fiscal sin id → fallaba.

1. dashboard.html · factRep: r.cliId → r.clienteId + fallback robusto con id
2. factura.js · _guardarDatosFiscalesCliente: quitar alerts DIAG, versión limpia
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


# ─── Verificación ───
print("═══ VERIFICACIÓN PREVIA ═══")

for f in (DASH, FACT):
    if not os.path.exists(f):
        print(f"❌ {f} no encontrado")
        sys.exit(1)

dash = leer(DASH)
fact = leer(FACT)

# Anchor 1: la línea buggy de factRep
FACTREP_OLD = """  if (r.cliId) cli = DB.clis.find(function(c){ return c.id === r.cliId; });
  if (!cli && r.clienteNombre) cli = { nombre: r.clienteNombre, apellidos: '' };"""

n1 = dash.count(FACTREP_OLD)
print(f"  factRep línea buggy: {n1} (esperado 1)")
if n1 != 1:
    print("  ❌ ABORTO: no encontrado o duplicado")
    sys.exit(1)

# Anchor 2: la función diagnóstica de factura.js
INI = "  // ────────── Guardar datos fiscales en el cliente"
FIN = "  // ────────── Llamar función SQL siguiente_numero_factura ──────────"
idx_ini = fact.find(INI)
idx_fin = fact.find(FIN)
print(f"  factura.js func diag: ini={idx_ini} fin={idx_fin}")
if idx_ini == -1 or idx_fin == -1 or idx_ini >= idx_fin:
    print("  ❌ ABORTO: función no localizada")
    sys.exit(1)

print("✓ Verificación OK\n")

dash_body_antes = dash.count("</body>")
dash_html_antes = dash.count("</html>")


# ═══ CAMBIO 1: dashboard.html factRep ═══
print("═══ PATCH dashboard.html (factRep) ═══")

FACTREP_NEW = """  if (r.clienteId) cli = DB.clis.find(function(c){ return c.id === r.clienteId; });
  if (!cli && r.clienteId) cli = { id: r.clienteId, nombre: r.clienteNombre || '', apellidos: '' };
  if (!cli && r.clienteNombre) cli = { nombre: r.clienteNombre, apellidos: '' };"""

dash = dash.replace(FACTREP_OLD, FACTREP_NEW, 1)
print("  ✓ r.cliId → r.clienteId")
print("  ✓ fallback robusto con id añadido")
escribir(DASH, dash)


# ═══ CAMBIO 2: factura.js — versión limpia sin alerts ═══
print("\n═══ PATCH factura.js (limpiar diagnóstico) ═══")

FUNC_LIMPIA = '''  // ────────── Guardar datos fiscales en el cliente ──────────
  // Tras emitir, guarda los datos fiscales en la ficha del cliente
  // para que la próxima factura a ese cliente venga ya rellenada.
  function _guardarDatosFiscalesCliente() {
    var d = FACT.datos;
    if (!d.cliente || !d.cliente.id) return; // sin cliente vinculado, nada que guardar

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
      if (!r.ok) { console.warn('[factura.js] no se pudieron guardar datos fiscales'); return; }
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
      } catch (e) { /* no critico */ }
    }).catch(function(e) {
      console.warn('[factura.js] error guardando datos fiscales:', e);
    });
  }

'''

fact_nuevo = fact[:idx_ini] + FUNC_LIMPIA + fact[idx_fin:]
escribir(FACT, fact_nuevo)
print("  ✓ alerts DIAG eliminados")
print("  ✓ versión limpia restaurada")


# ═══ Verificación de integridad ═══
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
    (dash_final, "if (r.clienteId) cli = DB.clis.find", "factRep corregido"),
    (dash_final, "{ id: r.clienteId, nombre: r.clienteNombre", "fallback con id"),
    (fact_final, "_guardarDatosFiscalesCliente", "función presente"),
]
for contenido, needle, label in checks:
    if needle in contenido:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}")
        todo_ok = False

# alerts DIAG NO deben quedar
if "DIAG 4: voy a guardar" in fact_final or "alert('DIAG" in fact_final:
    print("  ✗ todavía hay alerts DIAG en factura.js")
    todo_ok = False
else:
    print("  ✓ sin alerts DIAG en factura.js")

# r.cliId NO debe quedar en factRep
if "r.cliId" in dash_final:
    # puede haber r.cliId en otras partes del dashboard (renderReps lo usa)
    # solo nos importa que factRep ya no lo use; informamos
    print("  ℹ nota: 'r.cliId' aún aparece en dashboard (otras funciones como renderReps); es normal")

print()
if todo_ok:
    print("🎉 PATCH FINAL APLICADO Y VERIFICADO")
    print()
    print("  node -c factura.js && echo OK")
    print()
    print("Subir a la rama de prueba:")
    print("  git add dashboard.html factura.js")
    print("  git commit -m 'fix(facturas): corregir cliId y guardar datos fiscales'")
    print("  git push origin test-datos-fiscales")
    print()
    print("Luego emite factura completa en la preview y verifica:")
    print("  - Test 1: emite con datos fiscales")
    print("  - Test 2: otra factura al mismo cliente -> datos precargados")
    print("  - SQL: SELECT nombre,nombre_fiscal FROM clientes WHERE nombre_fiscal IS NOT NULL;")
else:
    print("⚠️  Algo falló. Revertir: git checkout dashboard.html factura.js")
    sys.exit(1)
