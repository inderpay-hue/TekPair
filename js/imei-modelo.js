// js/imei-modelo.js — Marca y modelo a partir del IMEI.
//
// Las 8 primeras cifras del IMEI (TAC) identifican el modelo exacto. La base
// oficial (GSMA) es de pago, así que se busca en dos sitios, por este orden:
//   1) lo que han APRENDIDO las tiendas de TekPair (tabla tac_modelos, funciones
//      tac_buscar / tac_aprender: sql/tac-modelos.sql). Manda lo que de verdad se
//      ha guardado en un taller.
//   2) una lista pública (MIT, ~248.000 modelos hasta dic-2025) servida como
//      ficheros estáticos /tac/XXXX.json por las 4 primeras cifras (≤50 KB).
// Solo se comparte "estas 8 cifras = este modelo": nunca el IMEI ni la tienda.
(function () {
  var _cacheTac = {};      // tac -> {marca, modelo, fuente} | null
  var _cacheShard = {};    // '3528' -> Promise<{m:[], t:{}}>

  function _digitos(v) { return String(v || '').replace(/\D/g, ''); }

  // Comprobación de Luhn: la última cifra del IMEI es de control y detecta casi
  // cualquier error al teclear (una cifra cambiada o dos cifras al revés).
  function tkImeiValido(v) {
    var d = _digitos(v);
    if (d.length !== 15) return false;
    var s = 0;
    for (var i = 0; i < 15; i++) {
      var n = +d[i];
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      s += n;
    }
    return s % 10 === 0;
  }

  function _rpc(fn, args) {
    if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || typeof SB_KEY === 'undefined') return Promise.reject(new Error('sin sesion'));
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + ((typeof JWT_TOKEN !== 'undefined' && JWT_TOKEN) || SB_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
  }

  function _shard(pref) {
    if (!_cacheShard[pref]) {
      _cacheShard[pref] = fetch('/tac/' + pref + '.json')
        .then(function (r) { return r.ok ? r.json() : { m: [], t: {} }; })
        .catch(function () { delete _cacheShard[pref]; return { m: [], t: {} }; });
    }
    return _cacheShard[pref];
  }

  // Cada tienda escribe como quiere ("SAMSUNG", "a17"): al ENSEÑARLO se ordena,
  // sin tocar códigos internos como "SM-B310E".
  var _MARCAS = { APPLE: 'Apple', SAMSUNG: 'Samsung', XIAOMI: 'Xiaomi', REDMI: 'Xiaomi', POCO: 'Xiaomi', HUAWEI: 'Huawei',
    HONOR: 'Honor', OPPO: 'OPPO', REALME: 'realme', VIVO: 'vivo', MOTOROLA: 'Motorola', NOKIA: 'Nokia', GOOGLE: 'Google',
    ONEPLUS: 'OnePlus', SONY: 'Sony', ZTE: 'ZTE', TCL: 'TCL', ALCATEL: 'Alcatel', LG: 'LG', LENOVO: 'Lenovo', ASUS: 'ASUS' };
  var _ESP = { IPHONE: 'iPhone', IPAD: 'iPad', GALAXY: 'Galaxy', REDMI: 'Redmi', NOTE: 'Note', PRO: 'Pro', MAX: 'Max',
    PLUS: 'Plus', ULTRA: 'Ultra', MINI: 'mini', LITE: 'Lite', PIXEL: 'Pixel', EDGE: 'Edge', FOLD: 'Fold', FLIP: 'Flip' };
  function _marcaBonita(m) {
    var k = String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return _MARCAS[k] || String(m || '').trim();
  }
  function _modeloBonito(marcaOriginal, modelo) {
    var w = String(modelo || '').trim().split(/\s+/).map(function (p) {
      var u = p.toUpperCase();
      if (_ESP[u]) return _ESP[u];
      if (/\d/.test(p) || p.length <= 2) return u;          // A17, 15C, SM-B310E, 5G, XR
      if (p === u || p === p.toLowerCase()) return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      return p;                                              // ya venía bien escrito
    }).join(' ');
    // "Redmi 15C" guardado como marca Redmi: la marca es Xiaomi y Redmi es la gama.
    var mk = String(marcaOriginal || '').toUpperCase().replace(/[^A-Z]/g, '');
    if ((mk === 'REDMI' || mk === 'POCO') && w.toUpperCase().indexOf(mk) !== 0) w = (mk === 'REDMI' ? 'Redmi ' : 'POCO ') + w;
    return w;
  }
  function _deLista(tac) {
    return _shard(tac.slice(0, 4)).then(function (sh) {
      var e = sh.t && sh.t[tac];
      return e ? { marca: sh.m[e[0]], modelo: e[1], fuente: 'lista' } : null;
    });
  }

  // Promise<{marca, modelo, fuente:'tiendas'|'lista'} | null>
  // Manda lo aprendido en las tiendas en cuanto lo han confirmado DOS veces; con
  // un solo voto (puede ser una errata) se prefiere la lista si la tiene.
  function tkModeloPorImei(v) {
    var d = _digitos(v);
    if (d.length < 8) return Promise.resolve(null);
    var tac = d.slice(0, 8);
    if (tac in _cacheTac) return Promise.resolve(_cacheTac[tac]);
    return _rpc('tac_buscar', { p_tac: tac })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; })
      .then(function (rows) {
        var x = Array.isArray(rows) && rows[0];
        var aprendido = (x && x.marca && x.modelo)
          ? { marca: _marcaBonita(x.marca), modelo: _modeloBonito(x.marca, x.modelo), fuente: 'tiendas' } : null;
        if (aprendido && (x.n || 1) >= 2) return aprendido;
        return _deLista(tac).then(function (l) { return l || aprendido; });
      })
      .then(function (res) { _cacheTac[tac] = res; return res; });
  }

  // Un voto para "este TAC es esta marca y modelo". Sin esperar respuesta: si
  // falla no pasa nada, la próxima vez se vuelve a aprender.
  function tkAprenderImei(imei, marca, modelo) {
    var d = _digitos(imei);
    marca = String(marca || '').trim(); modelo = String(modelo || '').trim();
    if (!tkImeiValido(d) || marca.length < 2 || !modelo) return;
    var tac = d.slice(0, 8);
    // Se vota aunque ya lo supiéramos igual: es lo que hace subir la confianza.
    _cacheTac[tac] = { marca: marca, modelo: modelo, fuente: 'tiendas' };
    try { _rpc('tac_aprender', { p_tac: tac, p_marca: marca, p_modelo: modelo }).catch(function () {}); } catch (e) {}
  }

  // Se llama desde sbPost/sbPatch: aprende de cualquier fila de teléfono que se
  // guarde, venga de la pantalla que venga (stock, alta múltiple, reparación, venta).
  var _TABLAS_APRENDEN = { stock: 1, reparaciones: 1, ventas: 1 };
  function tkAprenderDeFila(tabla, data) {
    if (!_TABLAS_APRENDEN[tabla] || !data) return;
    (Array.isArray(data) ? data : [data]).forEach(function (f) {
      if (f && f.imei && f.marca && f.modelo) tkAprenderImei(f.imei, f.marca, f.modelo);
    });
  }

  // Engancha un campo de IMEI a sus campos de marca y modelo.
  //  - IMEI completo y mal tecleado → aviso.
  //  - Marca y modelo vacíos → se rellenan solos.
  //  - Ya escritos y distintos → se sugiere, con un botón para usarlo; nunca se pisa.
  function tkEngancharImei(idImei, idMarca, idModelo, alRellenar) {
    var inp = document.getElementById(idImei);
    if (!inp || inp._tkImei) return;
    inp._tkImei = true;
    var hint = document.createElement('div');
    hint.className = 'tk-imei-hint';
    hint.style.cssText = 'font-size:11.5px;margin-top:4px;display:none';
    inp.insertAdjacentElement('afterend', hint);
    var ultimo = '';
    function pintar(html, color) { hint.innerHTML = html; hint.style.color = color || 'var(--muted)'; hint.style.display = html ? 'block' : 'none'; }
    function revisar() {
      var d = _digitos(inp.value);
      if (d === ultimo) return;
      ultimo = d;
      if (d.length !== 15 || String(inp.value).replace(/[\s-]/g, '').length !== 15) { pintar(''); return; }
      if (!tkImeiValido(d)) { pintar('⚠️ ' + T('imei.no_valido'), '#D97706'); return; }
      tkModeloPorImei(d).then(function (r) {
        if (_digitos(inp.value) !== d) return;            // ya han cambiado el IMEI
        if (!r) { pintar(''); return; }
        var ma = document.getElementById(idMarca), mo = document.getElementById(idModelo);
        if (!ma || !mo) return;
        var nombre = r.marca + ' ' + r.modelo;
        var vacios = !ma.value.trim() && !mo.value.trim();
        if (vacios) {
          ma.value = r.marca; mo.value = r.modelo;
          ma.classList.remove('error'); mo.classList.remove('error');
          pintar('📱 ' + T('imei.detectado').replace('{m}', _esc(nombre)), '#10B981');
          if (typeof alRellenar === 'function') { try { alRellenar(); } catch (e) {} }
          return;
        }
        var igual = ma.value.trim().toLowerCase() === r.marca.toLowerCase() && mo.value.trim().toLowerCase() === r.modelo.toLowerCase();
        if (igual) { pintar(''); return; }
        pintar('📱 ' + T('imei.es_de').replace('{m}', _esc(nombre)) + ' <a href="#" style="font-weight:700">' + T('imei.usar') + '</a>', 'var(--muted)');
        var a = hint.querySelector('a');
        if (a) a.onclick = function (e) {
          e.preventDefault();
          ma.value = r.marca; mo.value = r.modelo; pintar('');
          if (typeof alRellenar === 'function') { try { alRellenar(); } catch (e2) {} }
        };
      });
    }
    inp.addEventListener('input', revisar);
    inp.addEventListener('change', revisar);
    inp._tkImeiRevisar = function () { ultimo = ''; pintar(''); };
  }
  function _esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  window.tkImeiValido = tkImeiValido;
  window.tkModeloPorImei = tkModeloPorImei;
  window.tkAprenderImei = tkAprenderImei;
  window.tkAprenderDeFila = tkAprenderDeFila;
  window.tkEngancharImei = tkEngancharImei;
})();
