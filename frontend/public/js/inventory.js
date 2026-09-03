let ageingChart;
let ageingCarlineChart;
let ageingDaysChart;
let ageingPisoChart;
let intHistChart;
let intHistMesChart;
let intHistConcChart;
let intHistRows = [];
let intHistSearch = '';
let intHistFilter = 'all';
let intHistData = null;
let ageingSlowRows = [];
let ageingCarlineFilters = [];
let ageingCarlineFilter = 'all';
let ageingSearch = '';
let vendidosRows = [];
let vendidosCarlineFilters = [];
let vendidosCarlineFilter = 'all';
let vendidosSearch = '';
let vendidosLoading = false;
let intHistLoading = false;
let entregasSinPreviasLoading = false;
let inventoryQuietRefreshing = false;
let inventoryAutoRefreshTimer = null;
const INVENTORY_AUTO_REFRESH_MS = 60 * 60 * 1000;
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
let seminuevosData = null;
let seminuevosLoaded = false;
let activeSemiKpi = null;
let semiDrawerUi = null;
let chartsReady = false;
let activeAutosKpi = null;
let autosKpiFilter = null;
let autosDrawerUi = null;
let stockAlertsRows = [];
let lastInventorySummary = null;
let lastInventoryPlanPisoPeriod = 'all';

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

function isFacturadoRow(r) {
  return Boolean(r && r._kind === 'facturado');
}

function facturadoSinPreviasRows() {
  return (window.__invFacturadoSinPrevias || []).slice();
}

function rowsForAutosKpi(kpiId) {
  if (kpiId === 'available') {
    return inventoryRows.filter((r) => r.situacion === 'DIS' || r.situacion === 'FIS' || r.situacion === 'SEP');
  }
  if (kpiId === 'demos') {
    return inventoryRows
      .filter((r) => r.situacion === 'DEMO')
      .slice()
      .sort((a, b) => (Number(b.daysAsDemo ?? b.daysInStock) || 0) - (Number(a.daysAsDemo ?? a.daysInStock) || 0));
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
  if (kpiId === 'demos') {
    return {
      title: 'Demos',
      hint: 'Unidades en DEMO · días desde remisión · pruebas de manejo (Sheets col. M = últimos 8 del VIN)',
      scopeLabel: 'demos',
      icon: 'directions_car',
      card: () => document.getElementById('kpiDemos'),
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
      title: 'Antigüedad',
      hint: 'Unidades en Físico (FIS) con 60 o más días desde remisión',
      scopeLabel: 'antigüedad',
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
  const facturado = rows.length > 0 && rows.every(isFacturadoRow);
  if (facturado) {
    headers = ['Fecha', 'Factura', 'VIN', 'Modelo', 'Previas', 'Cliente', 'Vendedor'];
    lines = rows.map((r) => [
      r.VTE_FECHDOCTO || '',
      r.VTE_DOCTO || '',
      r.VTE_SERIE || '',
      r.VEH_TIPOAUTO || '',
      Number(r.PREVIAS || 0),
      r.CLIENTE || '',
      r.VENDEDOR || '',
    ]);
  } else if (isSofiaKpi(kpi)) {
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
  } else if (kpi === 'demos') {
    headers = [
      'Modelo', 'Familia', 'Serie', 'VIN8', 'Días como demo', 'Pruebas manejo',
      'Ubicación', 'Color', 'Año', 'Previas',
    ];
    lines = rows.map((r) => [
      r.tipoAuto || '',
      r.familia || '',
      r.serie || '',
      r.vin8 || '',
      r.daysAsDemo ?? r.daysInStock ?? '',
      Number(r.pruebasManejo || 0),
      r.ubicacion || '',
      r.colorExterior || '',
      r.anModelo || '',
      Number(r.previas || 0),
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
  let alcanceMode = 'default'; // 'default' | 'FACTURADO'
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
    alcance: 'Alcance',
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
    if (showingFacturado() && !activeFilter) {
      filterChip.hidden = false;
      filterChip.innerHTML = `
        <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
        Alcance: Facturado sin previa
        <span class="material-symbols-outlined" aria-hidden="true">close</span>`;
      return;
    }
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

  function showingFacturado() {
    return alcanceMode === 'FACTURADO'
      && (currentMeta.kpi === 'sinPrevias' || currentMeta.kpi === 'entregasSinPrevias');
  }

  function matchesActiveFilter(r) {
    if (!activeFilter) return true;
    if (showingFacturado() || isFacturadoRow(r)) {
      if (activeFilter.dim === 'modelo') {
        return String(r.VEH_TIPOAUTO || r.tipoAuto || 'Sin modelo') === activeFilter.value;
      }
      if (activeFilter.dim === 'vendedor') {
        return String(r.VENDEDOR || 'Sin vendedor') === activeFilter.value;
      }
      return true;
    }
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
    if (dim === 'alcance') {
      const next = value === 'FACTURADO' ? 'FACTURADO' : 'default';
      if (alcanceMode === next && (!activeFilter || activeFilter.dim === 'alcance')) {
        alcanceMode = 'default';
      } else {
        alcanceMode = next;
      }
      activeFilter = null;
      autosKpiFilter = null;
      updateFilterChip();
      renderList(searchEl?.value || '');
      applyAutosKpiTableFilter();
      return;
    }

    if (activeFilter && activeFilter.dim === dim && activeFilter.value === value) {
      activeFilter = null;
      autosKpiFilter = null;
    } else {
      activeFilter = { dim, value, label: label || value };
      if (
        !showingFacturado()
        && !isSofiaKpi(currentMeta.kpi)
        && (dim === 'situacion' || dim === 'familia' || dim === 'modelo')
      ) {
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
    alcanceMode = 'default';
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

    const showingFact = showingFacturado();
    const factCount = facturadoSinPreviasRows().length;
    const alcanceItems = currentMeta.kpi === 'sinPrevias'
      ? [
        { label: 'En stock', value: rowsForAutosKpi('sinPrevias').length, id: 'STOCK' },
        { label: 'Facturado sin previa', value: factCount, id: 'FACTURADO' },
      ]
      : currentMeta.kpi === 'entregasSinPrevias'
        ? [
          { label: 'Entregas SOFIA', value: (window.__invSofiaSinPrevias || []).length, id: 'ENTREGA' },
          { label: 'Facturado sin previa', value: factCount, id: 'FACTURADO' },
        ]
        : null;

    const isAlcanceActive = (id) => (
      id === 'FACTURADO'
        ? alcanceMode === 'FACTURADO'
        : alcanceMode === 'default'
    );

    const alcanceBlock = alcanceItems
      ? `
      <div class="ops-orders-drawer__group">
        <h5>Alcance</h5>
        ${alcanceItems.map((x) => `
          <button type="button"
            class="ops-orders-drawer__row ops-orders-drawer__row--filter${isAlcanceActive(x.id) ? ' is-active' : ''}"
            data-autos-filter-dim="alcance"
            data-autos-filter-value="${escapeHtml(x.id)}"
            data-autos-filter-label="${escapeHtml(x.label)}"
            title="Filtrar por ${escapeHtml(x.label)}">
            <span class="lbl">${escapeHtml(x.label)}</span>
            <span class="val">${Number(x.value).toLocaleString('es-MX')}</span>
          </button>`).join('')}
      </div>`
      : '';

    if (showingFact) {
      const porModelo = countByField(rows, (r) => r.VEH_TIPOAUTO || r.tipoAuto || 'Sin modelo').slice(0, 10);
      const porVendedor = countByField(rows, (r) => r.VENDEDOR || 'Sin vendedor').slice(0, 10);
      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Facturas</span><span class="val">${rows.length.toLocaleString('es-MX')}</span></div>
          <p class="ops-orders-drawer__hint">Ventas facturadas del mes (VEN) sin órdenes de previa</p>
        </div>
        ${alcanceBlock}
        ${block('Por modelo', 'modelo', porModelo)}
        ${block('Por vendedor', 'vendedor', porVendedor)}
      `;
      return;
    }

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
        ${alcanceBlock}
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
    const isDemos = currentMeta.kpi === 'demos';
    const demosConPruebas = isDemos
      ? rows.filter((r) => Number(r.pruebasManejo || 0) > 0).length
      : 0;
    const demosPruebasTotal = isDemos
      ? rows.reduce((s, r) => s + (Number(r.pruebasManejo) || 0), 0)
      : 0;
    const avgDaysDemo = isDemos && rows.length
      ? Math.round(
        rows.reduce((s, r) => s + (Number(r.daysAsDemo ?? r.daysInStock) || 0), 0) / rows.length,
      )
      : 0;

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
        ${isDemos ? `
          <div class="ops-orders-drawer__row"><span class="lbl">Prom. días demo</span><span class="val">${avgDaysDemo.toLocaleString('es-MX')}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Con pruebas</span><span class="val">${demosConPruebas.toLocaleString('es-MX')}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Pruebas totales</span><span class="val">${demosPruebasTotal.toLocaleString('es-MX')}</span></div>
        ` : ''}
        ${currentMeta.kpi === 'available' || currentMeta.kpi === 'total' ? `
          <div class="ops-orders-drawer__row"><span class="lbl">Libres FIS/DIS</span><span class="val">${libres.toLocaleString('es-MX')}</span></div>
          <div class="ops-orders-drawer__row"><span class="lbl">Apartadas</span><span class="val">${apartadas.toLocaleString('es-MX')}</span></div>
        ` : ''}
        <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
      </div>
      ${alcanceBlock}
      ${isDemos ? '' : situacionBlock}
      ${block('Por familia', 'familia', porFamilia)}
      ${block('Por modelo', 'modelo', porModelo)}
    `;
  }

  function renderList(term = '') {
    const q = String(term || '').trim().toLowerCase();
    const showingFact = showingFacturado();
    const sofia = isSofiaKpi(currentMeta.kpi) && !showingFact;
    const viewRows = showingFact ? facturadoSinPreviasRows() : sourceRows;

    const searched = !q
      ? viewRows
      : viewRows.filter((r) => {
        if (showingFact || isFacturadoRow(r)) {
          return [r.VTE_FECHDOCTO, r.VTE_DOCTO, r.VTE_SERIE, r.VEH_TIPOAUTO, r.CLIENTE, r.VENDEDOR, r.PREVIAS]
            .some((v) => String(v || '').toLowerCase().includes(q));
        }
        const fields = sofia
          ? [r.FECHA_PERIODO, r.SOF_FechAct, r.SOF_HoraAct, r.SOF_Factura, r.SOF_VIN, r.CLIENTE, r.SOF_Estatus, r.SOF_CveUSu, r.PREVIAS]
          : [
            r.tipoAuto, r.familia, r.anModelo, r.serie, r.vin8, r.motor, r.noInventario,
            r.colorExterior, r.ubicacion, r.situacion, r.situacionLabel,
            r.catalogo, r.status, r.apartadoPor, r.usuarioApartado, r.previas,
            r.pruebasManejo, r.daysAsDemo, r.daysInStock,
          ];
        return fields.some((v) => String(v || '').toLowerCase().includes(q));
      });

    const filtered = searched.filter(matchesActiveFilter);
    lastExportRows = filtered;

    statusEl.textContent = showingFact
      ? `${filtered.length.toLocaleString('es-MX')} factura(s)`
      : sofia
        ? `${filtered.length.toLocaleString('es-MX')} entrega(s)`
        : `${filtered.length.toLocaleString('es-MX')} unidad(es)`;
    metaEl.textContent = activeFilter || showingFact || q
      ? `${filtered.length} de ${viewRows.length}`
      : `${viewRows.length} registros`;

    renderSummary(searched);
    updateFilterChip();

    if (!filtered.length) {
      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__empty">
          <span class="material-symbols-outlined">inbox</span>
          <p>${activeFilter || q
            ? 'Sin coincidencias con el filtro actual.'
            : (showingFact
              ? 'No hay facturas del mes sin previa.'
              : (sofia ? 'No hay entregas SOFIA sin previa en el mes.' : 'No hay unidades para este indicador.'))}</p>
        </div>`;
      return;
    }

    if (showingFact) {
      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <h5>Facturado sin previa</h5>
          <span>${filtered.length.toLocaleString('es-MX')}</span>
        </div>
        ${filtered.map((r) => `
          <div class="ops-orders-drawer__item" style="cursor:default">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(dash(r.VTE_DOCTO))}</strong>
              <span class="ops-orders-drawer__tag">Facturado</span>
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.CLIENTE))} · VIN ${escapeHtml(dash(r.VTE_SERIE))}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(dash(r.VTE_FECHDOCTO))}</span>
              <span>${escapeHtml(dash(r.VEH_TIPOAUTO))}</span>
              <span>Previas ${Number(r.PREVIAS || 0)}</span>
            </div>
            <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
              <span>${escapeHtml(dash(r.VENDEDOR))}</span>
            </div>
          </div>`).join('')}`;
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
        <h5>${currentMeta.kpi === 'demos' ? 'Demos · días y pruebas' : 'Detalle de unidades'}</h5>
        <span>${filtered.length.toLocaleString('es-MX')}</span>
      </div>
      ${filtered.map((r) => {
        const apartada = r.isApartada || r.situacion === 'SEP';
        const isDemo = currentMeta.kpi === 'demos' || r.situacion === 'DEMO';
        const diasDemo = r.daysAsDemo ?? r.daysInStock;
        const pruebas = Number(r.pruebasManejo || 0);
        return `
          <div class="ops-orders-drawer__item" style="cursor:default">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(dash(r.tipoAuto))}</strong>
              <span class="ops-orders-drawer__tag">${escapeHtml(dash(r.situacionLabel || r.situacion))}</span>
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(dash(r.familia))} · Serie ${escapeHtml(dash(r.serie))}${r.vin8 ? ` · VIN8 ${escapeHtml(r.vin8)}` : ''}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(dash(r.ubicacion))}</span>
              <span>${isDemo
                ? (diasDemo != null ? `${diasDemo} d. como demo` : '—')
                : (r.daysInStock != null ? `${r.daysInStock} días` : '—')}</span>
              <span>${isDemo ? `${pruebas} prueba${pruebas === 1 ? '' : 's'}` : `Previas ${Number(r.previas || 0)}`}</span>
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
    alcanceMode = 'default';
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
    alcanceMode = 'default';

    if (titleEl) titleEl.textContent = currentMeta.title;
    if (logoEl) logoEl.textContent = currentMeta.icon;
    panel.setAttribute('aria-label', currentMeta.title);
    if (searchEl) {
      searchEl.placeholder = isSofiaKpi(kpiKey)
        ? 'Buscar factura, VIN, cliente...'
        : kpiKey === 'demos'
          ? 'Buscar modelo, serie, VIN8...'
          : kpiKey === 'sinPrevias'
            ? 'Buscar modelo, serie, factura...'
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

function filteredAgeingSlowRows() {
  let rows = ageingSlowRows;
  if (ageingCarlineFilter && ageingCarlineFilter !== 'all') {
    rows = rows.filter((r) => String(r.carline || '') === ageingCarlineFilter);
  }
  const q = String(ageingSearch || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => [
    r.vin, r.carline, r.version, r.catalogo, r.paquete,
  ].some((v) => String(v || '').toLowerCase().includes(q)));
}

function ageingDaysOf(row) {
  if (row.daysInStock == null) return Number(row.avgDays || 0);
  return Number(row.daysInStock || 0);
}

function renderAgeingAnalysisSummary(rows = ageingSlowRows) {
  const { fmt, chartOptions, chartColors } = Dashboard;
  const list = Array.isArray(rows) ? rows : [];
  const units = list.length;
  const daysVals = list.map(ageingDaysOf).filter((d) => Number.isFinite(d));
  const avgDays = daysVals.length
    ? Math.round(daysVals.reduce((s, d) => s + d, 0) / daysVals.length)
    : 0;
  const over30 = list.filter((r) => ageingDaysOf(r) > 30).length;
  const over90 = list.filter((r) => ageingDaysOf(r) >= 90).length;
  const planPiso = list.reduce((s, r) => s + Number(r.planPisoAcumulado || 0), 0);
  const utilRows = list.filter((r) => r.utilidadPromedio != null && Number(r.unidadesVendidas || 0) > 0);
  const utilidad = utilRows.length
    ? utilRows.reduce((s, r) => s + Number(r.utilidadPromedio || 0) * Number(r.unidadesVendidas || 0), 0)
      / utilRows.reduce((s, r) => s + Number(r.unidadesVendidas || 0), 0)
    : null;
  const byCarline = new Map();
  const pisoByCarline = new Map();
  for (const r of list) {
    const key = r.carline || 'Sin familia';
    byCarline.set(key, (byCarline.get(key) || 0) + 1);
    pisoByCarline.set(key, (pisoByCarline.get(key) || 0) + Number(r.planPisoAcumulado || 0));
  }
  const topCarline = [...byCarline.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPiso = list.slice().sort((a, b) => Number(b.planPisoAcumulado || 0) - Number(a.planPisoAcumulado || 0))[0];
  const oldest = list.slice().sort((a, b) => ageingDaysOf(b) - ageingDaysOf(a))[0];

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('ageingKpiUnidades', fmt.number(units));
  set('ageingKpiUnidadesSub', `${fmt.number(byCarline.size)} carline${byCarline.size === 1 ? '' : 's'}`);
  set('ageingKpiDias', `${fmt.number(avgDays)} días`);
  set('ageingKpiDiasSub', `${fmt.number(over30)} unidad(es) +30 días`);
  set('ageingKpiPiso', fmt.money(planPiso));
  set('ageingKpiPisoSub', `${fmt.number(over90)} críticas 90+`);
  set('ageingKpiUtilidad', utilidad == null ? '—' : fmt.money(utilidad));
  set('ageingKpiUtilidadSub', utilidad == null ? 'Sin histórico' : 'Promedio ponderado vendido');
  set('ageingAnalysisCount', `${fmt.number(units)} unidad(es) · ${fmt.number(byCarline.size)} carline(s)`);

  const banner = document.getElementById('ageingAnalysisBanner');
  if (banner) {
    banner.hidden = false;
    if (!units) {
      banner.className = 'int-acq-banner int-acq-banner--ok';
      banner.textContent = 'Sin unidades de piso real para analizar.';
    } else if (over90 > 0 || planPiso > 0) {
      banner.className = 'int-acq-banner int-acq-banner--warning';
      banner.textContent = `${over30} unidad(es) ya generan plan piso. Acumulado ${fmt.money(planPiso)}${topCarline ? ` · Más stock: ${topCarline[0]} (${topCarline[1]})` : ''}.`;
    } else {
      banner.className = 'int-acq-banner int-acq-banner--ok';
      banner.textContent = `${units} unidad(es) en piso · ninguna supera 30 días de plan piso.`;
    }
  }

  const box = document.getElementById('ageingAnalysisInsights');
  if (box) {
    const insights = [];
    if (oldest && ageingDaysOf(oldest) > 0) {
      insights.push({
        ok: ageingDaysOf(oldest) < 60,
        title: `Unidad más antigua: ${oldest.carline || '—'}`,
        detail: `${oldest.vin || '—'} · ${ageingDaysOf(oldest)} días · ${oldest.version || ''}`,
        action: ageingDaysOf(oldest) >= 90 ? 'Priorizar salida o intercambio de esta unidad' : 'Monitorear rotación',
      });
    }
    if (topPiso && Number(topPiso.planPisoAcumulado || 0) > 0) {
      insights.push({
        ok: false,
        title: `Mayor plan piso: ${fmt.money(topPiso.planPisoAcumulado)}`,
        detail: `${topPiso.carline || '—'} · ${topPiso.vin || '—'} · ${ageingDaysOf(topPiso)} días`,
        action: 'Revisar costo financiero vs utilidad esperada',
      });
    }
    if (topCarline) {
      insights.push({
        ok: true,
        title: `Carline con más piso: ${topCarline[0]}`,
        detail: `${topCarline[1]} unidad(es) · ${((topCarline[1] / Math.max(units, 1)) * 100).toFixed(0)}% del inventario`,
        action: 'Usar el filtro de fichas para ver el detalle',
      });
    }
    if (!insights.length) {
      box.innerHTML = `<div class="int-acq-alert int-acq-alert--ok">
        <span class="material-symbols-outlined int-acq-alert__icon">info</span>
        <div>
          <p class="int-acq-alert__title">Sin insights</p>
          <p class="int-acq-alert__meta">No hay unidades de piso real para analizar.</p>
        </div>
      </div>`;
    } else {
      box.innerHTML = insights.map((a) => `
        <article class="int-acq-alert int-acq-alert--${a.ok ? 'ok' : 'warning'}">
          <span class="material-symbols-outlined int-acq-alert__icon">${a.ok ? 'verified' : 'analytics'}</span>
          <div>
            <p class="int-acq-alert__title">${escapeHtml(a.title)}</p>
            <p class="int-acq-alert__meta">${escapeHtml(a.detail)}</p>
            <p class="int-acq-alert__action">${escapeHtml(a.action)}</p>
          </div>
        </article>
      `).join('');
    }
  }

  const buckets = [
    { label: '0-30', color: '#27AE60', n: list.filter((r) => ageingDaysOf(r) <= 30).length },
    { label: '31-60', color: '#f59e0b', n: list.filter((r) => { const d = ageingDaysOf(r); return d > 30 && d <= 60; }).length },
    { label: '61-90', color: '#f97316', n: list.filter((r) => { const d = ageingDaysOf(r); return d > 60 && d < 90; }).length },
    { label: '90+', color: '#be123c', n: list.filter((r) => ageingDaysOf(r) >= 90).length },
  ];
  const carlineRank = [...byCarline.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const pisoRank = [...pisoByCarline.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  destroyChart(ageingCarlineChart);
  destroyChart(ageingDaysChart);
  destroyChart(ageingPisoChart);
  ageingCarlineChart = null;
  ageingDaysChart = null;
  ageingPisoChart = null;

  try {
    const carlineCanvas = document.getElementById('ageingCarlineChart');
    if (carlineCanvas && typeof Chart !== 'undefined') {
      ageingCarlineChart = new Chart(carlineCanvas, {
        type: 'bar',
        data: {
          labels: carlineRank.map(([label]) => label),
          datasets: [{
            label: 'Unidades',
            data: carlineRank.map(([, n]) => n),
            backgroundColor: chartColors?.secondary || 'rgba(45, 91, 255, 0.7)',
            borderRadius: 8,
          }],
        },
        options: chartOptions({
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { grid: { display: false } },
          },
        }),
      });
    }

    const daysCanvas = document.getElementById('ageingDaysChart');
    if (daysCanvas && typeof Chart !== 'undefined') {
      ageingDaysChart = new Chart(daysCanvas, {
        type: 'doughnut',
        data: {
          labels: buckets.map((b) => b.label),
          datasets: [{
            data: buckets.map((b) => b.n),
            backgroundColor: buckets.map((b) => b.color),
            borderWidth: 0,
          }],
        },
        options: chartOptions({
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
          cutout: '62%',
        }),
      });
    }

    const pisoCanvas = document.getElementById('ageingPisoChart');
    if (pisoCanvas && typeof Chart !== 'undefined') {
      ageingPisoChart = new Chart(pisoCanvas, {
        type: 'bar',
        data: {
          labels: pisoRank.map(([label]) => label),
          datasets: [{
            label: 'Plan piso',
            data: pisoRank.map(([, n]) => Math.round(n)),
            backgroundColor: 'rgba(190, 18, 60, 0.72)',
            borderRadius: 8,
          }],
        },
        options: chartOptions({
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true },
            y: { grid: { display: false } },
          },
        }),
      });
    }
  } catch (err) {
    console.warn('[Analisis inventario] charts:', err);
  }
}

function renderAgeingCarlineFilterTabs(filters = ageingCarlineFilters) {
  const nav = document.getElementById('ageingCarlineFilterTabs');
  if (!nav) return;
  const list = Array.isArray(filters) ? filters : [];
  if (ageingCarlineFilter !== 'all' && !list.some((m) => m.label === ageingCarlineFilter)) {
    ageingCarlineFilter = 'all';
  }
  const total = list.reduce((s, m) => s + Number(m.count || 0), 0);
  nav.innerHTML = [
    `<button type="button" class="ageing-carline-chip${ageingCarlineFilter === 'all' ? ' is-active' : ''}" data-ageing-filter="all" aria-pressed="${ageingCarlineFilter === 'all'}">
      <span class="ageing-carline-chip__name">Todos</span>
      <span class="ageing-carline-chip__count">${total}</span>
    </button>`,
    ...list.map((m) => {
      const on = ageingCarlineFilter === m.label;
      return `<button type="button" class="ageing-carline-chip${on ? ' is-active' : ''}" data-ageing-filter="${escapeHtml(m.label)}" aria-pressed="${on}">
        <span class="ageing-carline-chip__name">${escapeHtml(m.label)}</span>
        <span class="ageing-carline-chip__count">${Number(m.count || 0)}</span>
      </button>`;
    }),
  ].join('');
}

function currentVendidosRange() {
  const fi = String(document.getElementById('fechaInicio')?.value || '').trim();
  const ff = String(document.getElementById('fechaFin')?.value || '').trim();
  if (fi && ff) return { fechaInicio: fi, fechaFin: ff };

  const input = document.getElementById('vendidosPeriod');
  const raw = String(input?.value || '').trim();
  const now = new Date();
  const year = raw ? Number(raw.slice(0, 4)) : now.getFullYear();
  const month = raw ? Number(raw.slice(5, 7)) : now.getMonth() + 1;
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return {
    fechaInicio: `${year}-${mm}-01`,
    fechaFin: `${year}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

function initVendidosPeriod() {
  const input = document.getElementById('vendidosPeriod');
  if (!input || input.value) return;
  const fi = String(document.getElementById('fechaInicio')?.value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fi)) {
    input.value = fi.slice(0, 7);
    return;
  }
  const now = new Date();
  input.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatVendidosDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function roundMoneyUi(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function costoNetoConBonif(r) {
  const costo = Number(r.costo || 0);
  const bonif = Number(r.bonificacion || 0);
  if (!costo && !bonif) return null;
  return roundMoneyUi(costo - bonif);
}

function notaCreditoSinIva(r) {
  const nota = Number(r.notaCargo || 0);
  return nota > 0 ? roundMoneyUi(nota / 1.16) : 0;
}

function pctRetencion(bruta, neta) {
  if (bruta == null || !Number(bruta)) return null;
  if (neta == null) return null;
  return Math.round((Number(neta) / Number(bruta)) * 1000) / 10;
}

function renderRetencionCell(pct) {
  if (pct == null) return '<span class="ageing-slow-hint">—</span>';
  const tone = pct < 0 ? 'is-neg' : (pct < 50 ? 'is-warn' : 'is-ok');
  return `<strong class="ageing-retencion ${tone}">${pct.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%</strong>`;
}

function renderComisionEvCell(r, fmt) {
  const importe = Number(r.comisionEv || 0);
  const pct = Number(r.comisionEvPct || 0);
  const uds = Number(r.comisionEvUnidadesPrev || 0);
  const mes = String(r.comisionEvMesPrev || 'mes ant.').trim();
  const udsLabel = uds >= 10 ? '10+' : String(uds);
  const arrend = r.comisionEvArrendamiento
    ? ` · +${Number(r.comisionEvPctLeasing || 1)}% arrend.`
    : '';
  const hint = `${pct}% · ${udsLabel} uds menudeo ${mes}${arrend}`;
  if (!importe) {
    return `<span class="ageing-slow-hint">${escapeHtml(hint)}</span>`;
  }
  return `<strong>${fmt.money(importe)}</strong><span class="ageing-slow-hint">${escapeHtml(hint)}</span>`;
}

function extrasBreakdownFromRow(r, fmt) {
  const previa = Number(r.costoPrevia || 0);
  const publicidad = Number(r.costoPublicidad || r.costoMercadotecnia || 0);
  const entrega = Number(r.costoEntrega || 0);
  const gasolina = Number(r.costoGasolina || 0);
  const litros = Number(r.gasolinaLitros || 0);
  const gastosLibro = Number(r.gastos || 0);
  const extras = Number(r.gastosAdicionales || (previa + publicidad + entrega + gasolina + gastosLibro));
  const items = [
    { label: 'Gastos', value: gastosLibro, hint: 'Línea GASTOS de remisión / libro' },
    { label: 'Previa', value: previa, hint: 'Costo fijo' },
    { label: 'Publicidad', value: publicidad, hint: 'Costo fijo' },
    { label: 'Entrega', value: entrega, hint: entrega === 240 ? 'Aveo, Onix, Tornado, Groove' : 'Resto de modelos' },
    { label: 'Gasolina', value: gasolina, hint: litros ? `${litros} L × $23.39` : 'Sin litros en tabla' },
  ];
  return { previa, publicidad, entrega, gasolina, litros, gastosLibro, extras, items };
}

function renderExtrasCell(r, fmt) {
  const det = extrasBreakdownFromRow(r, fmt);
  if (!det.extras) return '<span class="ageing-slow-hint">Sin extra</span>';
  const payload = encodeURIComponent(JSON.stringify({
    vin: r.vin || '',
    carline: r.carline || '',
    version: r.version || '',
    extras: det.extras,
    items: det.items,
  }));
  return `<button type="button" class="ageing-extras-trigger" data-extras-payload="${payload}" aria-haspopup="dialog" aria-expanded="false">
    <strong>${fmt.money(det.extras)}</strong>
    <span class="ageing-slow-hint">Ver detalle</span>
  </button>`;
}

function renderIngresoFiCell(r, fmt) {
  const monto = r.ingresoFinanciamiento == null ? null : Number(r.ingresoFinanciamiento);
  if (monto == null || !(monto > 0)) {
    return '<span class="ageing-slow-hint">Sin F&amp;I</span>';
  }
  const detalle = Array.isArray(r.ingresoFinanciamientoDetalle) ? r.ingresoFinanciamientoDetalle : [];
  const items = detalle.map((d) => ({
    label: d.concepto || 'PAGO GMF',
    value: Number(d.monto || 0) || 0,
    hint: Number(d.count || 0) > 1 ? `${d.count} pagos` : '',
  }));
  const count = Number(r.ingresoFinanciamientoCount || 0) || items.length;
  const fuente = 'PAGOS GMF';
  const payload = encodeURIComponent(JSON.stringify({
    kicker: 'Ingresos F&I',
    totalLabel: 'Total financiamiento',
    vin: r.vin || '',
    carline: r.carline || '',
    version: r.version || '',
    extras: monto,
    items,
    hint: fuente,
  }));
  return `<button type="button" class="ageing-extras-trigger" data-extras-payload="${payload}" aria-haspopup="dialog" aria-expanded="false">
    <strong>${fmt.money(monto)}</strong>
    <span class="ageing-slow-hint">${count ? `${count} pago${count === 1 ? '' : 's'}` : 'Ver detalle'}</span>
  </button>`;
}

let extrasPopoverEl = null;
let extrasPopoverAnchor = null;

function ensureExtrasPopover() {
  if (extrasPopoverEl) return extrasPopoverEl;
  const pop = document.createElement('div');
  pop.id = 'extrasDetailPopover';
  pop.className = 'extras-popover hidden';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Detalle de gastos extra');
  document.body.appendChild(pop);
  extrasPopoverEl = pop;
  document.addEventListener('click', (e) => {
    if (!extrasPopoverEl || extrasPopoverEl.classList.contains('hidden')) return;
    if (extrasPopoverEl.contains(e.target) || e.target.closest?.('.ageing-extras-trigger')) return;
    closeExtrasPopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeExtrasPopover();
  });
  window.addEventListener('resize', () => {
    if (extrasPopoverAnchor) placeExtrasPopover(extrasPopoverAnchor);
  });
  document.addEventListener('scroll', () => {
    if (extrasPopoverAnchor) placeExtrasPopover(extrasPopoverAnchor);
  }, true);
  return pop;
}

function placeExtrasPopover(anchor) {
  const pop = extrasPopoverEl;
  if (!pop || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth || 280;
  const ph = pop.offsetHeight || 220;
  let left = rect.right + 10;
  let top = rect.top;
  if (left + pw > window.innerWidth - 12) left = rect.left - pw - 10;
  if (left < 12) left = Math.max(12, (window.innerWidth - pw) / 2);
  if (top + ph > window.innerHeight - 12) top = window.innerHeight - ph - 12;
  if (top < 12) top = 12;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function closeExtrasPopover() {
  if (!extrasPopoverEl) return;
  extrasPopoverEl.classList.add('hidden');
  extrasPopoverEl.innerHTML = '';
  extrasPopoverAnchor?.setAttribute('aria-expanded', 'false');
  extrasPopoverAnchor = null;
}

let fichaPopoverEl = null;
let fichaPopoverAnchor = null;

function closeFichaPopover() {
  if (!fichaPopoverEl) return;
  fichaPopoverEl.classList.add('hidden');
  fichaPopoverEl.innerHTML = '';
  fichaPopoverAnchor?.setAttribute('aria-expanded', 'false');
  fichaPopoverAnchor = null;
}

function closeVendidosPopovers() {
  closeExtrasPopover();
  closeFichaPopover();
}

function ensureFichaPopover() {
  if (fichaPopoverEl) return fichaPopoverEl;
  const pop = document.createElement('div');
  pop.id = 'vendidosFichaPopover';
  pop.className = 'extras-popover extras-popover--ficha hidden';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Detalle de la unidad vendida');
  document.body.appendChild(pop);
  fichaPopoverEl = pop;
  document.addEventListener('click', (e) => {
    if (!fichaPopoverEl || fichaPopoverEl.classList.contains('hidden')) return;
    if (fichaPopoverEl.contains(e.target) || e.target.closest?.('.ageing-ficha-trigger')) return;
    closeFichaPopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFichaPopover();
  });
  window.addEventListener('resize', () => {
    if (fichaPopoverAnchor) placeFichaPopover(fichaPopoverAnchor);
  });
  document.addEventListener('scroll', () => {
    if (fichaPopoverAnchor) placeFichaPopover(fichaPopoverAnchor);
  }, true);
  return pop;
}

function placeFichaPopover(anchor) {
  const pop = fichaPopoverEl;
  if (!pop || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth || 340;
  const ph = pop.offsetHeight || 320;
  let left = rect.right + 10;
  let top = rect.top;
  if (left + pw > window.innerWidth - 12) left = rect.left - pw - 10;
  if (left < 12) left = Math.max(12, (window.innerWidth - pw) / 2);
  if (top + ph > window.innerHeight - 12) top = window.innerHeight - ph - 12;
  if (top < 12) top = 12;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function fichaRow(label, value, hint) {
  const text = value == null || value === '' ? '—' : String(value);
  return `<li>
    <span>
      <strong>${escapeHtml(label)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </span>
    <em>${escapeHtml(text)}</em>
  </li>`;
}

function renderVendidosFichaCell(r) {
  const vin = r.vin || '—';
  const payload = encodeURIComponent(JSON.stringify({
    vin,
    carline: r.carline || '',
    version: r.version || '',
    factura: r.factura || '',
    fechaVenta: r.fechaVenta || '',
    fechaRemision: r.fechaRemision || '',
    daysInStock: r.daysInStock,
    vendedor: r.vendedor || '',
    cliente: r.cliente || '',
    tipoVenta: r.tipoVenta || '',
    formaPago: r.formaPago || '',
    isDemo: Boolean(r.isDemo),
    demoHint: r.demoHint || '',
    isFlotilla: Boolean(r.isFlotilla),
    arrendamiento: Boolean(r.comisionEvArrendamiento),
    comisionPct: r.comisionEvPct,
    unidadesPrev: r.comisionEvUnidadesPrev,
    mesPrev: r.comisionEvMesPrev || '',
    notaFolio: r.notaCargoFolio || '',
  }));
  return `<button type="button" class="ageing-ficha-trigger" data-ficha-payload="${payload}" aria-haspopup="dialog" aria-expanded="false" title="${escapeHtml(vin)}">
    <strong class="ageing-slow-vin-text">${escapeHtml(vin)}</strong>
    <span class="ageing-slow-hint">Ver detalle</span>
  </button>`;
}

function openFichaPopover(anchor) {
  let data = null;
  try {
    data = JSON.parse(decodeURIComponent(anchor.getAttribute('data-ficha-payload') || ''));
  } catch {
    data = null;
  }
  if (!data) return;
  closeExtrasPopover();
  const pop = ensureFichaPopover();
  const modelo = [data.carline, data.version].filter(Boolean).join(' · ') || 'Unidad';
  const demoLabel = data.isDemo ? 'Sí, fue demo' : 'No';
  const fmtDate = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  };
  const uds = Number(data.unidadesPrev || 0);
  const udsLabel = uds >= 10 ? '10+' : String(uds);
  pop.innerHTML = `
    <div class="extras-popover__head">
      <div>
        <p class="extras-popover__kicker">Detalle de venta</p>
        <h4 class="extras-popover__title">${escapeHtml(modelo)}</h4>
        <p class="extras-popover__vin">${escapeHtml(data.vin || '—')}</p>
      </div>
      <button type="button" class="extras-popover__close" aria-label="Cerrar">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <ul class="extras-popover__list">
      ${fichaRow('Vendedor', data.vendedor || '—')}
      ${fichaRow('Demo', demoLabel, data.isDemo ? (data.demoHint || 'Detectada en observación / ubicación') : 'Sin marca de demo')}
      ${fichaRow('Cliente', data.cliente || '—')}
      ${fichaRow('Factura', data.factura || '—')}
      ${fichaRow('Fecha venta', fmtDate(data.fechaVenta))}
      ${fichaRow('Tipo de venta', data.tipoVenta || '—', data.formaPago ? `Clave ${data.formaPago}` : '')}
      ${fichaRow('Canal', data.isFlotilla ? 'Flotilla' : 'Menudeo')}
      ${fichaRow('Arrendamiento', data.arrendamiento ? 'Sí' : 'No')}
      ${fichaRow('Días en inventario', data.daysInStock == null ? '—' : `${data.daysInStock} días`, data.fechaRemision ? `Remisión ${fmtDate(data.fechaRemision)}` : '')}
      ${fichaRow('Comisión E.V.', data.comisionPct == null ? '—' : `${data.comisionPct}%`, `${udsLabel} uds menudeo ${data.mesPrev || 'mes ant.'}`)}
      ${fichaRow('Nota de crédito', data.notaFolio || 'Sin nota')}
    </ul>
    <div class="extras-popover__total ${data.isDemo ? 'is-demo' : ''}">
      <span>${data.isDemo ? 'Unidad demo' : 'Unidad de piso'}</span>
      <strong>${escapeHtml(data.vendedor || 'Sin asesor')}</strong>
    </div>
  `;
  pop.querySelector('.extras-popover__close')?.addEventListener('click', closeFichaPopover);
  fichaPopoverAnchor?.setAttribute('aria-expanded', 'false');
  fichaPopoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  pop.classList.remove('hidden');
  placeFichaPopover(anchor);
}

function bindFichaPopover(root) {
  if (!root || root.dataset.fichaBound === '1') return;
  root.dataset.fichaBound = '1';
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('.ageing-ficha-trigger');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    if (fichaPopoverAnchor === trigger) {
      closeFichaPopover();
      return;
    }
    openFichaPopover(trigger);
  });
}

function openExtrasPopover(anchor) {
  const { fmt } = Dashboard;
  let data = null;
  try {
    data = JSON.parse(decodeURIComponent(anchor.getAttribute('data-extras-payload') || ''));
  } catch {
    data = null;
  }
  if (!data) return;
  const pop = ensureExtrasPopover();
  const items = Array.isArray(data.items) ? data.items : [];
  const vin = data.vin || '—';
  const modelo = [data.carline, data.version].filter(Boolean).join(' · ') || 'Unidad';
  const kicker = data.kicker || 'Gastos extra';
  const totalLabel = data.totalLabel || 'Total extras';
  pop.innerHTML = `
    <div class="extras-popover__head">
      <div>
        <p class="extras-popover__kicker">${escapeHtml(kicker)}</p>
        <h4 class="extras-popover__title">${escapeHtml(modelo)}</h4>
        <p class="extras-popover__vin">${escapeHtml(vin)}</p>
      </div>
      <button type="button" class="extras-popover__close" aria-label="Cerrar">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <ul class="extras-popover__list">
      ${items.map((item) => `
        <li class="${Number(item.value || 0) ? '' : 'is-zero'}">
          <span>
            <strong>${escapeHtml(item.label)}</strong>
            ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}
          </span>
          <em>${fmt.money(Number(item.value || 0))}</em>
        </li>
      `).join('')}
    </ul>
    <div class="extras-popover__total">
      <span>${escapeHtml(totalLabel)}${data.hint ? ` · ${escapeHtml(data.hint)}` : ''}</span>
      <strong>${fmt.money(Number(data.extras || 0))}</strong>
    </div>
  `;
  pop.querySelector('.extras-popover__close')?.addEventListener('click', closeExtrasPopover);
  extrasPopoverAnchor?.setAttribute('aria-expanded', 'false');
  extrasPopoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  pop.classList.remove('hidden');
  placeExtrasPopover(anchor);
}

function bindExtrasPopover(root) {
  if (!root || root.dataset.extrasBound === '1') return;
  root.dataset.extrasBound = '1';
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('.ageing-extras-trigger');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    if (extrasPopoverAnchor === trigger) {
      closeExtrasPopover();
      return;
    }
    closeFichaPopover();
    openExtrasPopover(trigger);
  });
}

function filteredVendidosRows() {
  let rows = vendidosRows;
  if (vendidosCarlineFilter && vendidosCarlineFilter !== 'all') {
    rows = rows.filter((r) => String(r.carline || '') === vendidosCarlineFilter);
  }
  const q = String(vendidosSearch || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => [
    r.vin, r.carline, r.version, r.catalogo, r.paquete, r.factura, r.notaCargoFolio,
    r.vendedor, r.cliente, r.tipoVenta, r.formaPago,
  ].some((v) => String(v || '').toLowerCase().includes(q)));
}

function renderVendidosCarlineFilterTabs(filters = vendidosCarlineFilters) {
  const nav = document.getElementById('vendidosCarlineFilterTabs');
  if (!nav) return;
  const list = Array.isArray(filters) ? filters : [];
  if (vendidosCarlineFilter !== 'all' && !list.some((m) => m.label === vendidosCarlineFilter)) {
    vendidosCarlineFilter = 'all';
  }
  const total = list.reduce((s, m) => s + Number(m.count || 0), 0);
  nav.innerHTML = [
    `<button type="button" class="ageing-carline-chip${vendidosCarlineFilter === 'all' ? ' is-active' : ''}" data-vendidos-filter="all" aria-pressed="${vendidosCarlineFilter === 'all'}">
      <span class="ageing-carline-chip__name">Todos</span>
      <span class="ageing-carline-chip__count">${total}</span>
    </button>`,
    ...list.map((m) => {
      const on = vendidosCarlineFilter === m.label;
      return `<button type="button" class="ageing-carline-chip${on ? ' is-active' : ''}" data-vendidos-filter="${escapeHtml(m.label)}" aria-pressed="${on}">
        <span class="ageing-carline-chip__name">${escapeHtml(m.label)}</span>
        <span class="ageing-carline-chip__count">${Number(m.count || 0)}</span>
      </button>`;
    }),
  ].join('');
}

function renderVendidosTable(rows = filteredVendidosRows()) {
  closeVendidosPopovers();
  const body = document.getElementById('vendidosSlowBody');
  if (!body) return;
  const { fmt } = Dashboard;
  const list = Array.isArray(rows) ? rows : [];
  const meta = document.getElementById('vendidosSearchMeta');
  if (meta) {
    const filtered = vendidosSearch.trim() || vendidosCarlineFilter !== 'all';
    meta.classList.toggle('hidden', !filtered);
    if (filtered) meta.textContent = `${list.length} de ${vendidosRows.length}`;
  }
  if (!list.length) {
    const empty = vendidosLoading
      ? 'Cargando vendidos…'
      : (vendidosRows.length ? 'Sin coincidencias para el filtro.' : 'Sin ventas en el mes seleccionado.');
    body.innerHTML = `<tr><td colspan="13" class="empty-row">${empty}</td></tr>`;
    return;
  }
  body.innerHTML = list.map((r) => {
    const carline = r.carline || '—';
    const version = r.version || '—';
    const vin = r.vin || '—';
    const utilidad = r.utilidadPromedio == null ? null : Number(r.utilidadPromedio);
    const utilidadNeta = r.utilidadNeta == null ? null : Number(r.utilidadNeta);
    const planPiso = Number(r.planPisoAcumulado || 0);
    const extrasComenUtilidad = utilidadNeta != null && utilidadNeta < 0;
    const rowClass = extrasComenUtilidad ? 'ageing-slow-row--piso-over' : '';
    const costoNeto = costoNetoConBonif(r);
    const bonif = Number(r.bonificacion || 0);
    const notaSinIva = notaCreditoSinIva(r);
    const notaFolio = String(r.notaCargoFolio || '').trim();
    const pisoCell = planPiso > 0
      ? `<strong>${fmt.money(planPiso)}</strong><span class="ageing-slow-hint">${Number(r.daysChargeable || 0)} días cargo</span>`
      : '<span class="ageing-slow-hint">Sin cargo</span>';
    const notaCell = notaSinIva > 0
      ? `<strong>${fmt.money(notaSinIva)}</strong><span class="ageing-slow-hint">${notaFolio ? escapeHtml(notaFolio) : 'A favor del cliente'}</span>`
      : '<span class="ageing-slow-hint">Sin nota</span>';
    const costoCell = costoNeto == null
      ? '—'
      : `<strong>${fmt.money(costoNeto)}</strong>${bonif > 0 ? `<span class="ageing-slow-hint">− Bonif. ${fmt.money(bonif)}</span>` : ''}`;
    return `<tr class="${rowClass}">
      <td class="ageing-slow-carline"><strong>${escapeHtml(carline)}</strong></td>
      <td class="ageing-slow-version" title="${escapeHtml(version)}"><span>${escapeHtml(version)}</span></td>
      <td class="ageing-slow-vin">${renderVendidosFichaCell(r)}</td>
      <td class="cell-num">${r.precio ? fmt.money(r.precio) : '—'}${Number(r.isan || 0) > 0 ? `<span class="ageing-slow-hint">− ISAN ${fmt.money(r.isan)}</span>` : ''}</td>
      <td class="cell-num">${costoCell}</td>
      <td class="cell-num ageing-slow-nota">${notaCell}</td>
      <td class="cell-num ageing-slow-utilidad"><strong>${utilidad == null ? '—' : fmt.money(utilidad)}</strong></td>
      <td class="cell-num ageing-slow-comision">${renderComisionEvCell(r, fmt)}</td>
      <td class="cell-num ageing-slow-extras">${renderExtrasCell(r, fmt)}</td>
      <td class="cell-num ageing-slow-piso">${pisoCell}</td>
      <td class="cell-num ageing-slow-fi">${renderIngresoFiCell(r, fmt)}</td>
      <td class="cell-num ageing-slow-neta"><strong>${utilidadNeta == null ? '—' : fmt.money(utilidadNeta)}</strong></td>
      <td class="cell-num">${renderRetencionCell(pctRetencion(utilidad, utilidadNeta))}</td>
    </tr>`;
  }).join('');
  bindExtrasPopover(body);
  bindFichaPopover(body);
}

function buildVendidosInsightPayload() {
  const rows = Array.isArray(vendidosRows) ? vendidosRows : [];
  const range = currentVendidosRange();
  const netaRows = rows.filter((r) => r.utilidadNeta != null);
  const brutaRows = rows.filter((r) => r.utilidadPromedio != null);
  const utilidadNetaTotal = netaRows.reduce((s, r) => s + Number(r.utilidadNeta || 0), 0);
  const utilidadBrutaTotal = brutaRows.reduce((s, r) => s + Number(r.utilidadPromedio || 0), 0);
  const ingresoFiTotal = rows.reduce((s, r) => s + Number(r.ingresoFinanciamiento || 0), 0);
  const conNetaNegativa = rows.filter((r) => r.utilidadNeta != null && Number(r.utilidadNeta) < 0);
  const sinIngresoFi = rows.filter((r) => !(Number(r.ingresoFinanciamiento) > 0)).length;
  const menudeo = rows.filter((r) => !r.isFlotilla).length;
  const flotilla = rows.filter((r) => r.isFlotilla).length;
  const peoresNeta = conNetaNegativa
    .slice()
    .sort((a, b) => Number(a.utilidadNeta || 0) - Number(b.utilidadNeta || 0))
    .slice(0, 5)
    .map((r) => ({
      vin: r.vin,
      carline: r.carline,
      utilidadNeta: Number(r.utilidadNeta || 0),
    }));
  const monthLabel = (() => {
    const input = document.getElementById('vendidosPeriod');
    const val = input?.value || '';
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [y, m] = val.split('-').map(Number);
      return `${PLAN_PISO_MONTH_NAMES[m - 1] || m} ${y}`;
    }
    return `${range.fechaInicio} — ${range.fechaFin}`;
  })();

  return {
    available: true,
    unidades: rows.length,
    utilidadNetaTotal: Math.round(utilidadNetaTotal * 100) / 100,
    utilidadNetaPromedio: netaRows.length
      ? Math.round((utilidadNetaTotal / netaRows.length) * 100) / 100
      : null,
    utilidadBrutaTotal: Math.round(utilidadBrutaTotal * 100) / 100,
    ingresoFiTotal: Math.round(ingresoFiTotal * 100) / 100,
    sinIngresoFi,
    conNetaNegativa: conNetaNegativa.length,
    menudeo,
    flotilla,
    peoresNeta,
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
    periodoLabel: monthLabel,
  };
}

function renderVendidosKpiCard() {
  renderAutosVendidosInsightsPanel();
}

function buildAutosVendidosInsightCards(payload, fmt) {
  const cards = [];
  const unidades = Number(payload.unidades || 0);

  if (!unidades) {
    cards.push({
      tone: 'warning',
      icon: 'sell',
      title: 'Sin unidades vendidas en el periodo',
      meta: `No hay facturas DMS en ${payload.periodoLabel || 'el periodo seleccionado'}.`,
      action: 'Revisa el periodo del análisis o cruza con Ventas / SOFIA.',
    });
    return cards;
  }

  const pctSinFi = Math.round((payload.sinIngresoFi / unidades) * 1000) / 10;
  const pctNetaNeg = Math.round((payload.conNetaNegativa / unidades) * 1000) / 10;
  const conFi = unidades - payload.sinIngresoFi;

  cards.push({
    tone: 'ok',
    icon: 'analytics',
    title: `${unidades} unidad(es) · neta ${fmt.money(payload.utilidadNetaTotal)}`,
    meta: `Bruta ${fmt.money(payload.utilidadBrutaTotal)} · menudeo ${payload.menudeo} · flotilla ${payload.flotilla}`
      + (payload.utilidadNetaPromedio != null ? ` · neta prom. ${fmt.money(payload.utilidadNetaPromedio)}` : ''),
    action: 'Abre Cierre de unidades vendidas para bajar a VIN y carline.',
  });

  if (payload.conNetaNegativa > 0) {
    const peores = (payload.peoresNeta || []).slice(0, 3)
      .map((p) => `${p.vin || '—'} (${fmt.money(p.utilidadNeta)})`)
      .join(' · ');
    cards.push({
      tone: payload.conNetaNegativa >= 5 || pctNetaNeg >= 40 ? 'critical' : 'warning',
      icon: 'trending_down',
      title: `${payload.conNetaNegativa} venta(s) con utilidad neta negativa (${pctNetaNeg}%)`,
      meta: peores
        ? `Peores: ${peores}`
        : 'Comisión E.V., extras o plan piso están comiendo la bruta.',
      action: 'Prioriza VINs con más días de piso y revisa gastos extra.',
    });
  } else {
    cards.push({
      tone: 'ok',
      icon: 'verified',
      title: 'Todas las ventas cierran con utilidad neta ≥ 0',
      meta: 'Ninguna unidad del periodo queda en rojo tras comisión, extras y plan piso.',
      action: 'Mantén el control de extras y rotación antes del umbral de piso.',
    });
  }

  if (payload.sinIngresoFi > 0) {
    cards.push({
      tone: pctSinFi >= 50 ? 'warning' : 'ok',
      icon: 'account_balance',
      title: `F&I: ${conFi}/${unidades} con pagos GMF (${Math.round(1000 - pctSinFi * 10) / 10}%)`,
      meta: `${payload.sinIngresoFi} sin ingreso F&I · total F&I ${fmt.money(payload.ingresoFiTotal)}.`,
      action: pctSinFi >= 50
        ? 'Cruza VIN/contrato con PAGOS GMF; puede faltar carga o match.'
        : 'Valida que los montos F&I cuadren con comisiones del periodo.',
    });
  } else {
    cards.push({
      tone: 'ok',
      icon: 'payments',
      title: `F&I cubierto · ${fmt.money(payload.ingresoFiTotal)}`,
      meta: 'Todas las unidades del periodo tienen al menos un pago GMF asociado.',
      action: 'Revisa el desglose por concepto en la columna Ingresos F&I.',
    });
  }

  const byCarline = new Map();
  for (const r of vendidosRows || []) {
    const key = r.carline || 'Sin familia';
    const cur = byCarline.get(key) || { n: 0, neta: 0, fi: 0 };
    cur.n += 1;
    cur.neta += Number(r.utilidadNeta || 0);
    cur.fi += Number(r.ingresoFinanciamiento || 0);
    byCarline.set(key, cur);
  }
  const top = [...byCarline.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const worstNeta = [...byCarline.entries()]
    .filter(([, v]) => v.n > 0)
    .sort((a, b) => (a[1].neta / a[1].n) - (b[1].neta / b[1].n))[0];
  if (top) {
    cards.push({
      tone: 'ok',
      icon: 'directions_car',
      title: `Más volumen: ${top[0]} (${top[1].n})`,
      meta: worstNeta
        ? `Menor neta/ud: ${worstNeta[0]} · ${fmt.money(worstNeta[1].neta / worstNeta[1].n)} · F&I carline top ${fmt.money(top[1].fi)}`
        : `F&I del carline ${fmt.money(top[1].fi)}`,
      action: 'Usa el filtro de carline en la tabla de vendidos para profundizar.',
    });
  }

  return cards;
}

function renderAutosVendidosInsightsPanel(payload = buildVendidosInsightPayload()) {
  const { fmt } = Dashboard;
  const box = document.getElementById('autosVendidosInsights');
  const lead = document.getElementById('autosVendidosInsightsLead');
  const compactBox = document.getElementById('autosVendidosInsightsCompact');
  const compactLead = document.getElementById('autosVendidosInsightsCompactLead');
  if (!box) return;

  if (lead) {
    lead.textContent = vendidosLoading
      ? 'Calculando lectura del mes…'
      : `Lectura de ${payload.periodoLabel || 'periodo'} · utilidad, F&I y riesgos`;
  }
  if (compactLead) {
    compactLead.textContent = vendidosLoading
      ? 'Calculando resumen…'
      : `${payload.periodoLabel || 'Periodo'} · utilidad, F&I y riesgos`;
  }

  if (vendidosLoading) {
    const loadingHtml = `<div class="int-acq-alert int-acq-alert--ok">
      <span class="material-symbols-outlined int-acq-alert__icon">hourglass_empty</span>
      <div>
        <p class="int-acq-alert__title">Cargando insights…</p>
        <p class="int-acq-alert__meta">Se calculan con el cierre de unidades vendidas del periodo.</p>
      </div>
    </div>`;
    box.innerHTML = loadingHtml;
    if (compactBox) compactBox.innerHTML = loadingHtml;
    return;
  }

  const cards = buildAutosVendidosInsightCards(payload, fmt);

  box.innerHTML = cards.map((c) => `
    <article class="int-acq-alert int-acq-alert--${c.tone}">
      <span class="material-symbols-outlined int-acq-alert__icon">${c.icon}</span>
      <div>
        <p class="int-acq-alert__title">${escapeHtml(c.title)}</p>
        <p class="int-acq-alert__meta">${escapeHtml(c.meta)}</p>
        <p class="int-acq-alert__action">${escapeHtml(c.action)}</p>
      </div>
    </article>
  `).join('');
  if (compactBox) {
    compactBox.innerHTML = cards.slice(0, 2).map((c) => `
      <article class="int-acq-alert int-acq-alert--${c.tone}">
        <span class="material-symbols-outlined int-acq-alert__icon">${c.icon}</span>
        <div>
          <p class="int-acq-alert__title">${escapeHtml(c.title)}</p>
          <p class="int-acq-alert__meta">${escapeHtml(c.meta)}</p>
        </div>
      </article>
    `).join('');
  }
}

function applyInventoryInsights() {
  if (!window.KpiInsights?.apply) return;
  const s = lastInventorySummary || {};
  const pv = postventaData || {};
  const tr = pv.traspasos?.summary || {};
  window.KpiInsights.apply('inventory', {
    planPisoPeriod: lastInventoryPlanPisoPeriod,
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
    vendidos: buildVendidosInsightPayload(),
    postventa: {
      totalCosto: pv.overview?.totalCosto,
      servicio: pv.overview?.servicio,
      refacciones: pv.overview?.refacciones,
      hyp: pv.overview?.hyp,
      traspasos: tr,
    },
  });
}

async function loadVendidosAnalisis({ quiet = false } = {}) {
  const { api } = Dashboard;
  const range = currentVendidosRange();
  vendidosLoading = true;
  renderVendidosKpiCard();
  if (!quiet) renderVendidosTable([]);
  try {
    const data = await api(`/inventory/vendidos?fechaInicio=${encodeURIComponent(range.fechaInicio)}&fechaFin=${encodeURIComponent(range.fechaFin)}`);
    vendidosRows = Array.isArray(data.vendidosTable) ? data.vendidosTable : [];
    vendidosCarlineFilters = Array.isArray(data.carlineFilters) ? data.carlineFilters : [];
    renderVendidosCarlineFilterTabs(vendidosCarlineFilters);
    renderVendidosTable();
    renderIemcF2(data.iemc || null);
  } catch (err) {
    vendidosRows = [];
    vendidosCarlineFilters = [];
    const body = document.getElementById('vendidosSlowBody');
    if (body) {
      body.innerHTML = `<tr><td colspan="13" class="empty-row">${escapeHtml(err.message || 'No se pudieron cargar las ventas.')}</td></tr>`;
    }
    renderIemcF2(null, err.message);
  } finally {
    vendidosLoading = false;
    renderVendidosKpiCard();
    applyInventoryInsights();
  }
}

function iemcTone(pct) {
  if (pct == null) return '';
  if (pct >= 100) return 'is-ok';
  if (pct >= 90) return 'is-warn';
  return 'is-neg';
}

function iemcFuenteLabel(src) {
  if (src === 'dms_catalogo') return 'catálogo DMS';
  if (src === 'dms_inventario') return 'remisión DMS (piso)';
  if (src === 'dms_vendidos') return 'ventas del mes (costo)';
  if (src === 'faltante') return 'faltante';
  return src || '';
}

function renderIemcF2(data, errorMessage) {
  const { fmt } = Dashboard;
  const setTxt = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const setTone = (id, tone) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-ok', 'is-warn', 'is-neg');
    if (tone) el.classList.add(tone);
  };

  if (errorMessage) {
    setTxt('iemcF2MargenReal', '—');
    setTxt('iemcF2MargenObj', '—');
    setTxt('iemcF2Iemc', '—');
    setTxt('iemcF2Brecha', '—');
    setTone('iemcF2MargenReal', '');
    setTone('iemcF2MargenObj', '');
    setTone('iemcF2Iemc', '');
    setTone('iemcF2Brecha', '');
    const status = document.getElementById('iemcF2Status');
    if (status) {
      status.textContent = errorMessage;
      status.classList.add('is-warn');
    }
    const body = document.getElementById('iemcF2MixBody');
    if (body) body.innerHTML = `<tr><td colspan="9" class="empty-row">${escapeHtml(errorMessage)}</td></tr>`;
    return;
  }

  const real = data?.real || {};
  const obj = data?.objetivo || {};
  const iemc = data?.iemcPct;
  const brecha = data?.brecha;
  setTxt('iemcF2MargenReal', real.margenBrutoPct == null ? '—' : `${real.margenBrutoPct.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`);
  setTxt('iemcF2MargenObj', obj.margenBrutoPct == null ? '—' : `${obj.margenBrutoPct.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`);
  setTxt('iemcF2Iemc', iemc == null ? '—' : `${iemc.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`);
  setTxt('iemcF2Brecha', brecha == null ? '—' : fmt.money(brecha));
  setTxt('iemcF2MargenRealHint', `UBA ${fmt.money(real.uba || 0)} ÷ ${fmt.money(real.ventaNeta || 0)}`);
  setTxt('iemcF2MargenObjHint', `UBA ${fmt.money(obj.uba || 0)} ÷ ${fmt.money(obj.ventaNeta || 0)}`);
  setTone('iemcF2Iemc', iemcTone(iemc));
  setTone('iemcF2Brecha', brecha == null ? '' : (brecha >= 0 ? 'is-ok' : 'is-neg'));

  const status = document.getElementById('iemcF2Status');
  if (status) {
    const bits = [];
    if (!data?.mixDisponible) bits.push('Sin mix objetivo para este mes. Cargue el PDF en Objetivos Web.');
    else if (data.plantilla?.aplicadaAlPeriodo) bits.push(`Mix fijo ${data.plantilla.label || data.periodo} · UO del PDF · PL/CF del DMS.`);
    else bits.push(`Mix de captura ${data.periodo}.`);
    if (data?.incompleto) bits.push(`Faltan PL en ${obj.lineasSinPl || 0} línea(s) y CF en ${obj.lineasSinCf || 0}.`);
    if (real.unidadesSinUba) bits.push(`${real.unidadesSinUba} unidad(es) sin utilidad bruta no entran al IEMC.`);
    status.textContent = bits.join(' ');
    status.classList.toggle('is-warn', Boolean(!data?.mixDisponible || data?.incompleto));
  }

  const footnote = document.getElementById('iemcF2Footnote');
  if (footnote) {
    footnote.textContent = Array.isArray(data?.notas) ? data.notas[0] : '';
  }

  const body = document.getElementById('iemcF2MixBody');
  if (!body) return;
  const rows = Array.isArray(data?.mix) ? data.mix : [];
  const otras = Array.isArray(data?.otrasLineasReales) ? data.otrasLineasReales : [];
  if (!rows.length && !otras.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty-row">Sin mix objetivo para el mes.</td></tr>';
    return;
  }

  const cellMoney = (n) => (n == null ? '—' : fmt.money(n));

  const mixHtml = rows.map((r) => {
    const plCell = `${cellMoney(r.pl)}<span class="iemc-f2-src">${escapeHtml(iemcFuenteLabel(r.plFuente))}</span>`;
    const cfCell = `${cellMoney(r.cf)}<span class="iemc-f2-src">${escapeHtml(iemcFuenteLabel(r.cfFuente))}</span>`;
    return `<tr>
      <td><strong>${escapeHtml(r.linea)}</strong>${r.familia ? `<span class="ageing-slow-hint">${escapeHtml(r.familia)}</span>` : ''}</td>
      <td class="cell-num">${Number(r.uo || 0)}</td>
      <td class="cell-num">${plCell}</td>
      <td class="cell-num">${cfCell}</td>
      <td class="cell-num">${cellMoney(r.ventaObjetivo)}</td>
      <td class="cell-num">${cellMoney(r.ubaObjetivo)}</td>
      <td class="cell-num">${Number(r.unidadesReales || 0)}</td>
      <td class="cell-num">${cellMoney(r.ventaNetaReal)}</td>
      <td class="cell-num">${cellMoney(r.ubaReal)}</td>
    </tr>`;
  }).join('');

  const otrasHtml = otras.map((r) => `<tr>
    <td><strong>${escapeHtml(r.linea)}</strong><span class="ageing-slow-hint">Vendido sin línea en el mix</span></td>
    <td class="cell-num">—</td>
    <td class="cell-num">—</td>
    <td class="cell-num">—</td>
    <td class="cell-num">—</td>
    <td class="cell-num">—</td>
    <td class="cell-num">${Number(r.unidadesReales || 0)}</td>
    <td class="cell-num">${cellMoney(r.ventaNetaReal)}</td>
    <td class="cell-num">${cellMoney(r.ubaReal)}</td>
  </tr>`).join('');

  body.innerHTML = mixHtml + otrasHtml;
}

function renderAgeingSlowTable(rows = filteredAgeingSlowRows()) {
  closeExtrasPopover();
  const body = document.getElementById('ageingSlowBody');
  if (!body) return;
  const { fmt } = Dashboard;

  const list = Array.isArray(rows) ? rows : [];
  const meta = document.getElementById('ageingSearchMeta');
  if (meta) {
    const filtered = ageingSearch.trim() || ageingCarlineFilter !== 'all';
    meta.classList.toggle('hidden', !filtered);
    if (filtered) meta.textContent = `${list.length} de ${ageingSlowRows.length}`;
  }

  if (!list.length) {
    const empty = ageingSlowRows.length
      ? 'Sin coincidencias para el filtro.'
      : 'Sin inventario real (DIS / FIS / SEP) para analizar.';
    body.innerHTML = `<tr><td colspan="11" class="empty-row">${empty}</td></tr>`;
    return;
  }

  body.innerHTML = list.map((r) => {
    const carline = r.carline || (r.model ? String(r.model).split(' · ')[0] : '—');
    const version = r.version || (r.model ? String(r.model).split(' · ').slice(1).join(' · ') : '—') || '—';
    const paquete = String(r.paquete || '').trim();
    const versionLabel = paquete && !version.toUpperCase().includes(` ${paquete}`)
      ? `${version} · ${paquete}`
      : version;
    const vin = r.vin || '—';
    const days = r.daysInStock == null ? Number(r.avgDays || 0) : Number(r.daysInStock);
    const utilidad = r.utilidadPromedio == null ? null : Number(r.utilidadPromedio);
    const utilidadNeta = r.utilidadNeta == null ? null : Number(r.utilidadNeta);
    const vendidas = Number(r.unidadesVendidas || 0);
    const planPiso = Number(r.planPisoAcumulado || 0);
    const generaInteres = Boolean(r.generaInteres) || days > 30;
    const extrasComenUtilidad = utilidadNeta != null && utilidadNeta < 0;
    const pisoSuperaUtilidad = extrasComenUtilidad || (utilidad != null && planPiso > utilidad);
    const rowClass = [
      pisoSuperaUtilidad ? 'ageing-slow-row--piso-over' : '',
      !pisoSuperaUtilidad && (r.critical || days >= 90) ? 'ageing-slow-row--critical' : '',
      !pisoSuperaUtilidad && (r.warn || days >= 60) ? 'ageing-slow-row--warn' : '',
    ].filter(Boolean).join(' ');
    const costoNeto = costoNetoConBonif(r);
    const bonif = Number(r.bonificacion || 0);
    const notaSinIva = notaCreditoSinIva(r);
    const utilidadCell = utilidad == null
      ? '<span class="ageing-slow-hint">Sin histórico</span>'
      : `<strong>${fmt.money(utilidad)}</strong><span class="ageing-slow-hint">${vendidas.toLocaleString('es-MX')} vendida${vendidas === 1 ? '' : 's'}</span>`;
    const extrasCell = renderExtrasCell(r, fmt);
    const pisoCell = generaInteres && planPiso > 0
      ? `<strong>${fmt.money(planPiso)}</strong><span class="ageing-slow-hint">${pisoSuperaUtilidad ? 'Come utilidad' : '+30 días'}</span>`
      : '<span class="ageing-slow-hint">Sin cargo</span>';
    const netaCell = utilidadNeta == null
      ? '<span class="ageing-slow-hint">—</span>'
      : `<strong>${fmt.money(utilidadNeta)}</strong>`;
    const costoCell = costoNeto == null
      ? '—'
      : `<strong>${fmt.money(costoNeto)}</strong>${bonif > 0 ? `<span class="ageing-slow-hint">− Bonif. ${fmt.money(bonif)}</span>` : ''}`;
    const notaCell = notaSinIva > 0
      ? `<strong>${fmt.money(notaSinIva)}</strong>`
      : '<span class="ageing-slow-hint">Sin nota</span>';
    return `<tr class="${rowClass}">
      <td class="ageing-slow-carline"><strong>${escapeHtml(carline)}</strong></td>
      <td class="ageing-slow-version" title="${escapeHtml(versionLabel)}"><span>${escapeHtml(versionLabel)}</span></td>
      <td class="ageing-slow-vin" title="${escapeHtml(vin)}">${escapeHtml(vin)}</td>
      <td class="cell-num">${r.precio ? fmt.money(r.precio) : '—'}</td>
      <td class="cell-num">${costoCell}</td>
      <td class="cell-num ageing-slow-nota">${notaCell}</td>
      <td class="cell-num ageing-slow-utilidad">${utilidadCell}</td>
      <td class="cell-num ageing-slow-extras">${extrasCell}</td>
      <td class="cell-num ageing-slow-piso">${pisoCell}</td>
      <td class="cell-num ageing-slow-neta">${netaCell}</td>
      <td class="cell-num">${renderRetencionCell(pctRetencion(utilidad, utilidadNeta))}</td>
    </tr>`;
  }).join('');
  bindExtrasPopover(body);
  renderPlanPisoCommercialScenario();
}

const PLAN_PISO_DAILY_FACTOR = 0.00020778;

function estimatePlanPisoBurnPerDay(row) {
  const planPiso = Number(row.planPisoAcumulado || 0);
  const chargeable = Number(row.daysChargeable || 0);
  if (planPiso > 0 && chargeable > 0) return planPiso / chargeable;
  const base = Number(row.precio || row.costo || 450000) || 450000;
  return base * PLAN_PISO_DAILY_FACTOR;
}

function pickPlanPisoStrategy(row, ctx) {
  const days = ageingDaysOf(row);
  const planPiso = Number(row.planPisoAcumulado || 0);
  const neta = row.utilidadNeta == null ? null : Number(row.utilidadNeta);
  const bruta = row.utilidadPromedio == null ? null : Number(row.utilidadPromedio);
  const carline = String(row.carline || '').toUpperCase();
  const isTruck = /SILVERADO|CHEYENNE|TAHOE|SUBURBAN|COLORADO|TRAVERSE|EXPRESS/.test(carline);
  const burn = ctx.burnDay;
  const costo15 = ctx.costo15d;
  const incentivo = ctx.incentivoMax;

  if (neta != null && neta < 0 && planPiso > Math.abs(neta)) {
    return {
      priority: 'Crítica',
      tone: 'critical',
      code: 'break-even',
      title: 'Salida a break-even / transferencia',
      detail: `La neta ya está en ${Dashboard.fmt.money(neta)} y el piso (${Dashboard.fmt.money(planPiso)}) sigue comiendo margen. Mejor mover ya aunque sea a margen cero.`,
      plays: [
        `Autorizar descuento hasta ${Dashboard.fmt.money(incentivo)} si cierra en ≤7 días.`,
        'Ofertar a otras sucursales / intercambio de planta si no hay retail caliente.',
        'No invertir más en previa/publicidad de esta unidad.',
      ],
    };
  }

  if (days >= 90) {
    return {
      priority: 'Alta',
      tone: 'critical',
      code: 'liquidacion',
      title: 'Liquidación 90+ · liberar piso',
      detail: `${days} días en stock. Cada quincena suma ~${Dashboard.fmt.money(burn * 15)} de interés. El costo de no vender supera un descuento puntual.`,
      plays: [
        `Publicar oferta flash 72 h con techo ${Dashboard.fmt.money(incentivo)}.`,
        'Asignar un EV dueño + seguimiento diario en CRM.',
        isTruck
          ? 'Empujar a flotilla / gobierno / taxi con bonos de volumen.'
          : 'Cruzar con leads de prueba de manejo del mismo carline.',
      ],
    };
  }

  if (days >= 60) {
    return {
      priority: 'Alta',
      tone: 'warning',
      code: 'promo-fi',
      title: 'Promo retail + paquete F&I',
      detail: `En 60–89 días aún hay margen para recuperar con F&I. 15 días más cuestan ~${Dashboard.fmt.money(costo15)}; un GAP/OnStar bien colocado puede compensar parte del incentivo.`,
      plays: [
        `Descuento visible ≤ ${Dashboard.fmt.money(incentivo * 0.7)} + bono F&I al asesor.`,
        'Demo en piso / prueba de manejo obligatoria esta semana.',
        bruta != null
          ? `Proteger bruta histórica (~${Dashboard.fmt.money(bruta)}) no regalando todo el incentivo de golpe.`
          : 'Validar utilidad histórica del carline antes de bajar lista.',
      ],
    };
  }

  if (isTruck) {
    return {
      priority: 'Media',
      tone: 'warning',
      code: 'flotilla',
      title: 'Empuje flotilla / corporativo',
      detail: `${carline || 'Unidad'} con ticket alto: el plan piso duele rápido. Canal flotilla suele cerrar más rápido que menudeo puro.`,
      plays: [
        'Lista corta a 3 cuentas flotilla activas esta semana.',
        `Incentivo negociable hasta ${Dashboard.fmt.money(incentivo)} si facturan en 10 días.`,
        'Preparar dossier (ficha, stock, entrega) para gerente de flotillas.',
      ],
    };
  }

  return {
    priority: 'Media',
    tone: 'ok',
    code: 'spotlight',
    title: 'Spotlight en piso + agenda de pruebas',
    detail: `Todavía es recuperable con rotación comercial. Si se queda 15 días más, el piso suma ~${Dashboard.fmt.money(costo15)}.`,
    plays: [
      'Ubicar en plaza premium / rotar a demo de patio.',
      `Tope de cortesía comercial ${Dashboard.fmt.money(incentivo * 0.5)} solo con cierre en cita.`,
      'Activar 5 leads calientes del mismo carline en Seguimiento 360.',
    ],
  };
}

function buildPlanPisoScenarioRows(sourceRows = ageingSlowRows) {
  const withPiso = (sourceRows || [])
    .filter((r) => Number(r.planPisoAcumulado || 0) > 0)
    .slice()
    .sort((a, b) => Number(b.planPisoAcumulado || 0) - Number(a.planPisoAcumulado || 0)
      || ageingDaysOf(b) - ageingDaysOf(a));

  return withPiso.slice(0, 8).map((r, idx) => {
    const planPiso = Number(r.planPisoAcumulado || 0);
    const burnDay = estimatePlanPisoBurnPerDay(r);
    const costo15d = burnDay * 15;
    const incentivoMax = Math.round(Math.max(costo15d * 1.1, planPiso * 0.5) * 100) / 100;
    const ctx = { burnDay, costo15d, incentivoMax };
    const strategy = pickPlanPisoStrategy(r, ctx);
    return {
      rank: idx + 1,
      row: r,
      planPiso,
      burnDay,
      costo15d,
      incentivoMax,
      strategy,
    };
  });
}

function renderPlanPisoCommercialScenario(rows = ageingSlowRows) {
  const { fmt } = Dashboard;
  const body = document.getElementById('invPisoScenarioBody');
  const cardsEl = document.getElementById('invPisoScenarioCards');
  const banner = document.getElementById('invPisoScenarioBanner');
  const lead = document.getElementById('invPisoScenarioLead');
  const badge = document.getElementById('invPisoScenarioBadge');
  if (!body || !cardsEl) return;

  const scenario = buildPlanPisoScenarioRows(rows);
  const totalPiso = scenario.reduce((s, x) => s + x.planPiso, 0);
  const burn15 = scenario.reduce((s, x) => s + x.costo15d, 0);
  const criticas = scenario.filter((x) => x.strategy.tone === 'critical').length;

  if (lead) {
    lead.textContent = scenario.length
      ? `Top ${scenario.length} VIN por cargo de plan piso · si no salen en 15 días el interés adicional estimado es ${fmt.money(burn15)}.`
      : 'Cuando haya unidades con cargo de plan piso (+30 días), aquí verás el tablero de salida para gerencia comercial.';
  }
  if (badge) {
    badge.textContent = scenario.length ? `${scenario.length} prioritarias` : 'Sin cargo';
  }

  if (banner) {
    if (!scenario.length) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.className = criticas
        ? 'int-acq-banner int-acq-banner--warning'
        : 'int-acq-banner int-acq-banner--ok';
      banner.textContent = criticas
        ? `${criticas} unidad(es) en prioridad crítica · piso en foco ${fmt.money(totalPiso)} · riesgo +15 días ${fmt.money(burn15)}.`
        : `Piso en foco ${fmt.money(totalPiso)} · riesgo financiero +15 días ${fmt.money(burn15)}. Ejecuta el playbook por VIN.`;
    }
  }

  if (!scenario.length) {
    cardsEl.innerHTML = `<article class="int-acq-alert int-acq-alert--ok">
      <span class="material-symbols-outlined int-acq-alert__icon">verified</span>
      <div>
        <p class="int-acq-alert__title">Sin unidades con plan piso activo</p>
        <p class="int-acq-alert__meta">El inventario filtrado no tiene cargos (+30 días). El escenario se activa al detectar intereses.</p>
        <p class="int-acq-alert__action">Mantén rotación antes del día 31 para no abrir este tablero.</p>
      </div>
    </article>`;
    body.innerHTML = '<tr><td colspan="9" class="empty-row">Sin unidades con plan piso en el filtro actual.</td></tr>';
    return;
  }

  const playbooks = [];
  const byCode = new Map();
  for (const item of scenario) {
    const key = item.strategy.code;
    if (!byCode.has(key)) {
      byCode.set(key, {
        ...item.strategy,
        count: 0,
        piso: 0,
        sample: item.row.vin,
      });
    }
    const agg = byCode.get(key);
    agg.count += 1;
    agg.piso += item.planPiso;
  }
  for (const pb of byCode.values()) playbooks.push(pb);
  playbooks.sort((a, b) => b.count - a.count || b.piso - a.piso);

  cardsEl.innerHTML = playbooks.map((pb) => `
    <article class="int-acq-alert int-acq-alert--${pb.tone === 'ok' ? 'ok' : pb.tone === 'critical' ? 'critical' : 'warning'}">
      <span class="material-symbols-outlined int-acq-alert__icon">${pb.tone === 'critical' ? 'priority_high' : pb.tone === 'warning' ? 'campaign' : 'lightbulb'}</span>
      <div>
        <p class="int-acq-alert__title">${escapeHtml(pb.title)} · ${pb.count} VIN</p>
        <p class="int-acq-alert__meta">${escapeHtml(pb.detail)}</p>
        <ul class="inv-piso-scenario__plays">
          ${(pb.plays || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
        </ul>
        <p class="int-acq-alert__action">Piso en este playbook: ${fmt.money(pb.piso)}${pb.sample ? ` · ej. ${escapeHtml(pb.sample)}` : ''}</p>
      </div>
    </article>
  `).join('');

  body.innerHTML = scenario.map((item) => {
    const r = item.row;
    const carline = r.carline || '—';
    const version = r.version || '—';
    const vin = r.vin || '—';
    const days = ageingDaysOf(r);
    const tone = item.strategy.tone;
    return `<tr class="inv-piso-scenario__row inv-piso-scenario__row--${tone}">
      <td>${item.rank}</td>
      <td><span class="inv-piso-scenario__pill inv-piso-scenario__pill--${tone}">${escapeHtml(item.strategy.priority)}</span></td>
      <td>
        <strong>${escapeHtml(carline)}</strong>
        <span class="ageing-slow-hint">${escapeHtml(version)}</span>
        <span class="ageing-slow-hint">${escapeHtml(vin)}</span>
      </td>
      <td class="cell-num">${fmt.number(days)}</td>
      <td class="cell-num"><strong>${fmt.money(item.planPiso)}</strong></td>
      <td class="cell-num">${fmt.money(item.burnDay)}</td>
      <td class="cell-num">${fmt.money(item.costo15d)}</td>
      <td class="cell-num"><strong>${fmt.money(item.incentivoMax)}</strong></td>
      <td>
        <strong>${escapeHtml(item.strategy.title)}</strong>
        <span class="ageing-slow-hint">${escapeHtml((item.strategy.plays || [])[0] || '')}</span>
      </td>
    </tr>`;
  }).join('');
}

function renderCharts(data) {
  ageingSlowRows = Array.isArray(data.ageingSlowTable)
    ? data.ageingSlowTable
    : (Array.isArray(data.ageingChart) ? data.ageingChart : []);
  ageingCarlineFilters = Array.isArray(data.ageingCarlineFilters) ? data.ageingCarlineFilters : [];
  renderAgeingCarlineFilterTabs(ageingCarlineFilters);
  renderAgeingSlowTable();

  destroyChart(ageingChart);
  ageingChart = null;
}

async function loadInventory({ onlyPlanPiso = false, quiet = false } = {}) {
  const { fmt, api, showLoading, setText } = Dashboard;
  const status = document.getElementById('statusBadge');
  const period = getPlanPisoPeriod();
  if (!quiet) {
    if (status) {
      status.textContent = 'Consultando...';
      status.className = 'sidebar-status-line status-loading';
    }
    showLoading(true);
  }

  try {
    const data = await api(`/inventory?planPisoPeriod=${encodeURIComponent(period)}`);
    const s = data.summary;
    lastInventorySummary = s;
    lastInventoryPlanPisoPeriod = period;

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
      const demosCount = s.demos ?? inventoryRows.filter((r) => r.situacion === 'DEMO').length;
      setText('sDemos', fmt.number(demosCount));
      setText(
        'sDemosSub',
        demosCount
          ? `Prom. ${fmt.number(s.avgDaysDemo ?? 0)} d · ${fmt.number(s.demosPruebasTotal ?? 0)} pruebas`
          : 'Sin unidades DEMO'
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
      if (!quiet && status) {
        status.textContent = `${s.totalUnits} unidades en inventario`;
        status.className = 'sidebar-status-line';
      }
    } else {
      setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
      if (!quiet && status) {
        status.textContent = `Plan Piso · ${s.planPisoPeriodLabel}`;
        status.className = 'sidebar-status-line';
      }
    }

    if (quiet) {
      setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
    }

    await loadEntregasSinPreviasMes({ quiet });
    applyInventoryInsights();
  } catch (err) {
    if (!quiet && status) {
      status.textContent = err.message;
      status.className = 'sidebar-status-line status-error';
    }
    console.error('[Inventario]', err);
  } finally {
    if (!quiet) showLoading(false);
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

function currentInventoryGlobalRange() {
  const fi = String(document.getElementById('fechaInicio')?.value || '').trim();
  const ff = String(document.getElementById('fechaFin')?.value || '').trim();
  if (fi && ff) {
    return {
      fechaInicio: fi,
      fechaFin: ff,
      label: Dashboard.formatPeriodLabel ? Dashboard.formatPeriodLabel(fi, ff) : `${fi} — ${ff}`,
    };
  }
  return currentMonthRange();
}

function inventoryDefaultDateRange() {
  const now = new Date();
  // Días 1 y 2: mostrar por defecto el mes que acaba de cerrar.
  if (now.getDate() <= 2) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      fechaInicio: Dashboard.formatDateInput ? Dashboard.formatDateInput(start) : isoDate(start),
      fechaFin: Dashboard.formatDateInput ? Dashboard.formatDateInput(end) : isoDate(end),
    };
  }
  return Dashboard.getDefaultDateRange ? Dashboard.getDefaultDateRange() : currentMonthRange();
}

async function loadEntregasSinPreviasMes({ quiet = false } = {}) {
  const { api, setText, fmt } = Dashboard;
  if (entregasSinPreviasLoading) return;
  entregasSinPreviasLoading = true;
  const range = currentInventoryGlobalRange();
  if (!quiet) {
    setText('sEntregasSinPreviasSub', 'Actualizando SOFIA…');
  }

  try {
    const data = await api(`/ventas?fechaInicio=${range.fechaInicio}&fechaFin=${range.fechaFin}`);
    const entregas = data.entregasSofia || [];
    const sinPrevias = entregas.filter((r) => Number(r.PREVIAS || 0) === 0);
    window.__invSofiaSinPrevias = sinPrevias;
    window.__invSofiaTotalMes = entregas.length;
    const facturado = (data.registros || [])
      .filter((r) => Number(r.PREVIAS || 0) === 0)
      .map((r) => ({ ...r, _kind: 'facturado' }));
    window.__invFacturadoSinPrevias = facturado;
    const conPrevias = entregas.length - sinPrevias.length;
    const stamp = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    setText('sEntregasSinPrevias', fmt.number(sinPrevias.length));
    setText(
      'sEntregasSinPreviasSub',
      `${fmt.number(conPrevias)} con previas · ${fmt.number(facturado.length)} fact. sin previa · ${range.label} · ${stamp}`
    );
    if (activeAutosKpi === 'entregasSinPrevias' || activeAutosKpi === 'sinPrevias') {
      ensureAutosKpiDrawer().refresh();
    }
  } catch (err) {
    console.warn('[Inventario] Entregas sin previa:', err.message);
    window.__invSofiaSinPrevias = [];
    window.__invSofiaTotalMes = 0;
    window.__invFacturadoSinPrevias = [];
    setText('sEntregasSinPrevias', '—');
    setText('sEntregasSinPreviasSub', 'No se pudo cargar SOFIA del mes');
    if (activeAutosKpi === 'entregasSinPrevias' || activeAutosKpi === 'sinPrevias') {
      ensureAutosKpiDrawer().refresh();
    }
  } finally {
    entregasSinPreviasLoading = false;
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
  const next = ['autos', 'cierre', 'seminuevos', 'postventa'].includes(scope) ? scope : 'autos';
  inventoryScope = next;
  if (inventoryScope !== 'autos' && autosDrawerUi?.panel?.classList.contains('ops-orders-drawer--open')) {
    autosDrawerUi.close();
  }
  if (inventoryScope !== 'seminuevos' && semiDrawerUi?.panel?.classList.contains('ops-orders-drawer--open')) {
    semiDrawerUi.close();
  }
  document.querySelectorAll('#inventoryMainTabs .eeff-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.inventoryScope === inventoryScope);
  });
  document.getElementById('panelInventarioAutos')?.classList.toggle('hidden', inventoryScope !== 'autos');
  document.getElementById('panelInventarioCierre')?.classList.toggle('hidden', inventoryScope !== 'cierre');
  document.getElementById('panelInventarioSeminuevos')?.classList.toggle('hidden', inventoryScope !== 'seminuevos');
  document.getElementById('panelInventarioPostventa')?.classList.toggle('hidden', inventoryScope !== 'postventa');

  const title = document.querySelector('.top-bar-title');
  if (title) {
    title.textContent = inventoryScope === 'postventa'
      ? 'Inventario · Postventa'
      : inventoryScope === 'seminuevos'
        ? 'Inventario · Autos seminuevos'
        : inventoryScope === 'cierre'
          ? 'Inventario · Cierre de unidades vendidas'
          : 'Gestión de Inventario';
  }

  if (inventoryScope === 'postventa') {
    postventaLoaded = false;
    loadInventoryPostventa({ force: true });
  } else if (inventoryScope === 'seminuevos') {
    loadInventorySeminuevos();
  } else if (inventoryScope === 'cierre' && !vendidosRows.length && !vendidosLoading) {
    loadVendidosAnalisis({ quiet: true });
  }
}

function gotoCierreUnidadesVendidas() {
  setInventoryScope('cierre');
  requestAnimationFrame(() => {
    document.getElementById('panelInventarioCierre')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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
  renderPostventaInsights(data);
  renderPostventaTraspasos(data);
}

function renderPostventaInsights(data) {
  const root = document.getElementById('pvInsightsCards');
  const meta = document.getElementById('pvInsightsMeta');
  if (!root) return;
  const list = data?.insights || [];
  if (meta) {
    const p = data?.periodo || {};
    meta.textContent = p.fechaInicio && p.fechaFin
      ? `${list.length} hallazgos · ${p.fechaInicio} — ${p.fechaFin}`
      : `${list.length} hallazgos`;
  }
  if (!list.length) {
    root.innerHTML = '<p class="section-subtitle" style="margin:0">Sin insights para el periodo.</p>';
    return;
  }
  root.innerHTML = list.map((c) => `
    <article class="ref-alerta ref-alerta--${escapeHtml(c.severity || 'info')}">
      <span class="material-symbols-outlined ref-alerta__icon" aria-hidden="true">${escapeHtml(c.icon || 'insights')}</span>
      <div class="ref-alerta__body">
        <h4 class="ref-alerta__title">${escapeHtml(c.title || '')}</h4>
        <p class="ref-alerta__summary">${escapeHtml(c.summary || '')}</p>
        ${c.detail ? `<p class="ref-alerta__detail">${escapeHtml(c.detail)}</p>` : ''}
        ${c.action ? `<p class="ref-alerta__action">${escapeHtml(c.action)}</p>` : ''}
      </div>
    </article>
  `).join('');
}

function renderPostventaTraspasos(data) {
  const { fmt, setText } = Dashboard;
  const tr = data?.traspasos || {};
  const s = tr.summary || {};
  const p = tr.periodo || data?.periodo || {};
  setText('pvKpiTraspasosPiezas', fmt.number(s.piezas || 0));
  setText('pvKpiTraspasosPartes', fmt.number(s.partes || 0));
  setText('pvKpiTraspasosDocs', fmt.number(s.documentos || 0));
  setText('pvKpiTraspasosCosto', fmt.currency(s.costo || 0));
  const meta = document.getElementById('pvTraspasosMeta');
  if (meta) {
    meta.textContent = p.fechaInicio && p.fechaFin
      ? `${p.fechaInicio} — ${p.fechaFin}`
      : '—';
  }
  const sub = document.getElementById('pvTraspasosSubtitle');
  if (sub) {
    sub.textContent = tr.fuente || 'Piezas movidas DE un almacén A otro (PAR_MOVTOS)';
  }

  const rutasEl = document.getElementById('pvTraspasosRutas');
  if (rutasEl) {
    const rows = tr.rutas || [];
    rutasEl.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td><strong>${escapeHtml(r.ruta || `${r.origen} → ${r.destino}`)}</strong></td>
          <td class="cell-num">${fmt.number(r.lineas || 0)}</td>
          <td class="cell-num">${fmt.number(r.piezas || 0)}</td>
          <td class="cell-money">${fmt.money(r.costo || 0)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="4">Sin traspasos en el periodo.</td></tr>';
  }

  const topEl = document.getElementById('pvTraspasosTopPartes');
  if (topEl) {
    const rows = tr.topPartes || [];
    topEl.innerHTML = rows.length
      ? rows.slice(0, 25).map((r) => `
        <tr>
          <td><strong>${escapeHtml(r.parte || '')}</strong></td>
          <td>${escapeHtml(r.descripcion || '—')}</td>
          <td class="cell-num">${fmt.number(r.movimientos || 0)}</td>
          <td class="cell-num">${fmt.number(r.piezas || 0)}</td>
          <td class="cell-money">${fmt.money(r.costo || 0)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="5">Sin partes traspasadas.</td></tr>';
  }

  const detEl = document.getElementById('pvTraspasosDetalle');
  if (detEl) {
    const rows = tr.detalle || [];
    detEl.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.fecha || '—')}</td>
          <td><strong>${escapeHtml(r.parte || '')}</strong></td>
          <td>${escapeHtml(r.descripcion || '—')}</td>
          <td>${escapeHtml(r.origen || '—')}</td>
          <td>${escapeHtml(r.destino || '—')}</td>
          <td class="cell-num">${fmt.number(r.piezas || 0)}</td>
          <td class="cell-money">${fmt.money(r.costo || 0)}</td>
          <td>${escapeHtml(r.observa || '')}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="8">Sin detalle de traspasos.</td></tr>';
  }
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
    applyInventoryInsights();
    return;
  }

  const { api, showLoading, setText } = Dashboard;
  const status = document.getElementById('statusBadge');
  status.textContent = 'Consultando Postventa...';
  status.className = 'sidebar-status-line status-loading';
  showLoading(true);

  try {
    let fi = document.getElementById('fechaInicio')?.value || '';
    let ff = document.getElementById('fechaFin')?.value || '';
    if ((!fi || !ff) && typeof currentVendidosRange === 'function') {
      try {
        const range = currentVendidosRange();
        fi = range?.fechaInicio || fi;
        ff = range?.fechaFin || ff;
      } catch {
        /* ignore */
      }
    }
    const qs = fi && ff
      ? `?fechaInicio=${encodeURIComponent(fi)}&fechaFin=${encodeURIComponent(ff)}`
      : '';
    postventaData = await api(`/inventory/postventa${qs}`);
    postventaLoaded = true;
    renderPostventaOverview(postventaData);
    renderPostventaArea();
    applyInventoryInsights();
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

function escSemiHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSeminuevosOverview(data) {
  const { fmt, setText } = Dashboard;
  const s = data?.summary || {};
  setText('semiTotal', fmt.number(s.totalUnits || 0));
  setText('semiValorAdq', moneyInt(s.valorAdquisicion || 0));
  setText('semiValorAdqSub', `Ticket prom. ${moneyInt(s.ticketPromAdq || 0)}`);
  setText('semiDays', fmt.number(s.diasPromedio || 0));
  setText('semiAgeing', fmt.number(s.envejecidas || 0));
  setText('semiAgeingSub', `${fmt.number(s.criticas || 0)} críticas · 90+ días`);

  const marcaBody = document.getElementById('tblSemiMarca');
  if (marcaBody) {
    const rows = s.byMarca || [];
    marcaBody.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td><strong>${escSemiHtml(r.marca)}</strong></td>
          <td class="cell-num">${fmt.number(r.unidades)}</td>
          <td class="cell-num">${r.diasPromedio != null ? fmt.number(r.diasPromedio) : '—'}</td>
          <td class="cell-money">${moneyInt(r.valorAdquisicion || 0)}</td>
          <td class="cell-money">${moneyInt(r.valorVenta || 0)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="5">Sin unidades en stock.</td></tr>';
  }

  const ageingBody = document.getElementById('tblSemiAgeing');
  if (ageingBody) {
    const a = s.ageing || {};
    const buckets = [
      { key: '0-30', label: '0-30 días' },
      { key: '31-60', label: '31-60 días' },
      { key: '61-90', label: '61-90 días' },
      { key: '90+', label: '90+ días' },
      { key: 'sinFecha', label: 'Sin fecha adquisición' },
    ];
    ageingBody.innerHTML = buckets.map((b) => `
      <tr>
        <td>${b.label}</td>
        <td class="cell-num"><strong>${fmt.number(a[b.key] || 0)}</strong></td>
      </tr>`).join('');
  }

  renderSeminuevosUnitsTable();
  syncSemiKpiCardState();
}

function rowsForSemiKpi(kpi) {
  const units = seminuevosData?.units || [];
  switch (kpi) {
    case 'toma':
      return units.filter((u) => Number(u.precioToma || 0) > 0);
    case 'ageing':
      return units.filter((u) => u.envejecida);
    case 'days':
    case 'total':
    default:
      return units.slice();
  }
}

function semiKpiMeta(kpi) {
  const map = {
    total: { title: 'Unidades en stock', hint: 'Inventario vivo SFIS', icon: 'directions_car' },
    toma: { title: 'Precio de toma', hint: 'VEH_TOMAIMPADQUI · costo de toma / adquisición', icon: 'payments' },
    days: { title: 'Días en stock', hint: 'Desde VEH_SFECADQUI', icon: 'schedule' },
    ageing: { title: 'Antigüedad 60+', hint: 'Unidades con 60 o más días en inventario', icon: 'warning' },
  };
  return map[kpi] || { title: 'Seminuevos', hint: '', icon: 'directions_car' };
}

function syncSemiKpiCardState() {
  document.querySelectorAll('#semiKpiGrid [data-semi-kpi]').forEach((btn) => {
    const open = btn.dataset.semiKpi === activeSemiKpi;
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

function moneyInt(n) {
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function moneyOrDash(fmt, n) {
  const v = Number(n || 0);
  return v > 0 ? moneyInt(v) : '—';
}

function semiUnitKey(u) {
  if (u?.kind === 'factura' || u?.factura) {
    return `F|${String(u.factura || '').toUpperCase()}|${String(u.vin || '').toUpperCase()}`;
  }
  return String(u?.vin || u?.noInventario || '').toUpperCase();
}

const SEMI_AGEING_LABELS = {
  '0-30': '0–30 días',
  '31-60': '31–60 días',
  '61-90': '61–90 días',
  '90+': '90+ días',
  sinFecha: 'Sin fecha',
};

let semiUnitDetailUi = null;

function ensureSemiUnitDetailPanel() {
  if (semiUnitDetailUi) return semiUnitDetailUi;

  const backdrop = document.createElement('div');
  backdrop.className = 'ops-order-detail-backdrop';
  backdrop.id = 'semiUnitDetailBackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'ops-order-detail ops-order-detail--semi-ficha';
  panel.id = 'semiUnitDetail';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Detalle unidad seminuevo');
  panel.innerHTML = `
    <div class="ops-order-detail__header">
      <div class="ops-order-detail__title-wrap">
        <span class="material-symbols-outlined ops-order-detail__logo">directions_car</span>
        <div>
          <h2 class="ops-order-detail__title">Detalle unidad</h2>
          <span class="ops-order-detail__status" data-sud-status>Seminuevos</span>
        </div>
      </div>
      <div class="ops-order-detail__actions">
        <button type="button" class="ops-order-detail__icon-btn" data-sud-expand title="Expandir" aria-label="Expandir">
          <span class="material-symbols-outlined" data-sud-expand-icon>open_in_full</span>
        </button>
        <button type="button" class="ops-order-detail__icon-btn" data-sud-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="ops-order-detail__body custom-scrollbar" data-sud-body></div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  const statusEl = panel.querySelector('[data-sud-status]');
  const bodyEl = panel.querySelector('[data-sud-body]');
  const expandBtn = panel.querySelector('[data-sud-expand]');
  const expandIcon = panel.querySelector('[data-sud-expand-icon]');
  let expanded = false;

  function setExpanded(next) {
    expanded = Boolean(next);
    panel.classList.toggle('ops-order-detail--expanded', expanded);
    if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
    if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
  }

  function isOpen() {
    return panel.classList.contains('ops-order-detail--open');
  }

  function close() {
    panel.classList.remove('ops-order-detail--open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('ops-order-detail-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ops-order-detail-open');
    setExpanded(false);
  }

  function moneyCompact(value) {
    const n = Math.round(Number(value) || 0);
    if (!Number.isFinite(n) || n === 0) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1_000_000) {
      const m = abs / 1_000_000;
      return `${sign}$${m % 1 === 0 ? m.toFixed(0) : Math.round(m)}M`;
    }
    if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}K`;
    return `${sign}${moneyInt(abs)}`;
  }

  function moneyFull(value, { allowZero = false } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (!allowZero && n === 0) return '—';
    return moneyInt(n);
  }

  function titleCaseModel(modelo) {
    return String(modelo || '')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function fichaRow(label, valueHtml) {
    return `
      <div class="semi-ficha__row">
        <span class="semi-ficha__lbl">${escapeHtml(label)}</span>
        <span class="semi-ficha__val">${valueHtml}</span>
      </div>`;
  }

  function fichaRowText(label, value) {
    const text = value == null || value === '' ? '—' : String(value);
    return fichaRow(label, escapeHtml(text));
  }

  function open(unit) {
    if (!unit) return;
    const { fmt } = Dashboard;
    const u = unit;
    const isFactura = u.kind === 'factura' || Boolean(u.factura);
    const modeloNice = titleCaseModel(u.modelo || u.carline);
    const heroTitle = isFactura
      ? (u.factura || [u.marca, modeloNice].filter(Boolean).join(' ') || 'Factura seminuevo')
      : ([u.marca, modeloNice, u.anio].filter(Boolean).join(' ') || 'Seminuevo');
    if (statusEl) {
      statusEl.textContent = isFactura
        ? [u.vin, u.fechaFactura, `${u.diasRotacion ?? u.daysInStock ?? '—'} d rotación`].filter(Boolean).join(' · ')
        : ([u.marca, u.modelo, u.anio].filter(Boolean).join(' · ') || 'Detalle seminuevo');
    }

    const ageingLabel = SEMI_AGEING_LABELS[u.ageingBucket] || u.ageingBucket || '—';
    const situacion = u.situacionLabel || u.situacion || '—';
    const daysVal = u.diasRotacion ?? u.daysInStock;
    const daysChip = daysVal != null && (u.ageingBucket === '90+' || daysVal >= 90)
      ? '<span class="semi-ficha__chip semi-ficha__chip--danger">90+ días</span>'
      : (u.envejecida
        ? '<span class="semi-ficha__chip semi-ficha__chip--warn">60+ días</span>'
        : '');
    const kmLabel = u.km != null ? `${fmt.number(u.km)} km` : '—';
    const margenVsGuia = Number(u.margenVsGuia);
    const margenIcon = Number.isFinite(margenVsGuia) && margenVsGuia < 0
      ? 'trending_down'
      : 'trending_up';
    const margenTone = Number.isFinite(margenVsGuia) && margenVsGuia < 0 ? 'down' : 'up';
    const precioMostrar = u.importeFactura || u.precioVentaIva;

    bodyEl.innerHTML = `
      <div class="semi-ficha">
        <header class="semi-ficha__hero">
          <h3 class="semi-ficha__title">${escapeHtml(heroTitle)}</h3>
          <p class="semi-ficha__meta">
            <span class="semi-ficha__vin">${escapeHtml(u.vin || '—')}</span>
            <span class="semi-ficha__sep">|</span>
            <span>${isFactura
              ? `Factura: <strong>${escapeHtml(u.factura || '—')}</strong>`
              : `No. inventario: <strong>${escapeHtml(u.noInventario != null ? String(u.noInventario) : '—')}</strong>`}</span>
          </p>
          <div class="semi-ficha__badges">
            <span class="semi-ficha__badge semi-ficha__badge--ok">${escapeHtml(situacion)}</span>
            ${isFactura
              ? `<span class="semi-ficha__badge semi-ficha__badge--muted">Rotación: ${daysVal != null ? `${daysVal} d` : '—'}</span>`
              : `<span class="semi-ficha__badge semi-ficha__badge--muted">Toma USN: ${u.tomaUsn ? 'Sí' : 'No'}</span>`}
          </div>
        </header>

        <div class="semi-ficha__kpis" role="group" aria-label="Resumen rápido">
          <div class="semi-ficha__kpi">
            <span class="semi-ficha__kpi-icon semi-ficha__kpi-icon--blue"><span class="material-symbols-outlined">attach_money</span></span>
            <div>
              <span class="semi-ficha__kpi-label">${isFactura ? 'Importe factura' : 'Precio de venta'}</span>
              <strong class="semi-ficha__kpi-value">${escapeHtml(moneyCompact(precioMostrar))}</strong>
            </div>
          </div>
          <div class="semi-ficha__kpi">
            <span class="semi-ficha__kpi-icon semi-ficha__kpi-icon--violet"><span class="material-symbols-outlined">calendar_month</span></span>
            <div>
              <span class="semi-ficha__kpi-label">${isFactura ? 'Días rotación' : 'Días en stock'}</span>
              <strong class="semi-ficha__kpi-value">${daysVal != null ? escapeHtml(fmt.number(daysVal)) : '—'}</strong>
              ${daysChip}
            </div>
          </div>
          <div class="semi-ficha__kpi">
            <span class="semi-ficha__kpi-icon semi-ficha__kpi-icon--green"><span class="material-symbols-outlined">${isFactura ? 'receipt_long' : 'speed'}</span></span>
            <div>
              <span class="semi-ficha__kpi-label">${isFactura ? 'Fecha factura' : 'Kilometraje'}</span>
              <strong class="semi-ficha__kpi-value">${escapeHtml(isFactura ? (u.fechaFactura || '—') : kmLabel)}</strong>
            </div>
          </div>
          <div class="semi-ficha__kpi">
            <span class="semi-ficha__kpi-icon semi-ficha__kpi-icon--sky"><span class="material-symbols-outlined">${isFactura ? 'event' : 'location_on'}</span></span>
            <div>
              <span class="semi-ficha__kpi-label">${isFactura ? 'Adquisición' : 'Ubicación'}</span>
              <strong class="semi-ficha__kpi-value">${escapeHtml(isFactura ? (u.fechaAdquisicion || '—') : (u.ubicacion || '—'))}</strong>
            </div>
          </div>
          <div class="semi-ficha__kpi">
            <span class="semi-ficha__kpi-icon semi-ficha__kpi-icon--${margenTone}"><span class="material-symbols-outlined">${margenIcon}</span></span>
            <div>
              <span class="semi-ficha__kpi-label">Margen vs guía</span>
              <strong class="semi-ficha__kpi-value">${escapeHtml(moneyCompact(u.margenVsGuia))}</strong>
            </div>
          </div>
          <div class="semi-ficha__kpi">
            <span class="semi-ficha__kpi-icon semi-ficha__kpi-icon--amber"><span class="material-symbols-outlined">verified_user</span></span>
            <div>
              <span class="semi-ficha__kpi-label">Estatus</span>
              <strong class="semi-ficha__kpi-value semi-ficha__kpi-value--amber">${escapeHtml(situacion)}</strong>
            </div>
          </div>
        </div>

        <div class="semi-ficha__grid">
          <section class="semi-ficha__card">
            <div class="semi-ficha__card-head">
              <span class="semi-ficha__card-num">1</span>
              <span class="material-symbols-outlined">badge</span>
              <h4>Identificación</h4>
            </div>
            ${isFactura ? fichaRowText('Factura', u.factura) : ''}
            ${fichaRowText('VIN', u.vin)}
            ${isFactura ? fichaRowText('Fecha factura', u.fechaFactura) : fichaRowText('No. inventario', u.noInventario)}
            ${fichaRowText('Situación', situacion)}
            ${isFactura ? fichaRowText('Días rotación', daysVal) : fichaRowText('Toma USN', u.tomaUsn ? 'Sí' : 'No')}
          </section>

          <section class="semi-ficha__card">
            <div class="semi-ficha__card-head">
              <span class="semi-ficha__card-num">2</span>
              <span class="material-symbols-outlined">directions_car</span>
              <h4>Unidad</h4>
            </div>
            ${fichaRowText('Marca', u.marca)}
            ${fichaRowText('Modelo / carline', u.modelo || u.carline)}
            ${fichaRowText('Año', u.anio)}
            ${fichaRowText('Color', u.color)}
            ${isFactura ? fichaRowText('Fecha adquisición', u.fechaAdquisicion) : fichaRowText('Ubicación', u.ubicacion)}
            ${isFactura ? '' : fichaRowText('Kilometraje', u.km != null ? kmLabel : null)}
          </section>

          <section class="semi-ficha__card">
            <div class="semi-ficha__card-head">
              <span class="semi-ficha__card-num">3</span>
              <span class="material-symbols-outlined">payments</span>
              <h4>Precios y rentabilidad</h4>
            </div>
            ${isFactura ? fichaRow('Importe factura', escapeHtml(moneyFull(u.importeFactura))) : ''}
            ${fichaRow('Precio de toma', escapeHtml(moneyFull(u.precioToma)))}
            ${fichaRow('Venta IVA incluido', escapeHtml(moneyFull(u.precioVentaIva)))}
            ${fichaRow('Compra según guía', escapeHtml(moneyFull(u.precioCompraGuia)))}
            ${fichaRow('Venta según guía', escapeHtml(moneyFull(u.precioVentaGuia)))}
            ${fichaRow('Margen est. (venta – toma)', escapeHtml(moneyFull(u.margenEstimado, { allowZero: true })))}
            ${fichaRow('Margen vs guía', escapeHtml(moneyFull(u.margenVsGuia, { allowZero: true })))}
          </section>

          <section class="semi-ficha__card semi-ficha__card--wide">
            <div class="semi-ficha__card-head">
              <span class="semi-ficha__card-num">4</span>
              <span class="material-symbols-outlined">schedule</span>
              <h4>${isFactura ? 'Rotación histórica' : 'Antigüedad'}</h4>
            </div>
            <div class="semi-ficha__ageing">
              <div>
                ${fichaRow(
                  isFactura ? 'Días adquisición → factura' : 'Días en stock',
                  `${daysVal != null ? escapeHtml(fmt.number(daysVal)) : '—'}${daysChip ? ` ${daysChip}` : ''}`,
                )}
                ${fichaRowText('Rango', ageingLabel)}
                ${fichaRow(
                  'Antigüedad 60+',
                  u.envejecida
                    ? `${escapeHtml('Sí')} <span class="semi-ficha__chip semi-ficha__chip--warn"><span class="material-symbols-outlined" aria-hidden="true">warning</span> Antigüedad 60+</span>`
                    : escapeHtml('No'),
                )}
              </div>
              <div>
                ${fichaRow(
                  'Fecha adquisición',
                  `${escapeHtml(u.fechaAdquisicion || '—')} <span class="material-symbols-outlined semi-ficha__cal" aria-hidden="true">calendar_today</span>`,
                )}
                ${fichaRow(
                  isFactura ? 'Fecha factura' : 'Fecha operación',
                  `${escapeHtml((isFactura ? u.fechaFactura : u.fechaOperacion) || '—')} <span class="material-symbols-outlined semi-ficha__cal" aria-hidden="true">calendar_today</span>`,
                )}
                ${isFactura ? '' : fichaRowText('Alta control', u.fechaAltaControl)}
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    setExpanded(true);
    panel.classList.add('ops-order-detail--open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('ops-order-detail-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ops-order-detail-open');
  }

  backdrop.addEventListener('click', close);
  panel.querySelector('[data-sud-close]')?.addEventListener('click', close);
  expandBtn?.addEventListener('click', () => setExpanded(!expanded));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  semiUnitDetailUi = { open, close, isOpen, panel };
  return semiUnitDetailUi;
}

function openSemiUnitDetail(unit) {
  ensureSemiUnitDetailPanel().open(unit);
}

function downloadSemiKpiCsv(rows, title) {
  const headers = [
    'VIN', 'Marca', 'Modelo', 'Año', 'Días stock',
    'Precio toma', 'Venta IVA incl.', 'Compra guía', 'Venta guía',
    'Color', 'Ubicación', 'Fecha adquisición', 'Km',
  ];
  const lines = rows.map((u) => [
    u.vin || '',
    u.marca || '',
    u.modelo || '',
    u.anio || '',
    u.daysInStock ?? '',
    Number(u.precioToma || 0),
    Number(u.precioVentaIva || 0),
    Number(u.precioCompraGuia || 0),
    Number(u.precioVentaGuia || 0),
    u.color || '',
    u.ubicacion || '',
    u.fechaAdquisicion || '',
    u.km ?? '',
  ]);
  const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escapeCell).join(',')]
    .concat(lines.map((row) => row.map(escapeCell).join(',')))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = String(title || 'seminuevos').replace(/[^\w\-]+/g, '_').slice(0, 40);
  link.href = URL.createObjectURL(blob);
  link.download = `seminuevos_${safe}_${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ensureSemiKpiDrawer() {
  if (semiDrawerUi) return semiDrawerUi;

  const backdrop = document.createElement('div');
  backdrop.className = 'ops-orders-backdrop';
  backdrop.id = 'semiKpiBackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'ops-orders-drawer';
  panel.id = 'semiKpiDrawer';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Detalle seminuevos');
  panel.innerHTML = `
    <div class="ops-orders-drawer__header">
      <div class="ops-orders-drawer__title-wrap">
        <span class="material-symbols-outlined ops-orders-drawer__logo" data-semi-kpi-logo>airport_shuttle</span>
        <div>
          <h2 class="ops-orders-drawer__title" data-semi-kpi-title>Detalle seminuevos</h2>
          <span class="ops-orders-drawer__status" data-semi-kpi-status>0 unidades</span>
        </div>
      </div>
      <div class="ops-orders-drawer__actions">
        <button type="button" class="ops-orders-drawer__icon-btn" data-semi-kpi-download title="Descargar CSV" aria-label="Descargar CSV">
          <span class="material-symbols-outlined">download</span>
        </button>
        <button type="button" class="ops-orders-drawer__icon-btn" data-semi-kpi-expand title="Expandir" aria-label="Expandir panel">
          <span class="material-symbols-outlined" data-semi-kpi-expand-icon>open_in_full</span>
        </button>
        <button type="button" class="ops-orders-drawer__icon-btn" data-semi-kpi-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="ops-orders-drawer__toolbar">
      <label class="ops-orders-drawer__search" for="semiKpiSearch">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input id="semiKpiSearch" type="search" placeholder="Buscar VIN, modelo, marca..." autocomplete="off"/>
      </label>
      <button type="button" class="ops-orders-drawer__filter-chip" data-semi-kpi-filter-chip hidden title="Quitar filtro"></button>
      <span class="ops-orders-drawer__meta" data-semi-kpi-meta></span>
    </div>
    <div class="ops-orders-drawer__main">
      <aside class="ops-orders-drawer__summary custom-scrollbar" data-semi-kpi-summary></aside>
      <div class="ops-orders-drawer__body custom-scrollbar" data-semi-kpi-body></div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  const statusEl = panel.querySelector('[data-semi-kpi-status]');
  const metaEl = panel.querySelector('[data-semi-kpi-meta]');
  const bodyEl = panel.querySelector('[data-semi-kpi-body]');
  const summaryEl = panel.querySelector('[data-semi-kpi-summary]');
  const searchEl = panel.querySelector('#semiKpiSearch');
  const filterChip = panel.querySelector('[data-semi-kpi-filter-chip]');
  const titleEl = panel.querySelector('[data-semi-kpi-title]');
  const logoEl = panel.querySelector('[data-semi-kpi-logo]');
  const expandBtn = panel.querySelector('[data-semi-kpi-expand]');
  const expandIcon = panel.querySelector('[data-semi-kpi-expand-icon]');
  const downloadBtn = panel.querySelector('[data-semi-kpi-download]');

  let expanded = false;
  let activeFilter = null;
  let priceRangeFilter = null; // { min, max, extentMin, extentMax } | null
  let sourceRows = [];
  let lastExportRows = [];
  let lastCard = null;
  let currentMeta = { kpi: '', title: '', hint: '', icon: 'airport_shuttle' };

  const FILTER_DIM_LABEL = {
    marca: 'Marca',
    modelo: 'Modelo',
    ageing: 'Antigüedad',
    precio: 'Rango de precios',
  };

  function getDrawerPriceExtent(rows) {
    const prices = (rows || [])
      .map((u) => Number(u.precioVentaIva || 0))
      .filter((p) => p > 0);
    if (!prices.length) return { min: 0, max: 100000, step: 10000 };
    const rawMin = Math.min(...prices);
    const rawMax = Math.max(...prices);
    const step = rawMax - rawMin > 500_000 ? 25_000 : 10_000;
    const min = Math.floor(rawMin / step) * step;
    const max = Math.max(Math.ceil(rawMax / step) * step, min + step);
    return { min, max, step };
  }

  function isPriceFilterActive() {
    if (!priceRangeFilter) return false;
    return priceRangeFilter.min > priceRangeFilter.extentMin
      || priceRangeFilter.max < priceRangeFilter.extentMax;
  }

  function placeNearKpi(card) {
    if (expanded) return;
    const ref = card || document.getElementById('semiKpiGrid');
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
    if (isPriceFilterActive() && (!activeFilter || activeFilter.dim === 'precio')) {
      filterChip.hidden = false;
      filterChip.innerHTML = `
        <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
        Precio: ${escapeHtml(moneyInt(priceRangeFilter.min))} – ${escapeHtml(moneyInt(priceRangeFilter.max))}
        <span class="material-symbols-outlined" aria-hidden="true">close</span>`;
      return;
    }
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

  function matchesActiveFilter(u) {
    if (isPriceFilterActive()) {
      const p = Number(u.precioVentaIva || 0);
      if (!(p > 0) || p < priceRangeFilter.min || p > priceRangeFilter.max) return false;
    }
    if (!activeFilter || activeFilter.dim === 'precio') return true;
    const { dim, value } = activeFilter;
    if (dim === 'marca') return String(u.marca || 'Sin marca') === value;
    if (dim === 'modelo') return String(u.modelo || 'Sin modelo') === value;
    if (dim === 'ageing') return String(u.ageingBucket || 'sinFecha') === value;
    return true;
  }

  function setFilter(dim, value, label) {
    if (activeFilter && activeFilter.dim === dim && activeFilter.value === value) activeFilter = null;
    else activeFilter = { dim, value, label: label || value };
    updateFilterChip();
    renderList(searchEl?.value || '');
  }

  function clearFilter() {
    activeFilter = null;
    if (priceRangeFilter) {
      priceRangeFilter = {
        ...priceRangeFilter,
        min: priceRangeFilter.extentMin,
        max: priceRangeFilter.extentMax,
      };
    }
    updateFilterChip();
    renderList(searchEl?.value || '');
  }

  function filterBySearch(term, rows) {
    const q = String(term || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => [
      u.vin, u.modelo, u.marca, u.anio, u.color, u.ubicacion, u.fechaAdquisicion,
    ].some((v) => String(v || '').toLowerCase().includes(q)));
  }

  function syncDrawerPriceSliderUi(root) {
    if (!root || !priceRangeFilter) return;
    const minInput = root.querySelector('[data-drawer-price-min]');
    const maxInput = root.querySelector('[data-drawer-price-max]');
    const rangeEl = root.querySelector('[data-drawer-price-range]');
    const minVal = root.querySelector('[data-drawer-price-min-val]');
    const maxVal = root.querySelector('[data-drawer-price-max-val]');
    if (!minInput || !maxInput) return;
    let min = Number(minInput.value);
    let max = Number(maxInput.value);
    if (min > max) {
      if (document.activeElement === minInput) max = min;
      else min = max;
      minInput.value = String(min);
      maxInput.value = String(max);
    }
    priceRangeFilter = { ...priceRangeFilter, min, max };
    const span = Math.max(1, priceRangeFilter.extentMax - priceRangeFilter.extentMin);
    const left = ((min - priceRangeFilter.extentMin) / span) * 100;
    const right = ((max - priceRangeFilter.extentMin) / span) * 100;
    if (rangeEl) {
      rangeEl.style.left = `${left}%`;
      rangeEl.style.right = `${100 - right}%`;
    }
    if (minVal) minVal.textContent = moneyInt(min);
    if (maxVal) maxVal.textContent = moneyInt(max);
  }

  function bindDrawerPriceSlider(root) {
    if (!root || root.dataset.bound === '1') return;
    const minInput = root.querySelector('[data-drawer-price-min]');
    const maxInput = root.querySelector('[data-drawer-price-max]');
    if (!minInput || !maxInput) return;
    const onInput = () => {
      syncDrawerPriceSliderUi(root);
      activeFilter = isPriceFilterActive()
        ? {
          dim: 'precio',
          value: `${priceRangeFilter.min}-${priceRangeFilter.max}`,
          label: `${moneyInt(priceRangeFilter.min)} – ${moneyInt(priceRangeFilter.max)}`,
        }
        : (activeFilter?.dim === 'precio' ? null : activeFilter);
      updateFilterChip();
      renderList(searchEl?.value || '', { keepSummary: true });
    };
    minInput.addEventListener('input', onInput);
    maxInput.addEventListener('input', onInput);
    root.dataset.bound = '1';
  }

  function renderSummary(rows) {
    const isActive = (dim, value) => activeFilter && activeFilter.dim === dim && activeFilter.value === value;
    const block = (titulo, dim, items) => `
      <div class="ops-orders-drawer__group">
        <h5>${escapeHtml(titulo)}</h5>
        ${items.length
          ? items.map((x) => `
            <button type="button"
              class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x.label) ? ' is-active' : ''}"
              data-semi-filter-dim="${escapeHtml(dim)}"
              data-semi-filter-value="${escapeHtml(x.label)}"
              data-semi-filter-label="${escapeHtml(x.display || x.label)}"
              title="Filtrar por ${escapeHtml(x.display || x.label)}">
              <span class="lbl">${escapeHtml(x.display || x.label)}</span>
              <span class="val">${Number(x.value).toLocaleString('es-MX')}</span>
            </button>`).join('')
          : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
      </div>`;

    const sumToma = rows.reduce((s, u) => s + Number(u.precioToma || 0), 0);
    const sumVenta = rows.reduce((s, u) => s + Number(u.precioVentaIva || 0), 0);
    const sumGuia = rows.reduce((s, u) => s + Number(u.precioCompraGuia || 0), 0);
    const envejecidas = rows.filter((u) => u.envejecida).length;
    const avgDays = rows.length
      ? Math.round(rows.reduce((s, u) => s + (Number(u.daysInStock) || 0), 0) / rows.length)
      : 0;

    const porAgeing = countByField(rows, (u) => u.ageingBucket || 'sinFecha')
      .map((x) => ({
        label: x.label,
        display: SEMI_AGEING_LABELS[x.label] || x.label,
        value: x.value,
      }));

    const extent = getDrawerPriceExtent(rows);
    if (!priceRangeFilter || priceRangeFilter.extentMin !== extent.min || priceRangeFilter.extentMax !== extent.max) {
      const keep = priceRangeFilter && isPriceFilterActive();
      priceRangeFilter = {
        extentMin: extent.min,
        extentMax: extent.max,
        min: keep ? Math.max(extent.min, Math.min(extent.max, priceRangeFilter.min)) : extent.min,
        max: keep ? Math.max(extent.min, Math.min(extent.max, priceRangeFilter.max)) : extent.max,
      };
    }

    const inPrice = rows.filter((u) => {
      const p = Number(u.precioVentaIva || 0);
      return p >= priceRangeFilter.min && p <= priceRangeFilter.max;
    }).length;

    summaryEl.innerHTML = `
      <div class="ops-orders-drawer__group">
        <h5>Resumen</h5>
        <div class="ops-orders-drawer__row"><span class="lbl">Unidades</span><span class="val">${rows.length.toLocaleString('es-MX')}</span></div>
        <div class="ops-orders-drawer__row"><span class="lbl">Precio de toma</span><span class="val">${moneyInt(sumToma)}</span></div>
        <div class="ops-orders-drawer__row"><span class="lbl">Venta IVA incl.</span><span class="val">${moneyInt(sumVenta)}</span></div>
        <div class="ops-orders-drawer__row"><span class="lbl">Compra guía</span><span class="val">${moneyInt(sumGuia)}</span></div>
        <div class="ops-orders-drawer__row"><span class="lbl">Días prom.</span><span class="val">${avgDays.toLocaleString('es-MX')}</span></div>
        <div class="ops-orders-drawer__row"><span class="lbl">Antigüedad 60+</span><span class="val">${envejecidas.toLocaleString('es-MX')}</span></div>
        <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
      </div>
      ${block('Marca', 'marca', countByField(rows, (u) => u.marca || 'Sin marca').slice(0, 12))}
      ${block('Modelo', 'modelo', countByField(rows, (u) => u.modelo || 'Sin modelo').slice(0, 12))}
      ${block('Antigüedad', 'ageing', porAgeing)}
      <div class="ops-orders-drawer__group">
        <h5>Rango de precios</h5>
        <p class="ops-orders-drawer__hint">Venta IVA incluido · ${inPrice.toLocaleString('es-MX')} en rango</p>
        <div class="semi-price-slider semi-price-slider--drawer" data-drawer-price-slider>
          <div class="semi-price-slider__values">
            <span data-drawer-price-min-val>${escapeHtml(moneyInt(priceRangeFilter.min))}</span>
            <span data-drawer-price-max-val>${escapeHtml(moneyInt(priceRangeFilter.max))}</span>
          </div>
          <div class="semi-price-slider__track-wrap">
            <div class="semi-price-slider__rail"></div>
            <div class="semi-price-slider__range" data-drawer-price-range></div>
            <input type="range" class="semi-price-slider__input semi-price-slider__input--min" data-drawer-price-min
              min="${extent.min}" max="${extent.max}" step="${extent.step}" value="${priceRangeFilter.min}" aria-label="Precio mínimo"/>
            <input type="range" class="semi-price-slider__input semi-price-slider__input--max" data-drawer-price-max
              min="${extent.min}" max="${extent.max}" step="${extent.step}" value="${priceRangeFilter.max}" aria-label="Precio máximo"/>
          </div>
        </div>
      </div>
    `;

    const sliderRoot = summaryEl.querySelector('[data-drawer-price-slider]');
    bindDrawerPriceSlider(sliderRoot);
    syncDrawerPriceSliderUi(sliderRoot);
  }

  function renderList(term = '', opts = {}) {
    const { fmt } = Dashboard;
    const filtered = filterBySearch(term, sourceRows).filter(matchesActiveFilter);
    lastExportRows = filtered;

    statusEl.textContent = `${filtered.length.toLocaleString('es-MX')} unidad(es)`;
    metaEl.textContent = filtered.length !== sourceRows.length
      ? `${filtered.length} de ${sourceRows.length}`
      : `${sourceRows.length} registros`;

    if (!opts.keepSummary) renderSummary(sourceRows);
    else {
      // actualizar solo conteo del hint de precio si el summary ya existe
      const hint = summaryEl.querySelector('.ops-orders-drawer__group:last-child .ops-orders-drawer__hint');
      if (hint && priceRangeFilter) {
        const inPrice = sourceRows.filter((u) => {
          const p = Number(u.precioVentaIva || 0);
          return p >= priceRangeFilter.min && p <= priceRangeFilter.max;
        }).length;
        hint.textContent = `Venta IVA incluido · ${inPrice.toLocaleString('es-MX')} en rango`;
      }
    }

    if (!filtered.length) {
      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__empty">
          <span class="material-symbols-outlined">inbox</span>
          <p>${term || activeFilter || isPriceFilterActive() ? 'Sin coincidencias.' : 'No hay unidades para este indicador.'}</p>
        </div>`;
      return;
    }

    const sorted = filtered.slice().sort((a, b) => (b.daysInStock || 0) - (a.daysInStock || 0));

    // Formato facturas nuevos + clic abre resumen estilo contratos F&I
    bodyEl.innerHTML = `
      <div class="ops-orders-drawer__list-head">
        <span>Unidades seminuevos</span>
        <span>${sorted.length.toLocaleString('es-MX')}</span>
      </div>
      ${sorted.map((u, idx) => `
        <button type="button"
          class="ops-orders-drawer__item${u.critica ? ' is-critical' : ''}"
          data-semi-unit-idx="${idx}"
          title="Ver detalle de la unidad">
          <div class="ops-orders-drawer__item-head">
            <strong>${escapeHtml(u.vin || 'Sin serie')}</strong>
            <span class="ops-orders-drawer__tag">${u.daysInStock != null ? `${u.daysInStock} d` : 'SFIS'}</span>
          </div>
          <p class="ops-orders-drawer__msg">${escapeHtml(u.modelo || '—')} · ${escapeHtml(u.marca || '—')}${u.anio ? ` ${escapeHtml(u.anio)}` : ''}</p>
          <div class="ops-orders-drawer__facts">
            <span>${escapeHtml(u.fechaAdquisicion || '—')}</span>
            <span>Toma ${escapeHtml(moneyOrDash(fmt, u.precioToma))}</span>
            <span>Venta IVA ${escapeHtml(moneyOrDash(fmt, u.precioVentaIva))}</span>
          </div>
          <div class="ops-orders-drawer__facts ops-orders-drawer__facts--muted">
            <span>Guía ${escapeHtml(moneyOrDash(fmt, u.precioCompraGuia))}</span>
            <span>${escapeHtml(u.color || '—')}</span>
            <span>${escapeHtml(u.ubicacion || '—')}</span>
          </div>
          <p class="ops-orders-drawer__sub">Inv. ${escapeHtml(u.noInventario != null ? String(u.noInventario) : '—')}${u.envejecida ? ' · Antigüedad alta' : ''}${u.tomaUsn ? ' · Toma USN' : ''} · Clic para ver detalle</p>
          <span class="ops-orders-drawer__open-hint">
            <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
            Abrir detalle
          </span>
        </button>`).join('')}`;

    bodyEl._semiListRows = sorted;
  }

  function close() {
    semiUnitDetailUi?.close?.();
    panel.classList.remove('ops-orders-drawer--open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('ops-orders-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ops-orders-drawer-open');
    setExpanded(false);
    clearPlacement();
    activeFilter = null;
    priceRangeFilter = null;
    updateFilterChip();
    activeSemiKpi = null;
    syncSemiKpiCardState();
  }

  function open(kpi, card) {
    if (activeSemiKpi === kpi && panel.classList.contains('ops-orders-drawer--open')) {
      close();
      return;
    }
    autosDrawerUi?.close?.();
    semiUnitDetailUi?.close?.();
    currentMeta = { kpi, ...semiKpiMeta(kpi) };
    sourceRows = rowsForSemiKpi(kpi).slice();
    lastCard = card || null;
    activeSemiKpi = kpi;
    activeFilter = null;
    priceRangeFilter = null;
    if (titleEl) titleEl.textContent = currentMeta.title;
    if (logoEl) logoEl.textContent = currentMeta.icon;
    panel.setAttribute('aria-label', currentMeta.title);
    if (searchEl) {
      searchEl.placeholder = 'Buscar VIN, modelo, marca, ubicación...';
      searchEl.value = '';
    }
    updateFilterChip();
    syncSemiKpiCardState();
    placeNearKpi(card);
    setExpanded(true);
    renderList('');
    panel.classList.add('ops-orders-drawer--open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('ops-orders-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ops-orders-drawer-open');
    window.setTimeout(() => searchEl?.focus({ preventScroll: true }), 180);
  }

  panel.querySelector('[data-semi-kpi-close]')?.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  expandBtn?.addEventListener('click', () => setExpanded(!expanded));
  downloadBtn?.addEventListener('click', () => {
    if (!lastExportRows.length) {
      window.alert('No hay registros para descargar.');
      return;
    }
    downloadSemiKpiCsv(lastExportRows, currentMeta.title);
  });
  searchEl?.addEventListener('input', () => renderList(searchEl.value));
  filterChip?.addEventListener('click', clearFilter);
  summaryEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-semi-filter-dim]');
    if (!btn || !summaryEl.contains(btn)) return;
    setFilter(
      btn.dataset.semiFilterDim,
      btn.dataset.semiFilterValue,
      btn.dataset.semiFilterLabel || btn.dataset.semiFilterValue
    );
  });
  bodyEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-semi-unit-idx]');
    if (!btn || !bodyEl.contains(btn)) return;
    const idx = Number(btn.getAttribute('data-semi-unit-idx'));
    const rows = bodyEl._semiListRows || lastExportRows || [];
    const record = rows[idx];
    if (record) openSemiUnitDetail(record);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panel.classList.contains('ops-orders-drawer--open')) return;
    if (semiUnitDetailUi?.isOpen?.()) {
      semiUnitDetailUi.close();
      return;
    }
    close();
  });

  semiDrawerUi = { open, close, panel };
  return semiDrawerUi;
}

function setActiveSemiKpi(kpiId) {
  const card = document.querySelector(`#semiKpiGrid [data-semi-kpi="${kpiId}"]`);
  ensureSemiKpiDrawer().open(kpiId, card);
}

function getSeminuevosRotacionFacturas() {
  return seminuevosData?.rotacionHistorica?.facturas || [];
}

const SEMI_ROTACION_TOP_N = 8;

function renderSemiRotacionRow(u, rank, tone) {
  const { fmt } = Dashboard;
  const days = u.diasRotacion ?? u.daysInStock;
  const daysClass = days == null
    ? ''
    : days <= 30
      ? 'semi-rot-days--good'
      : days >= 90
        ? 'semi-rot-days--bad'
        : 'semi-rot-days--mid';
  const importe = u.importeFactura || u.precioVentaIva;
  return `
    <tr class="${u.critica ? 'row-highlight' : ''} semi-rot-row semi-rot-row--${tone}"
      data-semi-unit-key="${escSemiHtml(semiUnitKey(u))}"
      style="cursor:pointer" title="Ver detalle de la factura">
      <td class="cell-num semi-rot-rank">${rank}</td>
      <td>
        <strong>${escSemiHtml(u.factura || u.vin || '—')}</strong>
        <div class="semi-rot-sub">${escSemiHtml(u.vin || '—')}${u.fechaFactura ? ` · ${escSemiHtml(u.fechaFactura)}` : ''}</div>
      </td>
      <td class="cell-num"><span class="semi-rot-days ${daysClass}">${days != null ? fmt.number(days) : '—'}</span></td>
      <td class="cell-money">${moneyOrDash(fmt, importe)}</td>
      <td>${escSemiHtml(u.carline || u.modelo || '—')}</td>
    </tr>`;
}

function renderSeminuevosUnitsTable() {
  const { fmt } = Dashboard;
  const body = document.getElementById('tblSemiUnits');
  const bestBody = document.getElementById('tblSemiRotBest');
  const worstBody = document.getElementById('tblSemiRotWorst');
  const countEl = document.getElementById('semiTableCount');
  const allCountEl = document.getElementById('semiRotAllCount');
  const summaryEl = document.getElementById('semiRotacionSummary');
  const bestMeta = document.getElementById('semiRotBestMeta');
  const worstMeta = document.getElementById('semiRotWorstMeta');
  if (!body && !bestBody) return;

  const rows = getSeminuevosRotacionFacturas();
  const withDays = rows.filter((u) => (u.diasRotacion ?? u.daysInStock) != null);
  const topN = SEMI_ROTACION_TOP_N;
  const rotMeta = seminuevosData?.rotacionHistorica || {};

  const best = withDays
    .slice()
    .sort((a, b) => (a.diasRotacion ?? a.daysInStock) - (b.diasRotacion ?? b.daysInStock)
      || String(a.factura || '').localeCompare(String(b.factura || '')))
    .slice(0, topN);
  const worst = withDays
    .slice()
    .sort((a, b) => (b.diasRotacion ?? b.daysInStock) - (a.diasRotacion ?? a.daysInStock)
      || String(a.factura || '').localeCompare(String(b.factura || '')))
    .slice(0, topN);

  const avgDays = withDays.length
    ? Math.round(withDays.reduce((s, u) => s + (u.diasRotacion ?? u.daysInStock), 0) / withDays.length)
    : null;
  const sumVenta = rows.reduce((s, u) => s + Number(u.importeFactura || u.precioVentaIva || 0), 0);
  const envejecidas = rows.filter((u) => u.envejecida).length;
  const bestAvg = best.length
    ? Math.round(best.reduce((s, u) => s + (u.diasRotacion ?? u.daysInStock), 0) / best.length)
    : null;
  const worstAvg = worst.length
    ? Math.round(worst.reduce((s, u) => s + (u.diasRotacion ?? u.daysInStock), 0) / worst.length)
    : null;

  if (countEl) {
    countEl.textContent = `${rows.length.toLocaleString('es-MX')} factura(s)`;
  }
  if (allCountEl) allCountEl.textContent = String(rows.length);
  if (bestMeta) {
    bestMeta.textContent = bestAvg != null ? `prom. ${bestAvg} d` : 'Sin datos';
  }
  if (worstMeta) {
    worstMeta.textContent = worstAvg != null ? `prom. ${worstAvg} d` : 'Sin datos';
  }

  if (summaryEl) {
    const errNote = rotMeta.error
      ? `<div class="semi-rotacion-stat semi-rotacion-stat--wide"><span class="lbl">Aviso</span><strong>${escapeHtml(rotMeta.error)}</strong></div>`
      : '';
    summaryEl.innerHTML = `
      <div class="semi-rotacion-stat">
        <span class="lbl">Facturas</span>
        <strong>${fmt.number(rows.length)}</strong>
      </div>
      <div class="semi-rotacion-stat">
        <span class="lbl">Días prom. rotación</span>
        <strong>${avgDays != null ? fmt.number(avgDays) : '—'}</strong>
      </div>
      <div class="semi-rotacion-stat">
        <span class="lbl">Lentas 60+</span>
        <strong>${fmt.number(envejecidas)}</strong>
      </div>
      <div class="semi-rotacion-stat">
        <span class="lbl">Importe facturado</span>
        <strong>${moneyInt(sumVenta)}</strong>
      </div>
      <div class="semi-rotacion-stat semi-rotacion-stat--wide">
        <span class="lbl">Base histórica</span>
        <strong>${fmt.number(rotMeta.meses || 12)} meses · ${escapeHtml(rotMeta.fuente || 'ADE_VTAFI U')} · ${escapeHtml(rotMeta.criterioDias || 'adquisición → factura')}</strong>
      </div>
      ${errNote}`;
  }

  if (bestBody) {
    bestBody.innerHTML = best.length
      ? best.map((u, i) => renderSemiRotacionRow(u, i + 1, 'best')).join('')
      : '<tr class="empty-row"><td colspan="5">Sin facturas históricas de rotación en el periodo.</td></tr>';
  }
  if (worstBody) {
    worstBody.innerHTML = worst.length
      ? worst.map((u, i) => renderSemiRotacionRow(u, i + 1, 'worst')).join('')
      : '<tr class="empty-row"><td colspan="5">Sin facturas históricas de rotación en el periodo.</td></tr>';
  }

  if (!body) return;

  const allSorted = rows.slice().sort((a, b) =>
    (b.diasRotacion ?? b.daysInStock ?? 0) - (a.diasRotacion ?? a.daysInStock ?? 0));
  if (!allSorted.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">Sin facturas históricas en el periodo.</td></tr>';
    return;
  }

  body.innerHTML = allSorted.map((u) => `
    <tr class="${u.critica ? 'row-highlight' : ''}" data-semi-unit-key="${escSemiHtml(semiUnitKey(u))}" style="cursor:pointer" title="Ver detalle">
      <td><strong>${escSemiHtml(u.factura || '—')}</strong></td>
      <td>${escSemiHtml(u.fechaFactura || '—')}</td>
      <td>${escSemiHtml(u.vin || '—')}</td>
      <td>${escSemiHtml(u.carline || u.modelo || '—')}</td>
      <td class="cell-num">${u.diasRotacion != null ? fmt.number(u.diasRotacion) : '—'}</td>
      <td class="cell-money">${moneyOrDash(fmt, u.importeFactura || u.precioVentaIva)}</td>
      <td class="cell-money">${moneyOrDash(fmt, u.precioToma)}</td>
      <td>${escSemiHtml(u.fechaAdquisicion || '—')}</td>
    </tr>`).join('');
}

async function loadInventorySeminuevos({ force = false } = {}) {
  if (seminuevosLoaded && seminuevosData && !force) {
    renderSeminuevosOverview(seminuevosData);
    return seminuevosData;
  }
  const status = document.getElementById('sidebarStatus') || { textContent: '', className: '' };
  try {
    showLoading(true);
    status.textContent = 'Cargando seminuevos y rotación histórica...';
    status.className = 'sidebar-status-line';
    seminuevosData = await api('/inventory/seminuevos?mesesRotacion=12');
    seminuevosLoaded = true;
    renderSeminuevosOverview(seminuevosData);
    const facturas = seminuevosData.rotacionHistorica?.totalFacturas || 0;
    status.textContent = `${(seminuevosData.summary?.totalUnits || 0).toLocaleString('es-MX')} en stock · ${facturas.toLocaleString('es-MX')} facturas históricas`;
    status.className = 'sidebar-status-line';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'sidebar-status-line status-error';
    window.alert(err.message || 'No se pudo cargar el inventario de seminuevos.');
  } finally {
    showLoading(false);
  }
  return seminuevosData;
}

document.getElementById('semiRotacionSection')?.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-semi-unit-key]');
  if (!row || !document.getElementById('semiRotacionSection')?.contains(row)) return;
  const key = row.dataset.semiUnitKey;
  const record = (seminuevosData?.rotacionHistorica?.facturas || []).find((u) => semiUnitKey(u) === key);
  if (record) openSemiUnitDetail(record);
});

document.getElementById('semiKpiGrid')?.addEventListener('click', (e) => {
  const kpiBtn = e.target.closest('[data-semi-kpi]');
  if (!kpiBtn) return;
  e.preventDefault();
  setActiveSemiKpi(kpiBtn.dataset.semiKpi);
});

document.getElementById('autosKpiGrid')?.addEventListener('click', (e) => {
  const kpiBtn = e.target.closest('[data-autos-kpi]');
  if (kpiBtn) {
    e.preventDefault();
    setActiveAutosKpi(kpiBtn.dataset.autosKpi);
  }
});

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function initIntercambiosHistoricoDates({ force = false } = {}) {
  const inicioEl = document.getElementById('intHistFechaInicio');
  const finEl = document.getElementById('intHistFechaFin');
  if (!inicioEl || !finEl) return;
  const now = new Date();
  // Incluye año anterior: los intercambios de planta suelen verse mejor en ventana amplia.
  const start = new Date(now.getFullYear() - 1, 0, 1);
  if (force || !inicioEl.value) inicioEl.value = isoDate(start);
  if (force || !finEl.value) finEl.value = isoDate(now);
}

function formatIntHistDate(v) {
  if (!v) return '—';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return s.slice(0, 10);
}

function filteredIntHistRows() {
  let rows = intHistRows;
  if (intHistFilter && intHistFilter !== 'all') {
    rows = rows.filter((r) => String(r.carline || '') === intHistFilter);
  }
  const q = String(intHistSearch || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [
      r.serie, r.carline, r.modelo, r.concesionario, r.tipoVenta,
      r.factura, r.cliente, r.vendedor, r.anModelo, r.pedido,
    ].map((x) => String(x || '').toLowerCase()).join(' ');
    return hay.includes(q);
  });
}

function renderIntercambiosInsights(insights = []) {
  const box = document.getElementById('intHistAlerts');
  if (!box) return;
  if (!insights.length) {
    box.innerHTML = `<div class="int-acq-alert int-acq-alert--ok">
      <span class="material-symbols-outlined int-acq-alert__icon">info</span>
      <div>
        <p class="int-acq-alert__title">Sin insights</p>
        <p class="int-acq-alert__meta">No hay unidades de planta de otros concesionarios en el periodo.</p>
      </div>
    </div>`;
    return;
  }
  box.innerHTML = insights.slice(0, 8).map((a) => `
    <article class="int-acq-alert int-acq-alert--${a.severity === 'ok' ? 'ok' : 'warning'}">
      <span class="material-symbols-outlined int-acq-alert__icon">${a.severity === 'ok' ? 'verified' : 'analytics'}</span>
      <div>
        <p class="int-acq-alert__title">${a.title || 'Insight'}</p>
        <p class="int-acq-alert__meta">${a.detail || ''}</p>
        <p class="int-acq-alert__action">${a.action || ''}</p>
      </div>
    </article>
  `).join('');
}

function renderIntercambiosBanner(summary = {}) {
  const el = document.getElementById('intHistAlertBanner');
  if (!el) return;
  const total = Number(summary.total || 0);
  el.hidden = false;
  if (!total) {
    el.className = 'int-acq-banner int-acq-banner--ok';
    el.textContent = 'Sin intercambios de planta en el periodo. Amplíe las fechas (p. ej. desde 2025) y pulse Consultar.';
    return;
  }
  el.className = 'int-acq-banner int-acq-banner--warning';
  const top = summary.topModelo
    ? ` Más solicitado: ${summary.topModelo} (${summary.topModeloUnidades || 0} · ${summary.topModeloSharePct || 0}%).`
    : '';
  el.textContent = `${total} unidad(es) traídas de inventario de planta de otros concesionarios.${top}`;
}

function renderIntHistFilterTabs(porModelo = []) {
  const nav = document.getElementById('intHistFilterTabs');
  if (!nav) return;
  const tops = (porModelo || []).slice(0, 6);
  nav.innerHTML = [
    `<button type="button" class="eeff-tab${intHistFilter === 'all' ? ' active' : ''}" data-int-filter="all" aria-pressed="${intHistFilter === 'all'}">Todos</button>`,
    ...tops.map((m) => {
      const on = intHistFilter === m.label;
      return `<button type="button" class="eeff-tab${on ? ' active' : ''}" data-int-filter="${String(m.label).replace(/"/g, '&quot;')}" aria-pressed="${on}">${m.label} (${m.count})</button>`;
    }),
  ].join('');
}

function renderIntercambiosHistoricoTable() {
  const body = document.getElementById('intHistTableBody');
  const meta = document.getElementById('intHistSearchMeta');
  if (!body) return;
  const rows = filteredIntHistRows();
  if (meta) {
    if (intHistSearch.trim() || intHistFilter !== 'all') {
      meta.classList.remove('hidden');
      meta.textContent = `${rows.length} de ${intHistRows.length}`;
    } else {
      meta.classList.add('hidden');
    }
  }
  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${intHistRows.length ? 'Sin coincidencias para el filtro.' : 'Sin intercambios de planta en el periodo.'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${formatIntHistDate(r.fecha)}</td>
      <td><strong>${r.serie || '—'}</strong></td>
      <td>${r.carline || '—'}</td>
      <td>${r.anModelo || '—'}</td>
      <td title="${(r.concesionario || '').replace(/"/g, '&quot;')}">${r.concesionario || '—'}</td>
      <td>${r.tipoVenta || '—'}</td>
      <td>${r.factura || '—'}</td>
      <td>${r.cliente || '—'}</td>
    </tr>
  `).join('');
}

function renderIntercambiosHistorico(data) {
  const { fmt, chartOptions, chartColors, setText } = Dashboard;
  intHistData = data || null;
  const s = data?.summary || {};
  setText('intHistTotal', fmt.number(s.total || 0));
  setText('intHistTopModelo', s.topModelo || '—');
  setText(
    'intHistTopModeloSub',
    s.topModelo
      ? `${fmt.number(s.topModeloUnidades || 0)} und · ${s.topModeloSharePct || 0}% del periodo`
      : 'Auto que más pedimos a facturar'
  );
  setText('intHistModelos', fmt.number(s.modelosDistintos || 0));
  setText('intHistConcesionarios', fmt.number(s.concesionariosOrigen || 0));
  setText(
    'intHistTopConcesionario',
    s.topConcesionario
      ? `Top: ${s.topConcesionario} (${fmt.number(s.topConcesionarioUnidades || 0)})`
      : 'Dealers de planta'
  );
  setText('intHistCount', `${fmt.number(s.total || 0)} unidad(es) · ${fmt.number(s.modelosDistintos || 0)} modelo(s)`);
  const sub = document.getElementById('intHistSubtitle');
  if (sub && data?.periodo) {
    sub.textContent = `Periodo ${data.periodo.fechaInicio} → ${data.periodo.fechaFin} · CONCESIONARIO ≠ GENERAL MOTORS DE MEXICO`;
  }

  intHistRows = data?.rows || [];
  if (intHistFilter !== 'all' && !(data?.porModelo || []).some((m) => m.label === intHistFilter)) {
    intHistFilter = 'all';
  }
  renderIntercambiosBanner(s);
  renderIntercambiosInsights(data?.insights || []);
  renderIntHistFilterTabs(data?.porModelo || []);
  renderIntercambiosHistoricoTable();

  destroyChart(intHistChart);
  destroyChart(intHistMesChart);
  destroyChart(intHistConcChart);
  intHistChart = null;
  intHistMesChart = null;
  intHistConcChart = null;

  try {
    const porModelo = (data?.porModelo || []).slice(0, 10);
    const canvas = document.getElementById('intHistChart');
    if (canvas && typeof Chart !== 'undefined') {
      intHistChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: porModelo.map((m) => m.label),
          datasets: [{
            label: 'Unidades',
            data: porModelo.map((m) => m.count),
            backgroundColor: chartColors?.secondary || 'rgba(37, 99, 235, 0.55)',
            borderRadius: 8,
          }],
        },
        options: chartOptions({
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { grid: { display: false } },
          },
        }),
      });
    }

    const porMes = data?.porMes || [];
    const mesCanvas = document.getElementById('intHistMesChart');
    if (mesCanvas && typeof Chart !== 'undefined') {
      intHistMesChart = new Chart(mesCanvas, {
        type: 'bar',
        data: {
          labels: porMes.map((m) => m.label),
          datasets: [{
            label: 'Unidades',
            data: porMes.map((m) => m.count),
            backgroundColor: chartColors?.primary || 'rgba(14, 165, 233, 0.55)',
            borderRadius: 8,
          }],
        },
        options: chartOptions({
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        }),
      });
    }

    const porConc = (data?.porConcesionario || []).slice(0, 8);
    const concCanvas = document.getElementById('intHistConcChart');
    if (concCanvas && typeof Chart !== 'undefined') {
      intHistConcChart = new Chart(concCanvas, {
        type: 'bar',
        data: {
          labels: porConc.map((m) => (m.label.length > 22 ? `${m.label.slice(0, 20)}…` : m.label)),
          datasets: [{
            label: 'Unidades',
            data: porConc.map((m) => m.count),
            backgroundColor: chartColors?.accent || 'rgba(16, 185, 129, 0.55)',
            borderRadius: 8,
          }],
        },
        options: chartOptions({
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { grid: { display: false } },
          },
        }),
      });
    }
  } catch (chartErr) {
    console.warn('[Intercambios planta] charts:', chartErr);
  }
}

function setIntHistLocalStatus(text, type = '') {
  const el = document.getElementById('intHistLocalStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'top-bar-meta';
  if (type === 'loading') el.classList.add('status-loading');
  else if (type === 'error') el.classList.add('status-error');
}

function setIntHistRefreshing(active) {
  const btn = document.getElementById('btnIntHistRefresh');
  const consultar = document.getElementById('btnIntHistConsultar');
  if (btn) {
    btn.disabled = active;
    btn.classList.toggle('is-refreshing', active);
  }
  if (consultar) consultar.disabled = active;
}

async function loadIntercambiosHistorico({ quiet = false } = {}) {
  const { api } = Dashboard;
  const inicioEl = document.getElementById('intHistFechaInicio');
  const finEl = document.getElementById('intHistFechaFin');
  if (!inicioEl || !finEl) return;
  if (intHistLoading) return;
  initIntercambiosHistoricoDates();
  const fechaInicio = inicioEl.value;
  const fechaFin = finEl.value;
  if (!fechaInicio || !fechaFin) return;

  intHistLoading = true;
  setIntHistRefreshing(true);
  setIntHistLocalStatus(quiet ? 'Actualizando en segundo plano…' : 'Consultando…', 'loading');

  try {
    const data = await api(
      `/inventory/intercambios?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`
    );
    renderIntercambiosHistorico(data);
    const top = data.summary?.topModelo;
    const stamp = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    setIntHistLocalStatus(
      top
        ? `Actualizado ${stamp} · Top: ${top}`
        : `Actualizado ${stamp}`
    );
  } catch (err) {
    console.error('[Intercambios planta]', err);
    if (!quiet) {
      intHistRows = [];
      intHistData = null;
      renderIntercambiosHistoricoTable();
      const sub = document.getElementById('intHistSubtitle');
      if (sub) sub.textContent = err.message || 'No se pudo analizar intercambios de planta';
    }
    setIntHistLocalStatus(err.message || 'Error al actualizar', 'error');
  } finally {
    intHistLoading = false;
    setIntHistRefreshing(false);
  }
}

async function refreshInventoryPageQuiet() {
  if (inventoryQuietRefreshing) return;
  inventoryQuietRefreshing = true;
  try {
    const jobs = [
      loadInventory({ quiet: true }),
      loadIntercambiosHistorico({ quiet: true }),
      loadVendidosAnalisis({ quiet: true }),
      loadEntregasSinPreviasMes({ quiet: true }),
    ];
    if (inventoryScope === 'postventa') jobs.push(loadInventoryPostventa({ force: true }));
    await Promise.all(jobs);
  } finally {
    inventoryQuietRefreshing = false;
  }
}

function startInventoryAutoRefresh() {
  if (inventoryAutoRefreshTimer) clearInterval(inventoryAutoRefreshTimer);
  inventoryAutoRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    refreshInventoryPageQuiet();
  }, INVENTORY_AUTO_REFRESH_MS);
}

document.getElementById('btnIntHistConsultar')?.addEventListener('click', () => {
  loadIntercambiosHistorico({ quiet: false });
});
document.getElementById('btnIntHistRefresh')?.addEventListener('click', () => {
  loadIntercambiosHistorico({ quiet: true });
});
document.getElementById('buscarIntHist')?.addEventListener('input', (e) => {
  intHistSearch = e.target.value || '';
  renderIntercambiosHistoricoTable();
});
document.getElementById('buscarAgeingInv')?.addEventListener('input', (e) => {
  ageingSearch = e.target.value || '';
  renderAgeingSlowTable();
});
document.getElementById('buscarVendidosInv')?.addEventListener('input', (e) => {
  vendidosSearch = e.target.value || '';
  renderVendidosTable();
});
document.getElementById('vendidosCarlineFilterTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vendidos-filter]');
  if (!btn) return;
  vendidosCarlineFilter = btn.dataset.vendidosFilter || 'all';
  document.querySelectorAll('#vendidosCarlineFilterTabs [data-vendidos-filter]').forEach((el) => {
    const on = el.dataset.vendidosFilter === vendidosCarlineFilter;
    el.classList.toggle('is-active', on);
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderVendidosTable();
});
document.getElementById('vendidosPeriod')?.addEventListener('change', () => {
  const input = document.getElementById('vendidosPeriod');
  const raw = String(input?.value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    const last = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    const fi = `${year}-${mm}-01`;
    const ff = `${year}-${mm}-${String(last).padStart(2, '0')}`;
    const fiEl = document.getElementById('fechaInicio');
    const ffEl = document.getElementById('fechaFin');
    if (fiEl) fiEl.value = fi;
    if (ffEl) ffEl.value = ff;
    Dashboard.updateCompactFilterLabels?.();
  }
  vendidosCarlineFilter = 'all';
  loadVendidosAnalisis({ quiet: false });
});
document.getElementById('autosVendidosInsightsCompactGoto')?.addEventListener('click', () => {
  gotoCierreUnidadesVendidas();
});
document.getElementById('ageingCarlineFilterTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ageing-filter]');
  if (!btn) return;
  ageingCarlineFilter = btn.dataset.ageingFilter || 'all';
  document.querySelectorAll('#ageingCarlineFilterTabs [data-ageing-filter]').forEach((el) => {
    const on = el.dataset.ageingFilter === ageingCarlineFilter;
    el.classList.toggle('is-active', on);
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderAgeingSlowTable();
});
document.getElementById('intHistFilterTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-int-filter]');
  if (!btn) return;
  intHistFilter = btn.dataset.intFilter || 'all';
  document.querySelectorAll('#intHistFilterTabs [data-int-filter]').forEach((el) => {
    const on = el.dataset.intFilter === intHistFilter;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderIntercambiosHistoricoTable();
});

const params = new URLSearchParams(window.location.search);
if (params.get('tab') === 'postventa') setInventoryScope('postventa');
else if (params.get('tab') === 'seminuevos') setInventoryScope('seminuevos');
else if (params.get('tab') === 'cierre') setInventoryScope('cierre');
else setInventoryScope('autos');

initPlanPisoKpiCard();
initIntercambiosHistoricoDates({ force: true });
initVendidosPeriod();
Dashboard.initDateFilter?.({
  onConsult: async (fi, ff) => {
    const vendidosInput = document.getElementById('vendidosPeriod');
    if (vendidosInput && fi.slice(0, 7) === ff.slice(0, 7)) vendidosInput.value = fi.slice(0, 7);

    // Intercambios usa su propio rango (año anterior → hoy). No lo pisa el filtro global.
    initIntercambiosHistoricoDates();

    await Promise.all([
      loadInventory({ quiet: false }),
      loadIntercambiosHistorico({ quiet: false }),
      loadVendidosAnalisis({ quiet: false }),
      loadEntregasSinPreviasMes({ quiet: false }),
      inventoryScope === 'postventa' ? loadInventoryPostventa({ force: true }) : Promise.resolve(),
    ]);
  },
  getInitialRange: (fromUrl) => {
    if (fromUrl?.fechaInicio && fromUrl?.fechaFin) return fromUrl;
    return inventoryDefaultDateRange();
  },
});
if (!params.get('fechaInicio') && !params.get('fechaFin')) {
  const defaultPreset = new Date().getDate() <= 2 ? 'mes-anterior' : 'mes-actual';
  Dashboard.setActivePresetChip?.(defaultPreset);
}
startInventoryAutoRefresh();
