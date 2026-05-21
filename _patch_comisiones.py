import sys
FILE = "api/comisiones.js"
src = open(FILE, "r", encoding="utf-8").read()

print("=== Patch backend: detalle tiendas referidas ===")

if "tiendasDetalle" in src:
    print("YA APLICADO. Salgo.")
    sys.exit(0)

A1 = """      const allPagosR = await fetch(`${SUPABASE_URL}/rest/v1/pagos_referidos?order=created_at.desc&select=*`, {
        headers: sbHeaders
      });
      const allPagos = await allPagosR.json();"""

if src.count(A1) != 1:
    print("ERROR: anchor 1 no unico:", src.count(A1))
    sys.exit(1)

N1 = A1 + """

      const tiendaIdsConRef = [...new Set(allPagos.map(p => p.tienda_id).filter(Boolean))];
      let tiendasDetalle = {};
      if (tiendaIdsConRef.length) {
        const tIdsStr = tiendaIdsConRef.map(id => '"' + id + '"').join(',');
        const tDetailR = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=in.(${encodeURIComponent(tIdsStr)})&select=id,nombre,plan,plan_status,creado_en,codigo_referido`, { headers: sbHeaders });
        const tDetailArr = await tDetailR.json();
        for (const t of (Array.isArray(tDetailArr) ? tDetailArr : [])) tiendasDetalle[t.id] = t;
      }"""

src = src.replace(A1, N1, 1)
print("OK 1: query tiendasDetalle")

A2 = """      const referidosPorCodigo = {};
      for (const p of allPagos) {
        const codigo = p.codigo_referido;
        if (!codigo) continue;
        if (!referidosPorCodigo[codigo]) referidosPorCodigo[codigo] = new Set();
        referidosPorCodigo[codigo].add(p.tienda_id);
      }"""

if src.count(A2) != 1:
    print("ERROR: anchor 2 no unico")
    sys.exit(1)

N2 = A2 + """

      const tiendasPorCodigo = {};
      for (const codigo of Object.keys(referidosPorCodigo)) {
        const tiendaIds = [...referidosPorCodigo[codigo]];
        tiendasPorCodigo[codigo] = tiendaIds.map(tid => {
          const det = tiendasDetalle[tid] || {};
          const facturado = allPagos.filter(p => p.tienda_id === tid && p.codigo_referido === codigo).reduce((s, p) => s + parseFloat(p.monto_neto || 0), 0);
          return {
            tienda_id: tid,
            nombre: det.nombre || 'Tienda sin nombre',
            plan: det.plan || '-',
            plan_status: det.plan_status || '-',
            fecha_captacion: det.creado_en || null,
            total_facturado: +facturado.toFixed(2)
          };
        });
      }"""

src = src.replace(A2, N2, 1)
print("OK 2: agrupacion tiendasPorCodigo")

open(FILE, "w", encoding="utf-8").write(src)
print("")
print("ARCHIVO GUARDADO. Ahora necesito ver donde esta el map de afiliados.")
print("Ejecuta:")
print("  sed -n '150,210p' api/comisiones.js")
