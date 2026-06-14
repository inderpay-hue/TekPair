/* F164/F163/F129: enriquece los artículos del blog (ES) con:
   - TOC (tabla de contenidos) a partir de los <h2 id="sN">
   - "Sigue leyendo" con 3 enlaces internos a otros artículos
   - botones de compartir (WhatsApp / X / LinkedIn)
   Idempotente (marcadores <!-- TOC --> / <!-- RELATED -->). Re-ejecutable tras publicar. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BLOG = path.join(ROOT, 'blog');
const BASE = 'https://www.tekpair.tech';

// Artículos ES (no index, no subcarpetas de idioma)
const files = fs.readdirSync(BLOG).filter(f => f.endsWith('.html') && f !== 'index.html');

// Mapa archivo -> {title, url}
const arts = files.map(function (f) {
  const html = fs.readFileSync(path.join(BLOG, f), 'utf8');
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || f;
  return { file: f, title: h1.replace(/<[^>]+>/g, '').trim(), url: BASE + '/blog/' + f };
});

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function buildTOC(html) {
  // h2 con id="sN" (secciones numeradas), excluye FAQ/CTA
  const re = /<h2\s+id="(s\d+)"[^>]*>([\s\S]*?)<\/h2>/g;
  const items = []; let m;
  while ((m = re.exec(html)) !== null) {
    items.push({ id: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() });
  }
  if (items.length < 3) return null; // no merece la pena con <3 secciones
  let toc = '<!-- TOC -->\n<nav class="post-toc" aria-label="Tabla de contenidos" style="background:#F7F9FC;border:1px solid #E2E8F0;border-radius:12px;padding:16px 20px;margin:0 0 28px">';
  toc += '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748B;margin-bottom:10px">Contenido</div>';
  toc += '<ol style="margin:0;padding-left:18px;font-size:14.5px;line-height:1.9">';
  items.forEach(function (it) { toc += '<li><a href="#' + it.id + '" style="color:#FF5B1F;text-decoration:none">' + esc(it.text) + '</a></li>'; });
  toc += '</ol></nav>\n';
  return toc;
}

function buildRelated(self) {
  // 3 artículos distintos al actual (rotación determinista por posición)
  const others = arts.filter(a => a.file !== self.file);
  const idx = arts.findIndex(a => a.file === self.file);
  const picks = [];
  for (let i = 1; i <= 3 && i <= others.length; i++) picks.push(others[(idx + i) % others.length] || others[i - 1]);
  // dedup
  const seen = {}; const uniq = picks.filter(p => p && !seen[p.file] && (seen[p.file] = 1));
  let h = '<!-- RELATED -->\n<section class="post-related" style="margin:36px 0 8px;padding-top:24px;border-top:1px solid #E2E8F0">';
  h += '<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748B;margin-bottom:14px">Sigue leyendo</div>';
  h += '<div style="display:grid;gap:10px">';
  uniq.forEach(function (a) {
    h += '<a href="/blog/' + a.file + '" style="display:block;color:#0F1729;text-decoration:none;font-weight:600;font-size:15px;padding:12px 14px;border:1px solid #E2E8F0;border-radius:10px">→ ' + esc(a.title) + '</a>';
  });
  h += '</div>';
  // Compartir (F129)
  const u = encodeURIComponent(self.url);
  const t = encodeURIComponent(self.title);
  h += '<div style="margin-top:20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h += '<span style="font-size:13px;color:#64748B;font-weight:600">Compartir:</span>';
  h += '<a href="https://wa.me/?text=' + t + '%20' + u + '" target="_blank" rel="noopener" style="font-size:13px;color:#fff;background:#25D366;padding:7px 14px;border-radius:8px;text-decoration:none;font-weight:600">WhatsApp</a>';
  h += '<a href="https://twitter.com/intent/tweet?text=' + t + '&url=' + u + '" target="_blank" rel="noopener" style="font-size:13px;color:#fff;background:#0F1419;padding:7px 14px;border-radius:8px;text-decoration:none;font-weight:600">X</a>';
  h += '<a href="https://www.linkedin.com/sharing/share-offsite/?url=' + u + '" target="_blank" rel="noopener" style="font-size:13px;color:#fff;background:#0A66C2;padding:7px 14px;border-radius:8px;text-decoration:none;font-weight:600">LinkedIn</a>';
  h += '</div></section>\n';
  return h;
}

let nTOC = 0, nRel = 0;
arts.forEach(function (a) {
  const p = path.join(BLOG, a.file);
  let html = fs.readFileSync(p, 'utf8');
  let changed = false;

  // TOC: antes del primer <h2 id="s...
  if (html.indexOf('<!-- TOC -->') === -1) {
    const toc = buildTOC(html);
    if (toc) {
      html = html.replace(/(<h2\s+id="s\d+")/, toc + '$1');
      nTOC++; changed = true;
    }
  }
  // Related + share: antes de .cta-box (o, si no hay, antes de </main>)
  if (html.indexOf('<!-- RELATED -->') === -1) {
    const rel = buildRelated(a);
    if (/<div class="cta-box">/.test(html)) html = html.replace(/<div class="cta-box">/, rel + '    <div class="cta-box">');
    else if (/<\/main>/.test(html)) html = html.replace(/<\/main>/, rel + '</main>');
    nRel++; changed = true;
  }
  if (changed) fs.writeFileSync(p, html);
});
console.log('✓ TOC añadido a ' + nTOC + ' · Sigue leyendo+compartir a ' + nRel + ' artículos ES');
