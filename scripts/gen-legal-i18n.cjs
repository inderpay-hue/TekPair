#!/usr/bin/env node
/**
 * gen-legal-i18n.cjs — Genera versiones por idioma de las páginas legales para SEO (#B72).
 *
 * Las páginas legales (aviso-legal, privacidad, terminos, cookies) ya son multilingües
 * internamente vía JS (objeto LEGAL_*), pero solo existían como URL en español. Google
 * indexaba solo la versión ES. Este script crea /{lang}/{pagina}.html para en/fr/it/de/pt
 * con: <html lang> correcto, idioma forzado al cargar, canonical propio y bloque hreflang
 * con las 6 alternativas + x-default. También inserta el hreflang en los originales ES.
 *
 * Idempotente: re-ejecutar regenera limpio. Ejecutar tras tocar cualquier página legal.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://www.tekpair.tech';
const PAGES = ['aviso-legal', 'privacidad', 'terminos', 'cookies'];
const LANGS = ['es', 'en', 'fr', 'it', 'de', 'pt'];
const OG_LOCALE = { es: 'es_ES', en: 'en_GB', fr: 'fr_FR', it: 'it_IT', de: 'de_DE', pt: 'pt_PT' };

function hreflangBlock(page) {
  let out = '';
  for (const l of LANGS) {
    const href = l === 'es' ? `${BASE}/${page}.html` : `${BASE}/${l}/${page}.html`;
    out += `<link rel="alternate" hreflang="${l}" href="${href}">\n`;
  }
  out += `<link rel="alternate" hreflang="x-default" href="${BASE}/${page}.html">\n`;
  return out;
}

// Quita cualquier bloque hreflang/canonical previo (para idempotencia)
function stripSeo(html) {
  return html
    .replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/g, '')
    .replace(/<link rel="canonical" href="[^"]*">\n?/g, '');
}

let written = 0;
for (const page of PAGES) {
  const srcPath = path.join(ROOT, page + '.html');
  if (!fs.existsSync(srcPath)) { console.warn('  ⚠ falta ' + page + '.html, salto'); continue; }
  let src = stripSeo(fs.readFileSync(srcPath, 'utf8'));

  const hl = hreflangBlock(page);

  // 1) Original ES: insertar canonical + hreflang tras el <title>
  const esSeo = `<link rel="canonical" href="${BASE}/${page}.html">\n${hl}`;
  const esOut = src.replace(/(<\/title>\n?)/, `$1${esSeo}`);
  fs.writeFileSync(srcPath, esOut);
  written++;

  // 2) Versiones por idioma (no-ES)
  for (const l of LANGS) {
    if (l === 'es') continue;
    let h = src;
    // <html lang="es"> → lang del idioma
    h = h.replace(/<html lang="[^"]*">/, `<html lang="${l}">`);
    // canonical + hreflang propios
    const seo = `<link rel="canonical" href="${BASE}/${l}/${page}.html">\n${hl}<meta property="og:locale" content="${OG_LOCALE[l]}">\n`;
    h = h.replace(/(<\/title>\n?)/, `$1${seo}`);
    // Enlaces internos entre páginas legales → su versión por idioma (interlinking SEO)
    for (const p2 of PAGES) {
      h = h.replace(new RegExp('href="/' + p2 + '\\.html"', 'g'), `href="/${l}/${p2}.html"`);
    }
    // Forzar idioma al cargar (sobre-escribe la auto-detección) justo antes de </script></body>
    h = h.replace(/<\/script>\s*<\/body>/, `try{setLegalLang('${l}');}catch(e){}\n</script>\n</body>`);
    const destDir = path.join(ROOT, l);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, page + '.html'), h);
    written++;
  }
  console.log('  ✓ ' + page + ' → ES + ' + (LANGS.length - 1) + ' idiomas');
}
console.log('[legal-i18n] ' + written + ' ficheros escritos.');
