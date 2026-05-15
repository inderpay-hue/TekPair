/* ═══════════════════════════════════════════════════════════
   TEKPAIR · MÓDULO FACTURAS
   ═══════════════════════════════════════════════════════════
   Uso: window.abrirModalFactura(origen, datos)
     origen: 'venta' | 'reparacion'
     datos: objeto con la venta o reparación a facturar
   ═══════════════════════════════════════════════════════════ */
(function() {
  'use strict';

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
  window.abrirModalFactura = function(origen, datos) {
    if (!window.SUPABASE_URL || !window.SB_KEY || !window.TIENDA_ID) {
      _toast('Faltan credenciales. Recarga la página.', 'err');
      return;
    }

    _inyectarModal();

    FACT.origen = origen;
    FACT.datos = datos;
    FACT.tipo = 'simplificada';

    _renderOrigen();
    window.setTipoFactura('simplificada');

    document.getElementById('mFactura').style.display = 'flex';
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
      web: t.web || ''
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

  // ────────── Llamar función SQL siguiente_numero_factura ──────────
  function _obtenerSiguienteNumero() {
    return fetch(window.SUPABASE_URL + '/rest/v1/rpc/siguiente_numero_factura', {
      method: 'POST',
      headers: _supabaseHeaders(),
      body: JSON.stringify({
        p_tienda_id: window.TIENDA_ID,
        p_serie: 1
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
        _toast('✓ Factura ' + f.numero + ' emitida', 'ok');
        window.cerrarModalFactura();
        // Fase 3: aquí se llamará al PDF
      });
    }).catch(function(err) {
      console.error('Error emitiendo factura:', err);
      _toast('Error: ' + err.message, 'err');
    }).then(function() {
      if (btn) { btn.disabled = false; btn.textContent = '✓ Emitir factura'; }
    });
  };

  console.log('[factura.js] módulo cargado');
})();
