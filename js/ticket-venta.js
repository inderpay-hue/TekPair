// js/ticket-venta.js — Ticket de venta de 80 mm, el MISMO en el panel y en el TPV.
//
// Antes había dos: el del panel (columnas, desglose de IVA, código de barras) y
// uno mucho más pobre en el TPV, que es el que más se imprime. Ahora los dos
// llaman a tkTicketVentaHtml(venta) y solo cambia cómo se manda a la impresora.
//
// Lee de lo global de cada página: TIENDA, AJUSTES, DB (stock y clientes), T()
// y, si están, cur() para la moneda, tkPartesVenta() (usados en régimen de
// margen, js/usados.js) y _pagoTxt() (pago mixto).
(function () {
  var _C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
'221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
'221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
'212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
'231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
'231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
'314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
'112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
'111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
'214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
'114131','311141','411131','211412','211214','211232','2331112'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    n = parseFloat(n) || 0;
    if (typeof cur === 'function') return cur(n);
    var m = (typeof AJUSTES !== 'undefined' && AJUSTES && AJUSTES.moneda) || 'EUR';
    var sym = { EUR: '€', USD: '$', GBP: '£', MXN: '$', ARS: '$', COP: '$', CLP: '$', PEN: 'S/ ', BRL: 'R$ ', UYU: '$' }[m] || (m + ' ');
    return sym + n.toFixed(2);
  }
  function txt(k) { return (typeof T === 'function') ? T(k) : k; }

  function code128Html(texto, altoPx, unidadPx) {
    var str = String(texto || '').replace(/[^\x20-\x7E]/g, '');
    if (!str) return '';
    var codigos = [104], suma = 104;            // Start B
    for (var i = 0; i < str.length; i++) {
      var v = str.charCodeAt(i) - 32;
      if (v < 0 || v > 94) continue;
      codigos.push(v); suma += v * (i + 1);
    }
    codigos.push(suma % 103);                   // dígito de control
    codigos.push(106);                          // Stop
    var anchos = '';
    for (var k = 0; k < codigos.length; k++) anchos += _C128[codigos[k]];
    var h = altoPx || 36, u = unidadPx || 1.3, out = '';
    for (var j = 0; j < anchos.length; j++) {
      var w = (parseInt(anchos[j], 10) || 0) * u;
      out += '<i style="display:inline-block;width:' + w.toFixed(2) + 'px;height:' + h +
        'px;background:' + (j % 2 === 0 ? '#000' : 'transparent') + '"></i>';
    }
    return '<div style="font-size:0;line-height:0;white-space:nowrap;text-align:center">' + out + '</div>';
  }

  // Número de documento legible. Sin número (la secuencia aún no lo ha dado) no
  // se inventa nada: el ticket sale sin número en vez de con uno falso.
  function numero(v) {
    if (!v || !v.numero) return '';
    var anio = String(v.fecha || '').slice(0, 4) || String(new Date().getFullYear());
    return 'T' + anio + '-' + String(v.numero).padStart(6, '0');
  }

  // Fecha con hora: de created_at si está; si no, del id ('v' + Date.now() + …),
  // que es como la guarda el TPV recién cobrada.
  function fechaHora(v) {
    var d = null;
    if (v.createdAt) d = new Date(v.createdAt);
    if (!d || isNaN(d)) { var m = /^v(\d{13})_/.exec(String(v.id || '')); if (m) d = new Date(parseInt(m[1], 10)); }
    var dd = function (n) { return ('0' + n).slice(-2); };
    if (d && !isNaN(d)) return dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes());
    var p = String(v.fecha || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(v.fecha || '');
  }

  // Lo que va debajo de cada línea: IMEI, estado si no es nuevo y garantía en
  // meses. De la propia línea (el TPV lo guarda al vender) o, en ventas
  // antiguas, de la ficha de stock de ese producto.
  var TIPO_KEY = { seminuevo: 'stock.seminuevo', segunda: 'stock.segunda_mano', reacond: 'stock.reacond' };
  function extrasLinea(it, v, nItems) {
    var stock = (typeof DB !== 'undefined' && DB && DB.stock) || [];
    var sid = it.idOriginal || it.stockId || it.id || (nItems === 1 ? v.stockId : '');
    var st = sid ? stock.find(function (s) { return s.id === sid; }) : null;
    var imei = it.imei || (nItems === 1 ? (v.imei || '') : '') || (st && st.imei) || '';
    var tipo = it.tipoProd || (st && st.tipo) || '';
    var gm = (it.garantiaMeses != null) ? parseInt(it.garantiaMeses, 10) : (st ? parseInt(st.garantiaMeses, 10) : 0);
    var estado = (tipo && TIPO_KEY[tipo]) ? String(txt(TIPO_KEY[tipo])).replace(/^[^\p{L}\p{N}]+/u, '').trim() : '';
    var esProducto = !it.esServicio && !it.esRapida && (st || it.imei);
    return { imei: imei, estado: estado, garantia: (esProducto && gm > 0) ? txt('tkt.garantia_meses').replace('{n}', gm) : '', conGarantia: !!(esProducto && gm > 0) };
  }

  // opts.imprimir: añade el script que abre el diálogo de impresión al cargar.
  function tkTicketVentaHtml(v, opts) {
    opts = opts || {};
    var TI = (typeof TIENDA !== 'undefined' && TIENDA) || {};
    var AJ = (typeof AJUSTES !== 'undefined' && AJUSTES) || {};
    var clis = (typeof DB !== 'undefined' && DB && DB.clis) || [];

    var cab = (TI.logo_url ? '<div class="c" style="margin-bottom:5px"><img src="' + esc(TI.logo_url) + '" style="max-height:52px;max-width:60mm;object-fit:contain"></div>' : '') +
      '<div class="c nom">' + esc(TI.nombre || 'TekPair') + '</div>' +
      (TI.dir ? '<div class="c sm">' + esc(TI.dir) + '</div>' : '') +
      (TI.cif ? '<div class="c sm">' + txt('tkt.nif') + ': ' + esc(TI.cif) + '</div>' : '') +
      (TI.tel ? '<div class="c sm">Tel: ' + esc(TI.tel) + '</div>' : '');

    // ── Cabecera del documento ──
    var num = numero(v);
    var filas = [[txt('tkt.documento'), (AJ.ticketDoc || txt('tkt.doc_def'))]];
    if (num) filas.push([txt('tkt.numero'), num]);
    filas.push([txt('pres.doc_fecha'), fechaHora(v)]);
    var sinCli = !v.clienteNombre || v.clienteNombre === 'Sin cliente';
    filas.push([txt('pres.doc_cliente'), sinCli ? txt('gen.sin_cliente') : v.clienteNombre]);
    var cli = v.clienteId ? clis.find(function (c) { return c.id === v.clienteId; }) : null;
    if (cli && cli.dni) filas.push([txt('tkt.nif'), cli.dni]);
    if (cli && cli.tel) filas.push([txt('ficha.telefono'), cli.tel]);
    if (v.atiende) filas.push([txt('tkt.atiende'), v.atiende]);
    var datos = filas.map(function (f) { return '<div class="row"><span>' + esc(String(f[0]).replace(/:\s*$/, '')) + '</span><strong>' + esc(f[1]) + '</strong></div>'; }).join('');

    // ── Líneas, con cabecera de tabla y precio unitario ──
    var items = (v.items && v.items.length) ? v.items
      : [{ nombre: ((v.marca ? v.marca + ' ' : '') + (v.modelo || '')).trim() || txt('tkt.doc_def'), precio: v.precio || v.total, qty: 1, imei: v.imei || '' }];
    var algunaGarantia = false;
    var lineas = items.map(function (it) {
      var ex = extrasLinea(it, v, items.length);
      if (ex.conGarantia) algunaGarantia = true;
      var qty = parseFloat(it.qty != null ? it.qty : it.cantidad) || 1;
      var pu = parseFloat(it.precio) || 0;
      var sub = pu * qty;
      var dv = parseFloat(it.desc) || 0;
      var dl = dv > 0 ? Math.min(it.descTipo === 'pct' ? sub * dv / 100 : dv, sub) : 0;
      return '<div class="it"><span class="it-q">' + qty + '</span>' +
          '<span class="it-d">' + esc(it.nombre) + (it.usado && it.usado.regimen === 'margen' ? ' (*)' : '') + '</span>' +
          '<span class="it-u">' + money(pu) + '</span><span class="it-t">' + money(sub) + '</span></div>' +
        (ex.imei ? '<div class="it-nota">IMEI: ' + esc(ex.imei) + '</div>' : '') +
        (ex.estado ? '<div class="it-nota">' + esc(ex.estado) + '</div>' : '') +
        (ex.garantia ? '<div class="it-nota">' + esc(ex.garantia) + '</div>' : '') +
        (it.notas ? '<div class="it-nota">' + esc(it.notas) + '</div>' : '') +
        (dl > 0 ? '<div class="it"><span class="it-q"></span><span class="it-d">' + txt('tkt.descuento') + (it.descTipo === 'pct' ? ' ' + dv + '%' : '') +
          '</span><span class="it-u"></span><span class="it-t">-' + money(dl) + '</span></div>' : '');
    }).join('');

    // ── Sumas y desglose de IVA ──
    // Los usados en régimen de margen no desglosan su impuesto: solo la parte normal.
    var P = (typeof tkPartesVenta === 'function') ? tkPartesVenta(v) : { normalBase: v.base || 0, normalIva: v.ivaImporte || 0, mencion: '', hay: false };
    var ivaOn = !!(v.iva && v.ivaModo && v.ivaModo !== 'sin') && (!P.hay || P.normalBase > 0);
    var sumas = '';
    if (v.descuento > 0) {
      sumas += '<div class="row"><span>' + txt('tkt.subtotal') + '</span><span>' + money(v.precio || 0) + '</span></div>' +
        '<div class="row"><span>' + txt('tkt.descuento') + '</span><span>-' + money(v.descuento) + '</span></div>';
    }
    var iva = ivaOn
      ? '<div class="sep"></div><div class="tit">' + txt('tkt.desglose_iva') + '</div>' +
        '<div class="iv th"><span>IVA</span><span>' + txt('pres.doc_base_imponible') + '</span><span>' + txt('tkt.cuota_iva') + '</span></div>' +
        '<div class="iv"><span>' + v.iva + '%</span><span>' + money(P.normalBase || 0) + '</span><span>' + money(P.normalIva || 0) + '</span></div>'
      : '';
    if (P.mencion) iva += '<div class="sm" style="margin-top:3px">(*) ' + esc(P.mencion) + '</div>';

    // ── Pago, y lo entregado/cambio cuando se cobró en efectivo ──
    var pagoTxt = (typeof _pagoTxt === 'function') ? _pagoTxt(v) : (v.pago || '');
    var pago = '<div class="row"><span>' + esc(String(txt('tpv.tk_pago')).replace(/:\s*$/, '')) + '</span><strong>' + esc(pagoTxt) + '</strong></div>';
    if (v.entregado > 0) {
      pago += '<div class="row"><span>' + txt('tkt.entregado') + '</span><span>' + money(v.entregado) + '</span></div>' +
        '<div class="row"><span>' + txt('tkt.cambio') + '</span><strong>' + money(Math.max(0, v.entregado - (v.total || 0))) + '</strong></div>';
    }

    // ── Pie ──
    // Garantía y cambios: el texto de la tienda (Ajustes) si lo tiene; si no, un
    // texto neutro que no promete plazos que la tienda no haya puesto.
    var pie = '<div class="c gracias">' + txt('tpv.gracias_compra') + '</div>';
    if (TI.garVenActiva !== false && (TI.garantiaVentas || algunaGarantia)) {
      pie += '<div class="blq"><div class="tit">' + txt('tkt.pie_garantia') + '</div><div class="sm">' +
        esc(TI.garantiaVentas || txt('tkt.pie_garantia_def')) + '</div></div>';
    }
    pie += '<div class="blq"><div class="tit">' + txt('tkt.pie_cambios') + '</div><div class="sm">' +
      esc(TI.politicaVentas || txt('tkt.conserve')) + '</div></div>';
    if (AJ.ticketPie) pie += '<div class="blq sm c">' + esc(AJ.ticketPie) + '</div>';
    var contacto = [TI.web, TI.email, TI.tel ? 'Tel: ' + TI.tel : ''].filter(Boolean).concat(redesTk(AJ));
    if (contacto.length) pie += '<div class="sep"></div><div class="c sm">' + contacto.map(esc).join('<br>') + '</div>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket ' + esc(num || v.id || '') + '</title>' +
      '<style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{width:80mm}' +
      'body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:2mm 1.5mm 6mm;color:#000;font-size:12.5px;font-weight:700;line-height:1.3;-webkit-font-smoothing:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
      'body *{color:#000!important}' +
      '.c{text-align:center}.sm{font-size:11.5px;line-height:1.35;font-weight:400}' +
      '.nom{font-size:17px;font-weight:900;letter-spacing:.2px;margin-bottom:1px}' +
      '.sep{border-top:1.5px dashed #000;margin:5px 0}' +
      '.row{display:flex;justify-content:space-between;gap:8px;margin:1px 0}' +
      '.tit{font-weight:900;font-size:11.5px;letter-spacing:.3px;margin:2px 0 1px;text-transform:uppercase}' +
      // Rejilla de 4 columnas: la descripción es la única elástica, así los
      // importes de la derecha quedan siempre alineados aunque el nombre sea largo.
      '.it{display:grid;grid-template-columns:22px 1fr 52px 56px;gap:3px;margin:1px 0;align-items:baseline}' +
      '.it-q{text-align:left}.it-d{word-break:break-word}.it-u,.it-t{text-align:right;font-variant-numeric:tabular-nums}' +
      '.th{font-size:10.5px;font-weight:900;border-bottom:1px solid #000;padding-bottom:1px;margin-bottom:2px}' +
      '.it-nota{font-size:10.5px;padding-left:25px;font-weight:400}' +
      '.iv{display:grid;grid-template-columns:42px 1fr 1fr;gap:4px;margin:1px 0}' +
      '.iv span:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}' +
      '.tot{display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-size:16px;font-weight:900;border-top:2px solid #000;border-bottom:2px solid #000;padding:4px 0;margin:5px 0}' +
      '.tot span:first-child{font-size:12.5px}.tot span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.gracias{font-size:14px;font-weight:900;margin:6px 0 4px}' +
      '.blq{margin-top:6px}' +
      '.rembolso{text-align:center;font-weight:900;border:1.5px solid #000;padding:3px;margin:4px 0}' +
      '</style></head><body>' +
      cab + '<div class="sep"></div>' + datos +
      (v.reembolsado ? '<div class="rembolso">' + txt('tpv.reembolsada') + '</div>' : '') +
      '<div class="sep"></div>' +
      '<div class="it th"><span class="it-q">' + txt('tkt.uds') + '</span><span class="it-d">' + txt('tkt.descripcion') +
        '</span><span class="it-u">' + txt('tkt.pvp_ud') + '</span><span class="it-t">' + txt('tkt.total_col') + '</span></div>' +
      lineas + '<div class="sep"></div>' + sumas + iva +
      '<div class="tot"><span>' + txt('pres.doc_total') + (v.ivaModo === 'incluido' && ivaOn ? ' ' + txt('tkt.iva_inc') : '') +
        '</span><span>' + money(v.total || 0) + '</span></div>' +
      pago +
      (num ? '<div class="sep"></div>' + code128Html(num, 34, 1.3) + '<div class="c" style="font-size:10.5px;letter-spacing:1px;margin-top:2px">' + esc(num) + '</div>' : '') +
      '<div class="sep"></div>' + pie +
      (opts.imprimir ? '<script>window.onload=function(){setTimeout(function(){window.print();},200);}<\/script>' : '') +
      '</body></html>';
  }

  // Textos del pie para el ticket de texto (ESC/POS) de la app de escritorio.
  function tkTicketVentaPie(v) {
    var TI = (typeof TIENDA !== 'undefined' && TIENDA) || {};
    var AJ = (typeof AJUSTES !== 'undefined' && AJUSTES) || {};
    var items = (v && v.items) || [];
    var algunaGarantia = items.some(function (it) { return extrasLinea(it, v, items.length).conGarantia; });
    var pie = [txt('tpv.gracias_compra')];
    if (TI.garVenActiva !== false && (TI.garantiaVentas || algunaGarantia)) pie.push(txt('tkt.pie_garantia') + ': ' + (TI.garantiaVentas || txt('tkt.pie_garantia_def')));
    pie.push(txt('tkt.pie_cambios') + ': ' + (TI.politicaVentas || txt('tkt.conserve')));
    if (AJ.ticketPie) pie.push(AJ.ticketPie);
    [TI.web, TI.email].filter(Boolean).concat(redesTk(AJ)).forEach(function (x) { pie.push(x); });
    return pie;
  }

  // Redes sociales de la tienda (Ajustes → Impresión): «Instagram: @usuario».
  // Si se pegó el enlace entero, se queda solo el usuario: ocupa menos papel.
  function redesTk(AJ) {
    var r = (AJ && AJ.redes) || {}, out = [];
    [['instagram', 'Instagram', /instagram\.com\/([^/?#]+)/i, true], ['tiktok', 'TikTok', /tiktok\.com\/@?([^/?#]+)/i, true], ['facebook', 'Facebook', /facebook\.com\/([^/?#]+)/i, false]].forEach(function (d) {
      var v = String(r[d[0]] || '').trim(); if (!v) return;
      var m = d[2].exec(v); if (m) v = decodeURIComponent(m[1]);
      if (d[3] && v.charAt(0) !== '@' && !/\s/.test(v)) v = '@' + v;
      out.push(d[1] + ': ' + v);
    });
    return out;
  }

  window.tkTicketVentaHtml = tkTicketVentaHtml;
  window.tkRedesTicket = function () { return redesTk((typeof AJUSTES !== 'undefined' && AJUSTES) || {}); };
  window.tkTicketVentaPie = tkTicketVentaPie;
  window.tkTicketExtrasLinea = extrasLinea;
})();
