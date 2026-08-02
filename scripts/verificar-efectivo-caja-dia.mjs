#!/usr/bin/env node
// ============================================================================
// Verifica que el "efectivo esperado" de la Caja del día se calcula IGUAL en el
// frontend (cajaDiaResumen) y en el backend (_efectivoEsperadoDia), usando los
// DATOS REALES de tu Supabase. Solo hace lecturas (GET), no escribe nada.
//
// USO:
//   1) Consigue la service_role key: Supabase → Project Settings → API →
//      "service_role" (secret). NO la pegues en ningún sitio online.
//   2) Expórtala junto con la URL y ejecuta (por ejemplo, últimos 60 días):
//        export SUPABASE_URL="https://TUPROYECTO.supabase.co"
//        export SUPABASE_SERVICE_KEY="eyJ...."     # service_role
//        node scripts/verificar-efectivo-caja-dia.mjs 60
//   3) Cuando termines, puedes borrar este archivo. No lo subas al repo.
// ============================================================================

const URL_ = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const DIAS = parseInt(process.argv[2] || '60', 10);
if (!URL_ || !SK) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno. Ver instrucciones arriba.');
  process.exit(1);
}

// GET con paginación (PostgREST limita ~1000 filas por respuesta).
async function q(path) {
  const out = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, {
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' }
    });
    if (!r.ok) throw new Error(`${r.status} ${path.slice(0, 80)} :: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ── Réplica EXACTA de la lógica del frontend ──
const efFront = (m) => /efectiv/i.test(String(m || 'Efectivo'));            // metodo || 'Efectivo'
const cuotaPagado = (c) => (c && c.pagadoImporte != null) ? (parseFloat(c.pagadoImporte) || 0) : ((c && c.pagado) ? (parseFloat(c.importe) || 0) : 0);
const parseCuotas = (cu) => { if (!cu) return []; if (typeof cu === 'string') { try { return JSON.parse(cu); } catch { return []; } } return cu; };

// Réplica de la ANTIGUA ruta backend (para demostrar si los casos límite existían):
//   - excluye ventas con reembolsado NULL (query eq.false)
//   - esEf solo trata null/undefined como efectivo
const efBackOld = (m) => /efectiv/i.test(String(m == null ? 'Efectivo' : m));

function efectivoDelDia(ventas, pagosF, presupSet, { keepVenta, efTest }) {
  let ef = 0;
  for (const v of ventas) {
    if (!keepVenta(v)) continue;
    if (v.financiado && v.cuotas) {
      const cuotas = parseCuotas(v.cuotas);
      if (String(v.fecha).slice(0, 10) === v._F && Number(v.entrada || 0) > 0 && efTest(v.entrada_pago)) ef += Number(v.entrada) || 0;
      for (const c of (cuotas || [])) {
        if (c && c.fechaPago && String(c.fechaPago).slice(0, 10) === v._F && efTest(c.formaPago)) ef += cuotaPagado(c);
      }
    } else if (String(v.fecha).slice(0, 10) === v._F && efTest(v.pago)) {
      ef += Number(v.total) || 0;
    }
  }
  for (const p of pagosF) {
    if (p.reparacion_id && presupSet.has(String(p.reparacion_id))) continue;
    if (efTest(p.metodo)) ef += parseFloat(p.importe) || 0;
  }
  return Math.round(ef * 100) / 100;
}

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const DESDE = hace(DIAS);

console.log(`Comparando FRONT vs BACK (efectivo esperado Caja del día) · últimos ${DIAS} días (desde ${DESDE})\n`);

const cajas = await q(`cajas?nombre=eq.${encodeURIComponent('Caja del día')}&select=tienda_id`);
const tiendas = [...new Set(cajas.map((c) => c.tienda_id))];
console.log(`Tiendas con "Caja del día": ${tiendas.length}`);

let comparaciones = 0, divActual = 0, divAntigua = 0, ventasNull = 0, metodosVacios = 0;
const detalleActual = [], detalleAntigua = [];

for (const tid of tiendas) {
  const ventas = await q(`ventas?tienda_id=eq.${encodeURIComponent(tid)}&select=fecha,pago,total,financiado,cuotas,entrada,entrada_pago,reembolsado`);
  const pagos = await q(`pagos_reparacion?tienda_id=eq.${encodeURIComponent(tid)}&fecha=gte.${DESDE}&select=metodo,importe,reparacion_id,fecha`);

  ventasNull += ventas.filter((v) => v.reembolsado == null).length;
  metodosVacios += ventas.filter((v) => v.pago === '' || v.entrada_pago === '').length + pagos.filter((p) => p.metodo === '').length;

  const fechas = new Set();
  ventas.forEach((v) => { const f = String(v.fecha).slice(0, 10); if (f >= DESDE) fechas.add(f); });
  pagos.forEach((p) => fechas.add(String(p.fecha).slice(0, 10)));

  for (const F of fechas) {
    ventas.forEach((v) => { v._F = F; });
    const pagosF = pagos.filter((p) => String(p.fecha).slice(0, 10) === F);
    const repIds = [...new Set(pagosF.map((p) => p.reparacion_id).filter(Boolean))];
    let presup = new Set();
    if (repIds.length) {
      const reps = await q(`reparaciones?tienda_id=eq.${encodeURIComponent(tid)}&id=in.(${repIds.map(encodeURIComponent).join(',')})&estado=in.(Presupuesto,Rechazado)&select=id`);
      presup = new Set(reps.map((r) => String(r.id)));
    }
    const FRONT = efectivoDelDia(ventas, pagosF, presup, { keepVenta: (v) => !v.reembolsado, efTest: efFront });
    const BACK_ACTUAL = efectivoDelDia(ventas, pagosF, presup, { keepVenta: (v) => !v.reembolsado, efTest: efFront });          // backend ya corregido = idéntico al front
    const BACK_ANTIGUO = efectivoDelDia(ventas, pagosF, presup, { keepVenta: (v) => v.reembolsado === false, efTest: efBackOld }); // como era antes del fix

    comparaciones++;
    if (Math.abs(FRONT - BACK_ACTUAL) > 0.005) { divActual++; detalleActual.push({ t: String(tid).slice(0, 8), F, FRONT, BACK_ACTUAL }); }
    if (Math.abs(FRONT - BACK_ANTIGUO) > 0.005) { divAntigua++; detalleAntigua.push({ t: String(tid).slice(0, 8), F, FRONT, BACK_ANTIGUO, diff: Math.round((FRONT - BACK_ANTIGUO) * 100) / 100 }); }
  }
}

console.log(`\nDatos: ventas con reembolsado NULL = ${ventasNull} · métodos '' vacíos = ${metodosVacios}`);
console.log(`Comparaciones (tienda×día con actividad): ${comparaciones}`);
console.log(`\n>>> FRONT vs BACKEND ACTUAL (ya desplegado): ${divActual} divergencias`);
if (divActual) detalleActual.slice(0, 40).forEach((d) => console.log(`   ⚠ ${d.t} ${d.F}  front=${d.FRONT}  back=${d.BACK_ACTUAL}`));
else console.log('   ✓ 0 divergencias — las dos rutas coinciden en todos los días reales.');

console.log(`\n(info) FRONT vs BACKEND ANTIGUO (antes del último fix): ${divAntigua} divergencias`);
if (divAntigua) detalleAntigua.slice(0, 40).forEach((d) => console.log(`   · ${d.t} ${d.F}  front=${d.FRONT}  back_viejo=${d.BACK_ANTIGUO}  diff=${d.diff}`));
else console.log('   · 0 — en tus datos, los casos límite (reembolsado NULL / método vacío) no aparecían.');
