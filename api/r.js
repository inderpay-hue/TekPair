// api/r.js — enlace de invitación /r/<CODIGO> (comerciales, tiendas, Cobrum).
//
// Antes /r/ era una redirección directa a /registro.html?ref=..., así que WhatsApp y
// las demás redes enseñaban la vista previa del registro normal: «Prueba gratis 15
// días». Con un código válido la prueba es de 30 días (checkout.js), y la foto del
// enlace tiene que decir eso. Esta página lleva su propia vista previa y manda al
// navegador al registro al momento (los robots de las redes no siguen la redirección).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function handler(req, res) {
  const code = String(req.query.code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16);
  const destino = '/registro.html' + (code ? '?ref=' + encodeURIComponent(code) : '');
  const url = 'https://www.tekpair.tech/r/' + encodeURIComponent(code);
  const titulo = 'TekPair — Prueba gratis 30 días';
  const desc = 'Software para tiendas y talleres de reparación de móviles: ventas, reparaciones, stock, clientes y citas. Con este enlace, 30 días de prueba gratis.';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TekPair">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="https://www.tekpair.tech/og-image-30.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://www.tekpair.tech/og-image-30.png">
<meta http-equiv="refresh" content="0;url=${esc(destino)}">
<link rel="canonical" href="https://www.tekpair.tech/registro.html">
</head><body style="font-family:system-ui,sans-serif;background:#111;color:#fff;text-align:center;padding:40px">
<script>location.replace(${JSON.stringify(destino)});</script>
<a href="${esc(destino)}" style="color:#FF5B1F">TekPair</a>
</body></html>`);
}
