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
  async function renderCajas() {
    if (!Estado.inicializado) {
      $('cajas-fecha-actual').value = Estado.fechaActual;
      $('cajas-fecha-actual').addEventListener('change', (e) => {
        Estado.fechaActual = e.target.value;
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
      const r = await api('listar_cajas');
      Estado.cajas = r.cajas || [];
      Estado.cierres = {};
      await Promise.all(Estado.cajas.map(async (c) => {
        try {
          const d = await api('obtener_cierre', {
            query: { caja_id: c.id, fecha: Estado.fechaActual }
          });
          Estado.cierres[c.id] = d;
        } catch (e) {
          Estado.cierres[c.id] = { cierre: null, movimientos: [], companias: [] };
        }
      }));
      pintarTarjetas();
      actualizarBadgePendientes();
      pintarFranja7();
      actualizarLabelFecha();
    } catch (e) {
      toast('Error cargando cajas: ' + e.message, 'error');
    }
  }

  function pintarTarjetas() {
    const grid = $('cajas-grid');
    if (Estado.cajas.length === 0) {
      grid.innerHTML = `
        <div class="cajas-mensaje-vacio" style="grid-column:1/-1;">
          <p style="font-size:16px;margin-bottom:6px;color:#374151;">Aún no tienes cajas configuradas</p>
          <p style="font-size:13px;">Crea tu primera caja para empezar a cuadrar el día a día</p>
          <button class="cajas-btn cajas-btn-verde" style="margin-top:12px;" onclick="Cajas.abrirModalNuevaCaja()">+ Crear primera caja</button>
        </div>
      `;
      return;
    }

    let html = '';
    for (const caja of Estado.cajas) {
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
        <div>Añadir nueva caja</div>
      </div>
    `;
    grid.innerHTML = html;
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
        lista.innerHTML = '<div style="color:#6b7280;font-size:12px;text-align:center;padding:8px;">' + T('gen.no_hay_companias') + '</div>';
        return;
      }
      lista.innerHTML = cmps.map(c => `
        <div class="compania-row" data-id="${c.id}">
          <input type="text" value="${escapar(c.nombre)}" onchange="Cajas.editarCompania('${c.id}', this.value)">
          <button class="cajas-btn cajas-btn-rojo" style="padding:5px 9px;font-size:11px;" onclick="Cajas.borrarCompania('${c.id}')">✕</button>
        </div>
      `).join('');
    } catch (e) {
      lista.innerHTML = `<div style="color:#dc2626;font-size:12px;">Error: ${e.message}</div>`;
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
        query: { caja_id: cajaId, fecha: Estado.fechaActual }
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
          <td style="text-align:right;"><input type="number" step="0.01" class="mov-enviado" value="${m.importe_enviado || 0}" onchange="Cajas.recalcular()"></td>
        </tr>`;
      } else if (tipo === 'recargas') {
        // Guardamos el total vendido en importe_efectivo (semánticamente ahora es "total vendido")
        // y dejamos importe_tarjeta a 0 para retrocompatibilidad
        const totalVendido = (m.importe_efectivo || 0) + (m.importe_tarjeta || 0);
        html += `<tr data-compania-id="${c.id}">
          <td>${escapar(c.nombre)}</td>
          <td style="text-align:right;"><input type="number" step="0.01" class="mov-efectivo" value="${totalVendido}" onchange="Cajas.recalcular()"></td>
        </tr>`;
      } else {
        html += `<tr data-compania-id="${c.id}">
          <td>${escapar(c.nombre)}</td>
          <td style="text-align:right;"><input type="number" step="0.01" class="mov-cobrado" value="${m.importe_cobrado || 0}" onchange="Cajas.recalcular()"></td>
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

    if (tipo === 'envios') {
      // ENVÍOS: total enviado por compañías
      let totalEnviado = 0;
      for (const m of movs) totalEnviado += m.importe_enviado || 0;
      const teorico = Math.round((saldoInicial + totalEnviado) * 100) / 100;
      // v2.3: pendientes son deuda, no suman al cobrado
      const cobrado = Math.round((efectivoCaja + importeTpv) * 100) / 100;
      const balance = Math.round((cobrado - teorico) * 100) / 100;

      // Envíos: debe cuadrar EXACTO (no aceptar sobra como verde)
      // v2.3: si hay pendientes, sumarlos a la falta
      const faltaTotal = Math.round((balance - totalFiados) * 100) / 100;
      okFlag = Math.abs(faltaTotal) <= 0.5;
      if (faltaTotal > 0.5) {
        okFlag = false;
        mensajeOK = '';
      } else {
        mensajeOK = T('cajas.caja_cuadrada');
      }
      mensajeKO = faltaTotal < -0.5 ? `❌ ${T('cajas.falta')}: ${eur(faltaTotal)}` : `❌ ${T('cajas.sobra')}: +${eur(faltaTotal)}`;

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
      const balance = Math.round((cobrado - totalVendido) * 100) / 100;

      // v2.3: si hay pendientes, restarlos
      const faltaTotal = Math.round((balance - totalFiados) * 100) / 100;
      okFlag = Math.abs(faltaTotal) <= 0.5;
      if (faltaTotal > 0.5) {
        okFlag = true;
        mensajeOK = `✓ ${T('cajas.sobra')}: +${eur(faltaTotal)}`;
      } else {
        mensajeOK = T('cajas.caja_cuadrada');
      }
      mensajeKO = `❌ ${T('cajas.falta')}: ${eur(faltaTotal)}`;

      html += `<div class="item" style="grid-column:1/-1;background:#dbeafe;padding:6px 10px;border-radius:6px;"><span class="label" style="color:#C2491A;font-weight:600;">${T('cajas.total_vendido')}</span><span style="color:#C2491A;font-weight:700;">${eur(totalVendido)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.efectivo_caja')}</span><span>${eur(efectivoCaja)}</span></div>`;
      html += `<div class="item"><span class="label">${T('cajas.importe_tpv')}</span><span>${eur(importeTpv)}</span></div>`;
      if (totalFiados > 0) {
        html += `<div class="item" style="grid-column:1/-1;background:#fef3c7;padding:6px 10px;border-radius:6px;margin-top:4px;"><span class="label" style="color:#92400e;">${T('cajas.pend_cobro')}</span><span style="color:#92400e;font-weight:600;">${eur(totalFiados)}</span></div>`;
      }
      html += `<div class="item" style="grid-column:1/-1;border-top:1px dashed #cbd5e1;padding-top:6px;margin-top:4px;"><span class="label">${T('cajas.total_cobrado')}</span><span><b>${eur(cobrado)}</b></span></div>`;
    }

    html += `<div class="descuadre-grande ${okFlag ? 'ok' : 'ko'}">
      ${okFlag ? mensajeOK : mensajeKO}
    </div>`;
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
      const metodoIcon = f.metodo_pago === 'efectivo' ? '💶' : f.metodo_pago === 'tarjeta' ? '💳' : '';
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
    const datos = {
      compania_id: $('fiado-compania-select').value || null,
      importe,
      cliente_nombre: $('fiado-cliente').value.trim(),
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
      const metodoIcon = f.metodo_pago === 'efectivo' ? '💶' : f.metodo_pago === 'tarjeta' ? '💳' : '';
      const metodoTxt = f.metodo_pago === 'efectivo' ? 'efectivo' : f.metodo_pago === 'tarjeta' ? 'tarjeta' : '';

      let acciones = '';
      if (!cobrado) {
        const waBtn = f.cliente_telefono
          ? `<button onclick="abrirWhatsAppFiado('${f.id}')" style="background:#25D366;color:#fff;border:0;padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;" title="Avisar por WhatsApp">💬</button>`
          : '';
        acciones = `
          ${waBtn}
          <button onclick="Cajas.cobrarFiado('${f.id}')" style="background:#10b981;color:#fff;border:0;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">✓ ${T('cajas.cobrar')}</button>
          <button onclick="Cajas.editarCobro('${f.id}')" style="background:#f3f4f6;border:1px solid #d1d5db;color:#374151;padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;">✏</button>
        `;
      } else {
        acciones = `<div style="text-align:right;"><div style="color:#10b981;font-size:11px;font-weight:600;">${metodoIcon} Cobrado ${fechaCobro}</div><div style="color:#6b7280;font-size:10px;">en ${metodoTxt}</div></div>`;
      }

      return `
        <div class="cobro-fila ${cobrado ? 'cobrado' : ''}">
          <div class="cobro-info">
            <div style="font-size:11px;color:#FF5B1F;font-weight:700;margin-bottom:4px;">📅 ${fechaVisible}</div>
            <div class="cobro-cliente">
              ${escapar(cliente)}
              <span style="color:#6b7280;font-size:12px;font-weight:400;">— ${cajaIco} ${escapar(cajaN)} ${cmp ? '· ' + escapar(cmp) : ''}</span>
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

  async function deshacerFestivo(cajaId) {
    if (!confirm('¿Deshacer la marca de festivo?\n\nPodrás hacer el cierre normal de este día.')) return;
    try {
      // Buscar el cierre festivo y borrarlo (eso "deshace" el festivo)
      const data = await api('obtener_cierre', {
        query: { caja_id: cajaId, fecha: Estado.fechaActual }
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
      let etiqueta = T('cajas.sin_cerrar');
      if (estado === 'cuadrado') etiqueta = '✓ ' + T('cajas.cuadra');
      else if (estado === 'sobra') etiqueta = '+' + Number(info.descuadre || 0).toFixed(2).replace('.', ',');
      else if (estado === 'falta') etiqueta = Number(info.descuadre || 0).toFixed(2).replace('.', ',');
      else if (estado === 'pendientes') etiqueta = T('cajas.pendientes');
      else if (estado === 'borrador') etiqueta = T('cajas.borrador');
      else if (estado === 'festivo') etiqueta = T('cajas.festivo');
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
    Estado.fechaActual = iso;
    const hidden = $('cajas-fecha-actual');
    if (hidden) hidden.value = iso;
    actualizarLabelFecha();
    cerrarCalendario();
    cargarCajas();
  }


  // API pública
  window.Cajas = {
    renderCajas,
    cargarCajas,
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
    marcarFestivoDesdeModal,
    abrirCalendario,
    cerrarCalendario,
    navegarMes,
    seleccionarDelCalendario,
    actualizarLabelFecha
  };
})();
