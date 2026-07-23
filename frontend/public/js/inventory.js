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

function rowsForAutosKpi(kpiId) {
  if (kpiId === 'available') {
    return inventoryRows.filter((r) => r.situacion === 'DIS' || r.situacion === 'FIS' || r.situacion === 'SEP');
  }
  if (kpiId === 'sinPrevias') {
    return inventoryRows.filter((r) => Number(r.previas || 0) === 0);
  }
  return inventoryRows;
}

function autosKpiMeta(kpiId) {
  if (kpiId === 'available') {
    return {
      title: 'Disponibles',
      hint: 'FIS, DIS y Apartadas (SEP) · las apartadas muestran días y quién las apartó',
      scopeLabel: 'disponibles',
    };
  }
  if (kpiId === 'sinPrevias') {
    return {
      title: 'Sin previas',
      hint: 'Unidades sin órdenes de servicio que empiecen con S · Previas = 0',
      scopeLabel: 'sin previas',
    };
  }
  return {
    title: 'Unidades totales',
    hint: 'Todas las situaciones · las apartadas (SEP) muestran días y quién las apartó',
    scopeLabel: 'unidades',
  };
}

function groupAutosRows(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r) || 'Sin dato';
    if (!map.has(key)) map.set(key, { id: key, label: labelFn(r, key), units: 0 });
    map.get(key).units += 1;
  }
  return [...map.values()].sort((a, b) => b.units - a.units);
}

function syncAutosKpiCards() {
  document.querySelectorAll('[data-autos-kpi]').forEach((btn) => {
    const open = activeAutosKpi === btn.dataset.autosKpi;
    btn.classList.toggle('is-selected', open);
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

function renderAutosKpiDetail() {
  const panel = document.getElementById('autosKpiDetail');
  if (!panel) return;

  if (!activeAutosKpi) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const { fmt, statusBadge } = Dashboard;
  const rows = rowsForAutosKpi(activeAutosKpi);
  const meta = autosKpiMeta(activeAutosKpi);
  const title = meta.title;
  const hint = meta.hint;

  const bySituacion = groupAutosRows(
    rows,
    (r) => r.situacion,
    (r, k) => r.situacionLabel || k,
  );

  const activeFilter = autosKpiFilter?.kpi === activeAutosKpi && autosKpiFilter?.dim === 'situacion'
    ? autosKpiFilter
    : null;

  const detailRows = activeFilter
    ? rows.filter((r) => (r.situacion || '') === activeFilter.id)
    : rows;

  const situacionRows = bySituacion.map((item) => {
    const selected = activeFilter?.id === item.id;
    const isApartada = item.id === 'SEP';
    return `
      <tr class="row-selectable${selected ? ' row-active' : ''}${isApartada ? ' row-apartada' : ''}" data-autos-filter-dim="situacion" data-autos-filter-id="${item.id}">
        <td>${item.label}${isApartada ? ' <span class="badge-tipo badge-flotilla">Apartada</span>' : ''}</td>
        <td class="cell-num"><strong>${fmt.number(item.units)}</strong></td>
        <td class="cell-num">${rows.length ? `${Math.round((item.units / rows.length) * 1000) / 10}%` : '—'}</td>
      </tr>`;
  }).join('');

  const groups = new Map();
  for (const r of detailRows) {
    const key = r.situacion || 'OTRO';
    if (!groups.has(key)) {
      groups.set(key, { label: r.situacionLabel || key, units: [] });
    }
    groups.get(key).units.push(r);
  }

  const situacionOrder = bySituacion.map((s) => s.id);
  const orderedGroups = [...groups.entries()].sort((a, b) => {
    const ia = situacionOrder.indexOf(a[0]);
    const ib = situacionOrder.indexOf(b[0]);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  const detailHtml = orderedGroups.length
    ? orderedGroups.map(([key, group]) => `
        <tr class="eeff-kpi-detail__section">
          <td colspan="10">${group.label} · ${fmt.number(group.units.length)} unidades</td>
        </tr>
        ${group.units.map((r) => `
          <tr class="${r.isApartada || r.situacion === 'SEP' ? 'row-apartada' : ''}">
            <td><strong>${r.tipoAuto || '—'}</strong></td>
            <td>${r.familia || '—'}</td>
            <td>${r.serie || '—'}</td>
            <td class="cell-num">${Number(r.previas || 0)}</td>
            <td>${r.ubicacion || '—'}</td>
            <td>
              <span class="badge-tipo${r.isApartada || r.situacion === 'SEP' ? ' badge-flotilla' : ''}">${r.situacionLabel || key}</span>
            </td>
            <td class="cell-num">${r.daysInStock !== null ? r.daysInStock : '—'}</td>
            <td class="cell-num">${r.isApartada || r.situacion === 'SEP' ? (r.daysApartado ?? '—') : '—'}</td>
            <td>${r.isApartada || r.situacion === 'SEP' ? (r.apartadoPor || '—') : '—'}</td>
            <td>${statusBadge ? statusBadge(r.status) : (r.status || '—')}</td>
          </tr>
        `).join('')}
      `).join('')
    : '<tr class="empty-row"><td colspan="10">Sin unidades en esta selección.</td></tr>';

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="eeff-kpi-detail">
      <div class="eeff-kpi-detail__head">
        <div>
          <p class="eeff-kpi-detail__eyebrow">Desglose</p>
          <h4 class="eeff-kpi-detail__title">${title} · ${fmt.number(rows.length)} unidades</h4>
          <p class="eeff-kpi-detail__hint">${hint}</p>
        </div>
        <button type="button" class="eeff-kpi-detail__close" data-autos-kpi-close aria-label="Cerrar desglose">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div style="padding:12px 16px 8px">
        <h3 class="section-title" style="font-size:14px;margin-bottom:8px">Por situación</h3>
        <div class="table-scroll" style="max-height:200px">
          <table class="data-table data-table--selectable">
            <thead><tr><th>Situación</th><th class="cell-num">Unidades</th><th class="cell-num">%</th></tr></thead>
            <tbody>${situacionRows || '<tr class="empty-row"><td colspan="3">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
        ${activeFilter ? `<p class="section-subtitle" style="margin-top:10px">Mostrando: <strong>${activeFilter.label}</strong> · <button type="button" class="btn-link" data-autos-clear-filter>Ver todas</button></p>` : ''}
      </div>
      <div style="padding:8px 16px 16px">
        <h3 class="section-title" style="font-size:14px;margin-bottom:8px">Detalle de unidades${activeFilter ? ` · ${activeFilter.label}` : ' por situación'}</h3>
        <div class="table-scroll" style="max-height:360px">
          <table class="data-table">
            <thead><tr>
              <th>Modelo</th>
              <th>Familia</th>
              <th>Serie</th>
              <th class="cell-num">Previas</th>
              <th>Ubicación</th>
              <th>Situación</th>
              <th class="cell-num">Días stock</th>
              <th class="cell-num">Días aparte</th>
              <th>Apartó</th>
              <th>Status</th>
            </tr></thead>
            <tbody>${detailHtml}</tbody>
          </table>
        </div>
        <p class="section-subtitle" style="margin-top:8px">${fmt.number(detailRows.length)} unidades listadas · apartadas resaltadas</p>
      </div>
    </div>`;
}

function applyAutosKpiTableFilter() {
  const term = getInventorySearchTerm();
  renderTable(filterRows(term), { searchTerm: term });
}

function setActiveAutosKpi(kpiId) {
  activeAutosKpi = activeAutosKpi === kpiId ? null : kpiId;
  if (!activeAutosKpi || autosKpiFilter?.kpi !== activeAutosKpi) {
    autosKpiFilter = null;
  }
  syncAutosKpiCards();
  renderAutosKpiDetail();
  applyAutosKpiTableFilter();
  if (activeAutosKpi) {
    document.getElementById('autosKpiDetail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function setAutosKpiFilter(dim, id, label) {
  if (autosKpiFilter?.kpi === activeAutosKpi && autosKpiFilter?.dim === dim && autosKpiFilter?.id === id) {
    autosKpiFilter = null;
  } else {
    autosKpiFilter = { kpi: activeAutosKpi, dim, id, label };
  }
  renderAutosKpiDetail();
  applyAutosKpiTableFilter();
}

function clearAutosKpiFilter() {
  autosKpiFilter = null;
  renderAutosKpiDetail();
  applyAutosKpiTableFilter();
}

function filterRows(term) {
  let rows = inventoryRows.slice();

  if (activeAutosKpi === 'available') {
    rows = rows.filter((r) => r.situacion === 'DIS' || r.situacion === 'FIS' || r.situacion === 'SEP');
  }
  if (activeAutosKpi === 'sinPrevias') {
    rows = rows.filter((r) => Number(r.previas || 0) === 0);
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

function renderCharts(data) {
  const { chartOptions, chartPalette, chartColors } = Dashboard;
  const s = data.summary;

  destroyChart(ageingChart);
  ageingChart = new Chart(document.getElementById('ageingChart'), {
    type: 'bar',
    data: {
      labels: data.ageingChart.map((r) => r.model.slice(0, 18)),
      datasets: [{
        label: 'Días promedio',
        data: data.ageingChart.map((r) => r.avgDays),
        backgroundColor: data.ageingChart.map((r) => (r.critical ? chartColors.error : chartColors.primary)),
        borderRadius: 8,
      }],
    },
    options: chartOptions({ plugins: { legend: { display: false } } }),
  });

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
        renderAutosKpiDetail();
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

function filterSofiaSinPreviasRows(term) {
  const rows = window.__invSofiaSinPrevias || [];
  const q = String(term || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.FECHA_PERIODO, r.SOF_FechAct, r.SOF_HoraAct, r.SOF_Factura, r.SOF_VIN, r.CLIENTE, r.SOF_Estatus, r.SOF_CveUSu]
      .some((v) => String(v ?? '').toLowerCase().includes(q))
  );
}

function renderInvSinPreviasTable(rows) {
  const body = document.getElementById('tablaInvSinPreviasBody');
  if (!body) return;
  const term = document.getElementById('buscarInvSinPrevias')?.value?.trim();
  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">${term ? 'Sin coincidencias.' : 'No hay entregas SOFIA sin previa en el mes.'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.FECHA_PERIODO || r.SOF_FechFact || '—'}</td>
      <td>${r.SOF_FechAct || '—'}</td>
      <td>${r.SOF_HoraAct || '—'}</td>
      <td><strong>${r.SOF_Factura || '—'}</strong></td>
      <td>${r.SOF_VIN || '—'}</td>
      <td class="cell-num">${Number(r.PREVIAS || 0)}</td>
      <td>${r.CLIENTE || '—'}</td>
      <td>${r.SOF_Estatus || '—'}</td>
      <td>${r.SOF_CveUSu || '—'}</td>
    </tr>
  `).join('');
}

function updateInvSinPreviasPanel(filteredCount) {
  const resumen = document.getElementById('invSinPreviasPanelResumen');
  const meta = document.getElementById('invSinPreviasSearchMeta');
  const total = (window.__invSofiaSinPrevias || []).length;
  const range = currentMonthRange();
  if (!resumen) return;
  if (filteredCount != null && filteredCount !== total) {
    resumen.textContent = `${filteredCount} de ${total} · ${range.label}`;
    if (meta) {
      meta.textContent = `${filteredCount} resultado(s)`;
      meta.classList.remove('hidden');
    }
    return;
  }
  meta?.classList.add('hidden');
  resumen.textContent = total
    ? `${total} entrega(s) SOFIA sin previa · ${range.label}`
    : `Sin entregas SOFIA sin previa · ${range.label}`;
}

function setInvSinPreviasPanelOpen(open) {
  const panel = document.getElementById('panelEntregasSinPreviasInv');
  const card = document.getElementById('kpiEntregasSinPrevias');
  if (!panel || !card) return;
  if (!open) {
    panel.classList.add('hidden');
    card.classList.remove('is-selected');
    card.setAttribute('aria-expanded', 'false');
    return;
  }
  const wasOpen = !panel.classList.contains('hidden');
  if (wasOpen) {
    setInvSinPreviasPanelOpen(false);
    return;
  }
  panel.classList.remove('hidden');
  card.classList.add('is-selected');
  card.setAttribute('aria-expanded', 'true');
  const rows = filterSofiaSinPreviasRows('');
  renderInvSinPreviasTable(rows);
  updateInvSinPreviasPanel();
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  } catch (err) {
    console.warn('[Inventario] Entregas sin previa:', err.message);
    window.__invSofiaSinPrevias = [];
    window.__invSofiaTotalMes = 0;
    setText('sEntregasSinPrevias', '—');
    setText('sEntregasSinPreviasSub', 'No se pudo cargar SOFIA del mes');
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

document.getElementById('autosKpiDetail')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-autos-kpi-close]')) {
    activeAutosKpi = null;
    autosKpiFilter = null;
    syncAutosKpiCards();
    renderAutosKpiDetail();
    applyAutosKpiTableFilter();
    return;
  }
  if (e.target.closest('[data-autos-clear-filter]')) {
    clearAutosKpiFilter();
    return;
  }
  const row = e.target.closest('[data-autos-filter-dim]');
  if (!row) return;
  const dim = row.dataset.autosFilterDim;
  const id = row.dataset.autosFilterId;
  const label = row.querySelector('td')?.textContent?.trim() || id;
  setAutosKpiFilter(dim, id, label);
});

const params = new URLSearchParams(window.location.search);
if (params.get('tab') === 'postventa') setInventoryScope('postventa');
else setInventoryScope('autos');

initPlanPisoKpiCard();

document.getElementById('kpiEntregasSinPrevias')?.addEventListener('click', () => {
  setInvSinPreviasPanelOpen(true);
});
document.getElementById('btnCerrarInvSinPreviasPanel')?.addEventListener('click', () => {
  setInvSinPreviasPanelOpen(false);
});
document.getElementById('buscarInvSinPrevias')?.addEventListener('input', (e) => {
  const filtered = filterSofiaSinPreviasRows(e.target.value);
  renderInvSinPreviasTable(filtered);
  updateInvSinPreviasPanel(e.target.value.trim() ? filtered.length : undefined);
});

loadInventory();
