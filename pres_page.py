# PASO 1: HTML de pPresupuestos (insertar antes de <!-- PAGE: VENTAS -->)
HTML_PAGE = """
<!-- PAGE: PRESUPUESTOS -->
<div class="page" id="pPresupuestos">
  <div class="sec-header" style="margin-bottom:10px">
    <div class="sec-title" style="color:#8B5CF6">📋 Presupuestos</div>
    <button class="btn-sm" style="background:#8B5CF6;color:white;font-size:13px;padding:8px 16px" onclick="abrirPresupuesto()">+ Nuevo presupuesto</button>
  </div>
  <div class="search-wrap">
    <span class="search-icon">🔍</span>
    <input class="search-input" id="busPresupuesto" placeholder="Buscar por cliente, modelo o avería..." oninput="renderPresupuestos()">
  </div>
  <div class="tabs" id="presTabsFiltro" style="margin-bottom:12px">
    <div class="tab active" data-pf="todos"    onclick="setPresFiltro(this)">Todos</div>
    <div class="tab"        data-pf="pendiente" onclick="setPresFiltro(this)">Pendientes</div>
    <div class="tab"        data-pf="aceptado"  onclick="setPresFiltro(this)" style="color:#16A34A">Aceptados</div>
    <div class="tab"        data-pf="rechazado" onclick="setPresFiltro(this)">Rechazados</div>
  </div>
  <div id="listaPresupuestos"></div>
</div>

"""

# PASO 2: Función renderPresupuestos + setPresFiltro
JS_FUNC = """
// ── PRESUPUESTOS — página propia ─────────────────────────────────────────────
var _presFiltro = 'todos';

function setPresFiltro(el) {
  document.querySelectorAll('#presTabsFiltro .tab').forEach(function(t){ t.classList.remove('active'); });
  el.classList.add('active');
  _presFiltro = el.dataset.pf;
  renderPresupuestos();
}

function renderPresupuestos() {
  var busq = (_norm(document.getElementById('busPresupuesto') ? document.getElementById('busPresupuesto').value : ''));
  var list = DB.reps.slice().reverse().filter(function(r) {
    if (r.estado !== 'Presupuesto') return false;
    if (_presFiltro === 'aceptado')  return !!r.presupuesto_aceptado_at;
    if (_presFiltro === 'rechazado') return r.estado === 'Rechazado';
    if (_presFiltro === 'pendiente') return !r.presupuesto_aceptado_at;
    return true;
  });
  if (busq) {
    list = list.filter(function(r) {
      return _norm(r.clienteNombre).includes(busq) || _norm(r.marca+' '+r.modelo).includes(busq) || _norm(r.averia).includes(busq);
    });
  }
  var el = document.getElementById('listaPresupuestos');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>Sin presupuestos' + (busq ? ' para "' + escHtml(busq) + '"' : '') + '</div>';
    return;
  }
  var html = '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
    + '<th>Cliente</th><th>Dispositivo</th><th>Avería</th><th>Total</th><th>Fecha</th><th>Estado</th><th></th>'
    + '</tr></thead><tbody>';

  list.forEach(function(r) {
    var cliRep = r.cliId ? DB.clis.find(function(c){ return c.id === r.cliId; }) : null;
    if (!cliRep && r.clienteNombre) {
      var nomNorm = _norm(r.clienteNombre);
      cliRep = DB.clis.find(function(c){
        return _norm(((c.nombre||'')+' '+(c.apellidos||'')).trim()) === nomNorm;
      });
    }

    // Estado visual
    var estadoBadge = '';
    if (r.presupuesto_aceptado_at) {
      estadoBadge = '<span class="badge bg" style="background:rgba(22,163,74,.1);color:#16A34A">✓ Aceptado</span>';
    } else {
      estadoBadge = '<span class="badge by">Pendiente</span>';
    }

    // Botones
    var btnAcept  = '<button data-rid="' + r.id + '" class="row-btn btn-pres-acept2" title="Aceptar — convertir a reparación" style="background:var(--green);color:white;border-color:var(--green)">✓ Aceptar</button>';
    var btnFirmar = '<button data-rid="' + r.id + '" class="row-btn btn-pres-firma2" title="Firmar en tablet" style="background:#8B5CF6;color:white;border-color:#8B5CF6">✍️ Firmar</button>';
    var btnEnviar = '<button data-rid="' + r.id + '" class="row-btn btn-pres-enviar2" title="Enviar al cliente por WA/Email" style="background:#0EA5E9;color:white;border-color:#0EA5E9">📤 Enviar</button>';
    var btnEditar = '<button data-rid="' + r.id + '" class="row-btn btn-pres-edit2" title="Editar presupuesto">✏️</button>';
    var btnRech   = tienePerm('reps_eliminar') ? '<button data-rid="' + r.id + '" class="row-btn btn-pres-rech2" title="Rechazar">✗</button>' : '';

    html += '<tr>'
      + '<td><strong>' + escHtml(r.clienteNombre||'—') + '</strong></td>'
      + '<td>' + escHtml(r.marca + ' ' + r.modelo) + '</td>'
      + '<td style="font-size:11px;color:var(--dark)">' + escHtml(r.averia||'—') + '</td>'
      + '<td style="font-weight:700;color:#8B5CF6">' + cur(r.total) + '</td>'
      + '<td style="font-size:11px;color:var(--muted)">' + (r.fecha||'—') + '</td>'
      + '<td>' + estadoBadge + '</td>'
      + '<td>' + btnAcept + btnFirmar + btnEnviar + btnEditar + btnRech + '</td>'
      + '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;

  // Listeners
  el.querySelectorAll('.btn-pres-acept2').forEach(function(btn) {
    btn.addEventListener('click', function() { aceptarPresupuesto(this.dataset.rid); });
  });
  el.querySelectorAll('.btn-pres-firma2').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var r = DB.reps.find(function(x){ return x.id === btn.dataset.rid; });
      if (r) { SEL.rep = r; openM('mFirma'); setTimeout(firmaCanvasInit, 100); }
    });
  });
  el.querySelectorAll('.btn-pres-enviar2').forEach(function(btn) {
    btn.addEventListener('click', function() { abrirModalEnviarPres(this.dataset.rid); });
  });
  el.querySelectorAll('.btn-pres-edit2').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var r = DB.reps.find(function(x){ return x.id === btn.dataset.rid; });
      if (r) { SEL.modoPresupuesto = true; abrirRepModal(r); }
    });
  });
  el.querySelectorAll('.btn-pres-rech2').forEach(function(btn) {
    btn.addEventListener('click', function() { rechazarPresupuesto(this.dataset.rid); });
  });
}

"""

with open('dashboard.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Insertar HTML página antes de <!-- PAGE: VENTAS -->
old_ventas = '<!-- PAGE: VENTAS -->'
content = content.replace(old_ventas, HTML_PAGE + old_ventas, 1)

# 2. Insertar JS antes de setPresFiltro (función renderReps)
old_js = 'function renderReps() {'
content = content.replace(old_js, JS_FUNC + old_js, 1)

# 3. Actualizar navTo para trigger renderPresupuestos
old_navto_trigger = "  if (id === 'pTienda') {"
new_navto_trigger = """  if (id === 'pPresupuestos') renderPresupuestos();
  if (id === 'pTienda') {"""
content = content.replace(old_navto_trigger, new_navto_trigger, 1)

# 4. Actualizar sidebar: navToPresupuestos → navTo('pPresupuestos')
old_sidebar_pres = """    <div class="sidebar-ni" onclick="navToPresupuestos();setSidebarActive(this)" style="color:rgba(168,85,247,.8)">
      <span class="sidebar-ni-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>Presupuestos
    </div>"""
new_sidebar_pres = """    <div class="sidebar-ni" data-p="pPresupuestos" onclick="navTo('pPresupuestos');setSidebarActive(this)" style="color:rgba(168,85,247,.8)">
      <span class="sidebar-ni-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>Presupuestos
    </div>"""
content = content.replace(old_sidebar_pres, new_sidebar_pres, 1)

# 5. Limpiar navToPresupuestos provisional
old_nav_prov = """function navToPresupuestos() {
  navTo('pReps');
  // Activar tab Presupuestos y filtro
  setTimeout(function() {
    var tab = document.querySelector('.tab[data-f="Presupuesto"]');
    if (tab) { tab.click(); }
  }, 80);
}

"""
content = content.replace(old_nav_prov, '', 1)

with open('dashboard.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ pPresupuestos creado')
