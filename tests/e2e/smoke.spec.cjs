// E2E de TekPair — i18n real + flujos críticos.
//
// Complementa al validador estático (scripts/i18n-validate.cjs): este test arranca la app
// de verdad, cambia de idioma y comprueba que el texto SE RENDERIZA traducido (no solo que
// la clave exista), y que la navegación crítica funciona. Cubre la clase de bug que más se
// repitió en la auditoría (i18n parcial + routing).
//
// Requiere credenciales por entorno (ver playwright.config.cjs). Sin ellas, se salta.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const HAVE_CREDS = !!(EMAIL && PASSWORD);

// Prefijos de claves i18n: si aparecen como texto visible, es una clave cruda sin traducir.
const KEY_LEAK_RE = /\b(gen|rep|tpv|fact|nav|notif|cli|estado|pedidos|inicio|tb|nom|cita|stock|gastos|caja|catalogo)\.[a-z][a-z0-9_]+\b/;

async function login(page) {
  await page.goto('/app.html');
  await page.fill('#em', EMAIL);
  await page.fill('#pw', PASSWORD);
  await page.click('#btn');
  // app.html redirige a dashboard.html tras el login correcto.
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
  // Esperar a que dash-app.js esté cargado (setLang/navTo disponibles).
  await page.waitForFunction(() => typeof window.setLang === 'function' && typeof window.navTo === 'function', { timeout: 20000 });
}

test.describe('TekPair E2E', () => {
  test.skip(!HAVE_CREDS, 'Define E2E_EMAIL y E2E_PASSWORD para ejecutar los E2E.');

  test.beforeEach(async ({ page }) => { await login(page); });

  test('i18n: los elementos data-t se renderizan según el diccionario en cada idioma', async ({ page }) => {
    for (const lang of ['es', 'en', 'fr', 'de']) {
      await page.evaluate((l) => window.setLang(l), lang);
      // Para cada [data-t] VISIBLE (sin data-t-attr), su texto debe ser el valor del diccionario.
      const mismatches = await page.evaluate((l) => {
        const dict = (window.TRANSLATIONS && window.TRANSLATIONS[l]) || {};
        const out = [];
        document.querySelectorAll('[data-t]').forEach((el) => {
          if (el.getAttribute('data-t-attr')) return;        // basado en atributo, no en texto
          if (el.offsetParent === null) return;              // oculto: su texto puede estar sin refrescar
          const k = el.getAttribute('data-t');
          const expected = dict[k];
          if (expected === undefined) return;                // ausencia la cubre el validador estático
          const actual = (el.textContent || '').trim();
          if (actual && actual !== String(expected).trim()) out.push({ k, expected: String(expected).trim(), actual });
        });
        return out;
      }, lang);
      expect(mismatches, `${lang}: ${JSON.stringify(mismatches.slice(0, 6))}`).toEqual([]);
    }
  });

  test('i18n: no se filtran claves crudas (tipo "nav.reps") al cambiar a inglés', async ({ page }) => {
    await page.evaluate(() => window.setLang('en'));
    const leak = await page.evaluate((reSrc) => {
      const re = new RegExp(reSrc);
      const hits = [];
      document.querySelectorAll('body *').forEach((el) => {
        if (el.children.length) return;                      // solo nodos hoja (texto propio)
        if (el.offsetParent === null) return;
        const t = (el.textContent || '').trim();
        if (t && re.test(t)) hits.push(t.slice(0, 40));
      });
      return Array.from(new Set(hits)).slice(0, 10);
    }, KEY_LEAK_RE.source);
    expect(leak, `Claves crudas visibles: ${JSON.stringify(leak)}`).toEqual([]);
  });

  test('routing: #reparaciones activa la vista de reparaciones (F211) y persiste al recargar', async ({ page }) => {
    await page.evaluate(() => window.navTo('pReps'));
    await expect(page.locator('#pReps')).toHaveClass(/active/);
    // F211: tras recargar con el hash puesto, debe volver a Reparaciones, no a Inicio.
    await page.reload();
    await page.waitForFunction(() => typeof window.navTo === 'function');
    await page.waitForTimeout(3000); // el boot reaplica el hash con reintentos (~2,5s)
    await expect(page.locator('#pReps')).toHaveClass(/active/);
  });

  test('routing: #tpv lleva a la página del TPV (F648/F649)', async ({ page }) => {
    await page.goto('/dashboard.html#tpv');
    await page.waitForURL(/tpv\.html/, { timeout: 15000 });
    expect(page.url()).toContain('tpv.html');
  });

  test('modales: al cambiar de página no quedan modales apilados (F293)', async ({ page }) => {
    // Abrir el modal de nuevo cliente y luego navegar a otra sección.
    await page.evaluate(() => { window.ECID = null; if (window.limpiarFormCli) limpiarFormCli(); window.openM('mCli'); });
    await expect(page.locator('#mCli')).toHaveClass(/open/);
    await page.evaluate(() => window.navTo('pStock'));
    const abiertos = await page.evaluate(() => document.querySelectorAll('.modal-bg.open').length);
    expect(abiertos).toBe(0);
  });
});
