let ageingChart;
let situacionChart;
let familiaChart;
let inventoryRows = [];
let planPisoRows = [];
let planPisoPeriodLabel = 'Todo (acumulado a hoy)';
let planPisoPeriodKey = 'all';
let planPisoMonthOptions = [];
let planPisoSelectedPeriod = null;
let inventoryScope = 'autos';
let postventaData = null;
let postventaArea = 'servicio';
let postventaLoaded = false;
let chartsReady = false;
let activeAutosKpi = null;
let autosKpiFilter = null;
let autosDrawerUi = null;
let stockAlertsRows = [];

const PLAN_PISO_MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function getCurrentMonthPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatPlanPisoMonthLabel(period) {
  const [year, month] = String(period).split('-').map(Number);
  if (!year || !month) return period;
  return `${PLAN_PISO_MONTH_NAMES[month - 1]} ${year}`;
}

function withCurrentMonthOption(months) {
  const current = getCurrentMonthPeriod();
  const list = [...(months || [])];
  if (!list.some((m) => m.value === current)) {
    list.unshift({ value: current, label: formatPlanPisoMonthLabel(current) });
  }
  return list;
}

function destroyChart(chart) {
  if (chart) chart.destroy();
}

function getPlanPisoPeriod() {
  return planPisoSelectedPeriod ?? getCurrentMonthPeriod();
}

function getPlanPisoPeriodOptions() {
  return [
    { value: 'all', label: 'Todo (acumulado a hoy)' },
    ...planPisoMonthOptions,
  ];
}

function populatePlanPisoPeriod(months, selected) {
  planPisoMonthOptions = withCurrentMonthOption(months);
  const sel = document.getElementById('planPisoPeriod');
  if (!sel) return;
  const current = selected ?? getPlanPisoPeriod();
  planPisoSelectedPeriod = current;
  const options = getPlanPisoPeriodOptions();
  sel.innerHTML = options.map((m) => (
    `<option value="${m.value}"${m.value === current ? ' selected' : ''}>${m.label}</option>`
  )).join('');
  sel.value = current;
  renderPlanPisoKpiMenu(current);
}

function renderPlanPisoKpiMenu(selected) {
  const menu = document.getElementById('planPisoKpiMenu');
  if (!menu) return;
  const current = selected || getPlanPisoPeriod();
  menu.innerHTML = getPlanPisoPeriodOptions().map((m) => (
    `<button type="button" class="kpi-period-option${m.value === current ? ' is-active' : ''}" data-period="${m.value}" role="option" aria-selected="${m.value === current}">${m.label}</button>`
  )).join('');
}

function isPlanPisoKpiMenuOpen() {
  const menu = document.getElementById('planPisoKpiMenu');
  return menu ? !menu.classList.contains('hidden') : false;
}

function setPlanPisoKpiMenuOpen(open) {
  const card = document.getElementById('kpiPlanPisoCard');
  const menu = document.getElementById('planPisoKpiMenu');
  if (!card || !menu) return;
  menu.classList.toggle('hidden', !open);
  card.classList.toggle('is-open', open);
  card.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closePlanPisoKpiMenu() {
  setPlanPisoKpiMenuOpen(false);
}

function togglePlanPisoKpiMenu() {
  if (isPlanPisoKpiMenuOpen()) {
    closePlanPisoKpiMenu();
    return;
  }
  renderPlanPisoKpiMenu(getPlanPisoPeriod());
  setPlanPisoKpiMenuOpen(true);
}

function setPlanPisoPeriod(period) {
  planPisoSelectedPeriod = period;
  const sel = document.getElementById('planPisoPeriod');
  if (sel) sel.value = period;
  renderPlanPisoKpiMenu(period);
  closePlanPisoKpiMenu();
  loadInventory({ onlyPlanPiso: true });
}

function initPlanPisoKpiCard() {
  const card = document.getElementById('kpiPlanPisoCard');
  const menu = document.getElementById('planPisoKpiMenu');
  const wrap = document.getElementById('kpiPlanPisoWrap');
  if (!card || !menu) return;

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlanPisoKpiMenu();
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePlanPisoKpiMenu();
    } else if (e.key === 'Escape') {
      closePlanPisoKpiMenu();
    }
  });

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    e.stopPropagation();
    setPlanPisoPeriod(btn.dataset.period);
  });

  document.addEventListener('click', (e) => {
    if (!wrap?.contains(e.target)) closePlanPisoKpiMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePlanPisoKpiMenu();
  });
}

function renderAlerts(alerts, planPisoTotal) {
  const { fmt } = Dashboard;
  stockAlertsRows = alerts || [];
  const el = document.getElementById('alertsList');
  const totalEl = document.getElementById('ageingPlanPisoTotal');
  if (totalEl) {
    totalEl.textContent = `Plan Piso acumulado (Físico): ${fmt.money(planPisoTotal || 0)}`;
  }

  if (!alerts.length) {
    el.innerHTML = '<p class="kpi-subtitle">Sin unidades Físico con 60+ días en inventario.</p>';
    return;
  }
  el.innerHTML = alerts.map((a) => `
    <div class="alert-list-item ${a.critical ? 'critical' : ''}">
      <div>
        <span style="font-weight:700;color:#0f172a">${a.model || 'Sin modelo'}</span>
        <p class="kpi-subtitle">${a.serie}</p>
        <p class="kpi-subtitle" style="font-size:11px">Físico${a.ubicacion ? ` · ${a.ubicacion}` : ''}</p>
      </div>
      <div style="text-align:right">
        <span style="font-weight:700;${a.critical ? 'color:#ef4444' : 'color:#0f172a'}">${a.days} días</span>
        <p class="kpi-subtitle" style="font-size:12px;font-weight:700;color:#b45309">${fmt.money(a.planPisoAcumulado || 0)}</p>
      </div>
    </div>
  `).join('');
}

function getPlanPisoSearchTerm() {
  return document.getElementById('buscarPlanPiso')?.value || '';
}

function filterPlanPisoRows(term) {
  const q = term.trim().toLowerCase();
  if (!q) return planPisoRows;
  return planPisoRows.filter((r) =>
    [r.serie, r.tipoAuto, r.anModelo, r.ubicacion, r.fechaRemision]
      .some((val) => String(val || '').toLowerCase().includes(q))
  );
}

function renderPlanPiso(rows, { searchTerm = '' } = {}) {
  const { fmt } = Dashboard;
  const body = document.getElementById('planPisoTable');
  const total = planPisoRows.length;
  const q = searchTerm.trim();
  const visibleTotal = rows.reduce((s, r) => s + (r.intereses || 0), 0);
  const countEl = document.getElementById('planPisoCount');

  if (countEl) {
    countEl.textContent = q && total
      ? `${rows.length} de ${total} VIN · Total ${fmt.money(visibleTotal)}`
      : `${rows.length} VIN · Total ${fmt.money(visibleTotal)}`;
  }

  setTextSafe('planPisoSubtitle', planPisoPeriodKey === 'all'
    ? 'Acumulado a hoy por VIN (Físico). Intereses = 0.00020778 × importe de remisión × días desde el día 31 hasta hoy'
    : `Acumulado al corte de ${formatPlanPisoMonthLabel(planPisoPeriodKey)} por VIN (Físico). Total desde el día 31 hasta el cierre del mes seleccionado`);

  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${q ? 'Sin coincidencias para la búsqueda.' : `Sin cargos de Plan Piso en ${planPisoPeriodLabel}.`}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="plan-piso-vin" title="${r.serie || ''}"><strong>${r.serie || '—'}</strong></td>
      <td class="plan-piso-modelo" title="${r.tipoAuto || ''}">${r.tipoAuto || '—'}</td>
      <td class="cell-num plan-piso-days">${r.daysInStock ?? '—'}</td>
      <td class="cell-num plan-piso-days">${r.daysChargeable}</td>
      <td class="cell-money plan-piso-money">${fmt.money(r.importeRemision)}</td>
      <td class="cell-money plan-piso-money plan-piso-interes"><strong>${fmt.money(r.intereses)}</strong></td>
    </tr>
  `).join('');
}

function setTextSafe(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getInventorySearchTerm() {
  return document.getElementById('buscarInventario')?.value || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dash(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function isSofiaKpi(kpiId) {
  return kpiId === 'entregasSinPrevias';
}

function rowsForAutosKpi(kpiId) {
  if (kpiId === 'available') {
    return inventoryRows.filter((r) => r.situacion === 'DIS' || r.situacion === 'FIS' || r.situacion === 'SEP');
  }
  if (kpiId === 'sinPrevias') {
    return inventoryRows.filter((r) => Number(r.previas || 0) === 0);
  }
  if (kpiId === 'ageing') {
    return inventoryRows.filter((r) => r.situacion === 'FIS' && Number(r.daysInStock || 0) >= 60);
  }
  if (kpiId === 'entregasSinPrevias') {
    return (window.__invSofiaSinPrevias || []).slice();
  }
  return inventoryRows;
}

function autosKpiMeta(kpiId) {
  if (kpiId === 'available') {
    return {
      title: 'Disponibles',
      hint: 'FIS, DIS y Apartadas (SEP) · las apartadas muestran días y quién las apartó',
      scopeLabel: 'disponibles',
      icon: 'check_circle',
      card: () => document.getElementById('kpiAvailableUnits'),
    };
  }
  if (kpiId === 'sinPrevias') {
    return {
      title: 'Sin previas (stock)',
      hint: 'Unidades sin órdenes de servicio que empiecen con S · Previas = 0',
      scopeLabel: 'sin previas',
      icon: 'visibility_off',
      card: () => document.getElementById('kpiSinPrevias'),
    };
  }
  if (kpiId === 'entregasSinPrevias') {
    const range = currentMonthRange();
    return {
      title: 'Entregas sin previa',
      hint: `Entregas SOFIA del mes (${range.label}) sin órdenes de previa`,
      scopeLabel: 'entregas',
      icon: 'no_photography',
      card: () => document.getElementById('kpiEntregasSinPrevias'),
    };
  }
  if (kpiId === 'ageing') {
    return {
      title: 'Unidades envejecidas',
      hint: 'Unidades en Físico (FIS) con 60 o más días desde remisión',
      scopeLabel: 'envejecidas',
      icon: 'warning',
      card: () => document.getElementById('kpiAgeingAlerts'),
    };
  }
  return {
    title: 'Unidades totales',
    hint: 'Todas las situaciones · las apartadas (SEP) muestran días y quién las apartó',
    scopeLabel: 'unidades',
    icon: 'directions_car',
    card: () => document.getElementById('kpiTotalUnits'),
  };
}

function countByField(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const label = keyFn(r) || 'Sin dato';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function downloadAutosKpiCsv(rows, title, kpi) {
  const safeName = String(title || 'inventario').replace(/[^\w\-]+/g, '_').slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 10);
  let headers;
  let lines;
  if (isSofiaKpi(kpi)) {
    headers = ['Fecha', 'Registro', 'Hora', 'Factura', 'VIN', 'Previas', 'Cliente', 'Estatus', 'Usuario'];
    lines = rows.map((r) => [
      r.FECHA_PERIODO || r.SOF_FechFact || '',
      r.SOF_FechAct || '',
      r.SOF_HoraAct || '',
      r.SOF_Factura || '',
      r.SOF_VIN || '',
      Number(r.PREVIAS || 0),
      r.CLIENTE || '',
      r.SOF_Estatus || '',
      r.SOF_CveUSu || '',
    ]);
  } else {
    headers = [
      'Modelo', 'Familia', 'Serie', 'Previas', 'Ubicación', 'Situación',
      'Días stock', 'Días aparte', 'Apartó', 'Status', 'Color', 'Año',
    ];
    lines = rows.map((r) => [
      r.tipoAuto || '',
      r.familia || '',
      r.serie || '',
      Number(r.previas || 0),
      r.ubicacion || '',
      r.situacionLabel || r.situacion || '',
      r.daysInStock ?? '',
      r.daysApartado ?? '',
      r.apartadoPor || r.usuarioApartado || '',
      r.status || '',
      r.colorExterior || '',
      r.anModelo || '',
    ]);
  }
  const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escapeCell).join(',')]
    .concat(lines.map((row) => row.map(escapeCell).join(',')))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function syncAutosKpiCards() {
  document.querySelectorAll('[data-autos-kpi]').forEach((btn) => {
    const open = activeAutosKpi === btn.dataset.autosKpi;
    btn.classList.toggle('is-selected', open);
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

function ensureAutosKpiDrawer() {
  if (autosDrawerUi) return autosDrawerUi;

  const backdrop = document.createElement('div');
  backdrop.className = 'ops-orders-backdrop';
  backdrop.id = 'autosKpiBackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'ops-orders-drawer';
  panel.id = 'autosKpiDrawer';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Detalle de inventario');
  panel.innerHTML = `
    <div class="ops-orders-drawer__header">
      <div class="ops-orders-drawer__title-wrap">
        <span class="material-symbols-outlined ops-orders-drawer__logo" data-autos-kpi-logo>directions_car</span>
        <div>
          <h2 class="ops-orders-drawer__title" data-autos-kpi-title>Detalle de inventario</h2>
          <span class="ops-orders-drawer__status" data-autos-kpi-status>0 unidades</span>
        </div>
      </div>
      <div class="ops-orders-drawer__actions">
        <button type="button" class="ops-orders-drawer__icon-btn" data-autos-kpi-download title="Descargar CSV" aria-label="Descargar CSV">
          <span class="material-symbols-outlined">download</span>
        </button>
        <button type="button" class="ops-orders-drawer__icon-btn" data-autos-kpi-expand title="Expandir" aria-label="Expandir panel">
          <span class="material-symbols-outlined" data-autos-kpi-expand-icon>open_in_full</span>
        </button>
        <button type="button" class="ops-orders-drawer__icon-btn" data-autos-kpi-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="ops-orders-drawer__toolbar">
      <label class="ops-orders-drawer__search" for="autosKpiSearch">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input id="autosKpiSearch" type="search" placeholder="Buscar modelo, serie, ubicación..." autocomplete="off"/>
      </label>
      <button type="button" class="ops-orders-drawer__filter-chip" data-autos-kpi-filter-chip hidden title="Quitar filtro"></button>
      <span class="ops-orders-drawer__meta" data-autos-kpi-meta></span>
    </div>
    <div class="ops-orders-drawer__main">
      <aside class="ops-orders-drawer__summary custom-scrollbar" data-autos-kpi-summary></aside>
      <div class="ops-orders-drawer__body custom-scrollbar" data-autos-kpi-body></div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  const statusEl = panel.querySelector('[data-autos-kpi-status]');
  const metaEl = panel.querySelector('[data-autos-kpi-meta]');
  const bodyEl = panel.querySelector('[data-autos-kpi-body]');
  const summaryEl = panel.querySelector('[data-autos-kpi-summary]');
  const searchEl = panel.querySelector('#autosKpiSearch');
  const filterChip = panel.querySelector('[data-autos-kpi-filter-chip]');
  const expandBtn = panel.querySelector('[data-autos-kpi-expand]');
  const expandIcon = panel.querySelector('[data-autos-kpi-expand-icon]');
  const downloadBtn = panel.querySelector('[data-autos-kpi-download]');
  const titleEl = panel.querySelector('[data-autos-kpi-title]');
  const logoEl = panel.querySelector('[data-autos-kpi-logo]');

  let expanded = false;
  let activeFilter = null;
  let sourceRows = [];
  let lastExportRows = [];
  let currentMeta = { kpi: '', title: 'Inventario', hint: '', icon: 'directions_car' };
  let lastCard = null;

  const FILTER_DIM_LABEL = {
    situacion: 'Situación',
    familia: 'Familia',
    modelo: 'Modelo',
    ubicacion: 'Ubicación',
    estatus: 'Estatus',
    usuario: 'Usuario',
  };

  function placeNearKpi(card) {
    if (expanded) return;
    const kpiBlock = document.getElementById('autosKpiGrid');
    const ref = card || kpiBlock;
    const rect = ref?.getBoundingClientRect?.();
    let top = 96;
    if (rect) top = Math.round(rect.bottom + 12);
    top = Math.max(72, Math.min(top, Math.round(window.innerHeight * 0.28)));
    const maxHeight = Math.max(360, window.innerHeight - top - 24);
    panel.style.top = `${top}px`;
    panel.style.right = window.innerWidth < 640 ? '12px' : '28px';
    panel.style.left = window.innerWidth < 640 ? '12px' : 'auto';
    panel.style.bottom = 'auto';
    panel.style.height = `${Math.min(680, maxHeight)}px`;
  }

  function clearPlacement() {
    panel.style.top = '';
    panel.style.right = '';
    panel.style.left = '';
    panel.style.bottom = '';
    panel.style.height = '';
  }

  function setExpanded(next) {
    expanded = Boolean(next);
    panel.classList.toggle('ops-orders-drawer--expanded', expanded);
    if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
    if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
    if (expanded) clearPlacement();
    else if (panel.classList.contains('ops-orders-drawer--open')) placeNearKpi(lastCard);
  }

  function updateFilterChip() {
    if (!filterChip) return;
    if (!activeFilter) {
      filterChip.hidden = true;
      filterChip.textContent = '';
      return;
    }
    filterChip.hidden = false;
    filterChip.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
      ${escapeHtml(FILTER_DIM_LABEL[activeFilter.dim] || activeFilter.dim)}: ${escapeHtml(activeFilter.label || activeFilter.value)}
      <span class="material-symbols-outlined" aria-hidden="true">close</span>`;
  }

  function matchesActiveFilter(r) {
    if (!activeFilter) return true;
    if (isSofiaKpi(currentMeta.kpi)) {
      if (activeFilter.dim === 'estatus') return String(r.SOF_Estatus || 'Sin estatus') === activeFilter.value;
      if (activeFilter.dim === 'usuario') return String(r.SOF_CveUSu || 'Sin usuario') === activeFilter.value;
      return true;
    }
    if (activeFilter.dim === 'situacion') return String(r.situacion || '') === activeFilter.value;
    if (activeFilter.dim === 'familia') return String(r.familia || 'Sin familia') === activeFilter.value;
    if (activeFilter.dim === 'modelo') return String(r.tipoAuto || 'Sin modelo') === activeFilter.value;
    if (activeFilter.dim === 'ubicacion') return String(r.ubicacion || 'Sin ubicación') === activeFilter.value;
    return true;
  }

  function setFilter(dim, value, label) {
    if (activeFilter && activeFilter.dim === dim && activeFilter.value === value) {
      activeFilter = null;
      autosKpiFilter = null;
    } else {
      activeFilter = { dim, value, label: label || value };
      if (!isSofiaKpi(currentMeta.kpi) && (dim === 'situacion' || dim === 'familia' || dim === 'modelo')) {
        autosKpiFilter = { kpi: currentMeta.kpi, dim, id: value, label: label || value };
      } else {
        autosKpiFilter = null;
      }
    }
    updateFilterChip();
    renderList(searchEl?.value || '');
    applyAutosKpiTableFilter();
  }

  function clearFilter() {
    activeFilter = null;
    autosKpiFilter = null;
    updateFilterChip();
    renderList(searchEl?.value || '');
    applyAutosKpiTableFilter();
  }

  function renderSummary(rows) {
    const isActive = (dim, value) => activeFilter && activeFilter.dim === dim && activeFilter.value === value;
    const block = (titulo, dim, items, valueKey = 'label') => `
      <div class="ops-orders-drawer__group">
        <h5>${escapeHtml(titulo)}</h5>
        ${items.length
          ? items.map((x) => `
            <button type="button"
              class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x[valueKey]) ? ' is-active' : ''}"
              data-autos-filter-dim="${escapeHtml(dim)}"
              data-autos-filter-value="${escapeHtml(x[valueKey])}"
              data-autos-filter-label="${escapeHtml(x.label)}"
              title="Filtrar por ${escapeHtml(x.label)}">
              <span class="lbl">${escapeHtml(x.label)}</span>
              <span class="val">${Number(x.value).toLocaleString('es-MX')}</span>
            </button>`).join('')
          : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
      </div>`;

    if (isSofiaKpi(currentMeta.kpi)) {
      const porEstatus = countByField(rows, (r) => r.SOF_Estatus || 'Sin estatus').slice(0, 10);
      const porUsuario = countByField(rows, (r) => r.SOF_CveUSu || 'Sin usuario').slice(0, 10);
      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Entregas</span><span class="val">${rows.length.toLocaleString('es-MX')}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">SOFIA mes</span><span class="val">${Number(window.__invSofiaTotalMes || 0).toLocaleString('es-MX')}</span></div>
          <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
        </div>
        ${block('Por estatus', 'estatus', porEstatus)}
        ${block('Por usuario', 'usuario', porUsuario)}
      `;
      return;
    }

    const porSituacion = countByField(rows, (r) => r.situacion || 'OTRO')
      .map((x) => {
        const sample = rows.find((r) => (r.situacion || 'OTRO') === x.label);
        return {
          label: sample?.situacionLabel || x.label,
          value: x.value,
          id: x.label,
        };
      })
      .slice(0, 12);
    const porFamilia = countByField(rows, (r) => r.familia || 'Sin familia').slice(0, 10);
    const porModelo = countByField(rows, (r) => r.tipoAuto || 'Sin modelo').slice(0, 10);
    const apartadas = rows.filter((r) => r.isApartada || r.situacion === 'SEP').length;
    const libres = rows.filter((r) => r.situacion === 'FIS' || r.situacion === 'DIS').length;

    const situacionBlock = `
      <div class="ops-orders-drawer__group">
        <h5>Por situación</h5>
        ${porSituacion.length
          ? porSituacion.map((x) => `
            <button type="button"
              class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive('situacion', x.id) ? ' is-active' : ''}"
              data-autos-filter-dim="situacion"
              data-autos-filter-value="${escapeHtml(x.id)}"
              data-autos-filter-label="${escapeHtml(x.label)}"
              title="Filtrar por ${escapeHtml(x.label)}">
              <span class="lbl">${escapeHtml(x.label)}</span>
              <span class="val">${Number(x.value).toLocaleString('es-MX')}</span>
            </button>`).join('')
          : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
      </div>`;

    summaryEl.innerHTML = `
      <div class="ops-orders-drawer__group">
        <h5>Resumen</h5>
        <div class="ops-orders-drawer__row"><span class="lbl">Unidades</span><span class="val">${rows.length.toLocaleString('es-MX')}</span></div>
        ${currentMeta.kpi === 'available' || currentMeta.kpi === 'total' ? `
          <div class="ops-orders-drawer__row"><span class="lbl">Libres FIS/DIS</span><span class="val">${libres.toLocaleString('es-MX')}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Apartadas</span><span class="val">${apartadas.toLocaleString('es-MX')}</span></div>
        ` : ''}
        <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
      </div>
      ${situacionBlock}
      ${block('Por familia', 'familia', porFamilia)}
      ${block('Por modelo', 'modelo', porModelo)}
    `;
  }

  function renderList(term = '') {
    const q = String(term || '').trim().toLowerCase();
    const sofia = isSofiaKpi(currentMeta.kpi);

    const searched = !q
      ? sourceRows
      : sourceRows.filter((r) => {
        const fields = sofia
          ? [r.FECHA_PERIODO, r.SOF_FechAct, r.SOF_HoraAct, r.SOF_Factura, r.SOF_VIN, r.CLIENTE, r.SOF_Estatus, r.SOF_CveUSu, r.PREVIAS]
          : [
            r.tipoAuto, r.familia, r.anModelo, r.serie, r.motor, r.noInventario,
            r.colorExterior, r.ubicacion, r.situacion, r.situacionLabel,
            r.catalogo, r.status, r.apartadoPor, r.usuarioApartado, r.previas,
          ];
        return fields.some((v) => String(v || '').toLowerCase().includes(q));
      });

    const filtered = searched.filter(matchesActiveFilter);
    lastExportRows = filtered;

    statusEl.textContent = sofia
      ? `${filtered.length.toLocaleString('es-MX')} entrega(s)`
      : `${filtered.length.toLocaleString('es-MX')} unidad(es)`;
    metaEl.textContent = activeFilter || q
      ? `${filtered.length} de ${sourceRows.length}`
      : `${sourceRows.length} registros`;

    renderSummary(searched);
    updateFilterChip();

    if (!filtered.length) {
      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__empty">
          <span class="material-symbols-outlined">inbox</span>
          <p>${activeFilter || q
            ? 'Sin coincidencias con el filtro actual.'
            : (sofia ? 'No hay entregas SOFIA sin previa en el mes.' : 'No hay unidades para este indicador.')}</p>
        </div>`;
      return;
    }

    if (sofia) {
      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <h5>Entregas SOFIA</h5>
          <span>${filtered.length.toLocaleString('es-MX')}</span>
        </div>
        ${filtered.map((r) => `
          <div class="ops-orders-drawer__item" style="cursor:default">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(dash(r.SOF_Factura))}</strong>
              <span class="ops-orders-drawer__tag">${escapeHtml(dash(r.SOF_Estatus))}</span>
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.CLIENTE))} · VIN ${escapeHtml(dash(r.SOF_VIN))}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(dash(r.FECHA_PERIODO ?? r.SOF_FechFact))}</span>
              <span>Previas ${Number(r.PREVIAS || 0)}</span>
              <span>${escapeHtml(dash(r.SOF_CveUSu))}</span>
            </div>
          </div>`).join('')}`;
      return;
    }

    bodyEl.innerHTML = `
      <div class="ops-orders-drawer__list-head">
        <h5>Detalle de unidades</h5>
        <span>${filtered.length.toLocaleString('es-MX')}</span>
      </div>
      ${filtered.map((r) => {
        const apartada = r.isApartada || r.situacion === 'SEP';
        return `
          <div class="ops-orders-drawer__item" style="cursor:default">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(dash(r.tipoAuto))}</strong>
              <span class="ops-orders-drawer__tag">${escapeHtml(dash(r.situacionLabel || r.situacion))}</span>
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.familia))} · Serie ${escapeHtml(dash(r.serie))}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(dash(r.ubicacion))}</span>
              <span>${r.daysInStock != null ? `${r.daysInStock} días` : '—'}</span>
              <span>Previas ${Number(r.previas || 0)}</span>
            </div>
            <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
              <span>${escapeHtml(dash(r.colorExterior))}</span>
              <span>${apartada ? `${r.daysApartado ?? '—'} d. aparte` : escapeHtml(dash(r.status))}</span>
              <span>${apartada ? escapeHtml(dash(r.apartadoPor || r.usuarioApartado)) : escapeHtml(dash(r.anModelo))}</span>
            </div>
          </div>`;
      }).join('')}`;
  }

  function close() {
    panel.classList.remove('ops-orders-drawer--open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('ops-orders-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ops-orders-drawer-open');
    expanded = false;
    panel.classList.remove('ops-orders-drawer--expanded');
    if (expandIcon) expandIcon.textContent = 'open_in_full';
    if (expandBtn) expandBtn.title = 'Expandir';
    clearPlacement();
    activeFilter = null;
    lastCard = null;
    activeAutosKpi = null;
    autosKpiFilter = null;
    syncAutosKpiCards();
    applyAutosKpiTableFilter();
  }

  function open(kpiKey, card) {
    const meta = autosKpiMeta(kpiKey);
    const resolvedCard = card || meta.card?.() || null;

    if (activeAutosKpi === kpiKey && panel.classList.contains('ops-orders-drawer--open')) {
      close();
      return;
    }

    currentMeta = {
      kpi: kpiKey,
      title: meta.title,
      hint: meta.hint,
      icon: meta.icon || 'directions_car',
    };
    lastCard = resolvedCard;
    activeAutosKpi = kpiKey;
    autosKpiFilter = null;
    activeFilter = null;

    if (titleEl) titleEl.textContent = currentMeta.title;
    if (logoEl) logoEl.textContent = currentMeta.icon;
    panel.setAttribute('aria-label', currentMeta.title);
    if (searchEl) {
      searchEl.placeholder = isSofiaKpi(kpiKey)
        ? 'Buscar factura, VIN, cliente...'
        : 'Buscar modelo, serie, ubicación...';
      searchEl.value = '';
    }

    sourceRows = rowsForAutosKpi(kpiKey).slice();
    updateFilterChip();
    placeNearKpi(resolvedCard);
    setExpanded(true);
    renderList('');
    panel.classList.add('ops-orders-drawer--open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('ops-orders-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ops-orders-drawer-open');
    syncAutosKpiCards();
    applyAutosKpiTableFilter();
    window.setTimeout(() => searchEl?.focus({ preventScroll: true }), 180);
  }

  backdrop.addEventListener('click', close);
  panel.querySelector('[data-autos-kpi-close]')?.addEventListener('click', close);
  expandBtn?.addEventListener('click', () => setExpanded(!expanded));
  downloadBtn?.addEventListener('click', () => {
    if (!lastExportRows.length) {
      window.alert('No hay registros para descargar.');
      return;
    }
    downloadAutosKpiCsv(lastExportRows, currentMeta.title, currentMeta.kpi);
  });
  searchEl?.addEventListener('input', () => renderList(searchEl.value));
  filterChip?.addEventListener('click', clearFilter);
  summaryEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-autos-filter-dim]');
    if (!btn || !summaryEl.contains(btn)) return;
    setFilter(
      btn.dataset.autosFilterDim,
      btn.dataset.autosFilterValue,
      btn.dataset.autosFilterLabel || btn.dataset.autosFilterValue
    );
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('ops-orders-drawer--open')) close();
  });

  autosDrawerUi = {
    open,
    close,
    panel,
    refresh() {
      if (!panel.classList.contains('ops-orders-drawer--open') || !currentMeta.kpi) return;
      sourceRows = rowsForAutosKpi(currentMeta.kpi).slice();
      renderList(searchEl?.value || '');
    },
  };
  return autosDrawerUi;
}

function setActiveAutosKpi(kpiId) {
  ensureAutosKpiDrawer().open(kpiId, autosKpiMeta(kpiId).card?.() || null);
}

function applyAutosKpiTableFilter() {
  const term = getInventorySearchTerm();
  renderTable(filterRows(term), { searchTerm: term });
}

function filterRows(term) {
  let rows = inventoryRows.slice();

  if (activeAutosKpi === 'available') {
    rows = rows.filter((r) => r.situacion === 'DIS' || r.situacion === 'FIS' || r.situacion === 'SEP');
  }
  if (activeAutosKpi === 'sinPrevias') {
    rows = rows.filter((r) => Number(r.previas || 0) === 0);
  }
  if (activeAutosKpi === 'ageing') {
    rows = rows.filter((r) => r.situacion === 'FIS' && Number(r.daysInStock || 0) >= 60);
  }

  if (autosKpiFilter?.kpi === activeAutosKpi) {
    const { dim, id } = autosKpiFilter;
    if (dim === 'situacion') rows = rows.filter((r) => (r.situacion || '') === id);
    if (dim === 'familia') rows = rows.filter((r) => (r.familia || 'Sin familia') === id);
    if (dim === 'modelo') rows = rows.filter((r) => (r.tipoAuto || 'Sin modelo') === id);
  }

  const q = term.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [
      r.tipoAuto, r.familia, r.anModelo, r.serie, r.motor, r.noInventario,
      r.colorExterior, r.colorInterior, r.ubicacion, r.situacion, r.situacionLabel,
      r.catalogo, r.observacion, r.status, r.apartadoPor, r.usuarioApartado, r.previas,
    ].some((val) => String(val || '').toLowerCase().includes(q))
  );
}

function renderTable(rows, { searchTerm = '' } = {}) {
  const { fmt, statusBadge } = Dashboard;
  const body = document.getElementById('inventoryTable');
  if (!body) return;
  const total = inventoryRows.length;
  const q = searchTerm.trim();
  const countEl = document.getElementById('tableCount');
  const filteredBase = activeAutosKpi
    ? rowsForAutosKpi(activeAutosKpi).length
    : total;

  if (countEl) {
    const scopeLabel = autosKpiMeta(activeAutosKpi || 'total').scopeLabel;
    countEl.textContent = (q || autosKpiFilter)
      ? `${rows.length} de ${filteredBase} ${scopeLabel}`
      : `${rows.length} ${scopeLabel}`;
  }

  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="14">${q ? 'Sin coincidencias para la búsqueda.' : 'No hay unidades en inventario.'}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r) => {
    const apartada = r.isApartada || r.situacion === 'SEP';
    return `
    <tr class="${apartada ? 'row-apartada' : ''}">
      <td><strong>${r.tipoAuto || '—'}</strong></td>
      <td style="color:#64748b">${r.familia || '—'}</td>
      <td>${r.anModelo || '—'}</td>
      <td>${r.serie || '—'}</td>
      <td class="cell-num">${Number(r.previas || 0)}</td>
      <td>${r.noInventario ?? '—'}</td>
      <td>${r.colorExterior || '—'}</td>
      <td>${r.colorInterior || '—'}</td>
      <td>${r.ubicacion || '—'}</td>
      <td>
        <span class="badge-tipo${apartada ? ' badge-flotilla' : ''}">${r.situacionLabel}${apartada ? ' · Apartada' : ''}</span>
      </td>
      <td>${r.daysInStock !== null ? r.daysInStock : '—'}</td>
      <td class="cell-num">${apartada ? (r.daysApartado ?? '—') : '—'}</td>
      <td>${apartada ? (r.apartadoPor || '—') : '—'}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`;
  }).join('');
}

function renderAgeingSlowTable(rows) {
  const body = document.getElementById('ageingSlowBody');
  if (!body) return;

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-row">Sin datos de antigüedad en inventario.</td></tr>';
    return;
  }

  body.innerHTML = list.map((r) => {
    const carline = r.carline || (r.model ? String(r.model).split(' · ')[0] : '—');
    const version = r.version || (r.model ? String(r.model).split(' · ').slice(1).join(' · ') : '—') || '—';
    const color = r.color || '—';
    const avg = Number(r.avgDays || 0);
    const rowClass = r.critical || avg >= 90
      ? 'ageing-slow-row--critical'
      : (r.warn || avg >= 60 ? 'ageing-slow-row--warn' : '');
    return `<tr class="${rowClass}">
      <td class="ageing-slow-carline"><strong>${escapeHtml(carline)}</strong></td>
      <td class="ageing-slow-version" title="${escapeHtml(version)}"><span>${escapeHtml(version)}</span></td>
      <td class="ageing-slow-color" title="${escapeHtml(color)}">${escapeHtml(color)}</td>
      <td class="cell-num">${Number(r.units || 0).toLocaleString('es-MX')}</td>
      <td class="cell-num ageing-slow-avg"><strong>${avg.toLocaleString('es-MX')}</strong></td>
      <td class="cell-num">${Number(r.maxDays || avg || 0).toLocaleString('es-MX')}</td>
    </tr>`;
  }).join('');
}

function renderCharts(data) {
  const { chartOptions, chartPalette, chartColors } = Dashboard;
  const s = data.summary;

  renderAgeingSlowTable(data.ageingSlowTable || data.ageingChart || []);

  destroyChart(ageingChart);
  ageingChart = null;

  destroyChart(situacionChart);
  situacionChart = new Chart(document.getElementById('situacionChart'), {
    type: 'doughnut',
    data: {
      labels: (s.bySituacion || []).map((r) => r.label),
      datasets: [{
        data: (s.bySituacion || []).map((r) => r.units),
        backgroundColor: chartPalette,
        borderWidth: 0,
      }],
    },
    options: chartOptions({ plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }),
  });

  destroyChart(familiaChart);
  familiaChart = new Chart(document.getElementById('familiaChart'), {
    type: 'bar',
    data: {
      labels: (data.byFamilia || []).map((r) => r.label.slice(0, 16)),
      datasets: [{
        label: 'Unidades',
        data: (data.byFamilia || []).map((r) => r.units),
        backgroundColor: chartColors.secondary,
        borderRadius: 8,
      }],
    },
    options: chartOptions({ plugins: { legend: { display: false } } }),
  });
}

async function loadInventory({ onlyPlanPiso = false } = {}) {
  const { fmt, api, showLoading, setText } = Dashboard;
  const status = document.getElementById('statusBadge');
  const period = getPlanPisoPeriod();
  status.textContent = 'Consultando...';
  status.className = 'sidebar-status-line status-loading';
  showLoading(true);

  try {
    const data = await api(`/inventory?planPisoPeriod=${encodeURIComponent(period)}`);
    const s = data.summary;

    populatePlanPisoPeriod(data.planPisoMonths || [], s.planPisoPeriod || period);

    setText('sPlanPiso', fmt.currency(s.planPisoTotal || 0));
    setText(
      'sPlanPisoSub',
      `${fmt.number(s.planPisoUnits || 0)} VIN · ${s.planPisoPeriodLabel || 'Todo (acumulado)'}`
    );
    planPisoRows = data.planPisoTable || [];
    planPisoPeriodKey = s.planPisoPeriod || period;
    planPisoPeriodLabel = s.planPisoPeriodLabel
      || (planPisoPeriodKey === 'all'
        ? 'Todo (acumulado a hoy)'
        : `Acumulado al corte · ${formatPlanPisoMonthLabel(planPisoPeriodKey)}`);
    renderPlanPiso(filterPlanPisoRows(getPlanPisoSearchTerm()), { searchTerm: getPlanPisoSearchTerm() });

    if (!onlyPlanPiso || !chartsReady) {
      inventoryRows = data.inventoryTable || [];
      setText('sTotal', fmt.number(s.totalUnits));
      setText('sAvail', fmt.number(s.available));
      setText(
        'sAvailSub',
        `${fmt.number(s.availableLibres ?? 0)} libres · ${fmt.number(s.availableApartadas ?? 0)} apartadas`
      );
      setText('sSinPrevias', fmt.number(s.sinPrevias ?? inventoryRows.filter((r) => Number(r.previas || 0) === 0).length));
      setText(
        'sSinPreviasSub',
        `${fmt.number(s.conPrevias ?? inventoryRows.filter((r) => Number(r.previas || 0) > 0).length)} con previas`
      );
      setText('sDays', `${s.avgDaysAvailable} días`);
      setText('sAlerts', fmt.number(s.ageingAlertsCount ?? s.urgentAlerts ?? 0));
      setText('sAlertsSub', `Físico · Plan Piso ${fmt.currency(s.ageingAlertsPlanPisoTotal || 0)}`);
      setText('urgentBadge', `${s.ageingAlertsCount || 0} FÍSICO`);
      setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
      renderAlerts(data.stockAlerts || [], s.ageingAlertsPlanPisoTotal || 0);
      renderTable(filterRows(getInventorySearchTerm()), { searchTerm: getInventorySearchTerm() });
      renderCharts(data);
      chartsReady = true;
      if (activeAutosKpi) {
        syncAutosKpiCards();
        ensureAutosKpiDrawer().refresh();
      }
      status.textContent = `${s.totalUnits} unidades en inventario`;
    } else {
      setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
      status.textContent = `Plan Piso · ${s.planPisoPeriodLabel}`;
    }

    status.className = 'sidebar-status-line';

    await loadEntregasSinPreviasMes();

    if (window.KpiInsights?.apply) {
      window.KpiInsights.apply('inventory', {
        planPisoPeriod: period,
        summary: {
          totalUnits: s.totalUnits,
          available: s.available,
          availableLibres: s.availableLibres,
          availableApartadas: s.availableApartadas,
          sinPrevias: s.sinPrevias,
          conPrevias: s.conPrevias,
          avgDaysAvailable: s.avgDaysAvailable,
          ageingAlertsCount: s.ageingAlertsCount ?? s.urgentAlerts,
          ageingAlertsPlanPisoTotal: s.ageingAlertsPlanPisoTotal,
          planPisoTotal: s.planPisoTotal,
          planPisoUnits: s.planPisoUnits,
          planPisoPeriodLabel: s.planPisoPeriodLabel,
          entregasSinPreviasSofia: (window.__invSofiaSinPrevias || []).length,
          entregasSofiaMes: Number(window.__invSofiaTotalMes || 0),
        },
      });
    }
  } catch (err) {
    status.textContent = err.message;
    status.className = 'sidebar-status-line status-error';
  } finally {
    showLoading(false);
  }
}

function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    fechaInicio: `${y}-${m}-01`,
    fechaFin: `${y}-${m}-${String(last).padStart(2, '0')}`,
    label: formatPlanPisoMonthLabel(`${y}-${m}`),
  };
}

async function loadEntregasSinPreviasMes() {
  const { api, setText, fmt } = Dashboard;
  const range = currentMonthRange();
  try {
    const data = await api(`/ventas?fechaInicio=${range.fechaInicio}&fechaFin=${range.fechaFin}`);
    const entregas = data.entregasSofia || [];
    const sinPrevias = entregas.filter((r) => Number(r.PREVIAS || 0) === 0);
    window.__invSofiaSinPrevias = sinPrevias;
    window.__invSofiaTotalMes = entregas.length;
    const conPrevias = entregas.length - sinPrevias.length;
    setText('sEntregasSinPrevias', fmt.number(sinPrevias.length));
    setText('sEntregasSinPreviasSub', `${fmt.number(conPrevias)} con previas · ${range.label}`);
    if (activeAutosKpi === 'entregasSinPrevias') ensureAutosKpiDrawer().refresh();
  } catch (err) {
    console.warn('[Inventario] Entregas sin previa:', err.message);
    window.__invSofiaSinPrevias = [];
    window.__invSofiaTotalMes = 0;
    setText('sEntregasSinPrevias', '—');
    setText('sEntregasSinPreviasSub', 'No se pudo cargar SOFIA del mes');
    if (activeAutosKpi === 'entregasSinPrevias') ensureAutosKpiDrawer().refresh();
  }
}

document.getElementById('buscarInventario')?.addEventListener('input', (e) => {
  const term = e.target.value;
  renderTable(filterRows(term), { searchTerm: term });
});

document.getElementById('buscarPlanPiso')?.addEventListener('input', (e) => {
  const term = e.target.value;
  renderPlanPiso(filterPlanPisoRows(term), { searchTerm: term });
});

document.getElementById('planPisoPeriod')?.addEventListener('change', (e) => {
  planPisoSelectedPeriod = e.target.value;
  renderPlanPisoKpiMenu(e.target.value);
  loadInventory({ onlyPlanPiso: true });
});

function setInventoryScope(scope) {
  inventoryScope = scope === 'postventa' ? 'postventa' : 'autos';
  if (inventoryScope !== 'autos' && autosDrawerUi?.panel?.classList.contains('ops-orders-drawer--open')) {
    autosDrawerUi.close();
  }
  document.querySelectorAll('#inventoryMainTabs .eeff-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.inventoryScope === inventoryScope);
  });
  document.getElementById('panelInventarioAutos')?.classList.toggle('hidden', inventoryScope !== 'autos');
  document.getElementById('panelInventarioPostventa')?.classList.toggle('hidden', inventoryScope !== 'postventa');

  const title = document.querySelector('.top-bar-title');
  if (title) {
    title.textContent = inventoryScope === 'postventa'
      ? 'Inventario · Postventa'
      : 'Gestión de Inventario';
  }

  if (inventoryScope === 'postventa') {
    loadInventoryPostventa();
  }
}

function setPostventaArea(area) {
  postventaArea = ['servicio', 'refacciones', 'hyp'].includes(area) ? area : 'servicio';
  document.querySelectorAll('#inventoryPvTabs .eeff-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.pvArea === postventaArea);
  });
  renderPostventaArea();
}

function renderPostventaOverview(data) {
  const { fmt, setText } = Dashboard;
  const ov = data?.overview || {};
  const servicio = ov.servicio || {};
  const refacciones = ov.refacciones || {};
  const hyp = ov.hyp || {};

  setText('pvKpiServicio', fmt.currency(servicio.costoProceso || 0));
  setText('pvKpiServicioSub', `${fmt.number(servicio.lineas || 0)} líneas · ${fmt.number(servicio.proceso || 0)} pzas`);
  setText('pvKpiRefacciones', fmt.currency(refacciones.costo || 0));
  setText('pvKpiRefaccionesSub', `${fmt.number(refacciones.lineas || 0)} líneas · ${fmt.number(refacciones.existencia || 0)} pzas`);
  setText('pvKpiHyp', fmt.currency(hyp.costo || 0));
  setText('pvKpiHypSub', `${fmt.number(hyp.lineas || 0)} líneas · ${fmt.number(hyp.existencia || 0)} pzas`);
  setText('pvKpiTotal', fmt.currency(ov.totalCosto || 0));
}

function getPostventaSearchTerm() {
  return document.getElementById('buscarPostventaInv')?.value || '';
}

function currentPostventaArea() {
  return postventaData?.areas?.[postventaArea] || null;
}

function filterPostventaDetalle(rows, term) {
  const q = term.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.parte, r.descripcion, r.almacen, r.grupo, r.grupoLabel]
      .some((v) => String(v || '').toLowerCase().includes(q))
  );
}

function renderPostventaArea() {
  const { fmt } = Dashboard;
  const area = currentPostventaArea();
  const titleEl = document.getElementById('pvAreaTitle');
  const subEl = document.getElementById('pvAreaSubtitle');
  const qtyLabel = document.getElementById('pvAreaQtyLabel');
  const costoLabel = document.getElementById('pvAreaCostoLabel');

  if (!area) {
    if (titleEl) titleEl.textContent = 'Postventa';
    if (subEl) subEl.textContent = 'Sin datos';
    ['pvByAlmacen', 'pvByGrupo', 'pvDetalleTable'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<tr class="empty-row"><td colspan="8">Sin datos de inventario Postventa.</td></tr>';
    });
    return;
  }

  if (titleEl) titleEl.textContent = area.label;
  if (subEl) subEl.textContent = area.description || '';

  const isServicio = postventaArea === 'servicio';
  if (qtyLabel) qtyLabel.textContent = isServicio ? 'En proceso' : 'Existencia';
  if (costoLabel) costoLabel.textContent = isServicio ? 'Costo proceso' : 'Costo stock';

  const s = area.summary || {};
  Dashboard.setText('pvAreaLineas', fmt.number(s.lineas || 0));
  Dashboard.setText('pvAreaQty', fmt.number(isServicio ? (s.proceso || 0) : (s.existencia || 0)));
  Dashboard.setText('pvAreaCosto', fmt.currency(isServicio ? (s.costoProceso || 0) : (s.costo || 0)));

  const qtyKey = isServicio ? 'proceso' : 'existencia';
  const costoKey = isServicio ? 'costoProceso' : 'costo';

  const byAlmacen = document.getElementById('pvByAlmacen');
  if (byAlmacen) {
    byAlmacen.innerHTML = (area.byAlmacen || []).length
      ? area.byAlmacen.map((r) => `
        <tr>
          <td><strong>${r.label}</strong></td>
          <td class="cell-num">${fmt.number(r.lineas)}</td>
          <td class="cell-num">${fmt.number(r[qtyKey] || 0)}</td>
          <td class="cell-money">${fmt.money(r[costoKey] || 0)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="4">Sin desglose por almacén.</td></tr>';
  }

  const byGrupo = document.getElementById('pvByGrupo');
  if (byGrupo) {
    byGrupo.innerHTML = (area.byGrupo || []).length
      ? area.byGrupo.map((r) => `
        <tr>
          <td><strong>${r.label}</strong></td>
          <td class="cell-num">${fmt.number(r.lineas)}</td>
          <td class="cell-num">${fmt.number(r[qtyKey] || 0)}</td>
          <td class="cell-money">${fmt.money(r[costoKey] || 0)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="4">Sin desglose por grupo.</td></tr>';
  }

  const term = getPostventaSearchTerm();
  const detalle = filterPostventaDetalle(area.detalle || [], term);
  const countEl = document.getElementById('pvTableCount');
  if (countEl) {
    const total = area.totalDetalle || (area.detalle || []).length;
    countEl.textContent = term
      ? `${detalle.length} de ${total} líneas`
      : `${Math.min(detalle.length, total)} de ${total} líneas`;
  }

  const body = document.getElementById('pvDetalleTable');
  if (!body) return;
  if (!detalle.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${term ? 'Sin coincidencias.' : 'Sin líneas en esta área.'}</td></tr>`;
    return;
  }

  body.innerHTML = detalle.map((r) => `
    <tr>
      <td><strong>${r.parte || '—'}</strong></td>
      <td>${r.descripcion || '—'}</td>
      <td>${r.almacen || '—'}</td>
      <td>${r.grupoLabel || r.grupo || '—'}</td>
      <td class="cell-num">${fmt.number(r.existencia || 0)}</td>
      <td class="cell-num">${fmt.number(r.proceso || 0)}</td>
      <td class="cell-money">${fmt.money(r.costoPromedio || 0)}</td>
      <td class="cell-money"><strong>${fmt.money(isServicio ? (r.costoProceso || 0) : (r.costo || 0))}</strong></td>
    </tr>
  `).join('');
}

async function loadInventoryPostventa({ force = false } = {}) {
  if (postventaLoaded && postventaData && !force) {
    renderPostventaOverview(postventaData);
    renderPostventaArea();
    return;
  }

  const { api, showLoading, setText } = Dashboard;
  const status = document.getElementById('statusBadge');
  status.textContent = 'Consultando Postventa...';
  status.className = 'sidebar-status-line status-loading';
  showLoading(true);

  try {
    postventaData = await api('/inventory/postventa');
    postventaLoaded = true;
    renderPostventaOverview(postventaData);
    renderPostventaArea();
    setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
    status.textContent = 'Inventario Postventa';
    status.className = 'sidebar-status-line';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'sidebar-status-line status-error';
  } finally {
    showLoading(false);
  }
}

document.getElementById('inventoryMainTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-inventory-scope]');
  if (!btn) return;
  setInventoryScope(btn.dataset.inventoryScope);
});

document.getElementById('inventoryPvTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pv-area]');
  if (!btn) return;
  setPostventaArea(btn.dataset.pvArea);
});

document.getElementById('buscarPostventaInv')?.addEventListener('input', () => {
  renderPostventaArea();
});

document.getElementById('autosKpiGrid')?.addEventListener('click', (e) => {
  const kpiBtn = e.target.closest('[data-autos-kpi]');
  if (kpiBtn) {
    e.preventDefault();
    setActiveAutosKpi(kpiBtn.dataset.autosKpi);
  }
});

const params = new URLSearchParams(window.location.search);
if (params.get('tab') === 'postventa') setInventoryScope('postventa');
else setInventoryScope('autos');

initPlanPisoKpiCard();

loadInventory();
