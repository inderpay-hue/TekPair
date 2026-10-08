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

  // Windows trae de serie impresoras que no son impresoras (PDF, XPS, Fax). Si cuentan,
  // nunca hay "una sola" y la app no puede configurarse sola nunca.
  var TK_VIRTUALES = /print to pdf|xps document writer|^fax$|onenote|adobe pdf|pdf24|dopdf|cutepdf|imprimir en pdf|pdfcreator/i;

  // Devuelve {lista, error}. El motivo del fallo NO se traga: cuando el IPC nativo
  // falla (por ejemplo, un permiso que falta en la ACL de la app), el selector decía
  // "No se detectaron impresoras instaladas en el sistema" — culpando al equipo del
  // usuario de un fallo nuestro, que es el peor mensaje de error posible.
  function tkListPrintersRaw() {
    return tkInvoke('list_printers').then(function (arr) {
      return { lista: Array.isArray(arr) ? arr : [], error: null };
    }).catch(function (e) {
      return { lista: [], error: (e && e.message) ? e.message : String(e) };
    });
  }

  function tkListPrinters() {
    return tkListPrintersRaw().then(function (r) { return r.lista; });
  }

  var DEFAULT_KEY = 'tk_impresora_etq';

  // Selector de impresora minimalista (overlay propio, sin depender de los modales del SPA).
  function _elegirImpresora(lista, error) {
    return new Promise(function (resolve) {
      var bg = document.createElement('div');
      bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2147483600;display:flex;align-items:center;justify-content:center;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif';
      var box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#0f172a;border-radius:14px;padding:18px;max-width:360px;width:90%;box-shadow:0 12px 40px rgba(0,0,0,.3)';
      var h = '<div style="font-weight:800;font-size:16px;margin-bottom:4px">Impresora de etiquetas</div>' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:12px">Elige a qué impresora salen las etiquetas en esta app.</div>';
      if (!lista.length) {
        h += '<div style="font-size:13px;color:#b91c1c;margin-bottom:12px">' +
          (error
            ? 'No se pudieron consultar las impresoras: ' + String(error).replace(/[&<>"]/g, '')
            : 'No se detectaron impresoras instaladas en el sistema.') +
          '</div>';
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

  // Devuelve la impresora guardada para `key`; si no hay (o force), pide elegir y la guarda.
  // Cada tipo de documento usa su propia key (etiquetas / tickets), así pueden ir a
  // impresoras distintas (etiquetadora vs impresora de tickets).
  function tkGetPrinter(force, key) {
    key = key || DEFAULT_KEY;
    var saved = '';
    try { saved = localStorage.getItem(key) || ''; } catch (e) {}
    if (saved && !force) return Promise.resolve(saved);
    return tkListPrintersRaw().then(function (r) {
      var fisicas = r.lista.filter(function (n) { return !TK_VIRTUALES.test(String(n)); });
      var cand = fisicas.length ? fisicas : r.lista;
      // Con una sola impresora de verdad no hay nada que preguntar: preguntarlo solo
      // añade un paso que el cajero tiene que resolver en mitad de una venta.
      if (!force && cand.length === 1) {
        try { localStorage.setItem(key, cand[0]); } catch (e) {}
        return cand[0];
      }
      return _elegirImpresora(cand, r.error).then(function (sel) {
        if (sel) { try { localStorage.setItem(key, sel); } catch (e) {} }
        return sel;
      });
    });
  }
  window.tkGetPrinter = tkGetPrinter;
  window.tkChangePrinter = function (key) { return tkGetPrinter(true, key); };

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
        // El ancho del iframe TIENE que ser el del documento. Antes era wmm*4+40 (360px
        // para 80mm) mientras el body mide 80mm = 302px: sobraban 58px de blanco SOLO por
        // la derecha, que se rasterizaban igual. Al escalar el PNG al ancho del papel, el
        // contenido se iba a la izquierda y el margen lateral desaparecia — por eso subir
        // el padding del CSS no cambiaba nada en el papel.
        var PX_MM = 96 / 25.4;                       // px CSS por milimetro
        var wpx = Math.ceil(wmm * PX_MM);
        var hpx = hmm ? Math.ceil(hmm * PX_MM) + 8 : 4000; // sin alto fijo (tickets) -> iframe alto, se recorta al contenido
        ifr.style.cssText = 'position:fixed;left:-10000px;top:0;border:0;background:#fff;width:' +
          wpx + 'px;height:' + hpx + 'px';
        document.body.appendChild(ifr);
        var doc = ifr.contentWindow.document;
        doc.open(); doc.write(fullHtml); doc.close();
        // html2canvas rasteriza el documento como PANTALLA: las reglas @media print NO se
        // aplican. Los avisos pensados para el navegador ("pon Escala 100%...") se ocultan
        // con @media print y por eso acababan IMPRESOS en el papel. Se quitan a mano antes
        // de rasterizar, y de paso vale para todos los documentos que salen por esta vía.
        try {
          doc.querySelectorAll('.npbar, .npb, [data-screen-only]').forEach(function (el) {
            el.style.display = 'none';
          });
        } catch (e) {}
        // Espera a que el layout y las imágenes (QR/logo) estén listas.
        setTimeout(function () {
          // windowWidth con el ancho REAL del documento, no scrollWidth (que devolvia
          // el del iframe y metia el blanco de sobra en la imagen).
          html2canvas(doc.body, { scale: 3, backgroundColor: '#ffffff', logging: false, width: wpx, windowWidth: wpx, windowHeight: doc.body.scrollHeight })
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

  // Núcleo: renderiza HTML -> PNG -> impresión nativa silenciosa. Si falla, usa fallback.
  //   opts = { wmm, hmm (null = alto automático), printerKey, label, fallback }
  function tkPrintHTML(fullHtml, opts) {
    opts = opts || {};
    var wmm = opts.wmm || 50;
    var key = opts.printerKey || DEFAULT_KEY;
    var nombre = opts.label || 'Documento';
    function fall(msg) {
      if (msg && typeof toast === 'function') toast(msg, 'err');
      if (typeof opts.fallback === 'function') opts.fallback();
    }
    tkGetPrinter(false, key).then(function (printer) {
      if (!printer) { fall(''); return; }  // canceló el selector → vuelve al diálogo
      _htmlACanvas(fullHtml, wmm, opts.hmm).then(function (canvas) {
        // Si el alto es automático, lo deduce del aspecto del render (para el media de Mac).
        var hmm = opts.hmm || Math.max(10, Math.round(wmm * canvas.height / Math.max(1, canvas.width)));
        _canvasABytes(canvas).then(function (bytes) {
          tkInvoke('print_label', {
            printer: printer, data: bytes,
            widthMm: wmm, heightMm: hmm, copies: 1
          }).then(function () {
            if (typeof toast === 'function') toast('🖨️ ' + nombre + ' → ' + printer, 'ok');
          }).catch(function (err) {
            fall('Error al imprimir: ' + (err && err.message ? err.message : err));
          });
        }).catch(function () { fall('No se pudo preparar la imagen'); });
      }).catch(function () { fall('No se pudo renderizar el documento'); });
    }).catch(function () { fall(''); });
  }
  window.tkPrintHTML = tkPrintHTML;

  // Atajos por tipo de documento (cada uno recuerda su propia impresora).
  function tkPrintLabel(fullHtml, wmm, hmm, fallbackFn) {
    tkPrintHTML(fullHtml, { wmm: wmm, hmm: hmm, printerKey: 'tk_impresora_etq', label: 'Etiqueta', fallback: fallbackFn });
  }
  window.tkPrintLabel = tkPrintLabel;

  function tkPrintTicket(fullHtml, wmm, fallbackFn) {
    tkPrintHTML(fullHtml, { wmm: wmm || 80, hmm: null, printerKey: 'tk_impresora_ticket', label: 'Ticket', fallback: fallbackFn });
  }
  window.tkPrintTicket = tkPrintTicket;

  // ─────────────────── Ticket por ESC/POS (texto crudo) ───────────────────
  // El camino PNG (print_label → mspaint /pt) manda la imagen al tamaño que decide
  // el driver: en una térmica de 80mm el ticket salía ocupando un tercio del papel.
  // ESC/POS no tiene ese problema — 48 columnas SON los 80mm, siempre, sin depender
  // del driver ni del DPI. Por eso los tickets de texto van por aquí y solo los
  // documentos con logo o QR siguen yendo como imagen.
  var TK_COLS = 48;
  var _ESC = 0x1b, _GS = 0x1d, _LF = 0x0a;

  // CP858 (la tabla que traen casi todas las térmicas) para que los acentos y el
  // euro no salgan como interrogaciones.
  var _CP858 = { 'á':0xa0,'é':0x82,'í':0xa1,'ó':0xa2,'ú':0xa3,'ü':0x81,'ñ':0xa4,
    'Á':0xb5,'É':0x90,'Í':0xd6,'Ó':0xe0,'Ú':0xe9,'Ñ':0xa5,'ç':0x87,'Ç':0x80,
    '¿':0xa8,'¡':0xad,'€':0xd5,'·':0xfa,'º':0xa7,'ª':0xa6 };

  function _tkBytes(s) {
    var out = [];
    String(s == null ? '' : s).split('').forEach(function (c) {
      if (_CP858[c] != null) out.push(_CP858[c]);
      else if (c.charCodeAt(0) < 128) out.push(c.charCodeAt(0));
      else out.push(0x3f);
    });
    return out;
  }

  // Línea con texto a la izquierda y a la derecha. Si no caben juntos, se recorta
  // la izquierda: el importe de la derecha nunca se pierde.
  function _tkFila(izq, der, cols) {
    cols = cols || TK_COLS;
    var L = String(izq == null ? '' : izq), R = String(der == null ? '' : der);
    if (L.length + R.length + 1 > cols) L = L.slice(0, Math.max(0, cols - R.length - 1));
    var hueco = cols - L.length - R.length;
    return L + new Array(Math.max(1, hueco) + 1).join(' ') + R;
  }

  function _tkCentro(s, cols) {
    cols = cols || TK_COLS;
    var t = String(s == null ? '' : s);
    if (t.length >= cols) return t.slice(0, cols);
    return new Array(Math.floor((cols - t.length) / 2) + 1).join(' ') + t;
  }

  // QR nativo de la impresora (ESC/POS, GS ( k). Es lo que permite imprimir el
  // resguardo como TEXTO en vez de como imagen: la impresora dibuja el QR ella misma,
  // asi que no hay PNG que reescalar ni margenes que invente el driver.
  // Secuencia estandar: modelo -> tamaño de modulo -> correccion de errores ->
  // almacenar datos -> imprimir.
  // Code 128 nativo (GS k 73). La impresora lo dibuja ella: nada que rasterizar.
  // Los datos van precedidos de su longitud y con el selector {B al principio,
  // que es el juego que admite letras y numeros (un numero de ticket los lleva).
  function _tkBarras(texto, alto) {
    var limpio = String(texto || '').replace(/[^\x20-\x7E]/g, '');
    if (!limpio) return [];
    var datos = [0x7b, 0x42];                       // {B -> Code128 juego B
    for (var i = 0; i < limpio.length; i++) datos.push(limpio.charCodeAt(i));
    var out = [];
    out.push(_GS, 0x68, Math.max(1, Math.min(255, alto || 60)));  // altura
    out.push(_GS, 0x77, 2);                                        // ancho de modulo
    out.push(_GS, 0x48, 0);                                        // sin texto debajo (lo ponemos nosotros)
    out.push(_GS, 0x6b, 73, datos.length);
    return out.concat(datos);
  }

  function _tkQR(texto, tam) {
    var datos = _tkBytes(texto);
    var n = datos.length + 3;              // +3 por los bytes 0x31 0x50 0x30
    var pL = n & 0xff, pH = (n >> 8) & 0xff;
    var b = [];
    var put = function (a) { a.forEach(function (x) { b.push(x); }); };
    put([_GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);           // modelo 2
    put([_GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, tam || 6]);             // tamaño del modulo
    put([_GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);                 // correccion M
    put([_GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]); put(datos);         // datos
    put([_GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);                 // imprimir
    return b;
  }

  /* Construye los bytes de un ticket a partir de una estructura simple:
     { cabecera: ['NOMBRE','dir','tel'], datos: [[izq,der]...], lineas: [[izq,der]...],
       sumas: [[izq,der]...], total: [izq,der], pie: ['...'] }
     Cualquier bloque puede faltar. */
  function tkTicketESC(doc) {
    doc = doc || {};
    var b = [];
    var put = function (arr) { arr.forEach(function (x) { b.push(x); }); };
    var txt = function (s) { put(_tkBytes(s)); b.push(_LF); };
    var hr = function () { txt(new Array(TK_COLS + 1).join('-')); };

    put([_ESC, 0x40]);            // init
    put([_ESC, 0x74, 19]);        // CP858

    var cab = doc.cabecera || [];
    if (cab.length) {
      put([_ESC, 0x61, 1]);                       // centrado
      put([_ESC, 0x45, 1]); put([_GS, 0x21, 0x01]); // negrita + doble alto
      txt(cab[0]);
      put([_GS, 0x21, 0x00]);
      for (var i = 1; i < cab.length; i++) txt(cab[i]);
      put([_ESC, 0x45, 0]);
      put([_ESC, 0x61, 0]);                       // izquierda
    }

    if ((doc.datos || []).length) {
      hr();
      doc.datos.forEach(function (f) { txt(_tkFila(f[0], f[1])); });
    }
    // Parrafos libres (averia, condiciones...): se parten a lo ancho del papel.
    var parrafos = function (lista, cols) {
      (lista || []).forEach(function (p) {
        if (p === '') { b.push(_LF); return; }
        var pal = String(p).split(' '), linea = '';
        pal.forEach(function (w) {
          if ((linea + ' ' + w).trim().length > (cols || TK_COLS)) { txt(linea); linea = w; }
          else linea = (linea ? linea + ' ' : '') + w;
        });
        if (linea) txt(linea);
      });
    };
    if ((doc.bloques || []).length) {
      doc.bloques.forEach(function (bl) {
        hr();
        if (bl.titulo) { put([_ESC, 0x45, 1]); txt(bl.titulo); put([_ESC, 0x45, 0]); }
        parrafos(bl.texto);
      });
    }

    if ((doc.lineas || []).length) {
      hr();
      doc.lineas.forEach(function (f) { txt(_tkFila(f[0], f[1])); });
    }
    if ((doc.sumas || []).length) {
      hr();
      doc.sumas.forEach(function (f) { txt(_tkFila(f[0], f[1])); });
    }
    if (doc.total) {
      hr();
      // El TOTAL va en doble ancho, donde solo caben 24 columnas. Con una
      // etiqueta larga ('TOTAL (IVA inc.)' = 16) mas el importe se pasa y
      // _tkFila lo recortaba: salia "TOTAL (IVA in 266.82". Si no cabe, la
      // etiqueta se imprime en ancho normal y el importe debajo, a la derecha
      // y grande, que es como lo lee cualquiera.
      var MITAD = Math.floor(TK_COLS / 2);
      var et = String(doc.total[0] || ''), im = String(doc.total[1] || '');
      put([_ESC, 0x45, 1]);
      if (et.length + im.length + 1 > MITAD) {
        txt(et);                                   // ancho normal, 48 columnas
        put([_GS, 0x21, 0x01]);
        txt(_tkFila('', im, MITAD));
        put([_GS, 0x21, 0x00]);
      } else {
        put([_GS, 0x21, 0x01]);
        txt(_tkFila(et, im, MITAD));
        put([_GS, 0x21, 0x00]);
      }
      put([_ESC, 0x45, 0]);
    }
    // Bloques de cierre (condiciones) y QR: despues del total.
    if ((doc.bloquesPie || []).length) {
      doc.bloquesPie.forEach(function (bl) {
        hr();
        if (bl.titulo) { put([_ESC, 0x45, 1]); txt(bl.titulo); put([_ESC, 0x45, 0]); }
        parrafos(bl.texto);
      });
    }
    if (doc.codigo) {
      hr();
      put([_ESC, 0x61, 1]);                        // centrado
      put(_tkBarras(doc.codigo, 60));
      txt(doc.codigo);
      put([_ESC, 0x61, 0]);
    }
    if (doc.qr && doc.qr.url) {
      hr();
      put([_ESC, 0x61, 1]);
      if (doc.qr.titulo) txt(doc.qr.titulo);
      put(_tkQR(doc.qr.url, doc.qr.tam || 6));
      b.push(_LF);
      if (doc.qr.pie) txt(doc.qr.pie);
      put([_ESC, 0x61, 0]);
    }
    if ((doc.pie || []).length) {
      hr();
      put([_ESC, 0x61, 1]);
      parrafos(doc.pie);
      put([_ESC, 0x61, 0]);
    }

    put([_ESC, 0x64, 4]);         // avanzar para que el corte no se coma el pie
    put([_GS, 0x56, 0x42, 0x00]); // cortar
    return b;
  }
  window.tkTicketESC = tkTicketESC;

  // Imprime un ticket de texto por ESC/POS. Si no estamos en la app, no hay
  // impresora elegida o el envío falla, llama al fallback (el método del navegador).
  function tkPrintTicketESC(doc, fallbackFn) {
    var fall = function () { if (typeof fallbackFn === 'function') fallbackFn(); };
    if (!tkIsDesktop()) { fall(); return Promise.resolve(false); }
    return tkGetPrinter(false, 'tk_impresora_ticket').then(function (impresora) {
      if (!impresora) { fall(); return false; }
      return tkInvoke('print_raw', { printer: impresora, data: tkTicketESC(doc) })
        .then(function () {
          if (typeof toast === 'function') toast('🖨️ Ticket → ' + impresora, 'ok');
          return true;
        })
        .catch(function (err) {
          if (typeof toast === 'function') toast('Error al imprimir: ' + (err && err.message ? err.message : err), 'err');
          fall();
          return false;
        });
    }).catch(function () { fall(); return false; });
  }
  window.tkPrintTicketESC = tkPrintTicketESC;

  // ───────── Documento con diseño, pero a tamaño exacto (imagen ESC/POS) ─────────
  // El camino PNG tradicional (print_label) acaba en `mspaint /pt`, que reescala la
  // imagen a su criterio y añade sus propios márgenes: por eso el resguardo salía más
  // pequeño que el papel y descentrado, y por eso tocar el CSS no cambiaba nada.
  // Aquí la imagen se convierte a mapa de bits ESC/POS (GS v 0) y se manda cruda:
  // la impresora la pinta punto por punto, sin driver y sin reescalar. Así se conserva
  // la tipografía, el logo y el QR del diseño, pero el ancho es exacto.
  var TK_DOTS = 576;    // puntos del cabezal de una térmica de 80mm (72mm útiles a 203ppp)
  var TK_UMBRAL = 180;  // por debajo de esta luminancia, el punto se imprime negro

  function _canvasAEscPos(canvas, dots) {
    dots = dots || TK_DOTS;
    var anchoBytes = Math.floor(dots / 8);
    dots = anchoBytes * 8;
    // Reescalado al ancho del cabezal conservando la proporción. Se hace aquí, con
    // suavizado, para que el texto llegue nítido al umbral de 1 bit.
    var alto = Math.max(1, Math.round(canvas.height * dots / Math.max(1, canvas.width)));
    var c2 = document.createElement('canvas');
    c2.width = dots; c2.height = alto;
    var cx = c2.getContext('2d');
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, dots, alto);
    cx.imageSmoothingEnabled = true;
    try { cx.imageSmoothingQuality = 'high'; } catch (e) {}
    cx.drawImage(canvas, 0, 0, dots, alto);
    var px = cx.getImageData(0, 0, dots, alto).data;
    var bytes = [0x1b, 0x40];              // init
    // Se trocea en bandas: un GS v 0 con miles de filas desborda el buffer de muchas
    // impresoras y el trabajo sale cortado o no sale.
    var BANDA = 128;
    for (var y0 = 0; y0 < alto; y0 += BANDA) {
      var filas = Math.min(BANDA, alto - y0);
      bytes.push(0x1d, 0x76, 0x30, 0x00,
        anchoBytes & 0xff, (anchoBytes >> 8) & 0xff,
        filas & 0xff, (filas >> 8) & 0xff);
      for (var y = 0; y < filas; y++) {
        var fila = (y0 + y) * dots;
        for (var b = 0; b < anchoBytes; b++) {
          var byte = 0;
          for (var bit = 0; bit < 8; bit++) {
            var i = (fila + b * 8 + bit) * 4;
            // Lo transparente cuenta como papel blanco, no como tinta.
            var lum = px[i + 3] < 128 ? 255
              : (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
            if (lum < TK_UMBRAL) byte |= (0x80 >> bit);
          }
          bytes.push(byte);
        }
      }
    }
    bytes.push(0x1b, 0x64, 0x03);          // avanza para que el corte no muerda el pie
    bytes.push(0x1d, 0x56, 0x42, 0x00);    // corte
    return bytes;
  }

  // Imprime un documento HTML conservando su diseño, a tamaño exacto del papel.
  // Cadena de respaldo: si esto falla, el llamante decide (texto ESC/POS o diálogo).
  function tkPrintImagenESC(fullHtml, wmm, fallbackFn) {
    var fall = function () { if (typeof fallbackFn === 'function') fallbackFn(); };
    if (!tkIsDesktop()) { fall(); return Promise.resolve(false); }
    return tkGetPrinter(false, 'tk_impresora_ticket').then(function (impresora) {
      if (!impresora) { fall(); return false; }
      return _htmlACanvas(fullHtml, wmm || 80, null).then(function (canvas) {
        return tkInvoke('print_raw', { printer: impresora, data: _canvasAEscPos(canvas) })
          .then(function () {
            if (typeof toast === 'function') toast('🖨️ Ticket → ' + impresora, 'ok');
            return true;
          });
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('[tk] imagen ESC/POS falló:', err);
        fall();
        return false;
      });
    }).catch(function () { fall(); return false; });
  }
  window.tkPrintImagenESC = tkPrintImagenESC;

  // Pulso de apertura del cajón portamonedas (ESC/POS). No imprime nada: son doce
  // bytes que la impresora reenvía al conector RJ11 del cajón. Si no hay cajón
  // conectado, la impresora los ignora y no pasa nada — ni papel, ni error.
  // Se mandan los dos pines porque el cableado varía según el fabricante del cajón.
  function tkAbrirCajon(key) {
    if (!tkIsDesktop()) return Promise.resolve(false);
    var impresora = '';
    try { impresora = localStorage.getItem(key || 'tk_impresora_ticket') || ''; } catch (e) {}
    // Sin impresora elegida NO se abre el selector: el cajón no justifica
    // interrumpir un cobro con una pregunta. Se abrirá a partir del primer ticket.
    if (!impresora) return Promise.resolve(false);
    var ESC = 0x1b;
    var bytes = [
      ESC, 0x40,                    // init
      ESC, 0x70, 0x00, 0x32, 0xFA,  // pin 2
      ESC, 0x70, 0x01, 0x32, 0xFA   // pin 5
    ];
    return tkInvoke('print_raw', { printer: impresora, data: bytes })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  window.tkAbrirCajon = tkAbrirCajon;
})();
