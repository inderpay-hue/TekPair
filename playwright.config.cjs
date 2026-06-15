// Configuración de Playwright para los E2E de TekPair.
// Se ejecuta contra la URL de E2E_BASE_URL (por defecto producción) con un usuario de
// prueba cuyas credenciales se pasan por entorno (NUNCA hardcodeadas):
//
//   E2E_BASE_URL   (def. https://www.tekpair.tech)
//   E2E_EMAIL      email del usuario de prueba
//   E2E_PASSWORD   contraseña del usuario de prueba
//
// Uso:
//   npm i                       # instala @playwright/test
//   npx playwright install      # descarga los navegadores (una vez)
//   E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
//
// Si no hay credenciales, los tests se marcan como "skipped" (no fallan el CI).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://www.tekpair.tech',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
