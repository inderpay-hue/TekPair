(function() {
  'use strict';

  // ── Auth: leer JWT de la sesión TekPair ──────────
  function getJWT() {
    try {
      const sess = JSON.parse(localStorage.getItem('tk_sess') || '{}');
      return sess.jwt_token || sess.jwt || '';
    } catch (e) { return ''; }
  }

  // Decodifica payload del JWT (sin verificar firma — solo para leer rol/email)
  function decodeJWT() {
    try {
      const t = getJWT();
      if (!t) return {};
      const partes = t.split('.');
      if (partes.length < 2) return {};
      const payload = partes[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = payload + '='.repeat((4 - payload.length % 4) % 4);
      return JSON.parse(atob(pad));
    } catch (e) { return {}; }
  }

  function esAdminTienda() {
    const p = decodeJWT();
    return p.rol === 'admin' || p.email === 'info@tekpair.tech';
  }

  function esSuperAdmin() {
    const p = decodeJWT();
    return p.email === 'info@tekpair.tech';
  }

  // ¿Puede ver días anteriores (histórico/calendario)? Admin siempre; empleado con permiso.
  function puedeHistorico() {
    return esAdminTienda() || (typeof window.tienePerm === 'function' && window.tienePerm('cajasm_historico'));
  }
  function _txtSinHist() {
    return (typeof window.T === 'function') ? window.T('cajas.sin_permiso_historico') : 'No tienes permiso para ver días anteriores';
  }

  // ── Wrapper API ──────────────────────────────────
  async function api(action, opts = {}) {
    const { method = 'GET', body = null, query = {} } = opts;
    const qs = new URLSearchParams({ action, ...query }).toString();
    const url = `/api/cajas?${qs}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getJWT()}`
      },
      body: body ? JSON.stringify(body) : null
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  const Estado = {
    cajas: [],
    fechaActual: hoyLocal(),
    cierres: {},
    cajaEditando: null,
    cierreEditando: null,
    inicializado: false,
    fiadosTemp: [],  // array de fiados del día actual (múltiples por compañía permitidos)
    cuentas: [],  // cuentas de saldo de recargas (monedero prepago)
    tabActiva: 'dia',
    subTabActiva: 'pendientes',
    cobros: []  // cache de fiados para la vista de cobros
  };

  function eur(n) {
    return Number(n || 0).toFixed(2).replace('.', ',') + ' €';
  }
  function toast(msg, tipo = 'info') {
    if (window.toast) return window.toast(msg, tipo);
    if (window.mostrarToast) return window.mostrarToast(msg, tipo);
    if (tipo === 'error') alert('❌ ' + msg);
    else alert(msg);
  }
  function $(id) { return document.getElementById(id); }
  function escapar(s) {
    return String(s || '').replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Devuelve la fecha de HOY en zona horaria LOCAL en formato YYYY-MM-DD.
  // Evita el bug clásico de new Date().toISOString().slice(0,10) que da UTC.
  function hoyLocal() {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // ── Init (se llama desde navTo('pCajas') ─────────
  // Icono de línea iOS (definido en dash-app.js, cargado en runtime). Fallback vacío si no está.
  function IC(name, sz) { return (typeof window._iv2ic === 'function') ? window._iv2ic(name, sz) : ''; }
  async function renderCajas() {
    if (typeof window._ensureIv2Sprite === 'function') { try { window._ensureIv2Sprite(); } catch (e) {} }
    if (!Estado.inicializado) {
      $('cajas-fecha-actual').value = Estado.fechaActual;
      // Sin permiso de histórico, el empleado no puede retroceder a días anteriores.
      if (!puedeHistorico()) $('cajas-fecha-actual').min = hoyLocal();
      $('cajas-fecha-actual').addEventListener('change', (e) => {
        var nueva = e.target.value;
        if (nueva && nueva < hoyLocal() && !puedeHistorico()) {
          if (typeof window.toast === 'function') window.toast(_txtSinHist(), 'err');
          e.target.value = hoyLocal();
          Estado.fechaActual = hoyLocal();
          cargarCajas();
          return;
        }
        Estado.fechaActual = nueva;
        cargarCajas();
      });
      $('caja-tipo').addEventListener('change', (e) => {
        const tipo = e.target.value;
        const sug = {
          envios:   { nombre: 'Caja Envíos',   icono: '📤' },
          recargas: { nombre: 'Caja Recargas', icono: '📱' },
          tpv:      { nombre: 'Caja TPV',      icono: '🛒' },
          custom:   { nombre: '',              icono: '💼' }
        }[tipo] || { nombre: '', icono: '💼' };
        if (!Estado.cajaEditando) {
          if (!$('caja-nombre').value || $('caja-nombre').dataset.auto !== 'no') {
            $('caja-nombre').value = sug.nombre;
            $('caja-nombre').dataset.auto = 'si';
          }
          if (!$('caja-icono').value || $('caja-icono').dataset.auto !== 'no') {
            $('caja-icono').value = sug.icono;
            $('caja-icono').dataset.auto = 'si';
          }
        }
      });
      document.addEventListener('input', (e) => {
        if (e.target.matches('#cierre-saldo-inicial, #cierre-saldo-real, #cierre-total-cobrado, #cierre-importe-tpv')) {
          recalcularResumen();
        }
        if (e.target.matches('#caja-nombre, #caja-icono')) {
          e.target.dataset.auto = 'no';
        }
      });
      Estado.inicializado = true;
    }
    await cargarCajas();
  }

  async function cargarCajas() {
    try {
      // Asegura la "Caja del día" por defecto (idempotente en el servidor).
      try { await api('asegurar_caja_dia', { method: 'POST', body: {} }); } catch (e) { /* no crítico */ }
      const r = await api('listar_cajas');
      Estado.cajas = r.cajas || [];
      Estado.cierres = {};
      await Promise.all(Estado.cajas.map(async (c) => {
        try {
          const d = await api('obtener_cierre', {
            query: { caja_id: c.id, fecha: Estado.fechaActual, hoy: (typeof hoyLocal === 'function' ? hoyLocal() : '') }
          });
          Estado.cierres[c.id] = d;
        } catch (e) {
          Estado.cierres[c.id] = { cierre: null, movimientos: [], companias: [] };
        }
      }));
      try { const rc = await api('listar_cuentas'); Estado.cuentas = rc.cuentas || []; } catch (e) { Estado.cuentas = Estado.cuentas || []; }
      pintarTarjetas();
      pintarCuentas();
      pintarCajaDia();
      actualizarBadgePendientes();
      pintarFranja7();
      actualizarLabelFecha();
    } catch (e) {
      var _m = (e && e.message) || '';
      if (/token|sesi[oó]n|401|inv[aá]lid/i.test(_m)) toast(T('gen.sesion_caducada'), 'error');
      else toast(T('cajas.error_cargar') + (_m ? ': ' + _m : ''), 'error');
    }
  }

  function pintarTarjetas() {
    const grid = $('cajas-grid');
    if (Estado.cajas.length === 0) {
      grid.innerHTML = `
        <div class="cajas-mensaje-vacio" style="grid-column:1/-1;">
          <p style="font-size:16px;margin-bottom:6px;color:var(--text,#374151);">${T('cajas.vacio_titulo')}</p>
          <p style="font-size:13px;">${T('cajas.vacio_sub')}</p>
          <button class="cajas-btn cajas-btn-verde" style="margin-top:12px;" onclick="Cajas.abrirModalNuevaCaja()">+ Crear primera caja</button>
        </div>
      `;
      return;
    }

    let html = '';
    for (const caja of Estado.cajas) {
      if (caja.nombre === 'Caja del día') continue; // se pinta en su propio panel
      const datos = Estado.cierres[caja.id] || {};
      const cierre = datos.cierre;
      const estado = cierre?.estado || 'pendiente';
      const descuadre = cierre?.descuadre || 0;
      const tieneDescuadre = Math.abs(descuadre) > 0.5;
      const esSobra = descuadre > 0.5;
      const esFalta = descuadre < -0.5;
      const labelEstado = {
        abierto: T('cajas.en_curso'),
        cerrado: T('cajas.cuadrada_ok'),
        descuadre: esSobra ? '+ ' + T('cajas.sobra') : '⚠ ' + T('cajas.falta'),
        pendiente: T('cajas.pendiente'),
        festivo: '🏖 ' + T('cajas.festivo')
      }[estado];

      html += `
        <div class="caja-card" style="border-left: 4px solid ${caja.color || '#FF5B1F'}">
          <div class="caja-card-header">
            <div class="caja-card-titulo">
              <span class="caja-card-icono">${caja.icono || '💼'}</span>
              <span>${escapar(caja.nombre)}</span>
            </div>
            <span class="caja-card-estado caja-estado-${estado}">${labelEstado}</span>
          </div>
          <div class="caja-card-resumen">
            <div>
              <div class="label">${T('cajas.teorico')}</div>
              <div class="valor">${cierre ? eur(cierre.saldo_teorico) : '—'}</div>
            </div>
            <div>
              <div class="label">${T('cajas.real')}</div>
              <div class="valor">${cierre ? eur(cierre.saldo_real_final) : '—'}</div>
            </div>
            ${cierre ? `
              <div style="grid-column:1/-1;">
                <div class="label">${T('cajas.descuadre')}</div>
                <div class="valor ${esFalta ? 'valor-descuadre' : (esSobra ? 'valor-sobra' : 'valor-ok')}">
                  ${tieneDescuadre ? (esSobra ? '+' + eur(descuadre).replace('+', '') : eur(descuadre)) : T('cajas.caja_cuadrada')}
                </div>
              </div>
            ` : ''}
          </div>
          <div class="caja-card-acciones">
            ${cierre?.estado === 'festivo' ? `
              <button class="cajas-btn cajas-btn-sec" style="flex:1;background:#f3f4f6;color:#6b7280;cursor:default;" disabled>
                🏖 ${T('cajas.dia_festivo')}
              </button>
              <button class="cajas-btn cajas-btn-sec" onclick="Cajas.deshacerFestivo('${caja.id}')" title="${T('cajas.quitar_festivo')}">↺</button>
            ` : `
              <button class="cajas-btn" onclick="Cajas.abrirCierre('${caja.id}')">
                ${cierre ? T('cajas.ver_editar') : T('cajas.hacer_cierre')}
              </button>
              ${(cierre && (cierre.estado === 'cerrado' || cierre.estado === 'descuadre') && esAdminTienda()) ? `<button class="cajas-btn cajas-btn-sec" onclick="Cajas.reabrirCaja('${cierre.id}')" title="${T('cajas.reabrir_ayuda')}">🔓 ${T('cajas.reabrir')}</button>` : ''}
              ${!cierre ? `<button class="cajas-btn cajas-btn-sec" onclick="Cajas.marcarFestivo('${caja.id}')" title="${T('cajas.marcar_festivo')}">🏖</button>` : ''}
            `}
            <button class="cajas-btn cajas-btn-sec" onclick="Cajas.editarCaja('${caja.id}')">⚙️</button>
          </div>
        </div>
      `;
    }

    html += `
      <div class="caja-card-nueva" onclick="Cajas.abrirModalNuevaCaja()">
        <div class="icono-grande">+</div>
        <div>${T('cajas.anadir_nueva')}</div>
      </div>
    `;
    grid.innerHTML = html;
  }

  // ── PANEL CUENTAS DE SALDO (monedero prepago de recargas) ──
  function pintarCuentas() {
    const cont = $('cajas-cuentas-panel');
    if (!cont) return;
    // Solo cuentas de cajas visibles (las que existen en Estado.cajas)
    const idsCajas = new Set((Estado.cajas || []).map(c => c.id));
    const cuentas = (Estado.cuentas || []).filter(c => idsCajas.has(c.caja_id));
    if (cuentas.length === 0) { cont.innerHTML = ''; return; }

    let cards = '';
    for (const c of cuentas) {
      const comps = (c.companias || []).map(x => escapar(x.nombre)).join(' · ');
      const esEnvios = _tipoCuenta(c) === 'envios';
      const etiqueta = esEnvios ? T('cajas.pendiente_ingresar') : T('cajas.saldo_label');
      const btnPrimario = esEnvios
        ? `<button class="cajas-btn cajas-btn-sec" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;" onclick="Cajas.ingresoBanco('${c.id}')">${IC('euro', 15)}${T('cajas.ingrese_banco')}</button>`
        : `<button class="cajas-btn cajas-btn-sec" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;" onclick="Cajas.recargarSaldo('${c.id}')">${IC('plus', 15)}${T('cajas.recargue')}</button>`;
      cards += `
        <div style="background:var(--white);border:1px solid var(--border);border-radius:14px;padding:16px;border-left:4px solid ${esEnvios ? '#F59E0B' : '#6366F1'};">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div style="font-weight:800;font-size:15px;color:var(--text);">${escapar(c.nombre)}</div>
            <button class="cajas-btn cajas-btn-sec" style="padding:5px 9px;display:inline-flex;align-items:center;" onclick="Cajas.verSeguimiento('${c.id}')" title="${T('cajas.seguimiento')}">${IC('chart', 16)}</button>
          </div>
          ${comps ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">${comps}</div>` : ''}
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-top:8px;">${etiqueta}</div>
          <div style="font-size:26px;font-weight:800;color:var(--text);margin:2px 0 12px;">${eur(c.saldo)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${btnPrimario}
            <button class="cajas-btn" style="flex:1;" onclick="Cajas.confirmarSaldoCuenta('${c.id}')">✓ ${T('cajas.confirmar_saldo')}</button>
          </div>
        </div>`;
    }
    cont.innerHTML = `
      <div style="margin-top:8px;">
        <div style="font-weight:800;font-size:15px;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:7px;">${IC('card', 16)}${T('cajas.saldos_titulo')}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">${cards}</div>
      </div>`;
  }

  // Recargas vendidas HOY de una cuenta: suma los movimientos del cierre del día
  // de la caja de esa cuenta cuyas compañías pertenecen a la cuenta.
  // Tipo de la caja a la que pertenece una cuenta ('envios' | 'recargas' | ...).
  function _tipoCuenta(cuenta) {
    const caja = (Estado.cajas || []).find(x => cuenta && x.id === cuenta.caja_id);
    return caja ? caja.tipo : null;
  }
  // Monto del día de una cuenta. Recargas = total vendido (efectivo + TPV, ya combinado en
  // importe_efectivo). Envíos = importe enviado (lo que se le debe ingresar a la compañía).
  function _ventasDiaCuenta(cuenta) {
    if (!cuenta) return 0;
    const datos = (Estado.cierres || {})[cuenta.caja_id] || {};
    const movs = datos.movimientos || [];
    const idsComp = new Set((cuenta.companias || []).map(x => x.id));
    const esEnvios = _tipoCuenta(cuenta) === 'envios';
    let total = 0;
    for (const m of movs) {
      if (idsComp.has(m.compania_id)) {
        total += esEnvios ? Number(m.importe_enviado || 0) : (Number(m.importe_efectivo || 0) + Number(m.importe_tarjeta || 0));
      }
    }
    return Math.round(total * 100) / 100;
  }

  async function recargarSaldo(cuentaId) {
    const v = await _pedirValor({ titulo: '➕ ' + T('cajas.recargue'), ayuda: T('cajas.recargue_prompt') });
    if (v === null) return;
    const imp = Number(String(v).replace(',', '.'));
    if (!isFinite(imp) || imp === 0) { toast(T('cajas.importe_invalido'), 'error'); return; }
    try {
      await api('recargar_saldo', { method: 'POST', body: { cuenta_id: cuentaId, importe: imp } });
      toast(T('cajas.saldo_actualizado'));
      await cargarCajas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Envíos: registrar un ingreso en el banco → BAJA el pendiente (recargar_saldo con importe negativo).
  async function ingresoBanco(cuentaId) {
    const v = await _pedirValor({ titulo: '💰 ' + T('cajas.ingrese_banco'), ayuda: T('cajas.ingrese_banco_prompt') });
    if (v === null) return;
    const imp = Number(String(v).replace(',', '.'));
    if (!isFinite(imp) || imp <= 0) { toast(T('cajas.importe_invalido'), 'error'); return; }
    try {
      await api('recargar_saldo', { method: 'POST', body: { cuenta_id: cuentaId, importe: -imp, nota: 'Ingreso banco' } });
      toast(T('cajas.saldo_actualizado'));
      await cargarCajas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function confirmarSaldoCuenta(cuentaId, ventasDia) {
    const _cta = (Estado.cuentas || []).find(c => c.id === cuentaId);
    const _esEnvios = _tipoCuenta(_cta) === 'envios';
    const v = await _pedirValor({ titulo: '✓ ' + T('cajas.confirmar_saldo'), ayuda: _esEnvios ? T('cajas.confirmar_pend_prompt') : T('cajas.confirmar_prompt'), valorInicial: _cta ? _cta.saldo : '' });
    if (v === null) return;
    const real = Number(String(v).replace(',', '.'));
    if (!isFinite(real)) { toast(T('cajas.importe_invalido'), 'error'); return; }
    try {
      await api('confirmar_saldo', {
        method: 'POST',
        body: { cuenta_id: cuentaId, saldo_real: real, ventas_dia: ventasDia || 0, fecha: Estado.fechaActual }
      });
      toast(T('cajas.saldo_actualizado'));
      await cargarCajas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Ventana de entrada (sustituye a prompt(), que Safari/PWA a veces bloquea).
  // Devuelve una Promise con el texto introducido, o null si se cancela.
  function _pedirValor(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let cerrado = false;
      const ov = document.createElement('div');
      ov.className = 'cajas-modal-overlay activo';
      ov.style.zIndex = '100001';
      const fin = (val) => { if (cerrado) return; cerrado = true; ov.remove(); resolve(val); };
      ov.onclick = (e) => { if (e.target === ov) fin(null); };
      ov.innerHTML = `<div class="cajas-modal" style="max-width:420px;">
        <div class="cajas-modal-header"><h3>${escapar(opts.titulo || '')}</h3><button class="cajas-modal-cerrar" type="button">✕</button></div>
        <div class="cajas-modal-cuerpo">
          ${opts.ayuda ? `<div style="font-size:13px;color:var(--muted);margin-bottom:10px;line-height:1.4;">${escapar(opts.ayuda)}</div>` : ''}
          <input id="_pv-input" type="text" inputmode="${opts.texto ? 'text' : 'decimal'}" autocomplete="off" value="${opts.valorInicial != null ? escapar(String(opts.valorInicial)) : ''}" onfocus="this.select();" style="width:100%;font-size:16px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--white);color:var(--text);box-sizing:border-box;">
        </div>
        <div class="cajas-modal-pie">
          <button class="cajas-btn cajas-btn-sec" id="_pv-cancel" type="button">${T('gen.cancelar')}</button>
          <button class="cajas-btn cajas-btn-verde" id="_pv-ok" type="button">${T('gen.aceptar')}</button>
        </div>
      </div>`;
      document.body.appendChild(ov);
      const inp = ov.querySelector('#_pv-input');
      ov.querySelector('.cajas-modal-cerrar').onclick = () => fin(null);
      ov.querySelector('#_pv-cancel').onclick = () => fin(null);
      ov.querySelector('#_pv-ok').onclick = () => fin(inp.value);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(inp.value); else if (e.key === 'Escape') fin(null); });
      setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* noop */ } }, 50);
    });
  }

  // Historial de movimientos de una cuenta (seguimiento del dinero): recargas, ingresos, ajustes.
  async function verSeguimiento(cuentaId) {
    let data;
    try { data = await api('listar_saldo_mov', { query: { cuenta_id: cuentaId } }); }
    catch (e) { toast(e.message, 'error'); return; }
    const cuenta = data.cuenta || {};
    const movs = data.movimientos || [];
    const TIPO = { recarga: T('cajas.mov_recarga'), confirmacion: T('cajas.mov_confirmacion'), ajuste: T('cajas.mov_ajuste') };
    let filas = movs.map(m => {
      const imp = Number(m.importe || 0);
      const signo = imp > 0 ? '+' : '';
      const col = imp > 0 ? '#16a34a' : (imp < 0 ? '#dc2626' : 'var(--muted)');
      const f = m.fecha || String(m.created_at || '').slice(0, 10);
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:7px 6px;font-size:12px;color:var(--muted);white-space:nowrap;">${escapar(f ? formatearFecha(f) : '')}</td>
        <td style="padding:7px 6px;font-size:12px;color:var(--text);">${escapar(TIPO[m.tipo] || m.tipo || '')}${m.nota ? ` <span style="color:var(--muted);">· ${escapar(m.nota)}</span>` : ''}</td>
        <td style="padding:7px 6px;font-size:13px;font-weight:700;text-align:right;color:${col};white-space:nowrap;">${signo}${eur(imp)}</td>
        <td style="padding:7px 6px;font-size:13px;font-weight:700;text-align:right;color:var(--text);white-space:nowrap;">${m.saldo_resultante != null ? eur(m.saldo_resultante) : '—'}</td>
      </tr>`;
    }).join('');
    if (!filas) filas = `<tr><td colspan="4" style="padding:14px;text-align:center;color:var(--muted);font-size:13px;">${T('cajas.sin_movimientos')}</td></tr>`;
    const ov = document.createElement('div');
    ov.className = 'cajas-modal-overlay activo';
    ov.style.zIndex = '100000';
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = `<div class="cajas-modal" style="max-width:600px;">
      <div class="cajas-modal-header">
        <h3 style="display:flex;align-items:center;gap:8px;">${IC('chart', 18)}${T('cajas.seguimiento')} — ${escapar(cuenta.nombre || '')}</h3>
        <button class="cajas-modal-cerrar" type="button">✕</button>
      </div>
      <div class="cajas-modal-cuerpo">
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px;">${T('cajas.saldo_label')}: <b style="color:var(--text);font-size:17px;">${eur(cuenta.saldo)}</b></div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:6px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">${T('gen.fecha')}</th>
            <th style="padding:6px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">${T('cajas.mov_tipo')}</th>
            <th style="padding:6px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);">${T('cajas.mov_cambio')}</th>
            <th style="padding:6px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);">${T('cajas.saldo_label')}</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table></div>
      </div>
    </div>`;
    ov.querySelector('.cajas-modal-cerrar').onclick = () => ov.remove();
    document.body.appendChild(ov);
  }

  // ── Modal Caja ──────────────────────────────────
  function abrirModalNuevaCaja() {
    Estado.cajaEditando = null;
    $('modal-caja-titulo').textContent = T('gen.nueva_caja').replace('+','').trim();
    $('caja-id').value = '';
    $('caja-tipo').value = 'envios';
    $('caja-nombre').value = 'Caja Envíos';
    $('caja-nombre').dataset.auto = 'si';
    $('caja-icono').value = '📤';
    $('caja-icono').dataset.auto = 'si';
    $('caja-color').value = '#FF5B1F';
    $('caja-permiso').value = 'admin';
    if ($('caja-gestion-fiados')) $('caja-gestion-fiados').checked = false;
    // Días apertura por defecto: L-V marcados
    document.querySelectorAll('.dia-checkbox').forEach(c => {
      c.checked = ['1','2','3','4','5'].includes(c.value);
    });
    $('btn-borrar-caja').style.display = 'none';
    $('caja-companias-bloque').style.display = 'none';
    $('modal-caja').classList.add('activo');
  }

  function editarCaja(id) {
    const caja = Estado.cajas.find(c => c.id === id);
    if (!caja) return;
    Estado.cajaEditando = caja;
    $('modal-caja-titulo').textContent = T('gen.editar_caja');
    $('caja-id').value = caja.id;
    $('caja-tipo').value = caja.tipo;
    $('caja-nombre').value = caja.nombre;
    $('caja-icono').value = caja.icono || '💼';
    $('caja-color').value = caja.color || '#FF5B1F';
    $('caja-permiso').value = caja.permiso_editar_cerrada || 'admin';
    if ($('caja-gestion-fiados')) $('caja-gestion-fiados').checked = !!caja.gestion_fiados;
    // Cargar días apertura (por defecto L-V si no hay)
    const dias = Array.isArray(caja.dias_apertura) && caja.dias_apertura.length > 0
      ? caja.dias_apertura.map(String)
      : ['1','2','3','4','5'];
    document.querySelectorAll('.dia-checkbox').forEach(c => {
      c.checked = dias.includes(c.value);
    });
    $('btn-borrar-caja').style.display = 'inline-block';
    $('caja-companias-bloque').style.display = 'block';
    renderCompanias();
    $('modal-caja').classList.add('activo');
  }

  async function renderCompanias() {
    if (!Estado.cajaEditando) return;
    const lista = $('lista-companias');
    try {
      const r = await api('listar_companias', {
        query: { caja_id: Estado.cajaEditando.id }
      });
      const cmps = r.companias || [];
      if (cmps.length === 0) {
        lista.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:8px;">' + T('gen.no_hay_companias') + '</div>';
      } else {
        lista.innerHTML = cmps.map(c => `
          <div class="compania-row" data-id="${c.id}">
            <input type="text" value="${escapar(c.nombre)}" onchange="Cajas.editarCompania('${c.id}', this.value)">
            <button class="cajas-btn cajas-btn-rojo" style="padding:5px 9px;font-size:11px;" onclick="Cajas.borrarCompania('${c.id}')">✕</button>
          </div>
        `).join('');
      }
      if (esAdminTienda()) await renderCuentasAdmin(cmps);
    } catch (e) {
      lista.innerHTML = `<div style="color:#dc2626;font-size:12px;">Error: ${e.message}</div>`;
    }
  }

  // Bloque admin de "Cuentas de saldo" dentro del modal de editar caja.
  async function renderCuentasAdmin(cmps) {
    const box = $('lista-cuentas-admin');
    if (!box || !Estado.cajaEditando) return;
    const cajaId = Estado.cajaEditando.id;
    // Cuentas de esta caja: usa Estado.cuentas si están, si no las pide.
    let cuentas = (Estado.cuentas || []).filter(c => c.caja_id === cajaId);
    if (!Estado.cuentas || Estado.cuentas.length === 0) {
      try { const rc = await api('listar_cuentas', { query: { caja_id: cajaId } }); cuentas = rc.cuentas || []; } catch (e) { cuentas = []; }
    }
    // Mapa compania_id -> cuenta_id (desde las companias[] de cada cuenta)
    const compACuenta = {};
    cuentas.forEach(ct => (ct.companias || []).forEach(x => { compACuenta[x.id] = ct.id; }));

    let html = '<div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:7px;">' + IC('card', 15) + T('cajas.cuentas_titulo') + '</div>';

    if (cuentas.length === 0) {
      html += '<div style="color:var(--muted);font-size:12px;padding:4px 0 8px;">' + T('gen.no_hay_companias') + '</div>';
    } else {
      html += cuentas.map(ct => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
          <span style="flex:1;font-size:13px;color:var(--text);">${escapar(ct.nombre)}</span>
          <span style="font-size:13px;font-weight:700;color:var(--text);">${eur(ct.saldo)}</span>
          <button class="cajas-btn cajas-btn-rojo" style="padding:5px 9px;display:inline-flex;align-items:center;" onclick="Cajas.borrarCuenta('${ct.id}')">${IC('trash', 15)}</button>
        </div>
      `).join('');
    }

    html += `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;">
      <input id="nueva-cuenta-nombre" type="text" autocomplete="off" placeholder="${T('cajas.cuenta_nombre_ph')}" style="flex:1;min-width:130px;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:6px;background:var(--white);color:var(--text);">
      <input id="nueva-cuenta-saldo" type="number" step="0.01" placeholder="${T('cajas.saldo_label')} €" style="width:96px;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:6px;background:var(--white);color:var(--text);">
      <button class="cajas-btn cajas-btn-verde" style="font-size:12px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;" onclick="Cajas.crearCuenta()">${IC('plus', 15)}${T('cajas.crear_cuenta')}</button>
    </div>`;

    if (cmps.length > 0 && cuentas.length > 0) {
      html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;">';
      html += cmps.map(c => {
        const sel = compACuenta[c.id] || '';
        const opts = '<option value="">' + T('cajas.sin_cuenta') + '</option>' +
          cuentas.map(ct => `<option value="${ct.id}" ${ct.id === sel ? 'selected' : ''}>${escapar(ct.nombre)}</option>`).join('');
        return `<div style="display:flex;align-items:center;gap:8px;">
          <span style="flex:1;font-size:12px;color:var(--muted);">${escapar(c.nombre)}</span>
          <select style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--white);color:var(--text);" onchange="Cajas.asignarCompaniaCuenta('${c.id}', this.value)">${opts}</select>
        </div>`;
      }).join('');
      html += '</div>';
    }

    box.innerHTML = html;
  }

  async function crearCuenta() {
    if (!Estado.cajaEditando) return;
    const inN = $('nueva-cuenta-nombre'), inS = $('nueva-cuenta-saldo');
    const n = ((inN && inN.value) || '').trim();
    if (!n) { toast(T('cajas.cuenta_nombre_falta'), 'error'); if (inN) { try { inN.focus(); } catch (e) { /* noop */ } } return; }
    // Saldo inicial (lo que ya tienes ahora mismo en esa cuenta). Vacío = 0.
    const sv = (inS && inS.value) || '';
    const saldoIni = String(sv).trim() === '' ? 0 : Number(String(sv).replace(',', '.'));
    if (!isFinite(saldoIni)) { toast(T('cajas.importe_invalido'), 'error'); return; }
    try {
      await api('crear_cuenta', { method: 'POST', body: { caja_id: Estado.cajaEditando.id, nombre: n, saldo: saldoIni } });
      const rc = await api('listar_cuentas'); Estado.cuentas = rc.cuentas || [];
      renderCompanias();
      pintarCuentas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function borrarCuenta(id) {
    if (!confirm(T('cajas.borrar_cuenta_confirm'))) return;
    try {
      await api('borrar_cuenta', { method: 'POST', body: { id } });
      const rc = await api('listar_cuentas'); Estado.cuentas = rc.cuentas || [];
      renderCompanias();
      pintarCuentas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function asignarCompaniaCuenta(companiaId, cuentaId) {
    try {
      await api('asignar_compania_cuenta', { method: 'POST', body: { compania_id: companiaId, cuenta_id: cuentaId || null } });
      const rc = await api('listar_cuentas'); Estado.cuentas = rc.cuentas || [];
      pintarCuentas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function crearCompania() {
    if (!Estado.cajaEditando) {
      toast('Guarda la caja primero', 'error');
      return;
    }
    const nombre = $('nueva-compania-nombre').value.trim();
    if (!nombre) return;
    try {
      await api('crear_compania', {
        method: 'POST',
        body: { caja_id: Estado.cajaEditando.id, nombre }
      });
      $('nueva-compania-nombre').value = '';
      renderCompanias();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function editarCompania(id, nombre) {
    try {
      await api('editar_compania', { method: 'POST', body: { id, nombre } });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function borrarCompania(id) {
    if (!confirm('¿Eliminar esta compañía? Los movimientos pasados también se borrarán.')) return;
    try {
      await api('borrar_compania', { method: 'POST', body: { id } });
      renderCompanias();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function guardarCaja() {
    const diasMarcados = Array.from(document.querySelectorAll('.dia-checkbox:checked'))
      .map(c => Number(c.value));
    if (diasMarcados.length === 0) {
      toast('Marca al menos un día de apertura', 'error');
      return;
    }
    const payload = {
      tipo: $('caja-tipo').value,
      nombre: $('caja-nombre').value.trim(),
      icono: $('caja-icono').value.trim() || '💼',
      color: $('caja-color').value,
      permiso_editar_cerrada: $('caja-permiso').value,
      gestion_fiados: !!($('caja-gestion-fiados')?.checked),
      dias_apertura: diasMarcados
    };
    if (!payload.nombre) {
      toast('Nombre obligatorio', 'error');
      return;
    }
    try {
      const id = $('caja-id').value;
      if (id) {
        await api('editar_caja', { method: 'POST', body: { id, ...payload } });
        cerrarModal('modal-caja');
        await cargarCajas();
      } else {
        const r = await api('crear_caja', { method: 'POST', body: payload });
        Estado.cajaEditando = r.caja;
        $('caja-id').value = r.caja.id;
        $('modal-caja-titulo').textContent = 'Editar caja';
        $('btn-borrar-caja').style.display = 'inline-block';
        $('caja-companias-bloque').style.display = 'block';
        renderCompanias();
        toast('Caja creada. Ahora añade sus compañías.');
        await cargarCajas();
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function borrarCaja() {
    if (!Estado.cajaEditando) return;
    if (!confirm(`¿Eliminar la caja "${Estado.cajaEditando.nombre}"?\n\nSe borrarán también sus compañías, cierres y movimientos. Esta acción NO se puede deshacer.`)) return;
    try {
      await api('borrar_caja', { method: 'POST', body: { id: Estado.cajaEditando.id } });
      cerrarModal('modal-caja');
      await cargarCajas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Modal Cierre ────────────────────────────────
  async function abrirCierre(cajaId) {
    try {
      const data = await api('obtener_cierre', {
        query: { caja_id: cajaId, fecha: Estado.fechaActual, hoy: (typeof hoyLocal === 'function' ? hoyLocal() : '') }
      });
      Estado.cierreEditando = data;

      if (!data.companias || data.companias.length === 0) {
        toast('Esta caja no tiene compañías. Configúralas primero en ⚙️', 'error');
        return;
      }

      $('cierre-caja-id').value = cajaId;
      $('modal-cierre-titulo').textContent = `${data.caja.icono} ${data.caja.nombre} — ${formatearFecha(Estado.fechaActual)}`;
      $('cierre-fecha').value = Estado.fechaActual;
      $('cierre-saldo-inicial').value = data.cierre?.saldo_inicial ?? data.saldo_sugerido ?? 0;

      // Apertura: "Abierta por: X" si ya está fichada; si no, "Operando: X" (empleado del gate)
      var _abPor = data.cierre && data.cierre.abierto_por;
      var _fila = $('cierre-apertura-fila');
      var _lblAb = $('cierre-abierto-por');
      var _oper = (window._cajaSesion && window._cajaSesion.nombre) || '';
      if (_abPor) {
        _lblAb.textContent = '✓ ' + T('caja.abierta_por') + ': ' + _abPor;
        _lblAb.style.color = '#16a34a';
        if (_fila) _fila.style.display = '';
      } else if (_oper) {
        _lblAb.textContent = T('caja.operando') + ': ' + _oper;
        _lblAb.style.color = '#2563eb';
        if (_fila) _fila.style.display = '';
      } else if (_fila) {
        _fila.style.display = 'none';
      }

      // Actualizar label "Cambio del día anterior" con la fecha real del último cierre
      const lbl = $('cierre-saldo-inicial-label');
      if (lbl) {
        const fechaAnterior = data.saldo_sugerido_fecha;
        if (fechaAnterior && !data.cierre) {
          // Hay cierre anterior, sin cierre actual (primer apertura del día)
          const partes = fechaAnterior.split('-');
          const fechaVisible = `${partes[2]}/${partes[1]}/${partes[0]}`;
          // Nombre del día de la semana
          const d = new Date(fechaAnterior + 'T12:00:00');
          const dias = [T('fecha.domingo'),T('fecha.lunes'),T('fecha.martes'),T('fecha.miercoles'),T('fecha.jueves'),T('fecha.viernes'),T('fecha.sabado')];
          const diaSemana = dias[d.getDay()];
          // F44/F45: avisar si la caja lleva varios días sin cerrar (el saldo inicial es viejo).
          // Umbral >4 días para tolerar fines de semana y puentes sin falsos positivos.
          const hoyD = new Date(Estado.fechaActual + 'T12:00:00');
          const diffDias = Math.round((hoyD - d) / 86400000);
          let aviso = '';
          if (diffDias > 4) {
            // BUG #5: el aviso va INLINE en la caja. El toast se quitó porque este render se
            // re-ejecuta al cambiar de vista → reaparecía constantemente (incluso en Citas/Gastos).
            aviso = ` <span style="text-transform:none;font-weight:700;color:#dc2626;font-size:10px;">⚠️ ${T('cajas.dias_sin_cerrar').replace('{n}', diffDias)}</span>`;
          }
          const _dowLoc = d.toLocaleDateString((typeof TEKPAIR_LANG === 'string' ? TEKPAIR_LANG : 'es'), {weekday:'long'});
          lbl.innerHTML = `${T('cajas.cambio_del')} ${fechaVisible} <span style="text-transform:none;font-weight:400;color:#6b7280;font-size:10px;">(${_dowLoc} · ${T('cajas.automatico')})</span>${aviso}`;
        } else if (!fechaAnterior && !data.cierre) {
          lbl.innerHTML = `${T('cajas.saldo_inicial')} <span style="text-transform:none;font-weight:400;color:#6b7280;font-size:10px;">(${T('cajas.primer_dia')})</span>`;
        } else {
          lbl.innerHTML = `${T('cajas.cambio_anterior')} <span style="text-transform:none;font-weight:400;color:#6b7280;font-size:10px;">(${T('cajas.automatico')})</span>`;
        }
      }
      $('cierre-saldo-real').value = data.cierre?.saldo_real_final ?? 0;
      if ($('cierre-importe-tpv')) $('cierre-importe-tpv').value = data.cierre?.importe_tpv ?? 0;
      $('cierre-cambio-siguiente').value = data.cierre?.cambio_siguiente ?? 0;
      $('cierre-notas').value = data.cierre?.notas ?? '';
      // Total cobrado: campo desactivado en v1.3 (ya no se usa, se calcula directo)
      const bloqueTC = $('bloque-total-cobrado');
      if (bloqueTC) {
        bloqueTC.style.display = 'none';
        $('cierre-total-cobrado').value = 0;
      }

      // ── Bloqueo según rol y estado ─────────────────────
      const esAdmin = esAdminTienda();
      const cierreCerrado = data.cierre?.estado === 'cerrado' || data.cierre?.estado === 'descuadre';

      // SALDO INICIAL: solo admin puede editarlo (siempre bloqueado para empleado)
      $('cierre-saldo-inicial').readOnly = !esAdmin;
      $('cierre-saldo-inicial').style.background = !esAdmin ? '#f3f4f6' : '';
      $('cierre-saldo-inicial').style.cursor = !esAdmin ? 'not-allowed' : '';
      $('cierre-saldo-inicial').title = !esAdmin
        ? 'Heredado del cierre anterior. Solo el administrador puede modificarlo.'
        : 'Cambio que se dejó al cerrar el día anterior.';

      // CAMBIO PARA MAÑANA: bloqueado para empleado si la caja ya está cerrada
      const bloquearCambio = !esAdmin && cierreCerrado;
      $('cierre-cambio-siguiente').readOnly = bloquearCambio;
      $('cierre-cambio-siguiente').style.background = bloquearCambio ? '#f3f4f6' : '';
      $('cierre-cambio-siguiente').style.cursor = bloquearCambio ? 'not-allowed' : '';
      $('cierre-cambio-siguiente').title = bloquearCambio
        ? 'Caja ya cerrada. Solo el administrador puede modificarlo ahora.'
        : 'Cuánto efectivo dejas en el cajón para mañana.';

      // Cargar TODOS los fiados del día - persisten en su día original incluso si se cobran
      Estado.fiadosTemp = [];
      if (data.caja.gestion_fiados) {
        try {
          const rf = await api('listar_fiados', {
            query: { caja_id: cajaId, desde: Estado.fechaActual, hasta: Estado.fechaActual }
          });
          for (const f of (rf.fiados || [])) {
            // Incluir TANTO pendientes COMO cobrados
            Estado.fiadosTemp.push({
              id: f.id,
              tempKey: 'srv_' + f.id,
              compania_id: f.compania_id || null,
              importe: Number(f.importe || 0),
              cliente_nombre: f.cliente_nombre || '',
              cliente_telefono: f.cliente_telefono || '',
              nota: f.nota || '',
              estado: f.estado || 'pendiente',
              metodo_pago: f.metodo_pago || null,
              fecha_cobro: f.fecha_cobro || null
            });
          }
        } catch(e) { console.warn('Error cargando fiados:', e); }
      }

      renderTablaMovimientos(data);
      // Mostrar bloque pendientes solo si la caja tiene gestión de fiados
      const bloqueP = $('bloque-pendientes-dia');
      if (bloqueP) {
        bloqueP.style.display = data.caja.gestion_fiados ? 'block' : 'none';
      }
      pintarListaPendientes();
      recalcularResumen();
      $('modal-cierre').classList.add('activo');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function formatearFecha(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function renderTablaMovimientos(data) {
    const tipo = data.caja.tipo;
    const thead = $('tabla-mov-thead');
    const tbody = $('tabla-mov-tbody');

    if (tipo === 'envios') {
      thead.innerHTML = `<tr>
        <th>${T('cajas.compania')}</th>
        <th style="text-align:right;">${T('cajas.enviado_h')}</th>
      </tr>`;
    } else if (tipo === 'recargas') {
      thead.innerHTML = `<tr>
        <th>${T('cajas.compania')}</th>
        <th style="text-align:right;">${T('cajas.total_vendido_h')}</th>
      </tr>`;
    } else {
      thead.innerHTML = `<tr><th>${T('cajas.compania')}</th><th style="text-align:right;">${T('cajas.importe_h')}</th></tr>`;
    }

    const movsExistentes = {};
    (data.movimientos || []).forEach(m => { movsExistentes[m.compania_id] = m; });

    let html = '';
    for (const c of data.companias) {
      const m = movsExistentes[c.id] || {};
      if (tipo === 'envios') {
        html += `<tr data-compania-id="${c.id}">
          <td>${escapar(c.nombre)}</td>
          <td style="text-align:right;"><input type="number" step="0.01" class="mov-enviado" value="${m.importe_enviado || 0}" onfocus="if(this.value==='0'){this.value='';}else{this.select();}" onchange="Cajas.recalcular()"></td>
        </tr>`;
      } else if (tipo === 'recargas') {
        // Guardamos el total vendido en importe_efectivo (semánticamente ahora es "total vendido")
        // y dejamos importe_tarjeta a 0 para retrocompatibilidad
        const totalVendido = (m.importe_efectivo || 0) + (m.importe_tarjeta || 0);
        html += `<tr data-compania-id="${c.id}">
          <td>${escapar(c.nombre)}</td>
          <td style="text-align:right;"><input type="number" step="0.01" class="mov-efectivo" value="${totalVendido}" onfocus="if(this.value==='0'){this.value='';}else{this.select();}" onchange="Cajas.recalcular()"></td>
        </tr>`;
      } else {
        html += `<tr data-compania-id="${c.id}">
          <td>${escapar(c.nombre)}</td>
          <td style="text-align:right;"><input type="number" step="0.01" class="mov-cobrado" value="${m.importe_cobrado || 0}" onfocus="if(this.value==='0'){this.value='';}else{this.select();}" onchange="Cajas.recalcular()"></td>
        </tr>`;
      }
    }
    tbody.innerHTML = html;
  }

  function leerMovimientos() {
    const tipo = Estado.cierreEditando?.caja?.tipo;
    const filas = document.querySelectorAll('#tabla-mov-tbody tr');
    const movs = [];
    filas.forEach(tr => {
      const compania_id = tr.dataset.companiaId;
      if (tipo === 'envios') {
        movs.push({
          compania_id,
          importe_enviado: Number(tr.querySelector('.mov-enviado')?.value || 0)
        });
      } else if (tipo === 'recargas') {
        movs.push({
          compania_id,
          importe_efectivo: Number(tr.querySelector('.mov-efectivo')?.value || 0),
          importe_tarjeta: Number(tr.querySelector('.mov-tarjeta')?.value || 0)
        });
      } else {
        movs.push({
          compania_id,
          importe_cobrado: Number(tr.querySelector('.mov-cobrado')?.value || 0)
        });
      }
    });
    return movs;
  }

  function recalcularResumen() {
    if (!Estado.cierreEditando) return;
    const tipo = Estado.cierreEditando.caja.tipo;
    const movs = leerMovimientos();
    const saldoInicial = Number($('cierre-saldo-inicial').value || 0);

    document.querySelectorAll('#tabla-mov-tbody tr').forEach((tr, i) => {
      const m = movs[i];
      const celda = tr.querySelector('.balance-celda');
      if (!celda) return;
      let bal = 0;
      if (tipo === 'recargas') bal = (m.importe_efectivo || 0) + (m.importe_tarjeta || 0);
      else bal = m.importe_cobrado || 0;
      celda.textContent = eur(bal);
    });

    // Total fiados
    let totalFiados = 0;
    if (Estado.cierreEditando?.caja?.gestion_fiados && Array.isArray(Estado.fiadosTemp)) {
      for (const f of Estado.fiadosTemp) {
        totalFiados += Number(f.importe || 0);
      }
    }

    // Datos comunes
    const efectivoCaja = Number($('cierre-saldo-real').value || 0);
    const importeTpv = Number($('cierre-importe-tpv')?.value || 0);

    let html = '';
    let okFlag = true, mensajeOK = T('cajas.caja_cuadrada'), mensajeKO = '';
    let diffMostrar = 0;  // descuadre numérico para graduar la severidad (no alarmista)

    if (tipo === 'envios') {
      // ENVÍOS: total enviado por compañías
      let totalEnviado = 0;
      for (const m of movs) totalEnviado += m.importe_enviado || 0;
      const teorico = Math.round((saldoInicial + totalEnviado) * 100) / 100;
      // v2.3: pendientes son deuda, no suman al cobrado
      const cobrado = Math.round((efectivoCaja + importeTpv) * 100) / 100;
      const balance = Math.round((cobrado - teorico) * 100) / 100;

      // Envíos: debe cuadrar EXACTO (no aceptar sobra como verde)
      // El importe fiado ya NO está en el cajón, así que `balance` ya lo refleja como
      // falta. El pendiente anotado lo JUSTIFICA: se suma para volver a cuadrar. Antes
      // se restaba y el descuadre salía DOBLE (fiar 10 € marcaba -20 €).
      const faltaTotal = Math.round((balance + totalFiados) * 100) / 100;
      okFlag = Math.abs(faltaTotal) <= 0.5;
      if (faltaTotal > 0.5) {
        okFlag = false;
        mensajeOK = '';
      } else {
        mensajeOK = T('cajas.caja_cuadrada');
      }
      diffMostrar = faltaTotal;
      mensajeKO = faltaTotal < -0.5 ? `${T('cajas.falta')}: ${eur(faltaTotal)}` : `${T('cajas.sobra')}: +${eur(faltaTotal)}`;

      html += `<div class="item"><span class="label">${T('cajas.total_enviado')}</span><span><b>${eur(totalEnviado)}</b></span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.saldo_inicial')}</span><span>${eur(saldoInicial)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.efectivo_caja')}</span><span>${eur(efectivoCaja)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.importe_tpv')}</span><span>${eur(importeTpv)}</span></div>`;
      if (totalFiados > 0) {
        html += `<div class="item" style="grid-column:1/-1;background:#fef3c7;padding:6px 10px;border-radius:6px;margin-top:4px;"><span class="label" style="color:#92400e;">${T('cajas.pend_cobro')}</span><span style="color:#92400e;font-weight:600;">${eur(totalFiados)}</span></div>`;
      }
      html += `<div class="item" style="grid-column:1/-1;border-top:1px dashed #cbd5e1;padding-top:6px;margin-top:4px;"><span class="label">${T('cajas.total_cobrado')}</span><span><b>${eur(cobrado)}</b></span></div>`;

    } else if (tipo === 'recargas') {
      // RECARGAS: total vendido (suma de la columna)
      let totalVendido = 0;
      for (const m of movs) totalVendido += m.importe_efectivo || 0;
      totalVendido = Math.round(totalVendido * 100) / 100;
      // v2.3: pendientes son deuda, no suman al cobrado
      const cobrado = Math.round((efectivoCaja + importeTpv) * 100) / 100;
      // El "cambio del día anterior" (saldo inicial) TAMBIÉN cuenta, igual que en envíos:
      // teórico = saldo inicial + total vendido. El backend ya lo calculaba así; el preview no,
      // y por eso salía una "sobra" falsa = el cambio que se dejó.
      const teorico = Math.round((saldoInicial + totalVendido) * 100) / 100;
      const balance = Math.round((cobrado - teorico) * 100) / 100;

      // Igual que en envíos: el fiado ya falta en el cajón, el pendiente lo justifica.
      const faltaTotal = Math.round((balance + totalFiados) * 100) / 100;
      okFlag = Math.abs(faltaTotal) <= 0.5;
      if (faltaTotal > 0.5) {
        okFlag = true;
        mensajeOK = `✓ ${T('cajas.sobra')}: +${eur(faltaTotal)}`;
      } else {
        mensajeOK = T('cajas.caja_cuadrada');
      }
      diffMostrar = faltaTotal;
      mensajeKO = `${T('cajas.falta')}: ${eur(faltaTotal)}`;

      html += `<div class="item" style="grid-column:1/-1;background:#dbeafe;padding:6px 10px;border-radius:6px;"><span class="label" style="color:#C2491A;font-weight:600;">${T('cajas.total_vendido')}</span><span style="color:#C2491A;font-weight:700;">${eur(totalVendido)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.saldo_inicial')}</span><span>${eur(saldoInicial)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.efectivo_caja')}</span><span>${eur(efectivoCaja)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.importe_tpv')}</span><span>${eur(importeTpv)}</span></div>`;
      if (totalFiados > 0) {
        html += `<div class="item" style="grid-column:1/-1;background:#fef3c7;padding:6px 10px;border-radius:6px;margin-top:4px;"><span class="label" style="color:#92400e;">${T('cajas.pend_cobro')}</span><span style="color:#92400e;font-weight:600;">${eur(totalFiados)}</span></div>`;
      }
      html += `<div class="item" style="grid-column:1/-1;border-top:1px dashed #cbd5e1;padding-top:6px;margin-top:4px;"><span class="label">${T('cajas.total_cobrado')}</span><span><b>${eur(cobrado)}</b></span></div>`;
    }

    // Cierre menos alarmista: en vez de un "❌ Falta -98€" rojo a secas, graduamos la
    // severidad (⚠️ pequeña = normal, propinas/redondeos · 🚨 grande = revisa antes de cerrar).
    if (okFlag) {
      html += `<div class="descuadre-grande ok">${mensajeOK}</div>`;
    } else {
      const absd = Math.abs(Number(diffMostrar) || 0);
      const grande = absd >= 20;
      const sub = grande ? T('arqueo.revisa_checklist') : T('arqueo.normal_propinas');
      html += `<div class="descuadre-grande ko">
        <div>${grande ? '🚨' : '⚠️'} ${mensajeKO}</div>
        <div style="font-size:11px;font-weight:500;opacity:.85;margin-top:4px;line-height:1.35">${sub}</div>
      </div>`;
    }
    $('cierre-resumen').innerHTML = html;
  }

  async function guardarCierre(estado) {
    if (!Estado.cierreEditando) return;
    const payload = {
      caja_id: $('cierre-caja-id').value,
      fecha: $('cierre-fecha').value,
      codigo_apertura: (window._cajaSesion && window._cajaSesion.codigo) || '',
      abierto_por_nombre: (window._cajaSesion && window._cajaSesion.nombre) || '',
      saldo_inicial: Number($('cierre-saldo-inicial').value || 0),
      saldo_real_final: Number($('cierre-saldo-real').value || 0),
      importe_tpv: Number($('cierre-importe-tpv')?.value || 0),
      total_fiados: Array.isArray(Estado.fiadosTemp)
        ? Estado.fiadosTemp.filter(f => f.estado !== 'cobrado').reduce((s, f) => s + Number(f.importe || 0), 0)
        : 0,
      cambio_siguiente: Number($('cierre-cambio-siguiente').value || 0),
      total_cobrado_caja: Number($('cierre-total-cobrado')?.value || 0),
      notas: $('cierre-notas').value.trim(),
      estado,
      movimientos: leerMovimientos()
    };
    try {
      const r = await api('guardar_cierre', { method: 'POST', body: payload });

      // Persistir fiados si la caja tiene gestión activa (array, múltiples por compañía)
      if (Estado.cierreEditando?.caja?.gestion_fiados) {
        try {
          // 1) IDs que estaban al inicio (vinieron del backend)
          const idsAlInicio = new Set();
          // 2) IDs que siguen existiendo tras edición
          const idsActuales = new Set();
          for (const f of Estado.fiadosTemp) {
            if (f.id) idsActuales.add(f.id);
          }
          // Detectar borrados: estaban con tempKey 'srv_XXX' pero ya no están en fiadosTemp
          // (la lista actual ya no los tiene porque los quitamos con quitarFiadoByKey)
          // → necesitamos comparar con el snapshot original. Lo más simple:
          //   recargar lista del servidor para saber qué hay
          const rf = await api('listar_fiados', {
            query: { caja_id: payload.caja_id, desde: payload.fecha, hasta: payload.fecha }
          });
          const idsServidor = new Set((rf.fiados || []).filter(f => f.estado === 'pendiente').map(f => f.id));
          // Eliminar los que ya no están en fiadosTemp
          for (const idSrv of idsServidor) {
            if (!idsActuales.has(idSrv)) {
              await api('borrar_fiado', { method: 'POST', body: { id: idSrv } });
            }
          }
          // Crear/editar
          for (const fiado of Estado.fiadosTemp) {
            if (fiado.id) {
              await api('editar_fiado', {
                method: 'POST',
                body: {
                  id: fiado.id,
                  importe: fiado.importe,
                  cliente_nombre: fiado.cliente_nombre,
                  cliente_telefono: fiado.cliente_telefono,
                  nota: fiado.nota
                }
              });
            } else {
              await api('crear_fiado', {
                method: 'POST',
                body: {
                  caja_id: payload.caja_id,
                  compania_id: fiado.compania_id || null,
                  cierre_id: r.cierre_id,
                  fecha: payload.fecha,
                  importe: fiado.importe,
                  cliente_nombre: fiado.cliente_nombre,
                  cliente_telefono: fiado.cliente_telefono,
                  nota: fiado.nota
                }
              });
            }
          }
        } catch(e) {
          toast('Cierre guardado, pero error con fiados: ' + e.message, 'error');
        }
      }

      // Cuentas de saldo: al CERRAR, recargas → confirma saldo real; envíos → pregunta cuánto ingresaste en banco.
      if (estado === 'cerrado' && Array.isArray(Estado.cuentas)) {
        // Refrescar los movimientos recién guardados para calcular el monto del día.
        if (Estado.cierres[payload.caja_id]) Estado.cierres[payload.caja_id].movimientos = payload.movimientos;
        const _cajaObj = (Estado.cajas || []).find(x => x.id === payload.caja_id);
        const _esEnvios = _cajaObj && _cajaObj.tipo === 'envios';
        const cuentasCaja = Estado.cuentas.filter(c => c.caja_id === payload.caja_id);
        for (const cuenta of cuentasCaja) {
          const montoDia = _ventasDiaCuenta(cuenta);   // recargas: vendido · envíos: enviado
          if (_esEnvios) {
            // Envíos: lo enviado hoy sube el pendiente; preguntamos cuánto se ingresó en banco.
            // El saldo definitivo lo recalcula el servidor a partir de monto_dia + ingreso (idempotente
            // en re-cierres); aquí el "pendiente" mostrado es solo informativo.
            const pendConEnvio = Math.round((Number(cuenta.saldo || 0) + montoDia) * 100) / 100;
            const msg = T('cajas.cierre_ingreso_prompt')
              .replace('{cuenta}', cuenta.nombre)
              .replace('{enviado}', eur(montoDia))
              .replace('{pendiente}', eur(pendConEnvio));
            const v = await _pedirValor({ titulo: '💰 ' + T('cajas.ingrese_banco') + ' — ' + cuenta.nombre, ayuda: msg, valorInicial: 0 });
            if (v === null) continue;
            const ingresado = String(v).trim() === '' ? 0 : Number(String(v).replace(',', '.'));
            if (!isFinite(ingresado)) { toast(T('cajas.importe_invalido'), 'err'); continue; }
            try {
              await api('confirmar_saldo', {
                method: 'POST',
                body: { cuenta_id: cuenta.id, fecha: payload.fecha, tipo: 'envios', monto_dia: montoDia, ingreso_banco: ingresado, nota: `Envios +${montoDia} / Banco -${ingresado}` }
              });
            } catch (e) { toast(e.message, 'err'); }
          } else {
            // Recargas: lo vendido hoy baja el saldo; confirmamos el saldo real contado.
            // Si el cajero acepta el esperado sin recontar, no mandamos saldo_contado y el servidor
            // lo recalcula (baseAyer − vendido) de forma idempotente; solo mandamos el valor si lo cambió.
            const esperado = Math.round((Number(cuenta.saldo || 0) - montoDia) * 100) / 100;
            const msg = T('cajas.cierre_saldo_prompt')
              .replace('{cuenta}', cuenta.nombre)
              .replace('{esperado}', eur(esperado));
            const v = await _pedirValor({ titulo: '✓ ' + T('cajas.confirmar_saldo') + ' — ' + cuenta.nombre, ayuda: msg, valorInicial: esperado });
            if (v === null || String(v).trim() === '') continue;
            const real = Number(String(v).replace(',', '.'));
            if (!isFinite(real)) { toast(T('cajas.importe_invalido'), 'err'); continue; }
            const recontado = Math.abs(real - esperado) > 0.005;   // ¿el cajero puso un valor distinto al esperado?
            try {
              await api('confirmar_saldo', {
                method: 'POST',
                body: Object.assign({ cuenta_id: cuenta.id, fecha: payload.fecha, tipo: 'recargas', monto_dia: montoDia }, recontado ? { saldo_contado: real } : {})
              });
            } catch (e) { toast(e.message, 'err'); }
          }
        }
      }

      toast(estado === 'cerrado' ? T('cajas.cierre_guardado') : T('cajas.borrador_guardado'));
      if (r.estado === 'descuadre') {
        toast(`⚠ Descuadre de ${eur(r.descuadre)}. Revisa la caja.`, 'error');
      }
      cerrarModal('modal-cierre');
      await cargarCajas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function cerrarModal(id) {
    $(id).classList.remove('activo');
  }

  // ── Modal anotar fiado ───────────────────────────
  function abrirModalFiado(companiaId, companiaNombre) {
    $('fiado-mov-key').value = companiaId;
    $('fiado-compania-nombre').textContent = companiaNombre;
    const existente = Estado.fiadosTemp[companiaId];
    $('fiado-importe').value = existente?.importe || 0;
    $('fiado-cliente').value = existente?.cliente_nombre || '';
    $('fiado-telefono').value = existente?.cliente_telefono || '';
    $('fiado-nota').value = existente?.nota || '';
    $('btn-quitar-fiado').style.display = existente ? 'inline-block' : 'none';
    $('modal-fiado-anotar').classList.add('activo');
  }

  function cerrarModalFiado() {
    $('modal-fiado-anotar').classList.remove('activo');
  }

  // ── PENDIENTES DEL DÍA (array, múltiples por compañía) ──

  function genTempKey() {
    return 'tmp_' + Math.random().toString(36).slice(2, 10);
  }

  function pintarListaPendientes() {
    const lista = $('lista-pendientes-dia');
    const cnt = $('pendientes-count');
    const bloqueTotal = $('total-pendientes-dia');
    const totalSpan = $('total-pendientes-importe');
    if (!lista) return;

    const fiados = Estado.fiadosTemp || [];
    cnt.textContent = fiados.length > 0 ? `(${fiados.length})` : '';

    if (fiados.length === 0) {
      lista.innerHTML = '<div style="color:#92400e;font-size:13px;text-align:center;padding:14px;font-style:italic;">' + T('gen.no_hay_pendientes') + '</div>';
      bloqueTotal.style.display = 'none';
      return;
    }

    // Mapa de compañías para mostrar nombres
    const cmpsMap = {};
    (Estado.cierreEditando?.companias || []).forEach(c => { cmpsMap[c.id] = c.nombre; });

    let totalImp = 0;
    lista.innerHTML = fiados.map(f => {
      if (f.estado !== 'cobrado') totalImp += Number(f.importe || 0);
      const nombreCmp = f.compania_id ? (cmpsMap[f.compania_id] || '?') : '—';
      const cliente = f.cliente_nombre || 'Sin nombre';
      const tel = f.cliente_telefono ? ` · 📞 ${escapar(f.cliente_telefono)}` : '';
      const nota = f.nota ? ` · ${escapar(f.nota)}` : '';
      const cobrado = f.estado === 'cobrado';
      const metodoIcon = f.metodo_pago === 'efectivo' ? IC('euro', 13) : f.metodo_pago === 'tarjeta' ? IC('card', 13) : '';
      const fechaCobroVisible = f.fecha_cobro ? new Date(f.fecha_cobro).toLocaleDateString('es-ES') : '';
      const bgColor = cobrado ? '#f0fdf4' : '#fff';
      const borderColor = cobrado ? '#86efac' : '#fde68a';
      const importeColor = cobrado ? '#15803d' : '#92400e';
      const acciones = cobrado
        ? `<div style="background:#dcfce7;color:#166534;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap;">${metodoIcon} Pagado ${fechaCobroVisible}</div>`
        : `<button type="button" onclick="Cajas.editarFiado('${f.tempKey}')" style="background:#fff;border:1px solid #d1d5db;color:#374151;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">✏</button>
           <button type="button" onclick="Cajas.quitarFiadoByKey('${f.tempKey}')" style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">✕</button>`;
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:${bgColor};border-radius:8px;margin-bottom:6px;border:1px solid ${borderColor};">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#111827;">
              <span style="color:${importeColor};">${escapar(nombreCmp)}</span> — ${escapar(cliente)}
              ${cobrado ? '<span style="color:#15803d;font-size:10px;font-weight:600;margin-left:4px;">✓ COBRADO</span>' : ''}
            </div>
            <div style="font-size:11px;color:#6b7280;">${tel}${nota}</div>
          </div>
          <div style="font-weight:700;color:${importeColor};font-size:14px;">${eur(f.importe)}</div>
          ${acciones}
        </div>
      `;
    }).join('');

    totalSpan.textContent = eur(totalImp);
    bloqueTotal.style.display = 'block';
  }

  function poblarSelectCompaniaFiado(companiaIdSel) {
    const sel = $('fiado-compania-select');
    if (!sel) return;
    const cmps = Estado.cierreEditando?.companias || [];
    sel.innerHTML = '<option value="">' + T('gen.sin_companias') + '</option>' +
      cmps.map(c => `<option value="${c.id}" ${c.id === companiaIdSel ? 'selected' : ''}>${escapar(c.nombre)}</option>`).join('');
  }

  function abrirModalFiado() {
    // Nuevo fiado: campos vacíos
    $('fiado-temp-key').value = '';
    $('modal-fiado-titulo').textContent = T('gen.nuevo_pendiente');
    poblarSelectCompaniaFiado('');
    $('fiado-importe').value = 0;
    $('fiado-cliente').value = '';
    $('fiado-telefono').value = '';
    $('fiado-nota').value = '';
    limpiarClienteFiadoUI();
    $('btn-quitar-fiado').style.display = 'none';
    $('modal-fiado-anotar').classList.add('activo');
    setTimeout(() => $('fiado-importe').focus(), 100);
  }

  function limpiarClienteFiadoUI() {
    var inp = $('fiado-busca-cli'); if (inp) inp.value = '';
    var box = $('fSelCliBox'); if (box) box.style.display = 'none';
    var res = $('fSelCli'); if (res) res.classList.remove('open');
  }

  function limpiarClienteFiado() {
    $('fiado-cliente').value = '';
    $('fiado-telefono').value = '';
    limpiarClienteFiadoUI();
  }

  function editarFiado(tempKey) {
    const f = (Estado.fiadosTemp || []).find(x => x.tempKey === tempKey);
    if (!f) return;
    $('fiado-temp-key').value = tempKey;
    $('modal-fiado-titulo').textContent = T('gen.editar_pendiente');
    poblarSelectCompaniaFiado(f.compania_id || '');
    $('fiado-importe').value = f.importe || 0;
    $('fiado-cliente').value = f.cliente_nombre || '';
    $('fiado-telefono').value = f.cliente_telefono || '';
    $('fiado-nota').value = f.nota || '';
    // Mostrar cliente en sel-box si existe
    limpiarClienteFiadoUI();
    if (f.cliente_nombre) {
      var box = $('fSelCliBox');
      var nom = $('fSelCliNom');
      if (box && nom) {
        nom.textContent = f.cliente_nombre + (f.cliente_telefono ? ' · ' + f.cliente_telefono : '');
        box.style.display = 'flex';
      }
    }
    $('btn-quitar-fiado').style.display = 'inline-block';
    $('modal-fiado-anotar').classList.add('activo');
  }

  function guardarFiado() {
    const tempKey = $('fiado-temp-key').value;
    const importe = Number($('fiado-importe').value || 0);
    if (importe <= 0) {
      toast('El importe debe ser mayor que 0', 'error');
      return;
    }
    // El campo de cliente es un buscador de clientes YA registrados y el nombre real
    // viaja en un hidden que solo se rellena al elegir uno de la lista. Quien fía a
    // alguien que no está de alta no podía ponerle nombre y salía "Sin nombre": si no
    // se ha seleccionado ningún cliente, se toma como nombre lo que se haya escrito.
    var _nomSel = $('fiado-cliente').value.trim();
    var _escrito = ($('fiado-busca-cli') && $('fiado-busca-cli').value || '').trim();
    const datos = {
      compania_id: $('fiado-compania-select').value || null,
      importe,
      cliente_nombre: _nomSel || _escrito,
      cliente_telefono: $('fiado-telefono').value.trim(),
      nota: $('fiado-nota').value.trim()
    };

    if (tempKey) {
      // Editar existente
      const f = Estado.fiadosTemp.find(x => x.tempKey === tempKey);
      if (f) Object.assign(f, datos);
    } else {
      // Nuevo
      Estado.fiadosTemp.push({
        id: null,
        tempKey: genTempKey(),
        ...datos
      });
    }

    cerrarModalFiado();
    pintarListaPendientes();
    recalcularResumen();
  }

  function quitarFiado() {
    // Llamado desde el botón "Eliminar" del modal
    const tempKey = $('fiado-temp-key').value;
    if (!tempKey) return;
    quitarFiadoByKey(tempKey);
    cerrarModalFiado();
  }

  function quitarFiadoByKey(tempKey) {
    Estado.fiadosTemp = Estado.fiadosTemp.filter(f => f.tempKey !== tempKey);
    pintarListaPendientes();
    recalcularResumen();
  }

  // ── TABS Y COBROS PENDIENTES ──────────────────

  function cambiarTab(tab) {
    Estado.tabActiva = tab;
    $('tab-cajas-dia').classList.toggle('cajas-tab-activa', tab === 'dia');
    $('tab-cobros').classList.toggle('cajas-tab-activa', tab === 'cobros');
    $('vista-cajas-dia').style.display = tab === 'dia' ? 'block' : 'none';
    $('vista-cobros-pendientes').style.display = tab === 'cobros' ? 'block' : 'none';
    if (tab === 'cobros') cargarCobros();
  }

  function cambiarSubTab(sub) {
    Estado.subTabActiva = sub;
    $('subtab-pendientes').classList.toggle('cajas-subtab-activa', sub === 'pendientes');
    $('subtab-cobrados').classList.toggle('cajas-subtab-activa', sub === 'cobrados');
    pintarCobros();
  }

  async function cargarCobros() {
    try {
      // Cargar pendientes Y cobrados (sin filtro de estado)
      const r = await api('listar_fiados', { query: {} });
      Estado.cobros = r.fiados || [];
      window._cajasFiadosCache = Estado.cobros;
      actualizarBadgePendientes();
      pintarCobros();
    } catch(e) {
      console.warn('Error cargando cobros:', e);
      $('lista-cobros').innerHTML = T('gen.error_cobros');
    }
  }

  async function actualizarBadgePendientes() {
    try {
      const r = await api('contar_fiados_pendientes', { query: {} });
      const count = r.count || 0;
      const badge = $('badge-pendientes');
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    } catch(e) { console.warn('Error badge:', e); }
  }

  function pintarCobros() {
    const lista = $('lista-cobros');
    const sub = Estado.subTabActiva;
    const filtrados = Estado.cobros.filter(c => {
      if (sub === 'pendientes') return c.estado === 'pendiente';
      if (sub === 'cobrados') return c.estado === 'cobrado';
      return true;
    });

    // Resumen del subtab pendientes
    if (sub === 'pendientes') {
      const total = filtrados.reduce((s, f) => s + Number(f.importe || 0), 0);
      $('resumen-pendientes').textContent = filtrados.length > 0
        ? `(${filtrados.length} · ${eur(total)})`
        : '';
    }

    if (filtrados.length === 0) {
      const msg = sub === 'pendientes'
        ? T('cajas.sin_cobros_pend')
        : T('cajas.sin_cobrados');
      lista.innerHTML = `<div class="cobro-vacio">${msg}</div>`;
      return;
    }

    lista.innerHTML = filtrados.map(f => {
      const cobrado = f.estado === 'cobrado';
      const cliente = f.cliente_nombre || 'Sin nombre';
      const tel = f.cliente_telefono ? ` · 📞 ${escapar(f.cliente_telefono)}` : '';
      const nota = f.nota ? ` · ${escapar(f.nota)}` : '';
      const cajaIco = f.caja_icono || '💼';
      const cajaN = f.caja_nombre || '';
      const cmp = f.compania_nombre || '';

      // Formato fecha visible: DD/MM/YYYY
      const fechaPartes = (f.fecha || '').split('-');
      const fechaVisible = fechaPartes.length === 3
        ? `${fechaPartes[2]}/${fechaPartes[1]}/${fechaPartes[0]}`
        : f.fecha;

      const fechaCobro = cobrado && f.fecha_cobro
        ? new Date(f.fecha_cobro).toLocaleDateString('es-ES')
        : '';
      const metodoIcon = f.metodo_pago === 'efectivo' ? IC('euro', 13) : f.metodo_pago === 'tarjeta' ? IC('card', 13) : '';
      const metodoTxt = f.metodo_pago === 'efectivo' ? 'efectivo' : f.metodo_pago === 'tarjeta' ? 'tarjeta' : '';

      let acciones = '';
      if (!cobrado) {
        const waBtn = f.cliente_telefono
          ? `<button onclick="abrirWhatsAppFiado('${f.id}')" style="background:#25D366;color:#fff;border:0;padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;" title="Avisar por WhatsApp">💬</button>`
          : '';
        acciones = `
          ${waBtn}
          <button onclick="Cajas.cobrarFiado('${f.id}')" style="background:#10b981;color:#fff;border:0;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">✓ ${T('cajas.cobrar')}</button>
          <button onclick="Cajas.editarCobro('${f.id}')" class="cobro-btn-sec">✏</button>
        `;
      } else {
        acciones = `<div style="text-align:right;"><div style="color:#10b981;font-size:11px;font-weight:600;">${metodoIcon} Cobrado ${fechaCobro}</div><div class="cobro-meta">en ${metodoTxt}</div></div>`;
      }

      return `
        <div class="cobro-fila ${cobrado ? 'cobrado' : ''}">
          <div class="cobro-info">
            <div class="cobro-fecha">📅 ${fechaVisible}</div>
            <div class="cobro-cliente">
              ${escapar(cliente)}
              <span class="cobro-caja">— ${cajaIco} ${escapar(cajaN)} ${cmp ? '· ' + escapar(cmp) : ''}</span>
            </div>
            <div class="cobro-meta">${tel.replace(/^ · /, '')}${nota}</div>
          </div>
          <div class="cobro-importe">${eur(f.importe)}</div>
          ${acciones}
        </div>
      `;
    }).join('');
  }

  function cobrarFiado(id) {
    const f = Estado.cobros.find(x => x.id === id);
    if (!f) return;
    $('cobrar-fiado-id').value = id;
    $('cobrar-cliente').textContent = f.cliente_nombre || 'Sin nombre';
    $('cobrar-compania').textContent = `${f.caja_icono || '💼'} ${f.caja_nombre || ''}` +
      (f.compania_nombre ? ` · ${f.compania_nombre}` : '');
    $('cobrar-importe').textContent = eur(f.importe);
    $('metodo-efectivo').checked = false;
    $('metodo-tarjeta').checked = false;
    $('modal-cobrar-pendiente').classList.add('activo');
  }

  function cerrarModalCobrar() {
    $('modal-cobrar-pendiente').classList.remove('activo');
  }

  async function confirmarCobro() {
    const id = $('cobrar-fiado-id').value;
    const metodo = document.querySelector('input[name="metodo-pago"]:checked')?.value;
    if (!metodo) {
      toast('Selecciona un método de pago', 'error');
      return;
    }
    try {
      await api('marcar_cobrado', {
        method: 'POST',
        body: { id, metodo_pago: metodo }
      });
      toast(`Cobro registrado en ${metodo} ✓`);
      cerrarModalCobrar();
      await cargarCobros();
    } catch(e) {
      toast('Error: ' + e.message, 'error');
    }
  }

  async function editarCobro(id) {
    const f = Estado.cobros.find(x => x.id === id);
    if (!f) return;
    const nombre = prompt('Nombre del cliente:', f.cliente_nombre || '');
    if (nombre === null) return;
    const tel = prompt('Teléfono:', f.cliente_telefono || '');
    if (tel === null) return;
    const nota = prompt('Nota:', f.nota || '');
    if (nota === null) return;
    try {
      await api('editar_fiado', {
        method: 'POST',
        body: {
          id,
          cliente_nombre: nombre.trim(),
          cliente_telefono: tel.trim(),
          nota: nota.trim()
        }
      });
      toast('Cobro actualizado ✓');
      await cargarCobros();
    } catch(e) {
      toast('Error: ' + e.message, 'error');
    }
  }


  // ── DÍAS FESTIVOS ─────────────────────────────

  async function marcarFestivo(cajaId) {
    if (!confirm('¿Marcar este día como festivo para esta caja?\n\nEl día aparecerá en gris en el calendario y no necesitas hacer cierre.')) return;
    try {
      await api('guardar_cierre', {
        method: 'POST',
        body: {
          caja_id: cajaId,
          fecha: Estado.fechaActual,
          saldo_inicial: 0,
          saldo_real_final: 0,
          importe_tpv: 0,
          total_fiados: 0,
          cambio_siguiente: 0,
          total_cobrado_caja: 0,
          notas: 'Día marcado como festivo',
          estado: 'festivo',
          movimientos: []
        }
      });
      toast('Día marcado como festivo ✓');
      await cargarCajas();
    } catch(e) {
      toast('Error: ' + e.message, 'error');
    }
  }

  // Reabrir una caja cerrada por error (mismo día). Solo admin; deja rastro de auditoría
  // en el backend (reabrir_cierre añade "[Reabierto ... por ...]" a las notas del cierre).
  async function reabrirCaja(cierreId) {
    if (!esAdminTienda() || !cierreId) return;
    if (!confirm(T('cajas.reabrir_confirm'))) return;
    try {
      await api('reabrir_cierre', { method: 'POST', body: { id: cierreId } });
      toast(T('cajas.reabierta'));
      await cargarCajas();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  }

  async function deshacerFestivo(cajaId) {
    if (!confirm('¿Deshacer la marca de festivo?\n\nPodrás hacer el cierre normal de este día.')) return;
    try {
      // Buscar el cierre festivo y borrarlo (eso "deshace" el festivo)
      const data = await api('obtener_cierre', {
        query: { caja_id: cajaId, fecha: Estado.fechaActual, hoy: (typeof hoyLocal === 'function' ? hoyLocal() : '') }
      });
      if (data.cierre?.id && data.cierre.estado === 'festivo') {
        await api('borrar_cierre', {
          method: 'POST',
          body: { id: data.cierre.id }
        });
        toast('Festivo deshecho ✓');
        await cargarCajas();
      }
    } catch(e) {
      toast('Error: ' + e.message, 'error');
    }
  }

  async function marcarFestivoDesdeModal() {
    const cajaId = $('cierre-caja-id').value;
    cerrarModal('modal-cierre');
    await marcarFestivo(cajaId);
  }


  // ── FRANJA 7 DÍAS (G2) ────────────────────────
  async function pintarFranja7() {
    const grid = $('cajas-franja-grid');
    if (!grid) return;

    const hoy = new Date();
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() - i);
      dias.push(d);
    }
    const fmtIso = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    let resumenDias = {};
    try {
      const r = await api('resumen_periodo', {
        query: { desde: fmtIso(dias[0]), hasta: fmtIso(dias[6]) }
      });
      resumenDias = r.dias || {};
    } catch(e) { console.warn('Franja resumen error:', e); }

    const hoyIso = fmtIso(hoy);
    const _lcC = (typeof TEKPAIR_LANG === 'string' ? TEKPAIR_LANG : 'es');

    grid.innerHTML = dias.map(d => {
      const iso = fmtIso(d);
      const info = resumenDias[iso];
      const estado = info?.estado || 'vacio';
      const esHoy = iso === hoyIso;
      const nombre = esHoy ? T('cita.hoy') : d.toLocaleDateString(_lcC, {weekday:'short'});
      let etiqueta = esHoy ? T('cajas.sin_cerrar') : '·';
      if (estado === 'cuadrado') etiqueta = '✓ ' + T('cajas.cuadra');
      else if (estado === 'sobra') etiqueta = '+' + Number(info.descuadre || 0).toFixed(2).replace('.', ',');
      else if (estado === 'falta') etiqueta = '⚠ ' + Number(info.descuadre || 0).toFixed(2).replace('.', ',');
      else if (estado === 'pendientes') etiqueta = '🔵 ' + T('cajas.pendientes');
      else if (estado === 'borrador') etiqueta = '🔄 ' + T('cajas.borrador');
      else if (estado === 'festivo') etiqueta = '🏖 ' + T('cajas.festivo');
      const claseEstado = estado === 'vacio' ? '' : 'fd-' + estado;
      return `
        <div class="franja-dia ${claseEstado} ${esHoy ? 'es-hoy' : ''}"
             onclick="Cajas.irAFechaFranja('${iso}')">
          <div class="fd-nombre">${nombre}</div>
          <div class="fd-num">${d.getDate()}</div>
          <div class="fd-info">${etiqueta}</div>
        </div>
      `;
    }).join('');
  }

  function irAFechaFranja(iso) {
    // Sin permiso de histórico, el empleado no puede abrir días anteriores desde la franja.
    if (iso && iso < hoyLocal() && !puedeHistorico()) { if (typeof window.toast === 'function') window.toast(_txtSinHist(), 'error'); return; }
    Estado.fechaActual = iso;
    const sel = $('cajas-fecha-actual');
    if (sel) sel.value = iso;
    cargarCajas();
  }



  // ── CALENDARIO POPUP (G3) ─────────────────────
  Estado.calMes = new Date();

  function fmtIsoCal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function actualizarLabelFecha() {
    const lbl = $('cajas-fecha-label');
    if (!lbl) return;
    const iso = Estado.fechaActual;
    if (!iso) return;
    const [y, m, dd] = iso.split('-');
    lbl.textContent = `${dd}/${m}/${y}`;
  }

  function abrirCalendario() {
    // El calendario es la vista del histórico → requiere permiso (admin siempre).
    if (!puedeHistorico()) { if (typeof window.toast === 'function') window.toast(_txtSinHist(), 'err'); return; }
    const [y, m] = Estado.fechaActual.split('-').map(Number);
    Estado.calMes = new Date(y, m - 1, 1);
    pintarCalendarioMes();
    $('tpcal-popup-overlay').classList.add('activo');
  }

  function cerrarCalendario() {
    $('tpcal-popup-overlay').classList.remove('activo');
  }

  function navegarMes(delta) {
    Estado.calMes.setMonth(Estado.calMes.getMonth() + delta);
    pintarCalendarioMes();
  }

  async function pintarCalendarioMes() {
    const mes = Estado.calMes;
    const y = mes.getFullYear();
    const m = mes.getMonth();
    const primerDia = new Date(y, m, 1);
    const ultimoDia = new Date(y, m + 1, 0);
    const totalDias = ultimoDia.getDate();
    // primerDayWeek: 0=domingo, queremos lunes=0
    let primerDow = primerDia.getDay() - 1;
    if (primerDow < 0) primerDow = 6;

    const desde = fmtIsoCal(primerDia);
    const hasta = fmtIsoCal(ultimoDia);

    let resumenDias = {};
    try {
      const r = await api('resumen_periodo', { query: { desde, hasta } });
      resumenDias = r.dias || {};
    } catch(e) { console.warn('Calendario resumen:', e); }

    const meses = [T('fecha.enero'),T('fecha.febrero'),T('fecha.marzo'),T('fecha.abril'),T('fecha.mayo'),T('fecha.junio'),T('fecha.julio'),T('fecha.agosto'),T('fecha.septiembre'),T('fecha.octubre'),T('fecha.noviembre'),T('fecha.diciembre')];
    $('tpcal-titulo').textContent = `${meses[m]} ${y}`;

    const hoyIso = fmtIsoCal(new Date());
    const fechaSelIso = Estado.fechaActual;

    let html = [T('fecha.L'),T('fecha.M'),T('fecha.X'),T('fecha.J'),T('fecha.V'),T('fecha.S'),T('fecha.D')].map(d =>
      `<div class="tpcal-dow">${d}</div>`
    ).join('');

    for (let i = 0; i < primerDow; i++) {
      html += '<div class="tpcal-day cal-empty"></div>';
    }

    for (let d = 1; d <= totalDias; d++) {
      const fecha = new Date(y, m, d);
      const iso = fmtIsoCal(fecha);
      const info = resumenDias[iso];
      const estado = info?.estado;
      const cls = [];
      if (estado) cls.push('tpcal-' + estado);
      if (iso === hoyIso) cls.push('tpcal-hoy');
      if (iso === fechaSelIso) cls.push('tpcal-sel');
      html += `<div class="tpcal-day ${cls.join(' ')}"
                    onclick="Cajas.seleccionarDelCalendario('${iso}')">${d}</div>`;
    }
    $('tpcal-grid').innerHTML = html;
  }

  function seleccionarDelCalendario(iso) {
    if (iso && iso < hoyLocal() && !puedeHistorico()) { if (typeof window.toast === 'function') window.toast(_txtSinHist(), 'error'); return; }
    Estado.fechaActual = iso;
    const hidden = $('cajas-fecha-actual');
    if (hidden) hidden.value = iso;
    actualizarLabelFecha();
    cerrarCalendario();
    cargarCajas();
  }


  // API pública
  // ═══ CAJA DEL DÍA (panel automático: desglose por forma de pago + anticipos aparte) ═══
  async function pintarCajaDia() {
    const cont = $('caja-dia-panel');
    if (!cont) return;
    const caja = (Estado.cajas || []).find(c => c.nombre === 'Caja del día');
    if (!caja || typeof window.cajaDiaResumen !== 'function') { cont.innerHTML = ''; return; }
    let r;
    try { r = await window.cajaDiaResumen(Estado.fechaActual); }
    catch (e) { cont.innerHTML = ''; return; }
    Estado._cajaDiaR = r;
    const cierre = (Estado.cierres[caja.id] || {}).cierre;
    // Cambio del día anterior: lo que se dejó en el cajón al cerrar ayer. Sin esto, el
    // efectivo contado incluía ese fondo y la caja salía siempre con una "sobra" falsa.
    let saldoIni = 0;
    try {
      const d = await api('obtener_cierre', {
        query: { caja_id: caja.id, fecha: Estado.fechaActual, hoy: (typeof hoyLocal === 'function' ? hoyLocal() : '') }
      });
      // El fondo con el que empieza hoy ES el cambio que se dejó ayer, y aquí no hay
      // campo para tocarlo a mano: manda siempre el sugerido. Antes se leía primero
      // cierre.saldo_inicial con `??`, que NO salta cuando el valor es 0, así que un
      // cierre guardado con 0 (todos los anteriores a este cambio) dejaba el fondo a
      // cero para siempre y el cambio del día anterior no aparecía nunca.
      saldoIni = Number(d.saldo_sugerido || 0) || 0;
      if (d.cierre && Number(d.cierre.saldo_inicial) > 0) saldoIni = Number(d.cierre.saldo_inicial);
      Estado._cajaDiaCambioPrev = (cierre && cierre.cambio_siguiente != null) ? cierre.cambio_siguiente : null;
    } catch (e) { saldoIni = 0; }
    Estado._cajaDiaSaldoIni = saldoIni;
    const ICON = { Efectivo:'💵', Tarjeta:'💳', Bizum:'📲', Transferencia:'🏦' };
    let filas = '';
    Object.keys(r.metodos).sort().forEach(m => {
      if (Math.abs(r.metodos[m]) < 0.005) return;
      filas += `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span>${ICON[m]||'•'} ${escapar(m)}</span><span style="font-weight:700">${eur(r.metodos[m])}</span></div>`;
    });
    if (!filas) filas = `<div style="padding:5px 0;font-size:13px;color:var(--muted,#9ca3af)">${T('cajas.dia_sin_cobros')}</div>`;
    const anti = r.anticipos.total > 0.005
      ? `<div style="display:flex;justify-content:space-between;padding:6px 8px;margin-top:4px;background:rgba(234,88,12,.08);border-radius:8px;font-size:14px"><span>💰 Anticipos <span style="font-size:11px;color:#6b7280">(reservas de clientes)</span></span><span style="font-weight:700;color:#EA580C">${eur(r.anticipos.total)}</span></div>`
      : '';
    // Gastos pagados de la caja: restan del efectivo esperado y se listan para poder
    // repasarlos al cuadrar (salen del módulo de Gastos, no son una lista aparte).
    const g = r.gastos || { total: 0, lista: [] };
    let gastosHtml = '';
    if (g.total > 0.005) {
      const items = g.lista.map(x =>
        `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:var(--muted,#6b7280)"><span>· ${escapar(x.concepto)}</span><span>−${eur(x.importe)}</span></div>`
      ).join('');
      gastosHtml = `<div style="margin-top:4px;padding:6px 8px;background:rgba(220,38,38,.08);border-radius:8px">
        <div style="display:flex;justify-content:space-between;font-size:14px"><span>${T('cajas.gastos_titulo')}</span><span style="font-weight:700;color:#DC2626">−${eur(g.total)}</span></div>
        ${items}</div>`;
    }
    const est = cierre && (cierre.estado === 'cerrado' || cierre.estado === 'descuadre');
    const badge = est
      ? `<span class="caja-card-estado caja-estado-${cierre.estado}">${cierre.estado === 'cerrado' ? T('cajas.cuadrada_ok') : (cierre.descuadre > 0 ? '+ ' + T('cajas.sobra') : '⚠ ' + T('cajas.falta'))}</span>`
      : `<span class="caja-card-estado caja-estado-pendiente">${T('cajas.pendiente')}</span>`;
    const contadoPrefill = (cierre && cierre.saldo_real_final != null) ? cierre.saldo_real_final : '';
    const cambioPrefill = (cierre && cierre.cambio_siguiente != null) ? cierre.cambio_siguiente : '';
    cont.innerHTML = `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:16px;border-left:4px solid #00C896">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:800;font-size:15px">📅 ${T('cajas.dia_titulo')} <span style="color:#6b7280;font-weight:500;font-size:12px">· ${formatearFecha(Estado.fechaActual)}</span></div>
          ${badge}
        </div>
        <div>${filas}${anti}${gastosHtml}</div>
        <div style="display:flex;justify-content:space-between;border-top:2px solid #e5e7eb;margin-top:6px;padding-top:8px;font-weight:800;font-size:16px"><span>${T('gen.total')}</span><span style="color:#00A87D">${eur(r.totalDia)}</span></div>
        <div style="margin-top:12px;background:#F8FAFC;border-radius:10px;padding:12px">
          ${saldoIni > 0.005 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:#6b7280"><span>🔁 ${T('cajas.cambio_anterior').replace(' €','')} <span style="font-size:11px">${T('cajas.automatico')}</span></span><span style="font-weight:700">${eur(saldoIni)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px"><span>💵 ${T('cajas.efectivo_esperado')}</span><span style="font-weight:700">${eur(r.efectivoEsperado + saldoIni)}</span></div>
          <div style="display:flex;gap:8px;align-items:center">
            <label style="font-size:13px;white-space:nowrap">${T('cajas.efectivo_contado')}</label>
            <input id="caja-dia-contado" type="number" step="0.01" inputmode="decimal" value="${contadoPrefill}" oninput="Cajas.cuadreCajaDia()" style="flex:1;min-width:0;padding:7px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <label style="font-size:13px;white-space:nowrap">${T('cajas.cambio_manana').replace(' €','')}</label>
            <input id="caja-dia-cambio" type="number" step="0.01" inputmode="decimal" value="${cambioPrefill}" oninput="Cajas.cuadreCajaDia()" style="flex:1;min-width:0;padding:7px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">
          </div>
          <div id="caja-dia-descuadre" style="margin-top:8px;font-size:13px;font-weight:700;min-height:18px"></div>
          <div id="caja-dia-retirar" style="font-size:12px;color:var(--muted,#6b7280);min-height:16px"></div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="cajas-btn cajas-btn-sec" style="flex:0 0 auto" onclick="Cajas.gastoDeCaja()" title="${T('cajas.gasto_btn_ayuda')}">${T('cajas.gasto_btn')}</button>
            <button class="cajas-btn cajas-btn-verde" style="flex:1" onclick="Cajas.cerrarCajaDia()">${est ? T('cajas.dia_actualizar') : T('cajas.dia_cerrar')}</button>
          </div>
        </div>
      </div>`;
    if (contadoPrefill !== '') cuadreCajaDia();
  }

  function cuadreCajaDia() {
    const r = Estado._cajaDiaR;
    const el = $('caja-dia-descuadre');
    const inp = $('caja-dia-contado');
    const ret = $('caja-dia-retirar');
    if (!r || !el || !inp || inp.value === '') { if (el) el.innerHTML = ''; if (ret) ret.innerHTML = ''; return; }
    const contado = parseFloat(inp.value) || 0;
    const saldoIni = Number(Estado._cajaDiaSaldoIni || 0);
    // Lo que debe haber en el cajón = fondo con el que se empezó + cobros en efectivo.
    const esperado = Math.round((r.efectivoEsperado + saldoIni) * 100) / 100;
    const d = Math.round((contado - esperado) * 100) / 100;
    if (Math.abs(d) < 0.005) el.innerHTML = `<span style="color:#16a34a">✓ ${T('cajas.caja_cuadrada')}</span>`;
    else if (d > 0) el.innerHTML = `<span style="color:#2563eb">+${eur(d).replace('+','')} ${T('cajas.sobra')}</span>`;
    else el.innerHTML = `<span style="color:#dc2626">${eur(d)} ${T('cajas.falta')}</span>`;
    // Si dejas fondo para mañana, el resto es lo que te llevas hoy.
    const cInp = $('caja-dia-cambio');
    const cambio = parseFloat((cInp && cInp.value) || 0) || 0;
    if (ret) {
      ret.innerHTML = cambio > 0.005
        ? T('cajas.dia_retiras').replace('{c}', eur(cambio)).replace('{r}', eur(Math.round((contado - cambio) * 100) / 100))
        : '';
    }
  }

  // Pago hecho con el dinero del cajón (mensajero, café, un recambio suelto…). Se guarda
  // como GASTO normal, no como apunte suelto de la caja: así cuenta en Gastos, reportes e
  // IVA, y de paso el efectivo esperado del día lo descuenta solo.
  async function gastoDeCaja() {
    const concepto = await _pedirValor({
      titulo: T('cajas.gasto_titulo'),
      ayuda: T('cajas.gasto_concepto_ayuda'),
      texto: true
    });
    if (concepto === null) return;
    if (!String(concepto).trim()) { toast(T('cajas.gasto_falta_concepto'), 'error'); return; }
    const impTxt = await _pedirValor({
      titulo: T('cajas.gasto_importe_titulo'),
      ayuda: T('cajas.gasto_importe_ayuda'),
      valorInicial: ''
    });
    if (impTxt === null) return;
    const importe = Math.round((parseFloat(String(impTxt).replace(',', '.')) || 0) * 100) / 100;
    if (!(importe > 0)) { toast(T('cajas.importe_invalido'), 'error'); return; }
    try {
      await window.crearGastoCaja({ concepto: String(concepto).trim(), importe, fecha: Estado.fechaActual });
      toast(T('cajas.gasto_ok'), 'ok');
      await pintarCajaDia();
    } catch (e) {
      toast(T('cajas.gasto_error') + ': ' + (e.message || e), 'error');
    }
  }

  async function cerrarCajaDia() {
    const caja = (Estado.cajas || []).find(c => c.nombre === 'Caja del día');
    if (!caja) return;
    const r = Estado._cajaDiaR || await window.cajaDiaResumen(Estado.fechaActual);
    const inp = $('caja-dia-contado');
    const contado = parseFloat((inp && inp.value) || 0) || 0;
    const saldoIni = Number(Estado._cajaDiaSaldoIni || 0);
    const cInp = $('caja-dia-cambio');
    const cambioSig = parseFloat((cInp && cInp.value) || 0) || 0;
    const payload = {
      caja_id: caja.id, fecha: Estado.fechaActual,
      saldo_inicial: saldoIni, saldo_real_final: contado, importe_tpv: 0,
      // El esperado incluye el fondo con el que se empezó el día; si no, el cambio que
      // se dejó ayer salía como "sobra" al contar el cajón.
      efectivo_esperado: Math.round((r.efectivoEsperado + saldoIni) * 100) / 100,
      total_fiados: 0, cambio_siguiente: cambioSig, total_cobrado_caja: r.totalDia,
      notas: null, estado: 'cerrado', movimientos: [],
      codigo_apertura: (window._cajaSesion && window._cajaSesion.codigo) || '',
      abierto_por_nombre: (window._cajaSesion && window._cajaSesion.nombre) || ''
    };
    try {
      await api('guardar_cierre', { method: 'POST', body: payload });
      toast('Caja del día cerrada', 'ok');
      await cargarCajas();
    } catch (e) { toast((e && e.message) || 'Error al cerrar', 'error'); }
  }

  window.Cajas = {
    renderCajas,
    cargarCajas,
    pintarCuentas,
    recargarSaldo,
    ingresoBanco,
    confirmarSaldoCuenta,
    verSeguimiento,
    crearCuenta,
    borrarCuenta,
    asignarCompaniaCuenta,
    pintarCajaDia,
    cuadreCajaDia,
    cerrarCajaDia,
    gastoDeCaja,
    abrirModalNuevaCaja,
    editarCaja,
    crearCompania,
    editarCompania,
    borrarCompania,
    guardarCaja,
    borrarCaja,
    abrirCierre,
    guardarCierre,
    recalcular: recalcularResumen,
    cerrarModal,
    abrirModalFiado,
    cerrarModalFiado,
    guardarFiado,
    quitarFiado,
    editarFiado,
    quitarFiadoByKey,
    cambiarTab,
    cambiarSubTab,
    cobrarFiado,
    cerrarModalCobrar,
    confirmarCobro,
    editarCobro,
    limpiarClienteFiado,
    pintarFranja7,
    irAFechaFranja,
    marcarFestivo,
    deshacerFestivo,
    reabrirCaja,
    marcarFestivoDesdeModal,
    abrirCalendario,
    cerrarCalendario,
    navegarMes,
    seleccionarDelCalendario,
    actualizarLabelFecha
  };
})();

// ── El 0 de los importes se quita al tocar el campo ─────────────────────────────
// Los inputs de dinero salen con "0" y hay que borrarlo a mano antes de escribir:
// molesto cuando cierras caja a diario. Se hace por delegación en todo el módulo de
// cajas —y no campo a campo con onfocus— porque así lo heredan también los inputs
// que se pintan por JS (compañías, saldos) y los que se añadan después: los tres del
// modal de cierre se habían quedado fuera justo por eso.
(function () {
  var SEL = '#pCajas, .cajas-modal, [id^="modal-caja"], [id^="modal-cierre"], [id^="modal-fiado"]';
  var esImporte = function (el) {
    return el && el.tagName === 'INPUT' &&
      (el.type === 'number' || el.inputMode === 'decimal') &&
      typeof el.closest === 'function' && el.closest(SEL);
  };
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!esImporte(el)) return;
    if (/^0(?:[.,]0+)?$/.test((el.value || '').trim())) el.value = '';
    else if (el.select) el.select();   // si ya hay importe, se sustituye escribiendo
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (!esImporte(el)) return;
    // Si se sale sin escribir, vuelve el 0: los cálculos del cierre cuentan con un número.
    if ((el.value || '').trim() === '') {
      el.value = '0';
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { /* noop */ }
    }
  });
})();
