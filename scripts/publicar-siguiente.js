#!/usr/bin/env node
/**
 * publicar-siguiente.js — Publica el siguiente post de la cola (_blog-queue/).
 *
 * Cada item de la cola es una carpeta numerada (ej. 001-slug/) con:
 *   - meta.json  → metadatos por idioma (slug, dest, title, excerpt, fecha, etc.)
 *   - es.html en.html fr.html it.html de.html pt.html  → los 6 posts ya escritos/revisados
 *
 * El script: copia los 6 HTML a su sitio, inserta la tarjeta en cada índice de idioma,
 * añade las 6 URLs al sitemap (con hreflang) y borra el item de la cola.
 * Si la cola está vacía, no hace nada (sale 0). Si algo no encaja, avisa y NO corrompe.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'blog.config.json'), 'utf8'));
const QUEUE = path.join(ROOT, cfg.queueDir);
const MARKER = '<!-- BLOG:CARDS -->';

function log(m) { console.log('[blog] ' + m); }
function die(m) { console.error('[blog][ERROR] ' + m); process.exit(1); }

// 1) Elegir el siguiente item de la cola (orden alfabético = orden de publicación)
if (!fs.existsSync(QUEUE)) { log('No hay carpeta de cola (' + cfg.queueDir + '). Nada que publicar.'); process.exit(0); }
const items = fs.readdirSync(QUEUE).filter(d => {
  const p = path.join(QUEUE, d);
  return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'meta.json'));
}).sort();
if (!items.length) { log('Cola vacía. Nada que publicar hoy.'); process.exit(0); }

const itemDir = path.join(QUEUE, items[0]);
const meta = JSON.parse(fs.readFileSync(path.join(itemDir, 'meta.json'), 'utf8'));
log('Publicando: ' + items[0]);

// 2) Validación previa (no tocamos nada hasta confirmar que TODO está)
for (const lang of cfg.langs) {
  const post = meta.posts[lang];
  if (!post) die('Falta el idioma "' + lang + '" en meta.json de ' + items[0]);
  const src = path.join(itemDir, lang + '.html');
  if (!fs.existsSync(src)) die('Falta el fichero ' + lang + '.html en ' + items[0]);
  if (!post.dest || !post.url) die('Falta dest/url para "' + lang + '" en meta.json');
}

// 3) Copiar los 6 HTML a su ubicación final
for (const lang of cfg.langs) {
  const post = meta.posts[lang];
  const dest = path.join(ROOT, post.dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(itemDir, lang + '.html'), dest);
  log('  → ' + post.dest);
}

// 4) Insertar la tarjeta en el índice de cada idioma (es = blog/index.html; resto = blog/xx/index.html)
function tarjeta(post, m) {
  const verbo = post.readlink || 'Leer más →';
  return [
    '    <article class="post-card">',
    '      <div class="post-meta">' + (post.dateLabel || m.date) + ' · ' + (post.readtime || m.readtime || '') + ' · ' + (post.category || m.category || '') + '</div>',
    '      <h2><a href="' + post.path + '">' + post.title + '</a></h2>',
    '      <p>' + post.excerpt + '</p>',
    '      <a href="' + post.path + '" class="post-link">' + verbo + '</a>',
    '    </article>'
  ].join('\n');
}
for (const lang of cfg.langs) {
  const post = meta.posts[lang];
  const idx = path.join(ROOT, cfg.blogDir, lang === 'es' ? 'index.html' : lang + '/index.html');
  if (!fs.existsSync(idx)) { log('  ⚠ índice no encontrado, salto tarjeta: ' + idx); continue; }
  let html = fs.readFileSync(idx, 'utf8');
  const card = tarjeta(post, meta) + '\n';
  if (html.includes(MARKER)) {
    html = html.replace(MARKER, MARKER + '\n' + card);   // nueva tarjeta justo después del marcador (más reciente arriba)
  } else {
    const anchor = html.indexOf('<article class="post-card">');
    if (anchor === -1) { log('  ⚠ sin marcador ni tarjetas en ' + idx + ', salto'); continue; }
    html = html.slice(0, anchor) + card + html.slice(anchor);
  }
  fs.writeFileSync(idx, html);
  log('  índice ' + lang + ' actualizado');
}

// 5) Añadir las 6 URLs al sitemap (cada una con sus 6 hreflang + x-default)
const smPath = path.join(ROOT, cfg.sitemap);
if (fs.existsSync(smPath)) {
  let sm = fs.readFileSync(smPath, 'utf8');
  const alts = cfg.langs.map(l => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + meta.posts[l].url + '"/>').join('\n');
  const xdef = '    <xhtml:link rel="alternate" hreflang="x-default" href="' + meta.posts.es.url + '"/>';
  let bloques = '';
  for (const lang of cfg.langs) {
    bloques += [
      '  <url>',
      '    <loc>' + meta.posts[lang].url + '</loc>',
      '    <lastmod>' + meta.date + '</lastmod>',
      '    <changefreq>monthly</changefreq>',
      '    <priority>0.7</priority>',
      alts,
      xdef,
      '  </url>',
      ''
    ].join('\n');
  }
  sm = sm.replace('</urlset>', bloques + '</urlset>');
  fs.writeFileSync(smPath, sm);
  log('  sitemap actualizado (+' + cfg.langs.length + ' URLs)');
} else {
  log('  ⚠ sitemap no encontrado: ' + smPath);
}

// 6) Sacar el item de la cola
fs.rmSync(itemDir, { recursive: true, force: true });
log('Publicado y retirado de la cola: ' + items[0]);
log('OK');
