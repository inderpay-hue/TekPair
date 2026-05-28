/* ═══════════════════════════════════════════════════════════
   TEKPAIR · MÓDULO FACTURAS
   ═══════════════════════════════════════════════════════════
   Uso: window.abrirModalFactura(origen, datos)
     origen: 'venta' | 'reparacion'
     datos: objeto con la venta o reparación a facturar
   ═══════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ═══ Interceptor JWT 401 (autocontenido, idempotente) ═══
  if (!window.__tekpair401Installed) {
    window.__tekpair401Installed = true;
    window._sesionExpirada = window._sesionExpirada || false;

    function _inyectarModalSesion() {
      if (document.getElementById('mSesionExpirada')) return;
      var modal = document.createElement('div');
      modal.className = 'modal-bg';
      modal.id = 'mSesionExpirada';
      modal.innerHTML =
        '<div class="modal" style="max-width:440px">' +
          '<div class="modal-h"><span>🔒 Sesión expirada</span></div>' +
          '<div style="padding:20px;text-align:center">' +
            '<p style="margin-bottom:12px;font-size:14px">Tu sesión ha caducado por inactividad.</p>' +
            '<p style="margin-bottom:20px;font-size:12px;color:#666;line-height:1.5">' +
              '<strong>Tus datos están a salvo</strong> en este navegador.<br>' +
              'Al volver a iniciar sesión se sincronizarán automáticamente.' +
            '</p>' +
            '<button onclick="window.__tekpairRelogin()" style="background:#0055FF;color:white;padding:10px 24px;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">' +
              'Iniciar sesión de nuevo' +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
    }

    window.__tekpairRelogin = function() {
      try { localStorage.removeItem('tk_sess'); } catch(e) {}
      window.location.href = '/app.html';
    };

    window.__tekpairMostrarSesionExpirada = function() {
      if (window._sesionExpirada) return;
      window._sesionExpirada = true;
      try {
        document.querySelectorAll('.modal-bg.open').forEach(function(m){
          m.classList.remove('open');
        });
      } catch(e) {}
      // Si dashboard ya inyectó su modal, usarlo; si no, inyectar el nuestro
      _inyectarModalSesion();
      var mod = document.getElementById('mSesionExpirada');
      if (mod) {
        if (typeof window.openM === 'function') {
          window.openM('mSesionExpirada');
        } else {
          mod.classList.add('open');
          mod.style.display = 'flex';
        }
      }
    };

    var _origFetch = window.fetch;
    if (typeof _origFetch === 'function') {
      window.fetch = function(url, options) {
        var urlStr = '';
        try {
          urlStr = typeof url === 'string' ? url : (url && url.url) || '';
        } catch(e) { urlStr = ''; }
        var esSupabase = urlStr.indexOf('supabase.co') !== -1;
        var p = _origFetch.apply(this, arguments);
        if (!esSupabase) return p;
        return p.then(function(response) {
          if (response && response.status === 401) {
            window.__tekpairMostrarSesionExpirada();
          }
          return response;
        });
      };
    }
  }


  // ────────── Estado del módulo ──────────
  var FACT = {
    origen: null,         // 'venta' | 'reparacion'
    datos: null,          // datos del origen
    tipo: 'simplificada', // 'simplificada' | 'completa'
  };

  // ────────── Helpers ──────────
  function _fmtEur(n) {
    return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' €';
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function _toast(msg, tipo) {
    if (typeof window.toast === 'function') {
      window.toast(msg, tipo);
    } else {
      alert(msg);
    }
  }

  function _supabaseHeaders() {
    return {
      'apikey': window.SB_KEY,
      'Authorization': 'Bearer ' + (window.JWT_TOKEN || window.SB_KEY),
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // ────────── HTML del modal ──────────
  function _inyectarModal() {
    if (document.getElementById('mFactura')) return; // ya inyectado

    var modalHTML = '' +
      '<div class="modal-bg" id="mFactura" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center">' +
        '<div style="background:white;max-width:560px;width:92%;max-height:90vh;border-radius:14px;overflow:hidden;display:flex;flex-direction:column">' +
          '<div style="padding:16px 20px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between">' +
            '<div style="font-weight:700;font-size:16px">📄 Generar factura</div>' +
            '<button type="button" onclick="window.cerrarModalFactura()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94A3B8">×</button>' +
          '</div>' +
          '<div style="padding:18px 20px;overflow-y:auto;flex:1" id="factModalBody">' +
            '<div style="background:#F8FAFC;border-radius:10px;padding:12px;margin-bottom:14px">' +
              '<div style="font-size:11px;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:6px">Origen</div>' +
              '<div id="factOrigenInfo" style="font-size:13px"></div>' +
              '<div id="factImporte" style="margin-top:8px;font-size:18px;font-weight:800;color:#10B981"></div>' +
            '</div>' +

            '<div style="margin-bottom:14px">' +
              '<div style="font-size:11px;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:6px">Tipo de factura</div>' +
              '<div style="display:flex;gap:8px">' +
                '<button type="button" id="factTipoSimp" onclick="window.setTipoFactura(\'simplificada\')" style="flex:1;padding:10px;border-radius:8px;border:2px solid #10B981;background:#ECFDF5;cursor:pointer;font-weight:600;font-size:13px">🎫 Simplificada</button>' +
                '<button type="button" id="factTipoComp" onclick="window.setTipoFactura(\'completa\')" style="flex:1;padding:10px;border-radius:8px;border:2px solid #E5E7EB;background:white;cursor:pointer;font-weight:600;font-size:13px;color:#475569">📄 Completa</button>' +
              '</div>' +
              '<div id="factTipoInfo" style="font-size:11px;color:#64748B;margin-top:6px">Simplificada: válida hasta 400€. Incluye solo NIF del cliente si quieres.</div>' +
            '</div>' +

            '<div id="factDatosCli" style="margin-bottom:14px"></div>' +

            '<div style="background:#FEF3C7;border-radius:8px;padding:10px;font-size:11px;color:#92400E;margin-bottom:14px" id="factNumeroPreview">' +
              '⚠️ El número se asigna automáticamente al emitir' +
            '</div>' +
          '</div>' +
          '<div style="padding:14px 20px;border-top:1px solid #E5E7EB;display:flex;gap:10px;background:#F8FAFC">' +
            '<button type="button" onclick="window.cerrarModalFactura()" style="padding:10px 16px;border-radius:8px;border:1px solid #E5E7EB;background:white;cursor:pointer;font-weight:600">Cancelar</button>' +
            '<button type="button" id="factEmitirBtn" onclick="window.emitirFactura()" style="flex:1;padding:10px 16px;border-radius:8px;border:none;background:#10B981;color:white;cursor:pointer;font-weight:700">✓ Emitir factura</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var div = document.createElement('div');
    div.innerHTML = modalHTML;
    document.body.appendChild(div.firstChild);
  }

  // ────────── Render datos cliente ──────────
  function _renderDatosCliente() {
    var box = document.getElementById('factDatosCli');
    if (!box) return;

    var cli = FACT.datos && FACT.datos.cliente || {};

    if (FACT.tipo === 'simplificada') {
      // Solo NIF opcional
      box.innerHTML =
        '<div style="font-size:11px;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:6px">Datos cliente (opcional)</div>' +
        '<input id="factCliNif" placeholder="NIF/DNI (opcional)" value="' + _esc(cli.dni || '') + '" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px">';
    } else {
      // Completa: todos los datos
      box.innerHTML =
        '<div style="font-size:11px;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:6px">Datos fiscales cliente (obligatorios)</div>' +
        '<input id="factCliNomFiscal" placeholder="Nombre fiscal / Razón social *" value="' + _esc(cli.nombreFiscal || cli.nombre || '') + '" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px;margin-bottom:8px">' +
        '<input id="factCliNif" placeholder="NIF/CIF *" value="' + _esc(cli.dni || '') + '" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px;margin-bottom:8px">' +
        '<input id="factCliDir" placeholder="Dirección fiscal *" value="' + _esc(cli.dirFiscal || cli.dir || '') + '" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px;margin-bottom:8px">' +
        '<div style="display:flex;gap:8px">' +
          '<input id="factCliCp" placeholder="CP" value="' + _esc(cli.cp || '') + '" style="flex:0 0 100px;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px">' +
          '<input id="factCliCiudad" placeholder="Ciudad" value="' + _esc(cli.ciudad || '') + '" style="flex:1;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px">' +
          '<input id="factCliProv" placeholder="Provincia" value="' + _esc(cli.provincia || '') + '" style="flex:1;padding:9px 11px;border-radius:8px;border:1px solid #E5E7EB;font-size:14px">' +
        '</div>';
    }
  }

  // ────────── Render origen ──────────
  function _renderOrigen() {
    var info = document.getElementById('factOrigenInfo');
    var imp = document.getElementById('factImporte');
    if (!info || !imp) return;

    var d = FACT.datos;
    if (FACT.origen === 'venta') {
      info.innerHTML =
        '<strong>Venta</strong> · ' + _esc(d.fecha || '') + '<br>' +
        (d.cliente && d.cliente.nombre ? '👤 ' + _esc(d.cliente.nombre + ' ' + (d.cliente.apellidos || '')) + '<br>' : '') +
        '📦 ' + _esc((d.items || []).map(function(i){ return i.nombre + ' x' + i.cantidad; }).join(', ')) +
        (d.pago ? '<br>💳 ' + _esc(d.pago) : '');
    } else {
      info.innerHTML =
        '<strong>Reparación</strong> · ' + _esc(d.fechaEntregaReal || d.fecha || '') + '<br>' +
        (d.cliente && d.cliente.nombre ? '👤 ' + _esc(d.cliente.nombre + ' ' + (d.cliente.apellidos || '')) + '<br>' : '') +
        '📱 ' + _esc((d.marca || '') + ' ' + (d.modelo || '')) + '<br>' +
        '🔧 ' + _esc(d.averia || '') +
        (d.pagoFinal ? '<br>💳 ' + _esc(d.pagoFinal) : '');
    }
    imp.textContent = _fmtEur(d.total || 0);
  }

  // ────────── Setter tipo factura (expuesto) ──────────
  window.setTipoFactura = function(tipo) {
    FACT.tipo = tipo;
    var simp = document.getElementById('factTipoSimp');
    var comp = document.getElementById('factTipoComp');
    var info = document.getElementById('factTipoInfo');
    if (tipo === 'simplificada') {
      if (simp) { simp.style.borderColor = '#10B981'; simp.style.background = '#ECFDF5'; }
      if (comp) { comp.style.borderColor = '#E5E7EB'; comp.style.background = 'white'; }
      if (info) info.textContent = 'Simplificada: válida hasta 400€. Incluye solo NIF del cliente si quieres.';
    } else {
      if (simp) { simp.style.borderColor = '#E5E7EB'; simp.style.background = 'white'; }
      if (comp) { comp.style.borderColor = '#10B981'; comp.style.background = '#ECFDF5'; }
      if (info) info.textContent = 'Completa: con datos fiscales del cliente. Sin límite de importe.';
    }
    _renderDatosCliente();
  };

  // ────────── Abrir modal (función principal expuesta) ──────────
  // Abre el modal de emisión (flujo de creación de factura)
  function _mostrarModalEmision(origen, datos) {
    _inyectarModal();

    FACT.origen = origen;
    FACT.datos = datos;
    FACT.tipo = 'simplificada';

    _renderOrigen();
    window.setTipoFactura('simplificada');

    document.getElementById('mFactura').style.display = 'flex';
  }

  window.abrirModalFactura = function(origen, datos) {
    if (!window.SUPABASE_URL || !window.SB_KEY || !window.TIENDA_ID) {
      _toast('Faltan credenciales. Recarga la página.', 'err');
      return;
    }

    // Si esta reparación/venta ya tiene factura, mostrar su PDF (no emitir otra)
    var oid = datos && datos.id;
    if (!oid) {
      _mostrarModalEmision(origen, datos);
      return;
    }

    var url = window.SUPABASE_URL + '/rest/v1/facturas' +
      '?tienda_id=eq.' + encodeURIComponent(window.TIENDA_ID) +
      '&origen_tipo=eq.' + encodeURIComponent(origen) +
      '&origen_id=eq.' + encodeURIComponent(oid) +
      '&select=*&limit=1';

    fetch(url, { headers: _supabaseHeaders() })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(arr) {
        if (Array.isArray(arr) && arr.length > 0) {
          // Ya existe factura para este origen → mostrar PDF, no emitir
          var existente = arr[0];
          _toast('Esta ' + (origen === 'reparacion' ? 'reparación' : 'venta') +
                 ' ya tiene factura (' + existente.numero + ')', 'ok');
          if (typeof window.generarFacturaPDF === 'function') {
            window.generarFacturaPDF(existente);
          }
        } else {
          // No tiene factura → abrir modal de emisión
          _mostrarModalEmision(origen, datos);
        }
      })
      .catch(function(e) {
        // Si la comprobación falla, no bloquear: abrir modal igualmente
        console.warn('[factura.js] no se pudo comprobar factura previa:', e);
        _mostrarModalEmision(origen, datos);
      });
  };

  // ────────── Cerrar modal ──────────
  window.cerrarModalFactura = function() {
    var m = document.getElementById('mFactura');
    if (m) m.style.display = 'none';
  };

  // ────────── Construir snapshot del cliente ──────────
  function _snapshotCliente() {
    if (FACT.tipo === 'simplificada') {
      var nif = (document.getElementById('factCliNif') || {}).value || '';
      var cli = FACT.datos.cliente || {};
      return {
        nombre: cli.nombre || '',
        apellidos: cli.apellidos || '',
        nif: nif.trim(),
        tipo_factura: 'simplificada'
      };
    } else {
      return {
        nombre_fiscal: ((document.getElementById('factCliNomFiscal') || {}).value || '').trim(),
        nif: ((document.getElementById('factCliNif') || {}).value || '').trim(),
        dir_fiscal: ((document.getElementById('factCliDir') || {}).value || '').trim(),
        cp: ((document.getElementById('factCliCp') || {}).value || '').trim(),
        ciudad: ((document.getElementById('factCliCiudad') || {}).value || '').trim(),
        provincia: ((document.getElementById('factCliProv') || {}).value || '').trim(),
        tipo_factura: 'completa'
      };
    }
  }

  // ────────── Construir snapshot del emisor (la tienda) ──────────
  function _snapshotEmisor() {
    var t = window.TIENDA || {};
    return {
      nombre: t.nombre || '',
      razon_social: t.razonSocial || t.razon_social || t.nombre || '',
      cif: t.cif || '',
      dir: t.dir || '',
      cp: t.cp || '',
      ciudad: t.ciudad || '',
      provincia: t.provincia || '',
      pais: t.pais || 'España',
      tel: t.tel || '',
      email: t.email || '',
      web: t.web || '',
      logo: t.logo_url || ''
    };
  }

  // ────────── Construir líneas ──────────
  function _construirLineas() {
    var d = FACT.datos;
    if (FACT.origen === 'venta') {
      return (d.items || []).map(function(i) {
        return {
          desc: i.nombre || '-',
          cantidad: parseFloat(i.cantidad) || 1,
          precio: parseFloat(i.precio) || 0,
          total: (parseFloat(i.cantidad) || 1) * (parseFloat(i.precio) || 0)
        };
      });
    } else {
      // Reparación: líneas = servicios + componentes
      var lineas = [];
      var servs = d.servicios || [];
      servs.forEach(function(s) {
        lineas.push({
          desc: s.desc || s.nombre || 'Servicio',
          cantidad: 1,
          precio: parseFloat(s.precio) || 0,
          total: parseFloat(s.precio) || 0
        });
      });
      var comps = d.componentes || [];
      comps.forEach(function(c) {
        lineas.push({
          desc: c.nombre || 'Componente',
          cantidad: parseFloat(c.cantidad) || 1,
          precio: parseFloat(c.precio) || 0,
          total: (parseFloat(c.cantidad) || 1) * (parseFloat(c.precio) || 0)
        });
      });
      // Si no hay servicios ni componentes, una sola línea
      if (lineas.length === 0) {
        lineas.push({
          desc: 'Reparación ' + (d.marca || '') + ' ' + (d.modelo || ''),
          cantidad: 1,
          precio: parseFloat(d.total) || 0,
          total: parseFloat(d.total) || 0
        });
      }
      return lineas;
    }
  }

  // ────────── Guardar datos fiscales en el cliente ──────────
  // Tras emitir, guarda los datos fiscales en la ficha del cliente
  // para que la próxima factura a ese cliente venga ya rellenada.
  function _guardarDatosFiscalesCliente() {
    var d = FACT.datos;
    if (!d.cliente || !d.cliente.id) return; // sin cliente vinculado, nada que guardar

    var body = {};
    if (FACT.tipo === 'completa') {
      body.nombre_fiscal = ((document.getElementById('factCliNomFiscal') || {}).value || '').trim();
      body.dir_fiscal = ((document.getElementById('factCliDir') || {}).value || '').trim();
      body.cp = ((document.getElementById('factCliCp') || {}).value || '').trim();
      body.ciudad = ((document.getElementById('factCliCiudad') || {}).value || '').trim();
      body.provincia = ((document.getElementById('factCliProv') || {}).value || '').trim();
    }
    var nif = ((document.getElementById('factCliNif') || {}).value || '').trim();
    if (nif) body.dni = nif;
    if (Object.keys(body).length === 0) return;

    fetch(window.SUPABASE_URL + '/rest/v1/clientes?id=eq.' + encodeURIComponent(d.cliente.id), {
      method: 'PATCH',
      headers: _supabaseHeaders(),
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) { console.warn('[factura.js] no se pudieron guardar datos fiscales'); return; }
      // Actualizar el cliente en memoria para esta sesión
      try {
        if (window.DB && Array.isArray(window.DB.clis)) {
          var cli = window.DB.clis.find(function(c){ return c.id === d.cliente.id; });
          if (cli) {
            if (body.nombre_fiscal != null) cli.nombreFiscal = body.nombre_fiscal;
            if (body.dir_fiscal != null) cli.dirFiscal = body.dir_fiscal;
            if (body.cp != null) cli.cp = body.cp;
            if (body.ciudad != null) cli.ciudad = body.ciudad;
            if (body.provincia != null) cli.provincia = body.provincia;
            if (body.dni != null) cli.dni = body.dni;
          }
        }
      } catch (e) { /* no critico */ }
    }).catch(function(e) {
      console.warn('[factura.js] error guardando datos fiscales:', e);
    });
  }

  // ────────── Llamar función SQL siguiente_numero_factura ──────────
  function _obtenerSiguienteNumero(serie) {
    return fetch(window.SUPABASE_URL + '/rest/v1/rpc/siguiente_numero_factura', {
      method: 'POST',
      headers: _supabaseHeaders(),
      body: JSON.stringify({
        p_tienda_id: window.TIENDA_ID,
        p_serie: serie || 1
      })
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(err) {
          throw new Error('RPC ' + r.status + ': ' + JSON.stringify(err));
        });
      }
      return r.json();
    }).then(function(data) {
      // data es un array [{numero, secuencia}]
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Respuesta vacía de siguiente_numero_factura');
      }
      return data[0];
    });
  }

  // ────────── Emitir factura (expuesto) ──────────
  window.emitirFactura = function() {
    var btn = document.getElementById('factEmitirBtn');

    // Validar
    if (FACT.tipo === 'completa') {
      var snap = _snapshotCliente();
      if (!snap.nombre_fiscal || !snap.nif || !snap.dir_fiscal) {
        _toast('Faltan datos fiscales obligatorios (nombre, NIF, dirección)', 'err');
        return;
      }
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Emitiendo...'; }

    var d = FACT.datos;
    var total = parseFloat(d.total) || 0;
    var ivaPct = parseFloat(d.iva) || 0;
    var base = ivaPct > 0 ? (total / (1 + ivaPct / 100)) : total;
    var ivaImp = total - base;

    _obtenerSiguienteNumero().then(function(numInfo) {
      // INSERT en facturas
      var payload = {
        tienda_id: window.TIENDA_ID,
        numero: numInfo.numero,
        serie: 1,
        secuencia: numInfo.secuencia,
        fecha_emision: new Date().toISOString().slice(0, 10),
        tipo: FACT.tipo,
        origen_tipo: FACT.origen,
        origen_id: d.id || null,
        cliente_id: (d.cliente && d.cliente.id) || null,
        cliente_snapshot: _snapshotCliente(),
        emisor_snapshot: _snapshotEmisor(),
        lineas: _construirLineas(),
        base_imponible: +base.toFixed(2),
        iva_pct: ivaPct,
        iva_importe: +ivaImp.toFixed(2),
        total: total,
        metodo_pago: d.pago || d.pagoFinal || '',
        origen_detalle: (FACT.origen === 'reparacion') ? { marca: d.marca || '', modelo: d.modelo || '', imei: d.imei || '', averia: d.averia || '' } : null,
        estado: 'emitida'
      };

      return fetch(window.SUPABASE_URL + '/rest/v1/facturas', {
        method: 'POST',
        headers: _supabaseHeaders(),
        body: JSON.stringify(payload)
      }).then(function(r) {
        if (!r.ok) {
          return r.json().then(function(err) {
            throw new Error('INSERT ' + r.status + ': ' + JSON.stringify(err));
          });
        }
        return r.json();
      }).then(function(facturas) {
        var f = Array.isArray(facturas) ? facturas[0] : facturas;
        _guardarDatosFiscalesCliente();
        window.cerrarModalFactura();
        window.__ultimaFactura = f;
        try { window.generarFacturaPDF(f); } catch (e) { console.warn('[factura.js] PDF:', e); }
        try { window.mostrarOpcionesEnvioFactura(f); } catch (e) { _toast('✓ Factura ' + f.numero + ' emitida', 'ok'); }
      });
    }).catch(function(err) {
      console.error('Error emitiendo factura:', err);
      _toast('Error: ' + err.message, 'err');
    }).then(function() {
      if (btn) { btn.disabled = false; btn.textContent = '✓ Emitir factura'; }
    });
  };

  // ────────── Generar PDF de la factura (ventana imprimible) ──────────
  function _fmtImporte(n) {
    return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' \u20ac';
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ────────── Envío de factura por WhatsApp / Email ──────────
  function _buscarContactoCliente() {
    // Devuelve {tel, email, nombre} buscando en FACT.datos.cliente y en DB.clis
    var cli = (FACT.datos && FACT.datos.cliente) || {};
    var tel = cli.tel || '';
    var email = cli.email || '';
    var nombre = (cli.nombre || '') + (cli.apellidos ? ' ' + cli.apellidos : '');
    // Si falta algo, buscar en DB.clis por id
    if ((!tel || !email) && cli.id && window.DB && Array.isArray(window.DB.clis)) {
      var full = window.DB.clis.find(function(c){ return c.id === cli.id; });
      if (full) {
        if (!tel) tel = full.tel || '';
        if (!email) email = full.email || '';
        if (!nombre.trim()) nombre = (full.nombre || '') + (full.apellidos ? ' ' + full.apellidos : '');
      }
    }
    return { tel: tel, email: email, nombre: nombre.trim() };
  }

  function _normalizarTel(tel) {
    // Quita espacios, guiones, parentesis. Añade prefijo 34 si parece español sin prefijo
    var t = String(tel || '').replace(/[^0-9+]/g, '');
    if (!t) return '';
    if (t.indexOf('+') === 0) return t.substring(1); // wa.me sin el +
    if (t.length === 9) return '34' + t; // móvil español sin prefijo
    return t;
  }

  window.enviarFacturaWhatsApp = function(f) {
    var c = _buscarContactoCliente();
    var tel = _normalizarTel(c.tel);
    if (!tel) {
      _toast('Este cliente no tiene teléfono guardado', 'err');
      return;
    }
    var emi = (f && f.emisor_snapshot) || {};
    var tienda = emi.nombre || emi.razon_social || 'nuestra tienda';
    var total = (parseFloat(f.total) || 0).toFixed(2).replace('.', ',');
    var msg = 'Hola' + (c.nombre ? ' ' + c.nombre : '') + ', aquí tienes tu factura ' + (f.numero || '') +
              ' de ' + tienda + '.\nTotal: ' + total + ' €.\nGracias por tu confianza.';
    var url = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
  };

  window.enviarFacturaEmail = function(f) {
    var c = _buscarContactoCliente();
    if (!c.email) {
      _toast('Este cliente no tiene email guardado', 'err');
      return;
    }
    var btn = document.getElementById('btnEnvEmail');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    window.generarFacturaPDFDoc(f).then(function(doc) {
      // base64 sin el prefijo data:...;base64,
      var dataUri = doc.output('datauristring');
      var base64 = dataUri.split(',')[1] || '';
      var emi = (f && f.emisor_snapshot) || {};
      var tienda = emi.razon_social || emi.nombre || (window.TIENDA && window.TIENDA.nombre) || 'TekPair';
      var nombreArchivo = 'Factura_' + String(f.numero || 'sin-numero').replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf';

      return fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'factura',
          email: c.email,
          nombreCliente: c.nombre || 'Cliente',
          numero: f.numero || '',
          total: (parseFloat(f.total) || 0).toFixed(2).replace('.', ','),
          tienda: tienda,
          pdfBase64: base64,
          nombreArchivo: nombreArchivo
        })
      });
    }).then(function(r) {
      return r.json().then(function(data) { return { ok: r.ok, data: data }; });
    }).then(function(res) {
      if (res.ok && res.data && res.data.ok) {
        _toast('Factura enviada a ' + c.email, 'ok');
        var m = document.getElementById('mEnvioFactura');
        if (m) m.remove();
      } else {
        var msg = (res.data && (res.data.error || res.data.message)) || 'Error al enviar';
        _toast('Error: ' + msg, 'err');
      }
    }).catch(function(err) {
      console.error('[factura.js] Error email:', err);
      _toast('Error al generar o enviar el PDF', 'err');
    }).then(function() {
      if (btn) { btn.disabled = false; btn.textContent = '📧 Enviar por Email'; }
    });
  };

  // Mini-panel tras emitir con botones de envío
  window.mostrarOpcionesEnvioFactura = function(f) {
    var c = _buscarContactoCliente();
    var existing = document.getElementById('mEnvioFactura');
    if (existing) existing.remove();
    var tieneTel = !!_normalizarTel(c.tel);
    var tieneEmail = !!c.email;
    var html = '' +
      '<div id="mEnvioFactura" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center">' +
        '<div style="background:white;max-width:380px;width:90%;border-radius:14px;padding:22px;text-align:center;font-family:inherit">' +
          '<div style="font-size:18px;font-weight:800;color:#10B981;margin-bottom:6px">✓ Factura ' + _esc(f.numero || '') + ' emitida</div>' +
          '<div style="font-size:13px;color:#64748B;margin-bottom:18px">¿Quieres enviarla al cliente?</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px">' +
            (tieneTel ?
              '<button onclick="window.enviarFacturaWhatsApp(window.__ultimaFactura)" style="padding:12px;border:none;border-radius:8px;background:#25D366;color:white;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit">📱 Enviar por WhatsApp</button>'
              : '<button disabled style="padding:12px;border:none;border-radius:8px;background:#E5E7EB;color:#9CA3AF;font-weight:700;font-size:14px;font-family:inherit">📱 Sin teléfono guardado</button>') +
            (tieneEmail ?
              '<button id="btnEnvEmail" onclick="window.enviarFacturaEmail(window.__ultimaFactura)" style="padding:12px;border:none;border-radius:8px;background:#0055FF;color:white;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit">📧 Enviar por Email</button>'
              : '<button disabled style="padding:12px;border:none;border-radius:8px;background:#E5E7EB;color:#9CA3AF;font-weight:700;font-size:14px;font-family:inherit">📧 Sin email guardado</button>') +
            '<button onclick="document.getElementById(\'mEnvioFactura\').remove()" style="padding:10px;border:1px solid #E5E7EB;border-radius:8px;background:white;color:#64748B;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit">Cerrar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstChild);
  };

  // ────────── Generar PDF de la factura con jsPDF (para email/descarga) ──────────
  function _logoABase64(url) {
    return new Promise(function(resolve) {
      if (!url) { resolve(''); return; }
      try {
        fetch(url).then(function(r){ return r.blob(); }).then(function(blob){
          var reader = new FileReader();
          reader.onload = function(){ resolve(reader.result); };
          reader.onerror = function(){ resolve(''); };
          reader.readAsDataURL(blob);
        }).catch(function(){ resolve(''); });
      } catch(e) { resolve(''); }
    });
  }

  function _pdfFmt(n) {
    return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' EUR';
  }

  // Devuelve una Promise<jsPDF doc> con la factura dibujada
  window.generarFacturaPDFDoc = function(f) {
    return new Promise(function(resolve, reject) {
      if (!f) { reject(new Error('Sin datos de factura')); return; }
      if (!window.jspdf || !window.jspdf.jsPDF) { reject(new Error('Libreria PDF no cargada')); return; }

      var emi = f.emisor_snapshot || {};
      var cli = f.cliente_snapshot || {};
      var lineas = f.lineas || [];
      var esSimplificada = (f.tipo === 'simplificada');
      var esAbono = !!f.rectifica_a;
      var emiLogo = emi.logo || (window.TIENDA && window.TIENDA.logo_url) || '';

      _logoABase64(emiLogo).then(function(logoB64) {
        try {
          var jsPDFClass = window.jspdf.jsPDF;
          var doc = new jsPDFClass({ unit: 'pt', format: 'a4' });
          var W = doc.internal.pageSize.getWidth();
          var H = doc.internal.pageSize.getHeight();
          var margin = 48;
          var y = margin;

          doc.setFillColor(16, 185, 129);
          doc.rect(0, 0, W, 96, 'F');

          var emiNombre = emi.razon_social || emi.nombre || (window.TIENDA && window.TIENDA.nombre) || 'Mi Tienda';
          if (logoB64) {
            try {
              var fmt = logoB64.indexOf('image/png') >= 0 ? 'PNG' : (logoB64.indexOf('image/webp') >= 0 ? 'WEBP' : 'JPEG');
              doc.addImage(logoB64, fmt, margin, 24, 48, 48);
              doc.setFontSize(13); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
              doc.text(emiNombre, margin + 60, 46);
            } catch(eImg) {
              doc.setFontSize(15); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
              doc.text(emiNombre, margin, 46);
            }
          } else {
            doc.setFontSize(15); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
            doc.text(emiNombre, margin, 46);
          }

          var tituloDoc = esAbono ? 'FACTURA RECTIFICATIVA' : (esSimplificada ? 'FACTURA SIMPLIFICADA' : 'FACTURA');
          doc.setFontSize(18); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
          doc.text(tituloDoc, W - margin, 44, { align: 'right' });
          doc.setFontSize(11); doc.setFont('helvetica','normal');
          doc.text(String(f.numero || ''), W - margin, 64, { align: 'right' });

          y = 130;
          doc.setFontSize(9); doc.setTextColor(100,116,139); doc.setFont('helvetica','bold');
          doc.text('EMISOR', margin, y);
          doc.text(esSimplificada ? 'CLIENTE' : 'FACTURAR A', W/2 + 10, y);
          y += 15;

          doc.setTextColor(26,26,46); doc.setFont('helvetica','bold'); doc.setFontSize(11);
          doc.text(emiNombre, margin, y);
          var cliNombre = esSimplificada
            ? (((cli.nombre||'') + ' ' + (cli.apellidos||'')).trim() || 'Cliente')
            : (cli.nombre_fiscal || 'Cliente');
          doc.text(cliNombre, W/2 + 10, y);
          y += 14;

          doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,80,90);
          var emiL = [];
          if (emi.cif) emiL.push('CIF/NIF: ' + emi.cif);
          if (emi.dir) emiL.push(emi.dir);
          var emiCP = [emi.cp, emi.ciudad].filter(Boolean).join(' '); if (emiCP) emiL.push(emiCP);
          if (emi.tel) emiL.push('Tel: ' + emi.tel);
          if (emi.email) emiL.push(emi.email);

          var cliL = [];
          if (cli.nif) cliL.push('NIF/CIF: ' + cli.nif);
          if (!esSimplificada) {
            if (cli.dir_fiscal) cliL.push(cli.dir_fiscal);
            var cliCP = [cli.cp, cli.ciudad].filter(Boolean).join(' '); if (cliCP) cliL.push(cliCP);
            if (cli.provincia) cliL.push(cli.provincia);
          }
          var yL = y, yR = y;
          emiL.forEach(function(l){ doc.text(String(l), margin, yL); yL += 12; });
          cliL.forEach(function(l){ doc.text(String(l), W/2 + 10, yR); yR += 12; });
          y = Math.max(yL, yR) + 8;

          var fechaTxt = f.fecha_emision || '';
          try { var d = new Date(f.fecha_emision); if (!isNaN(d)) fechaTxt = d.toLocaleDateString('es-ES'); } catch(e){}
          doc.setFontSize(9); doc.setTextColor(100,116,139);
          doc.text('Fecha: ' + fechaTxt, margin, y);
          y += 20;

          var od = f.origen_detalle || {};
          if (od.marca || od.modelo || od.imei || od.averia) {
            var aptNom = [od.marca, od.modelo].filter(Boolean).join(' ') || 'Dispositivo';
            doc.setFillColor(255, 247, 237);
            doc.rect(margin, y, W - margin*2, od.averia ? 44 : 30, 'F');
            doc.setFillColor(245, 158, 11);
            doc.rect(margin, y, 3, od.averia ? 44 : 30, 'F');
            doc.setFontSize(8); doc.setTextColor(245,158,11); doc.setFont('helvetica','bold');
            doc.text('APARATO REPARADO', margin + 12, y + 13);
            doc.setFontSize(10); doc.setTextColor(26,26,46); doc.setFont('helvetica','normal');
            doc.text(aptNom + (od.imei ? '  IMEI: ' + od.imei : ''), margin + 12, y + 26);
            if (od.averia) { doc.setFontSize(9); doc.setTextColor(100,100,100); doc.text('Averia: ' + od.averia, margin + 12, y + 38); }
            y += (od.averia ? 44 : 30) + 16;
          }

          doc.setFillColor(26, 26, 46);
          doc.rect(margin, y, W - margin*2, 22, 'F');
          doc.setFontSize(9); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
          doc.text('DESCRIPCION', margin + 10, y + 14);
          doc.text('CANT.', W - margin - 200, y + 14, { align: 'right' });
          doc.text('PRECIO', W - margin - 100, y + 14, { align: 'right' });
          doc.text('IMPORTE', W - margin - 10, y + 14, { align: 'right' });
          y += 22;

          doc.setFont('helvetica','normal'); doc.setTextColor(26,26,46); doc.setFontSize(10);
          lineas.forEach(function(ln) {
            var cant = parseFloat(ln.cantidad) || 1;
            var precio = parseFloat(ln.precio) || 0;
            var tot = parseFloat(ln.total); if (isNaN(tot)) tot = cant * precio;
            var desc = String(ln.desc || ln.nombre || '-');
            if (desc.length > 50) desc = desc.substring(0, 48) + '...';
            y += 18;
            doc.text(desc, margin + 10, y);
            doc.text(String(cant), W - margin - 200, y, { align: 'right' });
            doc.text(_pdfFmt(precio), W - margin - 100, y, { align: 'right' });
            doc.text(_pdfFmt(tot), W - margin - 10, y, { align: 'right' });
            doc.setDrawColor(232, 232, 238);
            doc.line(margin, y + 5, W - margin, y + 5);
          });
          y += 24;

          var boxX = W - margin - 220;
          doc.setFontSize(10); doc.setTextColor(26,26,46); doc.setFont('helvetica','normal');
          doc.text('Base imponible', boxX, y);
          doc.text(_pdfFmt(f.base_imponible), W - margin - 10, y, { align: 'right' });
          y += 16;
          doc.text('IVA (' + (parseFloat(f.iva_pct)||0) + '%)', boxX, y);
          doc.text(_pdfFmt(f.iva_importe), W - margin - 10, y, { align: 'right' });
          y += 10;
          doc.setFillColor(16, 185, 129);
          doc.rect(boxX - 10, y, W - margin - boxX + 10, 26, 'F');
          y += 17;
          doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13);
          doc.text('TOTAL', boxX, y);
          doc.text(_pdfFmt(f.total), W - margin - 10, y, { align: 'right' });

          doc.setFontSize(9); doc.setTextColor(26,26,46); doc.setFont('helvetica','bold');
          if (f.metodo_pago) { doc.text('Forma de pago: ' + f.metodo_pago, margin, H - 70); }
          doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(150,150,150);
          doc.text('Documento generado por TekPair. Conserve esta factura como justificante.', margin, H - 54);
          doc.text('tekpair.tech', margin, H - 42);

          resolve(doc);
        } catch(eDoc) {
          reject(eDoc);
        }
      });
    });
  };

  window.generarFacturaPDF = function(f) {
    if (!f) { _toast('No hay datos de factura para el PDF', 'err'); return; }

    var emi = f.emisor_snapshot || {};
    var cli = f.cliente_snapshot || {};
    var lineas = f.lineas || [];
    var esSimplificada = (f.tipo === 'simplificada');

    // Fecha legible
    var fechaTxt = f.fecha_emision || '';
    try {
      var d = new Date(f.fecha_emision);
      if (!isNaN(d)) fechaTxt = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {}

    // Datos emisor
    var emiNombre = emi.razon_social || emi.nombre || 'Mi Tienda';
    var emiLogo = emi.logo || (window.TIENDA && window.TIENDA.logo_url) || '';
    var emiLineas = [];
    if (emi.cif) emiLineas.push('CIF/NIF: ' + emi.cif);
    if (emi.dir) emiLineas.push(emi.dir);
    var emiCP = [emi.cp, emi.ciudad].filter(Boolean).join(' ');
    if (emiCP) emiLineas.push(emiCP);
    if (emi.provincia) emiLineas.push(emi.provincia);
    if (emi.tel) emiLineas.push('Tel: ' + emi.tel);
    if (emi.email) emiLineas.push(emi.email);

    // Datos cliente
    var cliNombre, cliLineas = [];
    if (esSimplificada) {
      cliNombre = ((cli.nombre || '') + ' ' + (cli.apellidos || '')).trim() || 'Cliente';
      if (cli.nif) cliLineas.push('NIF: ' + cli.nif);
    } else {
      cliNombre = cli.nombre_fiscal || 'Cliente';
      if (cli.nif) cliLineas.push('NIF/CIF: ' + cli.nif);
      if (cli.dir_fiscal) cliLineas.push(cli.dir_fiscal);
      var cliCP = [cli.cp, cli.ciudad].filter(Boolean).join(' ');
      if (cliCP) cliLineas.push(cliCP);
      if (cli.provincia) cliLineas.push(cli.provincia);
    }

    // Filas de la tabla
    var filasHtml = '';
    lineas.forEach(function(ln) {
      var cant = parseFloat(ln.cantidad) || 1;
      var precio = parseFloat(ln.precio) || 0;
      var tot = parseFloat(ln.total);
      if (isNaN(tot)) tot = cant * precio;
      filasHtml +=
        '<tr>' +
        '<td class="desc">' + _esc(ln.desc || ln.nombre || '-') + '</td>' +
        '<td class="num">' + cant + '</td>' +
        '<td class="num">' + _fmtImporte(precio) + '</td>' +
        '<td class="num">' + _fmtImporte(tot) + '</td>' +
        '</tr>';
    });

    var emiInfoHtml = emiLineas.map(function(l){ return '<div>' + _esc(l) + '</div>'; }).join('');
    var cliInfoHtml = cliLineas.map(function(l){ return '<div>' + _esc(l) + '</div>'; }).join('');

    var esAbono = !!f.rectifica_a;
    var tituloDoc = esAbono ? 'FACTURA RECTIFICATIVA (ABONO)' : (esSimplificada ? 'FACTURA SIMPLIFICADA' : 'FACTURA');

    // Detalle del aparato (solo facturas de reparación)
    var aptHtml = '';
    var od = f.origen_detalle || {};
    if (od.marca || od.modelo || od.imei || od.averia) {
      var aparatoNom = [od.marca, od.modelo].filter(Boolean).join(' ');
      aptHtml = '<div class="aparato"><h3>Aparato reparado</h3>' +
        '<div class="apt-row"><strong>' + _esc(aparatoNom || 'Dispositivo') + '</strong>' +
        (od.imei ? ' &middot; IMEI: ' + _esc(od.imei) : '') + '</div>' +
        (od.averia ? '<div class="apt-averia">Aver\u00eda: ' + _esc(od.averia) + '</div>' : '') +
        '</div>';
    }

    var html =
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<title>Factura ' + _esc(f.numero) + '</title>' +
      '<style>' +
      '* { margin:0; padding:0; box-sizing:border-box; }' +
      'body { font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#1a1a2e; padding:32px 40px; font-size:13px; line-height:1.5; }' +
      '.cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #10B981; padding-bottom:18px; margin-bottom:24px; }' +
      '.marca-wrap { display:flex; align-items:center; gap:14px; }' +
      '.logo-img { max-height:60px; max-width:160px; object-fit:contain; }' +
      '.marca { font-size:28px; font-weight:800; color:#10B981; letter-spacing:-0.5px; }' +
      '.marca .sub { display:block; font-size:11px; font-weight:500; color:#888; letter-spacing:0.5px; margin-top:2px; }' +
      '.doc-meta { text-align:right; }' +
      '.doc-meta .tipo { font-size:16px; font-weight:700; color:#1a1a2e; }' +
      '.doc-meta .numero { font-size:15px; color:#10B981; font-weight:700; margin-top:4px; }' +
      '.doc-meta .fecha { font-size:12px; color:#666; margin-top:4px; }' +
      '.doc-meta .rectif { font-size:11px; color:#dc2626; font-weight:600; margin-top:3px; }' +
      '.bloques { display:flex; gap:24px; margin-bottom:28px; }' +
      '.bloque { flex:1; background:#f7f8fa; border-radius:8px; padding:14px 16px; }' +
      '.bloque h3 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#10B981; margin-bottom:8px; font-weight:700; }' +
      '.bloque .nom { font-size:14px; font-weight:700; margin-bottom:4px; }' +
      '.bloque div { font-size:12px; color:#444; }' +
      'table { width:100%; border-collapse:collapse; margin-bottom:20px; }' +
      'thead th { background:#1a1a2e; color:#fff; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; padding:9px 12px; text-align:left; }' +
      'thead th.num { text-align:right; }' +
      'tbody td { padding:9px 12px; border-bottom:1px solid #e8e8ee; font-size:12px; }' +
      'tbody td.num { text-align:right; white-space:nowrap; }' +
      'tbody td.desc { font-weight:500; }' +
      'tbody tr:last-child td { border-bottom:2px solid #1a1a2e; }' +
      '.totales { display:flex; justify-content:flex-end; }' +
      '.totales-box { width:280px; }' +
      '.totales-box .fila { display:flex; justify-content:space-between; padding:6px 12px; font-size:13px; }' +
      '.totales-box .fila.total { background:#10B981; color:#fff; font-weight:800; font-size:16px; border-radius:6px; padding:10px 12px; margin-top:6px; }' +
      '.pie { margin-top:36px; padding-top:14px; border-top:1px solid #e8e8ee; font-size:11px; color:#888; }' +
      '.pie .pago { color:#1a1a2e; font-weight:600; font-size:12px; margin-bottom:6px; }' +
      '.aparato { background:#fff7ed; border-left:3px solid #f59e0b; border-radius:6px; padding:12px 16px; margin-bottom:24px; }' +
      '.aparato h3 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#f59e0b; margin-bottom:6px; font-weight:700; }' +
      '.aparato .apt-row { font-size:13px; }' +
      '.aparato .apt-averia { font-size:12px; color:#666; margin-top:3px; }' +
      '@media print { body { padding:16px 20px; } @page { margin:1cm; } }' +
      '</style></head><body>' +
      '<div class="cab">' +
        '<div class="marca-wrap">' +
          (emiLogo ? '<img class="logo-img" src="' + _esc(emiLogo) + '" alt="">' : '') +
          '<div class="marca">' + _esc(emiNombre) + '<span class="sub">' + (emi.web ? _esc(emi.web) : 'Factura') + '</span></div>' +
        '</div>' +
        '<div class="doc-meta">' +
          '<div class="tipo">' + tituloDoc + '</div>' +
          '<div class="numero">' + _esc(f.numero) + '</div>' +
          '<div class="fecha">Fecha: ' + _esc(fechaTxt) + '</div>' +
          (esAbono && f.rectifica_numero ? '<div class="rectif">Rectifica a: ' + _esc(f.rectifica_numero) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="bloques">' +
        '<div class="bloque"><h3>Emisor</h3><div class="nom">' + _esc(emiNombre) + '</div>' + emiInfoHtml + '</div>' +
        '<div class="bloque"><h3>' + (esSimplificada ? 'Cliente' : 'Facturar a') + '</h3><div class="nom">' + _esc(cliNombre) + '</div>' + cliInfoHtml + '</div>' +
      '</div>' +
      aptHtml +
      '<table><thead><tr>' +
        '<th>Descripci\u00f3n</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th>' +
      '</tr></thead><tbody>' + filasHtml + '</tbody></table>' +
      '<div class="totales"><div class="totales-box">' +
        '<div class="fila"><span>Base imponible</span><span>' + _fmtImporte(f.base_imponible) + '</span></div>' +
        '<div class="fila"><span>IVA (' + (parseFloat(f.iva_pct) || 0) + '%)</span><span>' + _fmtImporte(f.iva_importe) + '</span></div>' +
        '<div class="fila total"><span>TOTAL</span><span>' + _fmtImporte(f.total) + '</span></div>' +
      '</div></div>' +
      '<div class="pie">' +
        (f.metodo_pago ? '<div class="pago">Forma de pago: ' + _esc(f.metodo_pago) + '</div>' : '') +
        '<div>Documento generado por TekPair. Conserve esta factura como justificante.</div>' +
      '</div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
      '</body></html>';

    window.__ultimoFacturaHTML = html;
    window.__ultimoFacturaNum = f.numero || '';
    var w = window.open('', '_blank');
    if (!w) { _toast('Activa las ventanas emergentes para ver el PDF', 'err'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  // ────────── Emitir factura rectificativa (abono) ──────────
  window.emitirAbonoFactura = function(orig) {
    if (!orig || !orig.id) { _toast('Factura original no válida', 'err'); return; }
    if (orig.rectifica_a) { _toast('Esto ya es un abono, no se puede abonar', 'err'); return; }

    _obtenerSiguienteNumero(2).then(function(numInfo) {
      // Líneas con importes negativos
      var lineasNeg = (orig.lineas || []).map(function(l) {
        return {
          desc: l.desc || l.nombre || '-',
          cantidad: parseFloat(l.cantidad) || 1,
          precio: -(parseFloat(l.precio) || 0),
          total: -(parseFloat(l.total) || 0)
        };
      });

      var payload = {
        tienda_id: window.TIENDA_ID,
        numero: numInfo.numero,
        serie: 2,
        secuencia: numInfo.secuencia,
        fecha_emision: new Date().toISOString().slice(0, 10),
        tipo: orig.tipo || 'completa',
        origen_tipo: orig.origen_tipo || null,
        origen_id: orig.origen_id || null,
        cliente_id: orig.cliente_id || null,
        cliente_snapshot: orig.cliente_snapshot || {},
        emisor_snapshot: orig.emisor_snapshot || {},
        origen_detalle: orig.origen_detalle || null,
        lineas: lineasNeg,
        base_imponible: -(parseFloat(orig.base_imponible) || 0),
        iva_pct: parseFloat(orig.iva_pct) || 0,
        iva_importe: -(parseFloat(orig.iva_importe) || 0),
        total: -(parseFloat(orig.total) || 0),
        metodo_pago: orig.metodo_pago || '',
        rectifica_a: orig.id,
        rectifica_numero: orig.numero || '',
        estado: 'emitida'
      };

      return fetch(window.SUPABASE_URL + '/rest/v1/facturas', {
        method: 'POST',
        headers: _supabaseHeaders(),
        body: JSON.stringify(payload)
      }).then(function(r) {
        if (!r.ok) {
          return r.json().then(function(err) {
            throw new Error('INSERT abono ' + r.status + ': ' + JSON.stringify(err));
          });
        }
        return r.json();
      }).then(function(arr) {
        var ab = Array.isArray(arr) ? arr[0] : arr;
        _toast('✓ Abono ' + ab.numero + ' generado', 'ok');
        if (typeof window.generarFacturaPDF === 'function') {
          window.generarFacturaPDF(ab);
        }
      });
    }).catch(function(err) {
      console.error('Error generando abono:', err);
      _toast('Error generando abono: ' + err.message, 'err');
    });
  };

  console.log('[factura.js] módulo cargado');
})();
