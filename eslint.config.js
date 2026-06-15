// ESLint para TekPair — ENFOCADO EN CAZAR BUGS, no en estilo.
// - api/*.js (Node ESM): no-undef completo → caza variables inexistentes (body.lang, async sueltos…).
// - HTML/JS navegador (monolito): sin no-undef (sería ruidoso por los cientos de globals),
//   pero con reglas que cazan la clase de bugs de esta sesión sin necesitar declarar globals.
const globals = require('globals');
const html = require('eslint-plugin-html');

// Reglas que detectan errores REALES con bajo ruido (no requieren conocer los globals).
const cazaBugs = {
  'no-dupe-keys': 'error',          // claves duplicadas en objeto (el lío de i18n)
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-cond-assign': 'error',        // if (a = b) en vez de ==
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-self-assign': 'warn',
  'no-self-compare': 'warn',
  'no-unsafe-negation': 'error',
  'no-unreachable': 'warn',         // código tras return/throw
  'no-sparse-arrays': 'warn',
  'no-fallthrough': 'warn',
  'valid-typeof': 'error',
  'use-isnan': 'error',
  // Caza el 'async' suelto (expresión sin efecto). Permite patrones cond && fn() y a ? b : c.
  'no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],
};

module.exports = [
  {
    ignores: [
      'node_modules/**', '**/*.bak*', '**/*.bak-*',
      'lang/lang.v*.js', 'lang/lang.js', 'landing-i18n.v2.js',
      'dashboard_v2*.html', 'tekpair-promo/**', 'blog/**', 'eslint.config.js',
    ],
  },
  // ── Endpoints serverless: Node + ESM, con no-undef completo ──
  {
    files: ['api/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { ...cazaBugs, 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] },
  },
  // ── Scripts inline de los HTML (navegador) ──
  {
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.es2021 } },
    rules: { ...cazaBugs },
  },
  // ── JS de navegador en la raíz ──
  {
    files: ['factura.js', 'landing-i18n.js', 'login-i18n.js', 'js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: { ...cazaBugs },
  },
  // ── Tooling Node (validador i18n, config y specs E2E). Node + browser porque los callbacks
  //    de page.evaluate() corren en el navegador (window/document). ──
  {
    files: ['scripts/**/*.cjs', 'tests/**/*.cjs', '*.config.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { ...cazaBugs },
  },
];
