/* TekPair — Gestión de consentimiento de cookies (RGPD / LSSI)
   - GA (analítica) y Tawk.to (chat) NO se cargan hasta que el usuario ACEPTA.
   - La elección se guarda en localStorage 'tp_cookie_consent' = 'accepted' | 'rejected'.
   - Tawk solo se carga si la página define window.TP_ENABLE_TAWK = true (marketing). */
(function () {
  'use strict';
  var GA_ID = 'G-7V1W6B6KP4';
  var KEY = 'tp_cookie_consent';
  var TAWK_SRC = 'https://embed.tawk.to/6a1868a576b2c01c2f51f05a/1jpnlhhe8';

  function getConsent() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function loadGA() {
    if (window.__gaLoaded) return; window.__gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function loadTawk() {
    if (!window.TP_ENABLE_TAWK || window.__tawkLoaded) return; window.__tawkLoaded = true;
    window.Tawk_API = window.Tawk_API || {}; window.Tawk_LoadStart = new Date();
    var s1 = document.createElement('script');
    var s0 = document.getElementsByTagName('script')[0];
    s1.async = true; s1.src = TAWK_SRC; s1.charset = 'UTF-8'; s1.setAttribute('crossorigin', '*');
    if (s0 && s0.parentNode) s0.parentNode.insertBefore(s1, s0);
    else document.head.appendChild(s1);
  }

  function enableAll() { loadGA(); loadTawk(); }

  function hideBanner() {
    var b = document.getElementById('tpCookieBanner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  window.tpCookieAccept = function () { setConsent('accepted'); hideBanner(); enableAll(); };
  window.tpCookieReject = function () { setConsent('rejected'); hideBanner(); };

  function showBanner() {
    if (document.getElementById('tpCookieBanner')) return;
    var d = document.createElement('div');
    d.id = 'tpCookieBanner';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Aviso de cookies');
    d.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:760px;margin:0 auto;' +
      'background:#0F1729;color:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 10px 40px rgba(0,0,0,.35);' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;' +
      'line-height:1.5;display:flex;flex-wrap:wrap;align-items:center;gap:12px';
    d.innerHTML =
      '<div style="flex:1;min-width:220px">🍪 Usamos cookies propias y de terceros (analítica y chat de soporte) ' +
      'para mejorar el servicio. Puedes aceptarlas o rechazarlas. Más información en ' +
      '<a href="/cookies.html" style="color:#FF8A5B;text-decoration:underline">Política de cookies</a>.</div>' +
      '<div style="display:flex;gap:8px;flex-shrink:0">' +
      '<button type="button" onclick="tpCookieReject()" style="background:transparent;border:1px solid rgba(255,255,255,.3);' +
      'color:#fff;padding:9px 16px;border-radius:9px;cursor:pointer;font:inherit;font-weight:600">Rechazar</button>' +
      '<button type="button" onclick="tpCookieAccept()" style="background:#FF5B1F;border:none;color:#fff;' +
      'padding:9px 18px;border-radius:9px;cursor:pointer;font:inherit;font-weight:700">Aceptar</button>' +
      '</div>';
    (document.body || document.documentElement).appendChild(d);
  }

  function init() {
    var c = getConsent();
    if (c === 'accepted') enableAll();
    else if (c === 'rejected') { /* sin analítica ni chat */ }
    else showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
