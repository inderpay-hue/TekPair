/* Genera /en/, /fr/, /it/, /de/, /pt/ index.html pre-traducidos desde index.html + landing-i18n.v2.js.
   Splicing quirúrgico por rangos (no re-serializa el documento → preserva todo byte a byte). */
const fs = require('fs');
const path = require('path');
const { Parser } = require('htmlparser2');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1) Extraer T (objeto de traducciones) de landing-i18n.v2.js en sandbox
const i18nSrc = fs.readFileSync(path.join(ROOT, 'landing-i18n.v2.js'), 'utf8');
const sandbox = { document: { documentElement: {}, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, readyState: 'complete' }, navigator: { language: 'es' }, localStorage: { getItem: () => null, setItem: () => {} }, window: {} };
vm.createContext(sandbox);
vm.runInContext(i18nSrc, sandbox);
const T = sandbox.T;
if (!T || !T.en) { console.error('No se pudo extraer T'); process.exit(1); }

const LANGS = ['en', 'fr', 'it', 'de', 'pt'];
const ALL = ['es', 'en', 'fr', 'it', 'de', 'pt'];
const OG_LOCALE = { es: 'es_ES', en: 'en_GB', fr: 'fr_FR', it: 'it_IT', de: 'de_DE', pt: 'pt_PT' };
const META = {
  en: { title: 'TekPair — Software for phone repair and resale shops', desc: 'Manage sales, repairs, stock and customers of your phone shop from any device. 15-day free trial.' },
  fr: { title: 'TekPair — Logiciel pour magasins de réparation et vente de mobiles', desc: 'Gérez ventes, réparations, stock et clients de votre magasin mobile depuis n\'importe quel appareil. Essai gratuit 15 jours.' },
  it: { title: 'TekPair — Software per negozi di riparazione e vendita di cellulari', desc: 'Gestisci vendite, riparazioni, magazzino e clienti del tuo negozio di telefonia da qualsiasi dispositivo. Prova gratuita 15 giorni.' },
  de: { title: 'TekPair — Software für Handy-Reparatur- und Verkaufsläden', desc: 'Verwalte Verkäufe, Reparaturen, Lager und Kunden deines Handyshops von jedem Gerät. 15 Tage kostenlos testen.' },
  pt: { title: 'TekPair — Software para lojas de reparação e venda de telemóveis', desc: 'Faz a gestão de vendas, reparações, stock e clientes da tua loja de telemóveis a partir de qualquer dispositivo. Teste grátis de 15 dias.' }
};
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

// 2) Calcular rangos de contenido de cada [data-i18n] (una sola vez, sobre el fuente original)
function computeRanges(html) {
  const ranges = []; // {key, start, end, tag, isInput, openStart, openEnd, attrPlaceholder}
  const stack = [];
  const parser = new Parser({
    onopentag(name, attribs) {
      const key = attribs['data-i18n'];
      const node = { name, key: key || null, contentStart: parser.endIndex + 1, openStart: parser.startIndex, openEnd: parser.endIndex };
      if (key && VOID.has(name)) {
        // input/img: traducir vía placeholder (solo input/textarea lo usaban)
        if (name === 'input') ranges.push({ key, kind: 'placeholder', openStart: parser.startIndex, openEnd: parser.endIndex });
      }
      if (!VOID.has(name)) stack.push(node);
    },
    onclosetag() {
      const node = stack.pop();
      if (node && node.key) {
        ranges.push({ key: node.key, kind: 'content', start: node.contentStart, end: parser.startIndex });
      }
    }
  }, { withStartIndices: true, withEndIndices: true, decodeEntities: false, lowerCaseTags: false });
  parser.write(html);
  parser.end();
  return ranges;
}
const RANGES = computeRanges(SRC);

function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

function buildHreflang(selfLang) {
  const base = 'https://www.tekpair.tech';
  let out = '';
  ALL.forEach(function (l) {
    const href = l === 'es' ? base + '/' : base + '/' + l + '/';
    out += '<link rel="alternate" hreflang="' + l + '" href="' + href + '">\n';
  });
  out += '<link rel="alternate" hreflang="x-default" href="' + base + '/">\n';
  return out;
}

function translateTo(lang) {
  const dict = T[lang];
  // Splicing de contenido por rangos (de fin a inicio)
  let html = SRC;
  const ops = RANGES.filter(r => dict[r.key] !== undefined).map(r => ({ ...r })).sort((a, b) => {
    const pa = a.kind === 'content' ? a.start : a.openStart;
    const pb = b.kind === 'content' ? b.start : b.openStart;
    return pb - pa;
  });
  ops.forEach(function (r) {
    if (r.kind === 'content') {
      html = html.slice(0, r.start) + dict[r.key] + html.slice(r.end);
    } else if (r.kind === 'placeholder') {
      const open = html.slice(r.openStart, r.openEnd + 1);
      let neo;
      if (/placeholder=/.test(open)) neo = open.replace(/placeholder="[^"]*"/, 'placeholder="' + escAttr(dict[r.key]) + '"');
      else neo = open.replace(/\/?>$/, ' placeholder="' + escAttr(dict[r.key]) + '">');
      html = html.slice(0, r.openStart) + neo + html.slice(r.openEnd + 1);
    }
  });
  return html;
}

function applyHead(html, lang) {
  const base = 'https://www.tekpair.tech';
  const url = lang === 'es' ? base + '/' : base + '/' + lang + '/';
  // <html lang>
  html = html.replace(/<html lang="[^"]*"/, '<html lang="' + lang + '"');
  if (lang !== 'es') {
    const m = META[lang];
    html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + m.title + '</title>');
    html = html.replace(/(<meta name="description" content=")[^"]*(">)/, '$1' + escAttr(m.desc) + '$2');
    html = html.replace(/(<meta property="og:title" content=")[^"]*(">)/, '$1' + escAttr(m.title) + '$2');
    html = html.replace(/(<meta property="og:description" content=")[^"]*(">)/, '$1' + escAttr(m.desc) + '$2');
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*(">)/, '$1' + escAttr(m.title) + '$2');
    html = html.replace(/(<meta name="twitter:description" content=")[^"]*(">)/, '$1' + escAttr(m.desc) + '$2');
    html = html.replace(/(<meta property="og:locale" content=")[^"]*(">)/, '$1' + OG_LOCALE[lang] + '$2');
    // F182: og:locale:alternate (variantes regionales relevantes, p.ej. en_US para EE.UU.)
    var OG_ALT = { en: 'en_US', pt: 'pt_BR', es: 'es_MX' };
    if (OG_ALT[lang]) html = html.replace(/(<meta property="og:locale" content="[^"]*">)/, '$1\n<meta property="og:locale:alternate" content="' + OG_ALT[lang] + '">');
    html = html.replace(/(<meta property="og:url" content=")[^"]*(">)/, '$1' + url + '$2');
    html = html.replace(/(<link rel="canonical" href=")[^"]*(">)/, '$1' + url + '$2');
    // forzar idioma del JS para que no re-detecte el navegador
    html = html.replace(/<script src="\/landing-i18n/, '<script>window.__PAGE_LANG=\'' + lang + '\';</script>\n<script src="/landing-i18n');
  }
  // hreflang: inyectar tras canonical
  html = html.replace(/(<link rel="canonical"[^>]*>)/, '$1\n' + buildHreflang(lang).trim());
  // #B81: que los links de registro mantengan el idioma del funnel (registro.html lee ?lang=)
  html = html.replace(/href="\/registro\.html\?/g, 'href="/registro.html?lang=' + lang + '&');
  html = html.replace(/href="\/registro\.html"/g, 'href="/registro.html?lang=' + lang + '"');
  return html;
}

// 3) Generar páginas por idioma
LANGS.forEach(function (lang) {
  let html = translateTo(lang);
  html = applyHead(html, lang);
  const dir = path.join(ROOT, lang);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log('✓ /' + lang + '/index.html');
});

// 4) Inyectar hreflang en el root (es) si no lo tiene
let rootHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (rootHtml.indexOf('hreflang=') === -1) {
  rootHtml = rootHtml.replace(/(<link rel="canonical"[^>]*>)/, '$1\n' + buildHreflang('es').trim());
  fs.writeFileSync(path.join(ROOT, 'index.html'), rootHtml);
  console.log('✓ hreflang inyectado en / (es)');
} else {
  console.log('— root ya tiene hreflang');
}
console.log('Hecho.');
