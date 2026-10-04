#!/usr/bin/env node
// ============================================================================
// Cuenta cuántas financiaciones tienen las CUOTAS MAL FECHADAS por el bug de
// setMonth() (arreglado el 4-oct-2026): las ventas/reparaciones hechas un día 29,
// 30 o 31 generaban dos cuotas el mismo día y se saltaban un mes entero.
//
// SOLO LEE. No escribe, no corrige nada. Al final dice qué habría que cambiar.
//
// USO:
//   export SUPABASE_URL="https://TUPROYECTO.supabase.co"
//   export SUPABASE_SERVICE_KEY="eyJ...."      # service_role (Project Settings → API)
//   node scripts/auditar-cuotas-fecha.mjs
//
//   Añade --detalle para ver una a una, y --sql para generar los UPDATE.
// ============================================================================

const URL_ = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !SK) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY.\nVer las instrucciones de arriba en este mismo fichero.');
  process.exit(1);
}
const DETALLE = process.argv.includes('--detalle');
const GEN_SQL = process.argv.includes('--sql');

async function tabla(nombre, campos) {
  const filas = [];
  let desde = 0;
  const PASO = 1000;
  for (;;) {
    const r = await fetch(`${URL_}/rest/v1/${nombre}?select=${campos}&financiado=eq.true`, {
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, Range: `${desde}-${desde + PASO - 1}` },
    });
    if (!r.ok) throw new Error(`${nombre}: ${r.status} ${await r.text()}`);
    const lote = await r.json();
    filas.push(...lote);
    if (lote.length < PASO) break;
    desde += PASO;
  }
  return filas;
}

const parseCuotas = (c) => {
  if (!c) return null;
  try { return typeof c === 'string' ? JSON.parse(c) : c; } catch { return null; }
};

// Un conjunto de cuotas está mal si repite fecha o si los meses no van seguidos.
function diagnostico(cuotas) {
  const fechas = cuotas.map(q => String(q.fecha || '')).filter(Boolean);
  if (fechas.length < 2) return null;
  const dup = new Set(fechas).size !== fechas.length;
  const meses = fechas.map(f => f.slice(0, 7));
  let salta = false;
  for (let i = 1; i < meses.length; i++) {
    const [ay, am] = meses[i - 1].split('-').map(Number);
    const [by, bm] = meses[i].split('-').map(Number);
    if ((by * 12 + bm) - (ay * 12 + am) !== 1) { salta = true; break; }
  }
  if (!dup && !salta) return null;
  return { dup, salta };
}

// Cómo deberían ser: el día de pago es el de la primera cuota (el que eligió la
// tienda), y a partir de ahí un mes tras otro desde el mes de la primera.
function corregidas(cuotas) {
  const prim = String(cuotas[0].fecha || '');
  if (!prim) return null;
  const [y, m, d] = prim.split('-').map(Number);
  const dia = d;
  return cuotas.map((q, i) => {
    const f = new Date(y, m - 1 + i, 1);
    const ultimo = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    f.setDate(Math.min(dia, ultimo));
    const ymd = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    return { ...q, fecha: ymd };
  });
}

const eur = (n) => (parseFloat(n) || 0).toFixed(2) + ' €';

(async () => {
  const fuentes = [
    { tabla: 'ventas', campos: 'id,fecha,cliente_nombre,cuotas,entrada,total', etiqueta: 'Ventas' },
    { tabla: 'reparaciones', campos: 'id,fecha,cliente_nombre,cuotas,entrada,total', etiqueta: 'Reparaciones' },
  ];

  let totalFin = 0, totalMal = 0, totalPendientesMal = 0, dineroAfectado = 0;
  const sql = [];

  for (const f of fuentes) {
    let filas;
    try { filas = await tabla(f.tabla, f.campos); }
    catch (e) { console.error(`\n⚠ No se pudo leer ${f.tabla}: ${e.message}`); continue; }

    let mal = 0, conPendientes = 0;
    console.log(`\n══ ${f.etiqueta}: ${filas.length} financiadas`);

    for (const row of filas) {
      const cuotas = parseCuotas(row.cuotas);
      if (!Array.isArray(cuotas) || !cuotas.length) continue;
      totalFin++;
      const d = diagnostico(cuotas);
      if (!d) continue;
      mal++; totalMal++;

      const pend = cuotas.filter(q => !q.pagado);
      if (pend.length) { conPendientes++; totalPendientesMal++; }
      dineroAfectado += pend.reduce((s, q) => s + (parseFloat(q.importe) || 0), 0);

      if (DETALLE) {
        console.log(`   · ${row.fecha}  ${String(row.cliente_nombre || '—').slice(0, 24).padEnd(24)} ` +
          `${cuotas.map(q => q.fecha + (q.pagado ? '✓' : '')).join(' ')}` +
          `   ${d.dup ? '[fechas repetidas]' : ''}${d.salta ? '[salta mes]' : ''}` +
          `   ${pend.length} sin cobrar`);
      }
      if (GEN_SQL) {
        const fix = corregidas(cuotas);
        if (fix) sql.push(`UPDATE ${f.tabla} SET cuotas = '${JSON.stringify(fix).replace(/'/g, "''")}'::jsonb WHERE id = '${row.id}';`);
      }
    }
    console.log(`   mal fechadas: ${mal}${mal ? `  ·  con cuotas aún sin cobrar: ${conPendientes}` : ''}`);
  }

  console.log('\n' + '─'.repeat(62));
  console.log(`Financiaciones revisadas:        ${totalFin}`);
  console.log(`Con cuotas mal fechadas:         ${totalMal}`);
  console.log(`  …de ellas, con cobros futuros: ${totalPendientesMal}`);
  console.log(`Importe pendiente afectado:      ${eur(dineroAfectado)}`);
  if (!totalMal) {
    console.log('\nNada que corregir: ninguna financiación cayó en el bug.');
  } else {
    console.log('\nLas ya cobradas dan igual (la fecha es historia). Lo que importa son');
    console.log('las que tienen cuotas por cobrar, porque el cliente espera un día y el');
    console.log('aviso le llegará otro.');
    if (!DETALLE) console.log('\nVuelve a ejecutarlo con --detalle para verlas una a una.');
    if (!GEN_SQL) console.log('Con --sql genera los UPDATE (revísalos antes de ejecutar nada).');
  }
  if (GEN_SQL && sql.length) {
    console.log('\n── SQL de corrección (NO ejecutado) ──');
    sql.forEach(s => console.log(s));
  }
})();
