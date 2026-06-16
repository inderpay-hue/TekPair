#!/usr/bin/env node
/**
 * Validador de i18n para TekPair.
 *
 * Carga el diccionario TRANSLATIONS de lang/lang.v8.js (evaluándolo en un sandbox)
 * y comprueba, de forma estática, las dos clases de bug de i18n más recurrentes:
 *
 *   1) CLAVES INCOMPLETAS  — una clave existe en 'es' pero falta en otro idioma
 *      (o al revés). Eso deja texto sin traducir según el idioma.
 *   2) CLAVES COLGANTES    — código que usa data-t="X" / data-t-ph="X" / T('X')
 *      con una clave que NO está en el diccionario → se renderiza la clave cruda
 *      (la clase de bug F208/F218/F650).
 *
 * Sale con código != 0 si encuentra errores, para poder colgarlo de CI / pre-commit.
 *
 * Uso:  node scripts/i18n-validate.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LANG_FILE = path.join(ROOT, 'lang', 'lang.v8.js');

// Ficheros donde se referencian claves de i18n (data-t / T()).
const SOURCE_FILES = [
  'dashboard.html', 'tpv.html', 'parte.html', 'app.html', 'registro.html',
  'js/dash-app.js', 'js/dash-cajas.js', 'factura.js',
];

// Claves que se construyen dinámicamente (prefijo + variable) y no se pueden verificar literalmente.
// Se ignoran por prefijo para no generar falsos positivos.
const DYNAMIC_PREFIXES = ['estado.', 'gen.', 'nom.', 'tb.', 'inicio.', 'rep.', 'pedidos.', 'fact.', 'notif.', 'cli.'];

function fail(msg) { console.error('[31m✗ ' + msg + '[0m'); }
function ok(msg) { console.log('[32m✓ ' + msg + '[0m'); }
function warn(msg) { console.log('[33m! ' + msg + '[0m'); }

// ── 1. Cargar TRANSLATIONS evaluando el fichero en un sandbox ──
function cargarTranslations() {
  const code = fs.readFileSync(LANG_FILE, 'utf8');
  const sandbox = {
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { documentElement: {}, querySelectorAll() { return []; }, getElementById() { return null; } },
    window: {}, navigator: { language: 'es' }, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: 'lang.v8.js' });
  } catch (e) {
    fail('No se pudo evaluar lang.v8.js: ' + e.message);
    process.exit(2);
  }
  if (!sandbox.TRANSLATIONS) { fail('lang.v8.js no expone TRANSLATIONS'); process.exit(2); }
  return sandbox.TRANSLATIONS;
}

// ── 2. Detectar claves definidas en MÁS DE UN bloque (gotcha "gana la última") ──
// Cada clave debería definirse una vez por idioma (= nº de idiomas). Si aparece más veces,
// está en 2+ bloques y una copia puede pisar a la otra con una traducción incorrecta.
function detectarDuplicados(nLangs) {
  const code = fs.readFileSync(LANG_FILE, 'utf8');
  const re = /'([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)'\s*:\s*'(?:[^'\\]|\\.)*'/g;
  const cuenta = {};
  let m;
  while ((m = re.exec(code))) { cuenta[m[1]] = (cuenta[m[1]] || 0) + 1; }
  return Object.keys(cuenta)
    .filter(k => cuenta[k] > nLangs)
    .map(k => ({ key: k, veces: cuenta[k] }))
    .sort((a, b) => b.veces - a.veces);
}

// ── 3. Recoger claves usadas en el código ──
function recogerClavesUsadas() {
  const usadas = new Map(); // key -> Set(ficheros)
  const add = (k, f) => { if (!usadas.has(k)) usadas.set(k, new Set()); usadas.get(k).add(f); };
  const patrones = [
    /data-t(?:-ph|-attr|-html)?="([^"]+)"/g,       // atributos data-t / data-t-ph
    /[^a-zA-Z0-9_]T\(\s*'([^']+)'\s*\)/g,    // T('clave')
    /[^a-zA-Z0-9_]T\(\s*"([^"]+)"\s*\)/g,    // T("clave")
  ];
  for (const rel of SOURCE_FILES) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    const code = fs.readFileSync(fp, 'utf8');
    for (const re of patrones) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        const k = m[1];
        // Solo claves "planas con punto"; descarta data-t-attr con valores tipo "placeholder".
        if (/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/.test(k)) add(k, rel);
      }
    }
  }
  return usadas;
}

// ── Main ──
const T = cargarTranslations();
const langs = Object.keys(T);
const EXPECTED = ['es', 'en', 'fr', 'it', 'de', 'pt'];
let errores = 0;

console.log('— Validador i18n TekPair —');
console.log('Idiomas: ' + langs.join(', ') + '  ·  Claves en es: ' + Object.keys(T.es || {}).length);

// Comprobar que están los 6 idiomas esperados
for (const l of EXPECTED) {
  if (!T[l]) { fail('Falta el idioma "' + l + '" en TRANSLATIONS'); errores++; }
}

// 1) Claves incompletas: usar la UNIÓN de todas las claves como referencia.
const todas = new Set();
langs.forEach(l => Object.keys(T[l] || {}).forEach(k => todas.add(k)));
const faltantes = {}; // lang -> [keys]
langs.forEach(l => { faltantes[l] = []; });
todas.forEach(k => {
  langs.forEach(l => { if (!(k in (T[l] || {}))) faltantes[l].push(k); });
});
let totalFaltan = 0;
EXPECTED.forEach(l => {
  if (!T[l]) return;
  const f = faltantes[l] || [];
  if (f.length) {
    totalFaltan += f.length;
    fail(l.toUpperCase() + ': ' + f.length + ' clave(s) sin traducir → ' + f.slice(0, 8).join(', ') + (f.length > 8 ? ' …' : ''));
  }
});
if (totalFaltan === 0) ok('Todas las claves están presentes en los ' + EXPECTED.length + ' idiomas');
else errores += totalFaltan;

// 2) Claves colgantes: usadas en código pero ausentes del diccionario (se mostrarían crudas).
const usadas = recogerClavesUsadas();
const colgantes = [];
usadas.forEach((ficheros, k) => {
  if (!(k in (T.es || {}))) colgantes.push({ key: k, ficheros: Array.from(ficheros) });
});
if (colgantes.length) {
  colgantes.forEach(c => fail('Clave usada pero NO definida: "' + c.key + '" (' + c.ficheros.join(', ') + ')'));
  errores += colgantes.length;
} else {
  ok(usadas.size + ' claves referenciadas en el código, todas definidas');
}

// 3) Duplicados: claves definidas en más de un bloque (aviso, no error — puede ser intencional,
//    pero es el origen del bug "una copia mal traducida pisa a la buena").
const dups = detectarDuplicados(EXPECTED.length);
if (dups.length) {
  warn(dups.length + ' clave(s) definidas en más de un bloque (revisar que la última sea la correcta):');
  dups.slice(0, 12).forEach(d => warn('   ' + d.key + '  (' + d.veces + '×)'));
}

console.log('');
if (errores) { fail('i18n: ' + errores + ' problema(s).'); process.exit(1); }
ok('i18n OK');
