// api/_lib/precios.js
// Precios de Stripe de TekPair en un solo sitio.
//
// El 27-oct-2026 subieron Básico y Pro para las ALTAS NUEVAS:
//   Básico 9,90 → 14,90 €/mes (99 → 149 €/año)
//   Pro   19,90 → 22,90 €/mes (199 → 229 €/año)
//   Premium sin cambios (34,90 €/mes, 349 €/año)
// Los clientes que ya pagaban conservan su price viejo en Stripe, así que el
// webhook tiene que seguir reconociendo los viejos y los nuevos.

// Precios que se cobran HOY a quien se da de alta o cambia de plan.
export const PRECIOS_MENSUAL = {
  basico: 'price_1UUxz4KE1FTbu0p7x23ipbLV',
  pro: 'price_1UUy1DKE1FTbu0p7dO2DALH9',
  premium: 'price_1TUEbqKE1FTbu0p7U1y90BZF'
};
export const PRECIOS_ANUAL = {
  basico: 'price_1UUxzwKE1FTbu0p70vbzVKGj',
  pro: 'price_1UUy1aKE1FTbu0p7AP2z4jCQ',
  // Premium anual no cambió: sigue en la variable de entorno de siempre.
  premium: process.env.STRIPE_PRICE_PREMIUM_ANUAL || ''
};

// Precios mensuales de ANTES del 27-oct-2026 (siguen vivos en las suscripciones viejas).
export const PRECIOS_MENSUAL_VIEJOS = {
  basico: 'price_1TUEadKE1FTbu0p7OtHUDVnP',
  pro: 'price_1TUEbPKE1FTbu0p78X80WKAH',
  premium: 'price_1TUEbqKE1FTbu0p7U1y90BZF'
};

// Momento del cambio: las tiendas creadas antes conservan la tarifa vieja.
// Una tienda sin fecha de alta solo puede ser antigua (las nuevas siempre la llevan).
export const FECHA_SUBIDA = '2026-10-27T00:00:00+01:00';
export function esTarifaVieja(creadoEn) {
  return !creadoEn || new Date(creadoEn) < new Date(FECHA_SUBIDA);
}

// Importe (texto, IVA incluido) por plan y ciclo, para emails y avisos.
const IMPORTES = {
  nueva: { mensual: { basico: '14,90', pro: '22,90', premium: '34,90' }, anual: { basico: '149', pro: '229', premium: '349' } },
  vieja: { mensual: { basico: '9,90', pro: '19,90', premium: '34,90' }, anual: { basico: '99', pro: '199', premium: '349' } }
};
export function importePlan(plan, { vieja = false, ciclo = 'mensual' } = {}) {
  const p = plan === 'top' ? 'premium' : (IMPORTES.nueva.mensual[plan] ? plan : 'basico');
  return IMPORTES[vieja ? 'vieja' : 'nueva'][ciclo === 'anual' ? 'anual' : 'mensual'][p];
}

// price_id → plan. Reconoce los nuevos, los viejos y los anuales de las env vars
// (que apuntan a los anuales VIEJOS de Básico y Pro y al único de Premium).
export function mapaPrecioPlan() {
  const m = {};
  for (const tabla of [PRECIOS_MENSUAL_VIEJOS, PRECIOS_MENSUAL, PRECIOS_ANUAL]) {
    for (const [plan, id] of Object.entries(tabla)) if (id) m[id] = plan;
  }
  if (process.env.STRIPE_PRICE_BASICO_ANUAL) m[process.env.STRIPE_PRICE_BASICO_ANUAL] = 'basico';
  if (process.env.STRIPE_PRICE_PRO_ANUAL) m[process.env.STRIPE_PRICE_PRO_ANUAL] = 'pro';
  if (process.env.STRIPE_PRICE_PREMIUM_ANUAL) m[process.env.STRIPE_PRICE_PREMIUM_ANUAL] = 'premium';
  return m;
}
