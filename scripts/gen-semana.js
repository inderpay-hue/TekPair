#!/usr/bin/env node
/* Genera N items de cola TekPair (cada uno = 6 idiomas + meta.json) a partir de gen-semana.content.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://www.tekpair.tech';
const LANGS = ['es', 'en', 'fr', 'it', 'de', 'pt'];
const ARTICLES = require('./gen-semana.content.js');

function head(p, HREF) {
  const alts = LANGS.map(l => `  <link rel="alternate" hreflang="${l}" href="${HREF[l]}" />`).join('\n');
  return `<!DOCTYPE html>
<html lang="${p.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${p.title} | TekPair${p.lang === 'es' ? '' : ' Blog'}</title>
  <meta name="description" content="${p.description}" />
  <meta name="keywords" content="${p.keywords}" />
  <link rel="canonical" href="${HREF[p.lang]}" />
${alts}
  <link rel="alternate" hreflang="x-default" href="${HREF.es}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${p.title}" />
  <meta property="og:description" content="${p.ogdesc}" />
  <meta property="og:url" content="${HREF[p.lang]}" />
  <meta property="og:image" content="${BASE}/assets/og-blog.png" />
  <meta property="og:site_name" content="TekPair" />
  <meta property="article:published_time" content="${p.date}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${p.title}" />
  <meta name="twitter:description" content="${p.ogdesc}" />
  <meta name="twitter:image" content="${BASE}/assets/og-blog.png" />
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BlogPosting","headline":"${p.title}","description":"${p.description}","author":{"@type":"Organization","name":"TekPair","url":"${BASE}"},"publisher":{"@type":"Organization","name":"TekPair","logo":{"@type":"ImageObject","url":"${BASE}/assets/logo.png"}},"datePublished":"${p.date}","dateModified":"${p.date}","mainEntityOfPage":{"@type":"WebPage","@id":"${HREF[p.lang]}"},"image":"${BASE}/assets/og-blog.png"}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --terracota: #C2410C; --terracota-dark: #9A3309; --terracota-light: #FEF0E8; --text: #1C1917; --text-muted: #78716C; --border: #E7E5E4; --bg: #FFFFFF; --bg-alt: #FAFAF9; }
    body { font-family: 'Inter', sans-serif; color: var(--text); background: var(--bg); line-height: 1.7; font-size: 17px; }
    nav { border-bottom: 1px solid var(--border); padding: 0 1.5rem; height: 56px; display: flex; align-items: center; justify-content: space-between; background: #fff; }
    .nav-logo { font-weight: 700; font-size: 1.1rem; color: var(--terracota); text-decoration: none; letter-spacing: -0.02em; }
    .nav-links { display: flex; gap: 1.5rem; }
    .nav-links a { text-decoration: none; color: var(--text-muted); font-size: 0.9rem; font-weight: 500; }
    .nav-links a:hover { color: var(--terracota); }
    .article-hero { background: var(--terracota-light); padding: 3.5rem 1.5rem 3rem; text-align: center; }
    .article-hero .category { display: inline-block; background: var(--terracota); color: #fff; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.25rem 0.75rem; border-radius: 99px; margin-bottom: 1.25rem; }
    .article-hero h1 { font-size: clamp(1.75rem, 4vw, 2.6rem); font-weight: 700; line-height: 1.2; letter-spacing: -0.03em; max-width: 680px; margin: 0 auto 1rem; color: var(--text); }
    .article-hero .intro { max-width: 600px; margin: 0 auto; color: var(--text-muted); font-size: 1.05rem; }
    .article-meta { margin-top: 1.5rem; font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 1rem; }
    .article-wrapper { max-width: 740px; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    .toc { background: var(--bg-alt); border: 1px solid var(--border); border-left: 4px solid var(--terracota); border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 2.5rem; }
    .toc p { font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--terracota); margin-bottom: 0.75rem; }
    .toc ol { padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .toc a { color: var(--text); text-decoration: none; font-size: 0.95rem; font-weight: 500; }
    .toc a:hover { color: var(--terracota); text-decoration: underline; }
    h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 2.5rem 0 1rem; color: var(--text); scroll-margin-top: 16px; }
    h3 { font-size: 1.15rem; font-weight: 600; margin: 1.75rem 0 0.6rem; color: var(--text); }
    p { margin-bottom: 1.1rem; color: #44403C; }
    ul, ol { padding-left: 1.4rem; margin-bottom: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
    li { color: #44403C; }
    strong { color: var(--text); font-weight: 600; }
    .callout { background: var(--terracota-light); border-left: 4px solid var(--terracota); border-radius: 0 8px 8px 0; padding: 1.1rem 1.25rem; margin: 1.75rem 0; }
    .callout p { margin: 0; color: #7C2D12; font-size: 0.95rem; }
    .callout strong { color: #7C2D12; }
    .table-wrap { overflow-x: auto; margin: 1.75rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th { background: var(--terracota); color: #fff; font-weight: 600; text-align: left; padding: 0.7rem 1rem; }
    td { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); color: #44403C; }
    tr:nth-child(even) td { background: var(--bg-alt); }
    tr:last-child td { border-bottom: none; }
    .checklist { list-style: none; padding: 0; margin: 1.25rem 0; }
    .checklist li { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.45rem 0; border-bottom: 1px solid var(--border); color: #44403C; font-size: 0.95rem; }
    .checklist li:last-child { border-bottom: none; }
    .checklist li::before { content: "\\2713"; flex-shrink: 0; width: 20px; height: 20px; background: var(--terracota); color: #fff; border-radius: 50%; font-size: 0.7rem; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 2px; }
    .faq-section { margin-top: 3rem; }
    .faq-section h2 { margin-top: 0; }
    details { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden; }
    summary { padding: 1rem 1.25rem; font-weight: 600; font-size: 0.97rem; cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: center; background: var(--bg-alt); transition: background .2s; }
    summary:hover { background: var(--terracota-light); }
    summary::after { content: "+"; font-size: 1.2rem; color: var(--terracota); font-weight: 700; }
    details[open] summary::after { content: "\\2212"; }
    details[open] summary { background: var(--terracota-light); }
    .faq-body { padding: 1rem 1.25rem; font-size: 0.95rem; color: #44403C; }
    .cta-box { background: var(--terracota); color: #fff; border-radius: 12px; padding: 2.5rem 2rem; text-align: center; margin-top: 3.5rem; }
    .cta-box h2 { color: #fff; font-size: 1.5rem; margin: 0 0 0.75rem; }
    .cta-box p { color: rgba(255,255,255,0.85); margin-bottom: 1.5rem; font-size: 1rem; }
    .cta-btn { display: inline-block; background: #fff; color: var(--terracota); font-weight: 700; font-size: 0.95rem; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; }
    footer { border-top: 1px solid var(--border); padding: 2rem 1.5rem; text-align: center; font-size: 0.85rem; color: var(--text-muted); }
    footer a { color: var(--terracota); text-decoration: none; }
    @media (max-width: 600px) { .nav-links { display: none; } .article-hero { padding: 2.5rem 1.25rem 2rem; } .article-wrapper { padding: 2rem 1.25rem 3rem; } }
  </style>
</head>`;
}

function pageHtml(p, HREF) {
  const tocItems = p.toc.map((t, i) => `<li><a href="#s${i + 1}">${t}</a></li>`).join('');
  const faq = p.faq.map(f => `<details><summary>${f.q}</summary><div class="faq-body">${f.a}</div></details>`).join('');
  return head(p, HREF) + `
<body>
  <nav>
    <a href="${BASE}" class="nav-logo">TekPair</a>
    <div class="nav-links">
      <a href="${BASE}/blog/">Blog</a>
      <a href="${BASE}/#funcionalidades">${p.nav_feat}</a>
      <a href="${BASE}/#precios">${p.nav_price}</a>
      <a href="${BASE}/app.html">${p.nav_login}</a>
    </div>
  </nav>
  <header class="article-hero">
    <div class="category">${p.category}</div>
    <h1>${p.h1}</h1>
    <p class="intro">${p.heroIntro}</p>
    <div class="article-meta"><span>&#128197; ${p.dateLabel}</span><span>&#9201; ${p.readtime}</span></div>
  </header>
  <main class="article-wrapper">
    <div class="toc" role="navigation" aria-label="${p.toc_title}">
      <p>${p.toc_title}</p>
      <ol>${tocItems}<li><a href="#faq">${p.faq_title}</a></li></ol>
    </div>
    ${p.body}
    <section class="faq-section" id="faq">
      <h2>${p.faq_title}</h2>
      ${faq}
    </section>
    <div class="cta-box">
      <h2>${p.cta_h}</h2>
      <p>${p.cta_p}</p>
      <a href="${BASE}" class="cta-btn">${p.cta_btn}</a>
    </div>
  </main>
  <footer>
    <p>&#169; 2026 <a href="${BASE}">TekPair</a> &middot; ${p.foot_tag}</p>
    <p style="margin-top:0.5rem;"><a href="${BASE}/blog/">Blog</a> &middot; <a href="${BASE}/privacidad.html">${p.foot_priv}</a> &middot; <a href="${BASE}/terminos.html">${p.foot_terms}</a></p>
  </footer>
</body>
</html>`;
}

let n = 0;
for (const art of ARTICLES) {
  n++;
  const num = String(n).padStart(3, '0');
  const dir = path.join(ROOT, '_blog-queue', num + '-' + art.id);
  fs.mkdirSync(dir, { recursive: true });
  const HREF = Object.fromEntries(LANGS.map(l => [l, BASE + '/' + art.slug[l]]));
  const posts = {};
  for (const lang of LANGS) {
    const c = art.c[lang];
    const p = Object.assign({ lang, date: art.date }, c);
    fs.writeFileSync(path.join(dir, lang + '.html'), pageHtml(p, HREF));
    posts[lang] = { dest: art.slug[lang], path: '/' + art.slug[lang], url: HREF[lang], title: c.title, excerpt: c.excerpt, dateLabel: c.dateLabel, readtime: c.readtime, category: c.category, readlink: c.readlink };
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ date: art.date, readtime: art.c.es.readtime, category: art.c.es.category, posts }, null, 2));
  console.log('Generado ' + num + '-' + art.id);
}
console.log('Total: ' + n + ' artículos en cola');
