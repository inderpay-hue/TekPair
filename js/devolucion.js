// js/devolucion.js — Devolución PARCIAL (y cambio) de una venta, desde el panel.
//
// Antes solo había «Reembolsar» la venta entera (reembolsarVenta en dash-app.js):
// marca la venta reembolsado=true y la caja resta TODO el ticket el día de la
// devolución. Si un cliente compraba 5 cosas y devolvía 1, no había forma.
//
// Cómo funciona (sin columnas nuevas en la base de datos):
//  · La devolución es una FILA NUEVA en `ventas` con importes en negativo (total,
//    precio, base, IVA) y la forma de pago con la que se devuelve el dinero.
//    Toda la caja (panel, TPV y el cierre del servidor en api/cajas.js) ya suma
//    las ventas del día por forma de pago, así que el importe sale de la caja del
//    día con su método sin tocar ningún cálculo de caja.
//  · Sus líneas (items) llevan qty en negativo y `dev: { v: id venta original,
//    n: número de ticket, f: fecha, i: índice de línea }`. Así se reconoce como
//    devolución (tkEsDevolucion) y los informes que suman unidades restan.
//  · La venta original NO se marca reembolsada (eso restaría el ticket entero
//    otra vez): cada línea guarda `devuelto` (unidades ya devueltas) y `devs`
//    (historial: id de la devolución, fecha, unidades, importe y método).
//  · El importe de cada línea es su parte de lo COBRADO: descuento de línea y
//    descuento general repartidos en proporción, e IVA si se cobraba aparte.
//    Al completar una línea (o la venta) se devuelve exactamente lo que falte,
//    así varias devoluciones parciales nunca suman más que el ticket.
//  · «Cambio»: la devolución se hace con la forma de pago «Cambio» y se abre el
//    TPV con ese importe como saldo a favor (tk_cambio_pend). La venta nueva lo
//    usa como parte del pago («Cambio»), con lo que ese método se queda a cero y
//    en la caja solo se mueve la diferencia real (ver tpv.html, _cambio*).
(function () {
  'use strict';

  var METODOS = ['Efectivo', 'Tarjeta', 'Bizum'];
  var CAMBIO = 'Cambio';

  function r2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
  function txt(k) { return (typeof T === 'function') ? T(k) : k; }
  function e(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function money(n) { n = r2(n); return (n < 0 ? '-' : '') + ((typeof cur === 'function') ? cur(Math.abs(n)) : Math.abs(n).toFixed(2)); }
  function hoy() { return (typeof hoyLocal === 'function') ? hoyLocal() : new Date().toISOString().slice(0, 10); }
  function items(v) {
    var its = v && v.items;
    if (typeof its === 'string') { try { its = JSON.parse(its); } catch (x) { its = null; } }
    return Array.isArray(its) ? its : [];
  }
  function cant(it) { return Math.abs(parseFloat(it && (it.qty != null ? it.qty : it.cantidad)) || 1); }
  function descLinea(it) {
    var bruto = (parseFloat(it.precio) || 0) * cant(it);
    var d = parseFloat(it.desc) || 0;
    if (d <= 0) return 0;
    d = it.descTipo === 'pct' ? bruto * d / 100 : d;
    return Math.min(Math.max(0, d), bruto);
  }
  function devuelto(it) { return parseInt(it && it.devuelto, 10) || 0; }
  function numTicket(v) {
    if (!v || !v.numero) return '';
    return 'T' + String(v.fecha || '').slice(0, 4) + '-' + String(v.numero).padStart(6, '0');
  }

  // ── Consultas que usan también dash-app.js, ticket-venta.js y el TPV ──
  function devDe(v) {
    var its = items(v);
    for (var i = 0; i < its.length; i++) if (its[i] && its[i].dev && its[i].dev.v) return its[i].dev;
    return null;
  }
  function tieneDevoluciones(v) { return items(v).some(function (it) { return devuelto(it) > 0; }); }
  function devueltaEntera(v) {
    var its = items(v);
    return its.length > 0 && its.every(function (it) { return devuelto(it) >= cant(it); });
  }
  function importeDevuelto(v) {
    return r2(items(v).reduce(function (a, it) {
      return a + (Array.isArray(it.devs) ? it.devs : []).reduce(function (s, d) { return s + (parseFloat(d.imp) || 0); }, 0);
    }, 0));
  }
  // Historial de devoluciones de una venta, una entrada por devolución.
  function historial(v) {
    var por = {}, orden = [];
    items(v).forEach(function (it) {
      (Array.isArray(it.devs) ? it.devs : []).forEach(function (d) {
        if (!por[d.id]) { por[d.id] = { id: d.id, f: d.f, m: d.m, imp: 0, lineas: [] }; orden.push(d.id); }
        por[d.id].imp = r2(por[d.id].imp + (parseFloat(d.imp) || 0));
        por[d.id].lineas.push((d.q > 1 ? d.q + '× ' : '') + (it.nombre || '-'));
      });
    });
    return orden.map(function (k) { return por[k]; });
  }

  // ── Reparto de lo cobrado entre las líneas ──
  function calcular(v) {
    var its = items(v);
    var nets = its.map(function (it) { return Math.max(0, (parseFloat(it.precio) || 0) * cant(it) - descLinea(it)); });
    var sumNet = nets.reduce(function (a, n) { return a + n; }, 0);
    var sumDL = its.reduce(function (a, it) { return a + descLinea(it); }, 0);
    var discG = Math.min(sumNet, Math.max(0, (parseFloat(v.descuento) || 0) - sumDL));
    var preIva = Math.max(0, sumNet - discG);
    var total = parseFloat(v.total) || 0;
    return its.map(function (it, i) {
      var pre = sumNet > 0 ? nets[i] - discG * nets[i] / sumNet : 0;   // neto de la línea (sin IVA aparte)
      var prev = (Array.isArray(it.devs) ? it.devs : []).reduce(function (s, d) { return s + (parseFloat(d.imp) || 0); }, 0);
      return {
        idx: i, it: it, qty: cant(it), devuelto: devuelto(it),
        max: Math.max(0, cant(it) - devuelto(it)),
        pre: pre, imp: preIva > 0 ? total * pre / preIva : 0, prev: prev
      };
    });
  }
  function importeLinea(L, n) {
    if (n <= 0) return 0;
    if (L.devuelto + n >= L.qty) return Math.max(0, r2(L.imp - L.prev));   // completa la línea: lo que falte
    return r2(L.imp * n / L.qty);
  }
  // Total de una selección { idx: unidades }. Nunca más de lo que queda por devolver del ticket.
  function totalSel(v, Ls, sel) {
    var t = 0, completa = true;
    Ls.forEach(function (L) {
      var n = sel[L.idx] || 0;
      t += importeLinea(L, n);
      if (L.devuelto + n < L.qty) completa = false;
    });
    var queda = Math.max(0, r2((parseFloat(v.total) || 0) - importeDevuelto(v)));
    return completa ? queda : Math.min(r2(t), queda);
  }

  // ¿Se puede hacer una devolución parcial de esta venta? Devuelve la clave del motivo si no.
  function motivoNo(v) {
    if (!v) return 'vent.no_encontrada';
    if (devDe(v)) return 'dev.es_devolucion';
    if (items(v).some(function (it) { return it && it.undev && it.undev.d; })) return 'dr.contraria_no';
    if (v.reembolsado) return 'ev.reembolsada_no';
    if (v.financiado) return 'dev.financiada';
    if (!items(v).length) return 'dev.sin_lineas';
    if (devueltaEntera(v)) return 'dev.ya_entera';
    return '';
  }

  // ═══ Modal «Devolver / cambiar» ═══
  function abrirDevolucion(id) {
    if (typeof tienePerm === 'function' && !tienePerm('ventas_reembolso')) { toast(txt('gen.sin_permiso'), 'err'); return; }
    var v = (DB.ventas || []).find(function (x) { return x.id === id; });
    var mot = motivoNo(v);
    // Sin líneas (ventas antiguas de un artículo) o financiada: la devolución entera de siempre.
    if (mot === 'dev.sin_lineas' || mot === 'dev.financiada') {
      if (typeof reembolsarVenta === 'function') reembolsarVenta(id);
      return;
    }
    if (mot) { toast(txt(mot), 'err'); return; }

    var Ls = calcular(v);
    var sel = {};
    var metodo = METODOS.indexOf(v.pago) !== -1 ? v.pago : 'Efectivo';
    var num = numTicket(v);
    var hist = historial(v);
    var nombreMovil = (typeof _nombreMovil === 'function') ? _nombreMovil() : 'Bizum';
    var lblMet = function (m) { return m === 'Bizum' ? nombreMovil : ((typeof _pagoLbl === 'function') ? _pagoLbl(m) : m); };

    var filas = Ls.map(function (L) {
      var it = L.it, agotada = L.max <= 0;
      return '<tr data-idx="' + L.idx + '" style="border-bottom:1px solid var(--border,#E2E8F0);' + (agotada ? 'opacity:.5' : '') + '">' +
        '<td style="padding:8px 4px;width:28px"><input type="checkbox" class="_dvChk" ' + (agotada ? 'disabled' : '') + ' style="width:18px;height:18px;cursor:pointer"></td>' +
        '<td style="padding:8px 4px">' + e(it.nombre || '-') +
          (it.imei ? '<div style="font-size:11px;color:var(--muted)">IMEI: ' + e(it.imei) + '</div>' : '') +
          '<div style="font-size:11px;color:var(--muted)">' + e(txt('dev.vendidas').replace(/\{n\}/g, L.qty)) +
            (L.devuelto ? ' · ' + e(txt('dev.ya_devueltas').replace(/\{n\}/g, L.devuelto)) : '') + '</div></td>' +
        '<td style="padding:8px 4px;text-align:center;white-space:nowrap">' + (agotada ? '<span style="font-size:11.5px;font-weight:700;color:var(--red,#EF4444)">' + e(txt('dev.devuelto')) + '</span>' :
          '<input type="number" class="_dvQty" min="0" max="' + L.max + '" step="1" value="0" inputmode="numeric" style="width:58px;padding:6px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font:inherit;text-align:center;color:inherit;background:var(--light,#fff)">' +
          '<div style="font-size:10.5px;color:var(--muted)">' + e(txt('dev.max').replace(/\{n\}/g, L.max)) + '</div>') + '</td>' +
        '<td class="_dvImp" style="padding:8px 4px;text-align:right;font-weight:700;white-space:nowrap">' + money(0) + '</td>' +
      '</tr>';
    }).join('');

    var chips = METODOS.concat([CAMBIO]).map(function (m) {
      var ic = { Efectivo: '💵', Tarjeta: '💳', Bizum: '📲', Cambio: '🔁' }[m];
      return '<button type="button" class="_dvMet" data-m="' + m + '" style="flex:1 1 120px;padding:10px 8px;border:2px solid var(--border,#E5E7EB);background:transparent;color:inherit;border-radius:10px;cursor:pointer;font:inherit;font-size:13px;font-weight:700">' +
        ic + ' ' + e(m === CAMBIO ? txt('dev.metodo_cambio') : lblMet(m)) + '</button>';
    }).join('');

    var histHtml = hist.length ? '<div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--border,#E2E8F0)">' +
      '<div style="font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin-bottom:6px">' + e(txt('dev.historial')) + '</div>' +
      hist.map(function (h) {
        var existe = (DB.ventas || []).some(function (x) { return x.id === h.id; });
        return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px">' +
          '<div style="flex:1;min-width:0"><strong>' + e((typeof fmtFecha === 'function') ? fmtFecha(h.f) : h.f) + '</strong> · ' + e(h.lineas.join(', ')) +
          ' <span style="color:var(--muted)">(' + e(h.m === CAMBIO ? txt('dev.metodo_cambio') : lblMet(h.m)) + ')</span></div>' +
          '<div style="font-weight:700;color:var(--red,#EF4444);white-space:nowrap">-' + money(h.imp) + '</div>' +
          (existe ? '<button type="button" class="_dvReimp" data-id="' + e(h.id) + '" title="' + e(txt('dev.imprimir')) + '" style="border:1px solid var(--border,#E5E7EB);background:transparent;border-radius:7px;padding:3px 7px;cursor:pointer">🖨</button>' : '') +
        '</div>';
      }).join('') + '</div>' : '';

    var m = _modalOverlay(
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px">' +
        '<h3 style="margin:0;font-size:17px;font-weight:800">↩️ ' + e(txt('dev.titulo')) + '</h3>' +
        '<button type="button" id="_dvX" aria-label="' + e(txt('gen.cerrar')) + '" style="border:none;background:transparent;font-size:20px;cursor:pointer;color:var(--muted)">×</button>' +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">' + e([num, (typeof fmtFecha === 'function') ? fmtFecha(v.fecha) : v.fecha,
        (typeof _cliLbl === 'function') ? _cliLbl(v.clienteNombre) : v.clienteNombre, txt('gen.total_2') + ' ' + money(v.total)].filter(Boolean).join(' · ')) + '</div>' +
      '<div style="font-size:12.5px;margin-bottom:6px">' + e(txt('dev.ayuda')) + '</div>' +
      '<div style="overflow-x:auto;max-height:42vh;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:13.5px"><tbody>' + filas + '</tbody></table></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin:12px 0 10px;font-size:15px"><span style="font-weight:700">' + e(txt('dev.a_devolver')) + '</span>' +
        '<strong id="_dvTotal" style="font-size:20px;color:var(--red,#EF4444)">' + money(0) + '</strong></div>' +
      '<div style="font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin-bottom:6px">' + e(txt('dev.forma')) + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + chips + '</div>' +
      '<div id="_dvNotaCambio" style="display:none;font-size:12px;margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(59,130,246,.10);color:inherit">' + e(txt('dev.cambio_nota')) + '</div>' +
      histHtml +
      '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;flex-wrap:wrap">' +
        '<button type="button" id="_dvNo" style="padding:10px 16px;border:1px solid var(--border,#E5E7EB);background:transparent;color:inherit;border-radius:9px;cursor:pointer;font:inherit;font-weight:600">' + e(txt('gen.cancelar_2')) + '</button>' +
        '<button type="button" id="_dvOk" disabled style="padding:10px 16px;border:none;background:#EF4444;color:#fff;border-radius:9px;cursor:pointer;font:inherit;font-weight:700;opacity:.5">' + e(txt('dev.confirmar_btn')) + '</button>' +
      '</div>' +
      (!tieneDevoluciones(v) ? '<div style="text-align:center;margin-top:10px"><button type="button" id="_dvEntera" style="border:none;background:transparent;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px">' + e(txt('dev.entera_link')) + '</button></div>' : '')
    );
    m.box.style.maxWidth = '600px';
    m.box.style.maxHeight = '92vh';
    m.box.style.overflowY = 'auto';

    function pintar() {
      var t = totalSel(v, Ls, sel), hay = false;
      m.box.querySelectorAll('tr[data-idx]').forEach(function (tr) {
        var L = Ls[+tr.getAttribute('data-idx')], n = sel[L.idx] || 0;
        if (n > 0) hay = true;
        var c = tr.querySelector('._dvChk'); if (c) c.checked = n > 0;
        tr.querySelector('._dvImp').textContent = money(importeLinea(L, n));
      });
      m.box.querySelector('#_dvTotal').textContent = '-' + money(t);
      var ok = m.box.querySelector('#_dvOk');
      ok.disabled = !hay; ok.style.opacity = hay ? '1' : '.5';
      ok.textContent = hay ? txt(metodo === CAMBIO ? 'dev.confirmar_cambio' : 'dev.confirmar_importe').replace(/\{x\}/g, money(t)) : txt('dev.confirmar_btn');
      m.box.querySelectorAll('._dvMet').forEach(function (b) {
        var on = b.getAttribute('data-m') === metodo;
        b.style.borderColor = on ? 'var(--green,#10B981)' : 'var(--border,#E5E7EB)';
        b.style.background = on ? 'rgba(16,185,129,.10)' : 'transparent';
      });
      m.box.querySelector('#_dvNotaCambio').style.display = metodo === CAMBIO ? 'block' : 'none';
    }
    m.box.querySelectorAll('tr[data-idx]').forEach(function (tr) {
      var L = Ls[+tr.getAttribute('data-idx')];
      var q = tr.querySelector('._dvQty'), c = tr.querySelector('._dvChk');
      if (!q) return;
      q.addEventListener('input', function () {
        var n = parseInt(q.value, 10) || 0;
        n = Math.max(0, Math.min(L.max, n));
        if (String(n) !== q.value && q.value !== '') q.value = n;
        sel[L.idx] = n; pintar();
      });
      c.addEventListener('change', function () {
        var n = c.checked ? L.max : 0;
        q.value = n; sel[L.idx] = n; pintar();
      });
    });
    m.box.querySelectorAll('._dvMet').forEach(function (b) { b.onclick = function () { metodo = b.getAttribute('data-m'); pintar(); }; });
    m.box.querySelectorAll('._dvReimp').forEach(function (b) { b.onclick = function () { if (typeof imprimirTicketVenta === 'function') imprimirTicketVenta(b.getAttribute('data-id')); }; });
    m.box.querySelector('#_dvNo').onclick = m.close;
    m.box.querySelector('#_dvX').onclick = m.close;
    var bEnt = m.box.querySelector('#_dvEntera');
    if (bEnt) bEnt.onclick = function () { m.close(); if (typeof reembolsarVenta === 'function') reembolsarVenta(id); };
    m.bg.addEventListener('click', function (ev) { if (ev.target === m.bg) m.close(); });
    m.box.querySelector('#_dvOk').onclick = function () {
      var t = totalSel(v, Ls, sel);
      var elegidas = Ls.filter(function (L) { return (sel[L.idx] || 0) > 0; }).map(function (L) { return { idx: L.idx, n: sel[L.idx] }; });
      if (!elegidas.length) return;
      var msg = txt(metodo === CAMBIO ? 'dev.confirm_cambio' : 'dev.confirm').replace(/\{x\}/g, money(t))
        .replace(/\{n\}/g, elegidas.reduce(function (a, s) { return a + s.n; }, 0)).replace(/\{m\}/g, lblMet(metodo));
      confirmar(msg, function () {
        m.close();
        ejecutar(id, elegidas, metodo);
      }, { okLabel: txt('dev.confirmar_btn'), danger: true });
    };
    pintar();
  }

  // ═══ Hacer la devolución ═══
  var _enCurso = false;
  function ejecutar(id, elegidas, metodo) {
    if (_enCurso) return;
    _enCurso = true;
    var resultado = null;
    tpWithBusy(txt('dev.procesando'), function () {
      var v = (DB.ventas || []).find(function (x) { return x.id === id; });
      if (!v) return null;
      var hayNube = !!(typeof SB_KEY !== 'undefined' && SB_KEY && typeof TIENDA_ID !== 'undefined' && TIENDA_ID);
      // Antes de nada, las líneas como están en la nube: otro equipo puede haber devuelto algo ya.
      var leer = hayNube ? fetch(SUPABASE_URL + '/rest/v1/ventas?id=eq.' + encodeURIComponent(id) + '&tienda_id=eq.' + encodeURIComponent(TIENDA_ID) + '&select=items,reembolsado', {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + (JWT_TOKEN || SB_KEY) }
      }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null);
      return leer.then(function (rows) {
        var fila = Array.isArray(rows) && rows[0];
        if (fila) {
          if (fila.reembolsado) { v.reembolsado = true; toast(txt('ev.reembolsada_no'), 'err'); return null; }
          var nub = items({ items: fila.items });
          if (nub.length === items(v).length) v.items = nub;
        }
        var mot = motivoNo(v);
        if (mot) { toast(txt(mot), 'err'); return null; }
        var Ls = calcular(v), sel = {};
        for (var k = 0; k < elegidas.length; k++) {
          var L0 = Ls[elegidas[k].idx];
          if (!L0 || elegidas[k].n > L0.max) { toast(txt('dev.cambiado'), 'err'); return null; }
          sel[elegidas[k].idx] = elegidas[k].n;
        }
        var imp = totalSel(v, Ls, sel);
        var f = hoy();
        var devId = 'v' + Date.now() + '_dev' + Math.random().toString(36).slice(2, 6);
        var num = numTicket(v);

        // Importe de cada línea; el redondeo que sobre (o falte) va a la última para que sumen justo `imp`.
        var lineas = Ls.filter(function (L) { return (sel[L.idx] || 0) > 0; }).map(function (L) {
          var n = sel[L.idx];
          return { L: L, n: n, imp: importeLinea(L, n), pre: L.pre * n / L.qty };
        });
        var suma = lineas.reduce(function (a, x) { return a + x.imp; }, 0);
        if (lineas.length) lineas[lineas.length - 1].imp = r2(lineas[lineas.length - 1].imp + (imp - suma));
        var preSel = lineas.reduce(function (a, x) { return a + x.pre; }, 0);
        var ratio = (parseFloat(v.total) || 0) > 0 ? imp / v.total : 0;

        var nuevos = JSON.parse(JSON.stringify(items(v)));
        lineas.forEach(function (x) {
          var it = nuevos[x.L.idx];
          it.devuelto = devuelto(it) + x.n;
          it.devs = (Array.isArray(it.devs) ? it.devs : []).concat([{ id: devId, f: f, q: x.n, imp: r2(x.imp), m: metodo }]);
        });
        var nombres = lineas.map(function (x) { return (x.n > 1 ? x.n + '× ' : '') + (x.L.it.nombre || '-'); }).join(', ');
        var dev = {
          id: devId, fecha: f, clienteId: v.clienteId || '', clienteNombre: v.clienteNombre || 'Sin cliente',
          marca: '', modelo: (txt('dev.modelo').replace(/\{n\}/g, num || ((typeof fmtFecha === 'function') ? fmtFecha(v.fecha) : v.fecha)) + ': ' + nombres).slice(0, 250),
          imei: '', pago: metodo, pagos: null,
          precio: -r2(preSel), descuento: 0,
          iva: v.iva || 0, ivaModo: v.ivaModo || 'sin',
          base: -r2((parseFloat(v.base) || 0) * ratio), ivaImporte: -r2((parseFloat(v.ivaImporte) || 0) * ratio),
          total: -r2(imp), reembolsado: false, fechaReembolso: '', financiado: false, cuotas: null, entrada: 0, entradaPago: null,
          numero: 0, createdAt: new Date().toISOString(),
          items: lineas.map(function (x) {
            var it = x.L.it, o = {
              nombre: it.nombre || '-', precio: r2(x.n ? x.pre / x.n : 0), qty: -x.n,
              dev: { v: v.id, n: v.numero || 0, f: v.fecha || '', i: x.L.idx, imp: r2(x.imp) }
            };
            ['id', 'idOriginal', 'stockId', 'imei', 'esServicio', 'esRapida', 'esFijo', 'tipoProd', 'compraId'].forEach(function (k2) { if (it[k2] != null && it[k2] !== '') o[k2] = it[k2]; });
            return o;
          })
        };
        var antes = JSON.stringify(items(v));
        var qO = 'id=eq.' + encodeURIComponent(v.id) + '&tienda_id=eq.' + encodeURIComponent(TIENDA_ID);
        var enCola = function (fn) { try { return _syncQueueGet().some(fn); } catch (x) { return false; } };

        // 1) Primero se apuntan las unidades devueltas en la venta original (impide devolverlas dos veces);
        // 2) luego se guarda la devolución; si la nube la rechaza, se deshace el paso 1.
        var p1 = hayNube ? sbPatch('ventas', qO, { items: JSON.stringify(nuevos) }) : Promise.resolve(true);
        return p1.then(function (ok1) {
          if (hayNube && !ok1 && !enCola(function (op) { return op.method === 'PATCH' && op.table === 'ventas' && op.query === qO; })) {
            toast(txt('dev.error'), 'err'); return null;
          }
          var p2 = hayNube ? sbPost('ventas', {
            id: dev.id, tienda_id: TIENDA_ID, fecha: dev.fecha,
            cliente_id: dev.clienteId || null, cliente_nombre: dev.clienteNombre,
            marca: dev.marca, modelo: dev.modelo, imei: '',
            pago: dev.pago, precio: dev.precio, descuento: 0, total: dev.total,
            reembolsado: false, financiado: false, cuotas: null, entrada: 0, entrada_pago: null,
            iva: dev.iva, iva_modo: dev.ivaModo, base: dev.base, iva_importe: dev.ivaImporte,
            items: JSON.stringify(dev.items)
          }) : Promise.resolve(true);
          return p2.then(function (ok2) {
            if (hayNube && !ok2 && !enCola(function (op) { return op.method === 'POST' && op.table === 'ventas' && (op.dataId === dev.id || (op.data && op.data.id === dev.id)); })) {
              sbPatch('ventas', qO, { items: antes });
              toast(txt('dev.error'), 'err'); return null;
            }
            // 3) En local: líneas de la original, la devolución en la lista y las unidades al stock.
            v.items = nuevos;
            DB.ventas.push(dev);
            var sinStock = 0;
            lineas.forEach(function (x) {
              var it = x.L.it;
              if (it.esServicio || it.esRapida || it.esFijo) return;
              var sid = it.idOriginal || it.id;
              var st = sid ? (DB.stock || []).find(function (s) { return s.id === sid; }) : null;
              if (!st && it.imei) st = (DB.stock || []).find(function (s) { return (s.imei || '') && s.imei === it.imei; });
              if (!st) { sinStock++; return; }
              st.unidades = (parseInt(st.unidades, 10) || 0) + x.n;
              if (st.unidades > 0 && st.vendido) st.vendido = false;
              if (typeof _stockDelta === 'function') _stockDelta(st, x.n, null);
              if (typeof _logMov === 'function') _logMov('entrada', it.nombre || '', x.n, txt('dev.mov_ref').replace(/\{n\}/g, num || v.id));
            });
            if (typeof guardarDatos === 'function') guardarDatos();
            if (typeof audit === 'function') audit('devolucion', 'venta', v.id, (v.clienteNombre || '') + ' · -' + money(imp) + ' · ' + metodo + ' · ' + nombres, null);
            if (sinStock) toast(txt('venta.reembolsada_stock_manual'), 'err', 5000);
            // Número de ticket de la devolución (lo pone la secuencia de Postgres al insertar).
            if (hayNube) {
              fetch(SUPABASE_URL + '/rest/v1/ventas?id=eq.' + encodeURIComponent(dev.id) + '&select=numero', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + (JWT_TOKEN || SB_KEY) } })
                .then(function (r) { return r.ok ? r.json() : null; }).then(function (rr) {
                  if (Array.isArray(rr) && rr[0] && rr[0].numero) { dev.numero = parseInt(rr[0].numero, 10) || 0; try { guardarDatos(); } catch (x) {} }
                }).catch(function () {});
            }
            resultado = { v: v, dev: dev, imp: imp, metodo: metodo, lineas: lineas };
            return null;
          });
        });
      });
    }).then(function () {
      _enCurso = false;
      try { if (typeof renderVentas === 'function') renderVentas(); } catch (x) {}
      try { if (typeof renderDash === 'function') renderDash(); } catch (x) {}
      try { if (typeof renderInicioNuevo === 'function') renderInicioNuevo(); } catch (x) {}
      if (resultado) mostrarHecha(resultado);
    });
  }

  // ═══ Tras devolver: ticket, abono y, si es un cambio, al TPV ═══
  function mostrarHecha(R) {
    var esCambio = R.metodo === CAMBIO;
    var lbl = esCambio ? txt('dev.metodo_cambio') : ((typeof _pagoLbl === 'function') ? _pagoLbl(R.metodo) : R.metodo);
    var m = _modalOverlay(
      '<div style="text-align:center;font-size:34px;margin-bottom:4px">✅</div>' +
      '<div style="text-align:center;font-size:16px;font-weight:800;margin-bottom:4px">' + e(txt('dev.hecha')) + '</div>' +
      '<div style="text-align:center;font-size:22px;font-weight:900;color:var(--red,#EF4444)">-' + money(R.imp) + '</div>' +
      '<div style="text-align:center;font-size:12.5px;color:var(--muted);margin-bottom:14px">' + e(lbl) + ' · ' + e(R.lineas.map(function (x) { return (x.n > 1 ? x.n + '× ' : '') + (x.L.it.nombre || '-'); }).join(', ')) + '</div>' +
      (esCambio ? '<div style="font-size:12.5px;margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(59,130,246,.10)">' + e(txt('dev.cambio_siguiente').replace(/\{x\}/g, money(R.imp))) + '</div>' : '') +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        (esCambio ? '<button type="button" id="_dhTpv" style="padding:12px;border:none;background:var(--green,#10B981);color:#fff;border-radius:10px;cursor:pointer;font:inherit;font-weight:800">🔁 ' + e(txt('dev.ir_tpv')) + '</button>' : '') +
        '<button type="button" id="_dhTk" style="padding:11px;border:1px solid var(--border,#E5E7EB);background:transparent;color:inherit;border-radius:10px;cursor:pointer;font:inherit;font-weight:700">🖨 ' + e(txt('dev.imprimir')) + '</button>' +
        '<div id="_dhAbono"></div>' +
        '<button type="button" id="_dhOk" style="padding:10px;border:none;background:transparent;color:var(--muted);cursor:pointer;font:inherit">' + e(txt('gen.cerrar')) + '</button>' +
      '</div>'
    );
    m.box.style.maxWidth = '420px';
    m.box.querySelector('#_dhTk').onclick = function () { if (typeof imprimirTicketVenta === 'function') imprimirTicketVenta(R.dev.id); };
    m.box.querySelector('#_dhOk').onclick = m.close;
    var bT = m.box.querySelector('#_dhTpv');
    if (esCambio) {
      // El saldo queda guardado en este equipo; el TPV lo recoge al abrirse.
      try {
        localStorage.setItem('tk_cambio_pend', JSON.stringify({
          dev: R.dev.id, imp: r2(R.imp), ts: Date.now(),
          cli: R.v.clienteId ? { id: R.v.clienteId, nombre: R.v.clienteNombre || '' } : null,
          num: numTicket(R.v), tienda: (typeof TIENDA_ID !== 'undefined' ? TIENDA_ID : '')
        }));
      } catch (x) {}
      bT.onclick = function () { m.close(); window.location.href = 'tpv.html'; };
    }
    ofrecerAbono(R, m.box.querySelector('#_dhAbono'));
  }

  // Si la venta tenía factura emitida, abono (rectificativa) solo por lo devuelto.
  function ofrecerAbono(R, cont) {
    if (!cont || typeof window.emitirAbonoFactura !== 'function' || typeof SB_KEY === 'undefined' || !SB_KEY || !TIENDA_ID) return;
    fetch(SUPABASE_URL + '/rest/v1/facturas?tienda_id=eq.' + encodeURIComponent(TIENDA_ID) +
      '&origen_tipo=eq.venta&origen_id=eq.' + encodeURIComponent(R.v.id) + '&select=*', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + (JWT_TOKEN || SB_KEY) } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) {
        arr = Array.isArray(arr) ? arr : [];
        var orig = arr.find(function (x) { return !x.rectifica_a && x.estado === 'emitida'; });
        if (!orig) return;
        var totF = parseFloat(orig.total) || 0;
        var yaAb = r2(arr.filter(function (x) { return x.rectifica_a === orig.id; }).reduce(function (a, x) { return a + Math.abs(parseFloat(x.total) || 0); }, 0));
        var queda = r2(totF - yaAb);
        if (queda <= 0.005) return;
        // Si la factura se emitió tras otra devolución, cubre la venta menos lo ya devuelto entonces.
        var devPrev = parseFloat(orig.origen_detalle && orig.origen_detalle.devuelto_previo) || 0;
        var vt = (parseFloat(R.v.total) || 0) - devPrev;
        var esc = vt > 0 ? totF / vt : 1;
        var impAb = devueltaEntera(R.v) ? queda : Math.min(queda, r2(R.imp * esc));
        if (impAb <= 0.005) return;
        var excl = R.v.ivaModo === 'excluido';
        var lineas = R.lineas.map(function (x) {
          var t = r2((excl ? x.pre : x.imp) * esc);
          return { desc: (x.L.it.nombre || '-') + (x.L.it.imei ? '  ·  IMEI: ' + x.L.it.imei : ''), cantidad: x.n, precio: -r2(t / x.n), total: -t };
        });
        var k = totF > 0 ? impAb / totF : 0;
        var parcial = {
          lineas: lineas, total: -impAb,
          base: -r2((parseFloat(orig.base_imponible) || 0) * k),
          iva: -r2((parseFloat(orig.iva_importe) || 0) * k),
          devolucion: R.dev.id
        };
        cont.innerHTML = '<button type="button" style="width:100%;padding:11px;border:none;background:#dc2626;color:#fff;border-radius:10px;cursor:pointer;font:inherit;font-weight:700">🧾 ' +
          e(txt('dev.emitir_abono').replace(/\{num\}/g, orig.numero || '').replace(/\{x\}/g, money(impAb))) + '</button>';
        var b = cont.querySelector('button');
        b.onclick = function () {
          b.disabled = true; b.style.opacity = '.6';
          window.emitirAbonoFactura(orig, parcial);
        };
      }).catch(function () {});
  }

  // Devolución en «Cambio» que no se llegó a usar en el TPV: volver a llevarla o devolver el dinero.
  function cambioDisponible(dev) {
    if (!dev || !devDe(dev)) return 0;
    var pagos = dev.pagos;
    if (typeof pagos === 'string') { try { pagos = JSON.parse(pagos); } catch (x) { pagos = null; } }
    var enCambio = Array.isArray(pagos) && pagos.length
      ? pagos.reduce(function (a, p) { return a + (p.metodo === CAMBIO ? -(parseFloat(p.importe) || 0) : 0); }, 0)
      : (dev.pago === CAMBIO ? -(parseFloat(dev.total) || 0) : 0);
    var usado = (DB.ventas || []).reduce(function (a, x) {
      var p = x.pagos; if (typeof p === 'string') { try { p = JSON.parse(p); } catch (y) { p = null; } }
      return a + (Array.isArray(p) ? p.reduce(function (s, q) { return s + (q && q.metodo === CAMBIO && q.dev === dev.id ? (parseFloat(q.importe) || 0) : 0); }, 0) : 0);
    }, 0);
    return Math.max(0, r2(enCambio - usado));
  }
  function retomarCambio(devId) {
    var dev = (DB.ventas || []).find(function (x) { return x.id === devId; });
    var disp = cambioDisponible(dev);
    if (disp <= 0) return;
    var o = devDe(dev) || {};
    try {
      localStorage.setItem('tk_cambio_pend', JSON.stringify({
        dev: dev.id, imp: disp, ts: Date.now(),
        cli: dev.clienteId ? { id: dev.clienteId, nombre: dev.clienteNombre || '' } : null,
        num: o.n ? numTicket({ numero: o.n, fecha: o.f }) : '', tienda: (typeof TIENDA_ID !== 'undefined' ? TIENDA_ID : '')
      }));
    } catch (x) {}
    window.location.href = 'tpv.html';
  }

  // Desde el TPV (historial) se llega con dashboard.html?devolver=<id>#ventas.
  function abrirDesdeUrl() {
    var id = null;
    try { id = new URLSearchParams(location.search).get('devolver'); } catch (x) {}
    if (!id) return;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (x) {}
    var intentos = 0;
    var t = setInterval(function () {
      intentos++;
      var listo = typeof DB !== 'undefined' && DB && (DB.ventas || []).some(function (x) { return x.id === id; }) && typeof U !== 'undefined' && U;
      if (listo || intentos > 60) {
        clearInterval(t);
        if (listo) abrirDevolucion(id);
      }
    }, 500);
  }

  window.tkEsDevolucion = function (v) { return !!devDe(v); };
  window.tkDevDe = devDe;
  window.tkTieneDevoluciones = tieneDevoluciones;
  window.tkDevueltaEntera = devueltaEntera;
  window.tkImporteDevuelto = importeDevuelto;
  window.tkHistorialDevoluciones = historial;
  window.tkCambioDisponible = cambioDisponible;
  window.retomarCambio = retomarCambio;
  window.abrirDevolucion = abrirDevolucion;
  window._devCalcular = calcular;           // para pruebas
  window._devTotalSel = totalSel;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', abrirDesdeUrl);
  else abrirDesdeUrl();
})();
