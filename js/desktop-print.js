/* TekPair · Impresión nativa silenciosa (solo dentro de la app de escritorio Tauri)
 *
 * En el navegador normal NO hace nada: tkIsDesktop() devuelve false y el código de
 * impresión sigue usando el diálogo del navegador de siempre.
 *
 * Dentro de TekPair Desktop (Tauri) expone:
 *   tkPrintLabel(fullHtml, wmm, hmm, fallbackFn)
 *     - renderiza el HTML de la etiqueta a PNG con html2canvas
 *     - lo manda a la impresora elegida vía el comando nativo print_label (sin diálogo)
 *     - si algo falla, llama a fallbackFn() (que vuelve al método del navegador)
 *   tkChangePrinter()  -> abre el selector de impresora (para Ajustes)
 */
(function () {
  'use strict';

  function tkIsDesktop() {
    return !!(window.__TAURI__);
  }
  window.tkIsDesktop = tkIsDesktop;

  function tkInvoke(cmd, args) {
    var t = window.__TAURI__;
    var inv = t && ((t.core && t.core.invoke) || t.invoke);
    if (!inv) return Promise.reject(new Error('IPC nativo no disponible'));
    return inv(cmd, args);
  }

  function tkListPrinters() {
    return tkInvoke('list_printers').then(function (arr) {
      return Array.isArray(arr) ? arr : [];
    }).catch(function () { return []; });
  }

  var PRINTER_KEY = 'tk_impresora_etq';

  // Selector de impresora minimalista (overlay propio, sin depender de los modales del SPA).
  function _elegirImpresora(lista) {
    return new Promise(function (resolve) {
      var bg = document.createElement('div');
      bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2147483600;display:flex;align-items:center;justify-content:center;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif';
      var box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#0f172a;border-radius:14px;padding:18px;max-width:360px;width:90%;box-shadow:0 12px 40px rgba(0,0,0,.3)';
      var h = '<div style="font-weight:800;font-size:16px;margin-bottom:4px">Impresora de etiquetas</div>' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:12px">Elige a qué impresora salen las etiquetas en esta app.</div>';
      if (!lista.length) {
        h += '<div style="font-size:13px;color:#b91c1c;margin-bottom:12px">No se detectaron impresoras instaladas en el sistema.</div>';
      } else {
        h += '<div id="tkPrinterList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">';
        lista.forEach(function (name, i) {
          h += '<button data-i="' + i + '" style="text-align:left;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;cursor:pointer;font-size:13px">🖨️ ' +
            String(name).replace(/[&<>"]/g, '') + '</button>';
        });
        h += '</div>';
      }
      h += '<button id="tkPrinterCancel" style="width:100%;padding:9px;border:0;border-radius:8px;background:#e2e8f0;color:#334155;cursor:pointer;font-size:13px">Cancelar</button>';
      box.innerHTML = h;
      bg.appendChild(box);
      document.body.appendChild(bg);
      function close(val) { try { document.body.removeChild(bg); } catch (e) {} resolve(val); }
      box.querySelectorAll('#tkPrinterList button').forEach(function (b) {
        b.onclick = function () { close(lista[parseInt(b.getAttribute('data-i'), 10)]); };
      });
      box.querySelector('#tkPrinterCancel').onclick = function () { close(null); };
    });
  }

  // Devuelve la impresora guardada; si no hay (o force), pide elegir y la guarda.
  function tkGetPrinter(force) {
    var saved = '';
    try { saved = localStorage.getItem(PRINTER_KEY) || ''; } catch (e) {}
    if (saved && !force) return Promise.resolve(saved);
    return tkListPrinters().then(function (lista) {
      // Si la guardada ya no existe, también re-elige
      if (saved && !force && lista.indexOf(saved) !== -1) return saved;
      return _elegirImpresora(lista).then(function (sel) {
        if (sel) { try { localStorage.setItem(PRINTER_KEY, sel); } catch (e) {} }
        return sel;
      });
    });
  }
  window.tkGetPrinter = tkGetPrinter;
  window.tkChangePrinter = function () { return tkGetPrinter(true); };

  // Carga html2canvas bajo demanda (solo en la app de escritorio).
  var _h2cPromise = null;
  function _loadHtml2canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = function () { resolve(window.html2canvas); };
      s.onerror = function () { reject(new Error('No se pudo cargar html2canvas')); };
      document.head.appendChild(s);
    });
    return _h2cPromise;
  }

  // Renderiza el HTML de una etiqueta a un <canvas> dentro de un iframe aislado.
  function _htmlACanvas(fullHtml, wmm, hmm) {
    return _loadHtml2canvas().then(function (html2canvas) {
      return new Promise(function (resolve, reject) {
        var ifr = document.createElement('iframe');
        ifr.style.cssText = 'position:fixed;left:-10000px;top:0;border:0;background:#fff;width:' +
          Math.ceil(wmm * 4 + 40) + 'px;height:' + Math.ceil(hmm * 4 + 40) + 'px';
        document.body.appendChild(ifr);
        var doc = ifr.contentWindow.document;
        doc.open(); doc.write(fullHtml); doc.close();
        // Espera a que el layout y las imágenes (QR/logo) estén listas.
        setTimeout(function () {
          html2canvas(doc.body, { scale: 3, backgroundColor: '#ffffff', logging: false })
            .then(function (canvas) { try { document.body.removeChild(ifr); } catch (e) {} resolve(canvas); })
            .catch(function (err) { try { document.body.removeChild(ifr); } catch (e) {} reject(err); });
        }, 350);
      });
    });
  }

  function _canvasABytes(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('No se pudo generar la imagen')); return; }
        blob.arrayBuffer().then(function (buf) {
          resolve(Array.from(new Uint8Array(buf)));
        }).catch(reject);
      }, 'image/png');
    });
  }

  // API principal: imprime la etiqueta en silencio. Si falla, usa fallbackFn().
  function tkPrintLabel(fullHtml, wmm, hmm, fallbackFn) {
    function fall(msg) {
      if (msg && typeof toast === 'function') toast(msg, 'err');
      if (typeof fallbackFn === 'function') fallbackFn();
    }
    tkGetPrinter(false).then(function (printer) {
      if (!printer) { fall(''); return; }  // canceló el selector → vuelve al diálogo
      _htmlACanvas(fullHtml, wmm, hmm).then(function (canvas) {
        _canvasABytes(canvas).then(function (bytes) {
          tkInvoke('print_label', {
            printer: printer, data: bytes,
            widthMm: wmm || 50, heightMm: hmm || 30, copies: 1
          }).then(function () {
            if (typeof toast === 'function') toast('🖨️ Etiqueta enviada a ' + printer, 'ok');
          }).catch(function (err) {
            fall('Error al imprimir: ' + (err && err.message ? err.message : err));
          });
        }).catch(function () { fall('No se pudo preparar la etiqueta'); });
      }).catch(function () { fall('No se pudo renderizar la etiqueta'); });
    }).catch(function () { fall(''); });
  }
  window.tkPrintLabel = tkPrintLabel;
})();
