/* F142: genera /blog/rss.xml a partir de las tarjetas de blog/index.html.
   Re-ejecutar tras publicar artículos nuevos (o integrarlo en publicar-siguiente). */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://www.tekpair.tech';
const indexHtml = fs.readFileSync(path.join(ROOT, 'blog', 'index.html'), 'utf8');

const MESES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };
const RFC_MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function parseFecha(meta) {
  // "14 junio 2026 · 8 min lectura · Marketing"
  const m = meta.match(/(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/i);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = MESES[m[2].toLowerCase()];
  if (!mm) return null;
  return { y: m[3], m: mm, d: dd };
}
function rfc822(f) {
  // Sin día de la semana exacto (no crítico para RSS); usamos formato válido con 00:00
  return f.d + ' ' + RFC_MES[parseInt(f.m, 10) - 1] + ' ' + f.y + ' 00:00:00 +0000';
}

const cards = indexHtml.split('<article class="post-card">').slice(1);
const items = [];
cards.forEach(function (chunk) {
  const meta = (chunk.match(/<div class="post-meta">([^<]*)<\/div>/) || [])[1] || '';
  const tl = chunk.match(/<h2><a href="([^"]*)">([\s\S]*?)<\/a><\/h2>/);
  if (!tl) return;
  const href = tl[1];
  const title = tl[2].replace(/<[^>]+>/g, '').trim();
  const desc = ((chunk.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
  const f = parseFecha(meta);
  const url = href.startsWith('http') ? href : BASE + (href.startsWith('/') ? href : '/' + href);
  items.push({ url, title, desc, f });
});

let rss = '<?xml version="1.0" encoding="UTF-8"?>\n';
rss += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
rss += '  <channel>\n';
rss += '    <title>Blog de TekPair — Gestión de talleres de reparación de móviles</title>\n';
rss += '    <link>' + BASE + '/blog/</link>\n';
rss += '    <description>Guías y consejos para talleres de venta y reparación de móviles: gestión, precios, stock, marketing y más.</description>\n';
rss += '    <language>es</language>\n';
rss += '    <atom:link href="' + BASE + '/blog/rss.xml" rel="self" type="application/rss+xml"/>\n';
items.forEach(function (it) {
  rss += '    <item>\n';
  rss += '      <title>' + esc(it.title) + '</title>\n';
  rss += '      <link>' + esc(it.url) + '</link>\n';
  rss += '      <guid isPermaLink="true">' + esc(it.url) + '</guid>\n';
  if (it.desc) rss += '      <description>' + esc(it.desc) + '</description>\n';
  if (it.f) rss += '      <pubDate>' + rfc822(it.f) + '</pubDate>\n';
  rss += '    </item>\n';
});
rss += '  </channel>\n</rss>\n';

fs.writeFileSync(path.join(ROOT, 'blog', 'rss.xml'), rss);
console.log('✓ /blog/rss.xml — ' + items.length + ' artículos');
