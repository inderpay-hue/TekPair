// api/_lib/nivel-comercial.js
// Condiciones de los comerciales (decididas el 21-oct-2026). El MISMO fichero está
// en TekPair y en Bipe: si se cambia aquí, cambiarlo también en el otro repo.
//
//  · Todo cuenta desde la fecha de alta del comercial.
//  · Primer año: comisión base (20 %) sin mínimo de altas.
//  · Después, por trimestres contados desde el aniversario. Un «alta» es una tienda
//    de su código que hace su PRIMER PAGO REAL dentro del trimestre (las que solo se
//    registran no cuentan). Cada app cuenta las suyas por separado.
//      - 3 o más altas → sube un escalón (5 → 10 → 20 %).
//      - menos de 3    → baja un escalón (20 → 10 → 5 %).
//      - ya en el 5 %: si pasa 4 trimestres seguidos (un año) sin llegar a 3, queda
//        de BAJA: deja de cobrar comisión y su código se desactiva (cron diario).
//  · Cada pago se liquida al porcentaje que tenga el comercial ese día.

export const ALTAS_MINIMAS = 3;
const TRIMESTRES_EN_5_PARA_BAJA = 4;

function sumarMeses(fecha, meses) {
  const d = new Date(fecha);
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  // Mismo día del mes si existe (31-ene + 1 mes → 28/29-feb, no 3-mar).
  const ultimo = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return r;
}

/**
 * @param {object} p
 * @param {string|Date} p.alta   fecha de alta del comercial
 * @param {number} [p.base=20]   su comisión base
 * @param {Array<string|Date>} p.altas  fecha del PRIMER pago de cada tienda de su código
 * @param {Date} [p.hoy]
 */
export function nivelComercial({ alta, base = 20, altas = [], hoy = new Date() }) {
  // Sin fecha de alta válida se trata como si empezara hoy (primer año, sin mínimo).
  // Antes: null → 1970 (y el cron lo daba de BAJA) y undefined → RangeError al
  // llamar a toISOString, que tumbaba el panel de comisiones entero.
  const inicio = new Date(alta || hoy);
  if (isNaN(inicio)) return nivelComercial({ alta: hoy, base, altas, hoy });
  const ahora = new Date(hoy);
  const b = Math.max(0, Number(base) || 0);
  const niveles = [b, Math.min(b, 10), Math.min(b, 5)];
  const fechas = altas.map((f) => new Date(f)).filter((d) => !isNaN(d));
  const contar = (desde, hasta) => fechas.filter((d) => d >= desde && d < hasta).length;
  const finPrimerAno = sumarMeses(inicio, 12);

  const historial = [];
  let idx = 0;
  let enCinco = 0;
  let baja = null;
  let desde = finPrimerAno;
  if (!isNaN(inicio)) {
    // Trimestres ya terminados: cada uno decide el nivel del siguiente.
    for (let i = 0; i < 400; i++) {
      const hasta = sumarMeses(finPrimerAno, (i + 1) * 3);
      if (hasta > ahora) break;
      const n = contar(desde, hasta);
      const antes = niveles[idx];
      if (n >= ALTAS_MINIMAS) {
        if (idx > 0) idx--;
        enCinco = 0;
      } else if (idx < 2) {
        idx++;
        enCinco = 0;
      } else {
        enCinco++;
      }
      historial.push({ desde: desde.toISOString(), hasta: hasta.toISOString(), altas: n, pct_antes: antes, pct_despues: niveles[idx] });
      desde = hasta;
      if (idx === 2 && enCinco >= TRIMESTRES_EN_5_PARA_BAJA) { baja = hasta; break; }
    }
  }

  const primerAno = ahora < finPrimerAno;
  const tramoDesde = primerAno ? inicio : desde;
  const tramoHasta = primerAno ? finPrimerAno : sumarMeses(desde, 3);
  return {
    alta: isNaN(inicio) ? null : inicio.toISOString(),
    base: b,
    fin_primer_ano: isNaN(inicio) ? null : finPrimerAno.toISOString(),
    primer_ano: primerAno,
    estado: baja ? 'baja' : 'activo',
    baja_desde: baja ? baja.toISOString() : null,
    pct: baja ? 0 : niveles[idx],
    // Tramo en curso: el primer año entero o el trimestre actual, con sus altas hasta hoy.
    tramo: { desde: tramoDesde.toISOString(), hasta: tramoHasta.toISOString(), altas: contar(tramoDesde, ahora < tramoHasta ? ahora : tramoHasta) },
    altas_minimas: ALTAS_MINIMAS,
    trimestres_en_5: enCinco,
    historial,
  };
}

// Primera fecha de pago real de cada tienda, a partir de una lista de pagos
// [{ tienda, fecha, importe }]. Devuelve solo las fechas.
export function primerosPagos(pagos) {
  const primero = {};
  for (const p of pagos || []) {
    if (!p || !p.tienda || !(Number(p.importe) > 0)) continue;
    const d = new Date(p.fecha);
    if (isNaN(d)) continue;
    if (!primero[p.tienda] || d < primero[p.tienda]) primero[p.tienda] = d;
  }
  return Object.values(primero);
}
