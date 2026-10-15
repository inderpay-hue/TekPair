// js/usados.js — Compra de usados a particulares: lo que cambia de un país a
// otro y el impuesto sobre el margen. Lo cargan el panel (dashboard.html) y el
// TPV (tpv.html), y factura.js lo usa si está.
//
// El circuito es el mismo en todos los países (contrato firmado → registro →
// stock → venta). Lo que cambia va en AJUSTES.usados, que arranca con los
// valores del país de la tienda (AJUSTES.paisPrefijo) y la tienda puede tocar:
//   regimen  'margen' = el impuesto solo sobre (venta − compra), sin desglosarlo
//            'total'  = como cualquier otro producto
//            'sin'    = esa venta no lleva impuesto
//   tipo     porcentaje del impuesto para estas ventas
//   mencion  texto legal que sale en el ticket y la factura
//   registro si se lleva el registro de compras (libro de policía)
//   docs     documentos de identidad que se aceptan al vendedor
//   anios    años que se guardan los datos del vendedor
//   dias     días que el teléfono tiene que estar en tienda antes de venderlo
// Los valores por país son un PUNTO DE PARTIDA: los confirma el asesor.
(function () {
  // UE: régimen de margen de la Directiva 2006/112/CE (arts. 311 a 325).
  var PAISES = {
    '34':  { regimen: 'margen', tipo: 21, mencion: 'Régimen especial de los bienes usados', registro: true, docs: 'DNI, NIE, Pasaporte' },
    '33':  { regimen: 'margen', tipo: 20, mencion: 'Régime particulier – Biens d\'occasion', registro: true, docs: 'Carte d\'identité, Passeport, Titre de séjour' },
    '39':  { regimen: 'margen', tipo: 22, mencion: 'Regime del margine – beni usati', registro: true, docs: 'Carta d\'identità, Passaporto, Patente' },
    '49':  { regimen: 'margen', tipo: 19, mencion: 'Gebrauchtgegenstände / Sonderregelung', registro: false, docs: 'Personalausweis, Reisepass' },
    '351': { regimen: 'margen', tipo: 23, mencion: 'Regime da margem de lucro – Bens em segunda mão', registro: true, docs: 'Cartão de Cidadão, Passaporte' },
    '44':  { regimen: 'margen', tipo: 20, mencion: 'Margin scheme – second-hand goods', registro: true, docs: 'Passport, Driving licence' },
    // Fuera de la UE: sin régimen de margen general; se cobra como el resto.
    '52':  { docs: 'INE, Pasaporte' }, '54': { docs: 'DNI, Pasaporte' }, '57': { docs: 'Cédula, Pasaporte' },
    '56':  { docs: 'Cédula / RUT, Pasaporte' }, '51': { docs: 'DNI, Pasaporte' }, '55': { docs: 'RG, CPF, Passaporte' },
    '598': { docs: 'Cédula, Pasaporte' }, '593': { docs: 'Cédula, Pasaporte' }, '591': { docs: 'Carnet de identidad, Pasaporte' },
    '595': { docs: 'Cédula, Pasaporte' }, '502': { docs: 'DPI, Pasaporte' }, '506': { docs: 'Cédula, Pasaporte' },
    '507': { docs: 'Cédula, Pasaporte' }, '58': { docs: 'Cédula, Pasaporte' }, '1': { docs: 'ID, Driver license, Passport' }
  };

  function _aj() { try { return (typeof AJUSTES !== 'undefined' && AJUSTES) ? AJUSTES : {}; } catch (e) { return {}; } }
  function r2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }

  // Valores del país, sin lo que haya tocado la tienda.
  function tkUsadosDefaults(prefijo) {
    var aj = _aj();
    var p = PAISES[String(prefijo || aj.paisPrefijo || '34')] || {};
    var tipoGen = (aj.iva && aj.iva.tipoDefault != null) ? parseFloat(aj.iva.tipoDefault) : 21;
    return {
      regimen: p.regimen || 'total',
      tipo: p.tipo != null ? p.tipo : tipoGen,
      mencion: p.mencion || '',
      registro: p.registro !== false,
      docs: p.docs || 'DNI, Pasaporte',
      anios: 6,
      dias: 0
    };
  }

  // Configuración en uso: la del país con lo que haya cambiado la tienda encima.
  function tkUsadosCfg() {
    var aj = _aj();
    var c = Object.assign(tkUsadosDefaults(aj.paisPrefijo), aj.usados || {});
    c.tipo = parseFloat(c.tipo); if (!isFinite(c.tipo) || c.tipo < 0) c.tipo = 0;
    c.anios = parseInt(c.anios, 10); if (!(c.anios > 0)) c.anios = 6;
    c.dias = parseInt(c.dias, 10); if (!(c.dias >= 0)) c.dias = 0;
    // Sin impuestos activados en la tienda no hay nada que calcular.
    c.impuestoActivo = !!(aj.iva && aj.iva.activo);
    return c;
  }

  // Una línea vendida en régimen de margen. `neto` es lo cobrado por la línea
  // (ya con descuentos) y `coste` lo que se pagó al particular. El impuesto va
  // DENTRO del margen; si se vende por menos de lo que costó, no hay impuesto.
  function tkMargenLinea(neto, coste, tipo) {
    var margen = Math.max(0, r2(neto) - r2(coste));
    var cuota = tipo > 0 ? r2(margen * tipo / (100 + tipo)) : 0;
    return { margen: r2(margen), cuota: cuota, base: r2(margen - cuota) };
  }

  // Parte de una venta guardada que va por el régimen de usados (item.usado lo
  // pone el TPV al cobrar: 'margen' o 'sin' impuesto) y la parte normal, para
  // tickets, facturas e informes. En 'sin' la base y la cuota son 0.
  // Sin líneas de usados devuelve hay=false y la parte normal es la venta entera.
  function tkPartesVenta(v) {
    var out = { hay: false, ventas: 0, coste: 0, margen: 0, cuota: 0, base: 0, mencion: '', n: 0,
      normalBase: parseFloat(v && v.base) || 0, normalIva: parseFloat(v && v.ivaImporte) || 0 };
    var items = (v && v.items) || [];
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
    (items || []).forEach(function (it) {
      var u = it && it.usado;
      if (!u || (u.regimen !== 'margen' && u.regimen !== 'sin')) return;
      out.hay = true; out.n++;
      out.ventas += parseFloat(u.neto) || 0;
      out.coste += parseFloat(u.coste) || 0;
      out.margen += parseFloat(u.margen) || 0;
      out.cuota += parseFloat(u.cuota) || 0;
      out.base += parseFloat(u.base) || 0;
      if (u.mencion && !out.mencion) out.mencion = u.mencion;
    });
    if (out.hay) {
      ['ventas', 'coste', 'margen', 'cuota', 'base'].forEach(function (k) { out[k] = r2(out[k]); });
      out.normalBase = r2(Math.max(0, out.normalBase - out.base));
      out.normalIva = r2(Math.max(0, out.normalIva - out.cuota));
    }
    return out;
  }

  window.tkUsadosDefaults = tkUsadosDefaults;
  window.tkUsadosCfg = tkUsadosCfg;
  window.tkMargenLinea = tkMargenLinea;
  window.tkPartesVenta = tkPartesVenta;
})();
