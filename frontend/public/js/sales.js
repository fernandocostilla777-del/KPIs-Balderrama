(function () {
  'use strict';

  const SALES_JS_BUILD = 99;
  if (window.__salesPageInitBuild === SALES_JS_BUILD) return;

  let registrosActuales = [];
  let entregasActuales = [];
  let apartadasActuales = [];
  let tomasACuentaActuales = [];
  let tomasACuentaMeta = { porModeloToma: [], montoAdquisicion: 0, totalVendidosMismoMes: 0, pctVendidosMismoMes: 0 };
  let activeVentasKpiType = null;
  let activeVentasDrawerKpi = null;
  let ventasDrawerUi = null;
  let lastYtd = null;
  let ytdQuarters = new Set([1, 2, 3, 4]);
  let tomasQuarters = new Set([1, 2, 3, 4]);
  let lastTomasMensual = null;
  let lastMixAutos = null;
  let mixOtrosExpanded = false;
  let mixOtrosFloat = null;

  function setMixOtrosExpanded(open) {
    mixOtrosExpanded = Boolean(open);
    const panel = document.getElementById('mixOtrosDetalle');
    const btn = document.getElementById('btnMixOtrosToggle');
    const label = btn?.querySelector('[data-mix-otros-label]');
    const icon = btn?.querySelector('.material-symbols-outlined');
    if (panel) {
      panel.classList.toggle('hidden', !mixOtrosExpanded);
      panel.hidden = !mixOtrosExpanded;
    }
    if (btn) btn.setAttribute('aria-expanded', mixOtrosExpanded ? 'true' : 'false');
    if (label) label.textContent = mixOtrosExpanded ? 'Ocultar detalle de Otros' : 'Ver detalle de Otros';
    if (icon) icon.textContent = mixOtrosExpanded ? 'unfold_less' : 'unfold_more';
    if (!mixOtrosExpanded) closeMixOtrosFloat();
  }

  function ensureMixOtrosFloat() {
    if (mixOtrosFloat) return mixOtrosFloat;
    const el = document.createElement('div');
    el.id = 'mixOtrosFloat';
    el.className = 'toma-float mix-otros-float hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Detalle Otros por fuerza');
    el.innerHTML = `
      <div class="toma-float__header" data-mix-otros-drag>
        <div class="toma-float__title-wrap">
          <span class="material-symbols-outlined">groups</span>
          <div>
            <h3 class="toma-float__title" data-mix-otros-title>Fuerza</h3>
            <p class="toma-float__subtitle" data-mix-otros-sub></p>
          </div>
        </div>
        <button type="button" class="toma-float__icon-btn" data-mix-otros-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="toma-float__body custom-scrollbar" data-mix-otros-body></div>
    `;
    document.body.appendChild(el);
    el.querySelector('[data-mix-otros-close]')?.addEventListener('click', () => closeMixOtrosFloat());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.classList.contains('hidden')) closeMixOtrosFloat();
    });

    const dragHandle = el.querySelector('[data-mix-otros-drag]');
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    dragHandle?.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.setPointerCapture?.(e.pointerId);
    });
    dragHandle?.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, e.clientX - offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, e.clientY - offsetY));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });
    const endDrag = () => { dragging = false; };
    dragHandle?.addEventListener('pointerup', endDrag);
    dragHandle?.addEventListener('pointercancel', endDrag);

    mixOtrosFloat = el;
    return el;
  }

  function closeMixOtrosFloat() {
    if (!mixOtrosFloat) return;
    mixOtrosFloat.classList.add('hidden');
  }

  function openMixOtrosModeloDrawer(modeloLabel) {
    if (!modeloLabel) return;
    openMixAutosDrawer({
      filter: { dim: 'carline', value: modeloLabel, label: modeloLabel },
    });
  }

  function renderMixOtrosDetalle(mix) {
    const controls = document.getElementById('mixOtrosControls');
    const body = document.getElementById('mixOtrosBody');
    const meta = document.getElementById('mixOtrosMeta');
    const modelos = mix?.otrosDetalle || [];
    const otrosTotal = mix?.otrosTotal || 0;
    const total = mix?.total || 0;

    if (!controls || !body) return;

    if (!modelos.length) {
      controls.classList.add('hidden');
      setMixOtrosExpanded(false);
      body.innerHTML = '<tr class="empty-row"><td colspan="4">Sin unidades en Otros.</td></tr>';
      if (meta) meta.textContent = '';
      return;
    }

    controls.classList.remove('hidden');
    controls.style.display = 'flex';
    if (meta) {
      meta.textContent = `${modelos.length} modelos · ${otrosTotal} uds (${total > 0 ? Math.round((otrosTotal / total) * 1000) / 10 : 0}% del mix)`;
    }

    body.innerHTML = modelos.map(([label, count], idx) => {
      const n = Number(count || 0);
      const pctMix = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
      const pctOtros = otrosTotal > 0 ? Math.round((n / otrosTotal) * 1000) / 10 : 0;
      return `<tr class="mix-otros-row" data-mix-modelo-idx="${idx}" data-mix-modelo="${escapeHtml(label)}" title="Ver unidades de este modelo" tabindex="0" role="button">
        <td><strong>${escapeHtml(label)}</strong></td>
        <td class="cell-num">${n}</td>
        <td class="cell-num">${pctMix}%</td>
        <td class="cell-num">${pctOtros}%</td>
      </tr>`;
    }).join('');
  }

  function wireMixOtrosControls() {
    const btn = document.getElementById('btnMixOtrosToggle');
    if (btn && btn.dataset.bound !== '1') {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => setMixOtrosExpanded(!mixOtrosExpanded));
    }

    const analyzeBtn = document.getElementById('btnMixAutosDetalle');
    if (analyzeBtn && analyzeBtn.dataset.bound !== '1') {
      analyzeBtn.dataset.bound = '1';
      analyzeBtn.addEventListener('click', () => openMixAutosDrawer());
    }

    const body = document.getElementById('mixOtrosBody');
    if (body && body.dataset.bound !== '1') {
      body.dataset.bound = '1';
      const openFromRow = (row) => {
        const idx = Number(row?.dataset?.mixModeloIdx);
        if (!Number.isFinite(idx)) return;
        const modelo = lastMixAutos?.otrosDetalle?.[idx]?.[0];
        if (modelo) openMixOtrosModeloDrawer(modelo);
      };
      body.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-mix-modelo-idx]');
        if (row) openFromRow(row);
      });
      body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('tr[data-mix-modelo-idx]');
        if (!row) return;
        e.preventDefault();
        openFromRow(row);
      });
    }
  }
  let sofiaLiveTimer = null;
  let sofiaLiveActive = false;
  const charts = {};
  let els = null;
  let chartOptions = null;
  let chartPalette = null;
  let chartColors = null;
  let CANAL_COLORS = null;
  let goalActualRetail = 0;
  let goalActualSofia = 0;
  let resumenActual = null;
  let compactFilters = null;
  let activeSalesTab = 'ventas';
  let pendingFinanciamiento = null;
  let pendingLeads = null;
  let pendingAfluencia = null;

  const GOAL_STORAGE_KEYS = {
    retail: 'autointel_goal_retail',
    sofia: 'autointel_goal_sofia',
  };
  let goalsSaveTimer = null;
  /** Solo Administración (canManageUsers) puede editar; el resto solo lee el valor compartido. */
  let canEditGoals = false;

  function applyGoalEditMode() {
    const editable = Boolean(canEditGoals);
    [els.goalRetailInput, els.goalSofiaInput].forEach((input) => {
      if (!input) return;
      input.readOnly = !editable;
      input.tabIndex = editable ? 0 : -1;
      input.title = editable
        ? 'Objetivo compartido del periodo (editable por Administración)'
        : 'Solo Administración puede modificar este objetivo';
    });
    document.querySelectorAll('[data-goal-step]').forEach((btn) => {
      btn.disabled = !editable;
      btn.hidden = !editable;
    });
    els.goalRetailPanel?.classList.toggle('goal-chart-panel--readonly', !editable);
    els.goalSofiaPanel?.classList.toggle('goal-chart-panel--readonly', !editable);
  }

  async function resolveGoalEditPermission() {
    try {
      const session = await window.DashboardAuth?.getSession?.();
      canEditGoals = Boolean(session?.canManageUsers || session?.devBypass);
    } catch {
      canEditGoals = false;
    }
    applyGoalEditMode();
  }

  async function fetchSharedGoals() {
    const fechaInicio = els?.fechaInicio?.value;
    const fechaFin = els?.fechaFin?.value;
    if (!fechaInicio || !fechaFin) return;

    const res = await fetch(`/api/ventas/objetivos?fechaInicio=${encodeURIComponent(fechaInicio)}&fechaFin=${encodeURIComponent(fechaFin)}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudieron cargar los objetivos compartidos.');
    }
    const data = await res.json();

    if (els.goalRetailInput) els.goalRetailInput.value = data.retail ?? '';
    if (els.goalSofiaInput) els.goalSofiaInput.value = data.sofia ?? '';
    updateGoalHistoricLabels(data);

    const needsMigrate = canEditGoals && data.retail == null && data.sofia == null;
    if (needsMigrate) {
      const legacyRetail = localStorage.getItem(GOAL_STORAGE_KEYS.retail);
      const legacySofia = localStorage.getItem(GOAL_STORAGE_KEYS.sofia);
      if (legacyRetail || legacySofia) {
        if (legacyRetail && els.goalRetailInput) els.goalRetailInput.value = legacyRetail;
        if (legacySofia && els.goalSofiaInput) els.goalSofiaInput.value = legacySofia;
        await persistSharedGoals();
        localStorage.removeItem(GOAL_STORAGE_KEYS.retail);
        localStorage.removeItem(GOAL_STORAGE_KEYS.sofia);
      }
    }
  }

  function updateGoalHistoricLabels(data) {
    const retailLabel = els.goalRetailPanel?.querySelector('.goal-target-label');
    const sofiaLabel = els.goalSofiaPanel?.querySelector('.goal-target-label');
    const month = data?.historicMonth;
    const baseRetail = month && data.retailSource === 'historic'
      ? `Objetivo del periodo · histórico ${month}`
      : 'Objetivo del periodo';
    const baseSofia = month && data.sofiaSource === 'historic'
      ? `Objetivo del periodo · histórico ${month}`
      : 'Objetivo del periodo';
    if (retailLabel) {
      retailLabel.textContent = canEditGoals
        ? baseRetail
        : `${baseRetail} · solo Administración edita`;
    }
    if (sofiaLabel) {
      sofiaLabel.textContent = canEditGoals
        ? baseSofia
        : `${baseSofia} · solo Administración edita`;
    }
  }

  async function persistSharedGoals() {
    if (!canEditGoals) return;
    const fechaInicio = els?.fechaInicio?.value;
    const fechaFin = els?.fechaFin?.value;
    if (!fechaInicio || !fechaFin) return;

    const retail = getGoalValue('retail') || null;
    const sofia = getGoalValue('sofia') || null;

    const res = await fetch('/api/ventas/objetivos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fechaInicio, fechaFin, retail, sofia }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudieron guardar los objetivos.');
    }
  }

  function scheduleSaveGoals() {
    if (!canEditGoals) return;
    clearTimeout(goalsSaveTimer);
    goalsSaveTimer = setTimeout(() => {
      persistSharedGoals().catch((err) => {
        console.error('[Goals save]', err);
        setStatus(err.message, 'error');
      });
    }, 450);
  }

  function formatDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function setStatus(text, type = 'ready') {
    if (!els?.statusBadge) return;
    els.statusBadge.textContent = text;
    els.statusBadge.className = 'sidebar-status-line';
    if (type === 'loading') els.statusBadge.classList.add('status-loading');
    else if (type === 'error') els.statusBadge.classList.add('status-error');
    const dot = document.querySelector('[data-status-dot]');
    if (dot) {
      dot.classList.toggle('is-loading', type === 'loading');
      dot.classList.toggle('is-error', type === 'error');
    }
  }

  function setDefaultDates() {
    const now = new Date();
    els.fechaInicio.value = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
    els.fechaFin.value = formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  function applyPreset(preset) {
    const [start, end] = Dashboard.getDatePresetRange(preset);
    els.fechaInicio.value = formatDateInput(start);
    els.fechaFin.value = formatDateInput(end);
    Dashboard.setActivePresetChip(preset);
    Dashboard.updateCompactFilterLabels();
  }

  function destroyChart(name, canvasId) {
    if (charts[name]) {
      charts[name].destroy();
      delete charts[name];
    }
    if (canvasId && typeof Chart !== 'undefined') {
      const canvas = document.getElementById(canvasId);
      const existing = canvas ? Chart.getChart(canvas) : null;
      if (existing) existing.destroy();
    }
  }

  function resolveDataLabelKind(config) {
    if (!config || config.type === 'doughnut' || config.type === 'pie' || config.type === 'polarArea') {
      return null;
    }
    if (config.type === 'line') return 'line';
    const opts = config.options || {};
    const stacked = Boolean(opts.scales?.x?.stacked || opts.scales?.y?.stacked);
    if (opts.indexAxis === 'y') return stacked ? 'barStacked' : 'barHorizontal';
    return stacked ? 'barStacked' : 'bar';
  }

  function withUnitSalesDataLabels(config) {
    if (!config || typeof ChartDataLabels === 'undefined') return config;
    const kind = resolveDataLabelKind(config);
    if (!kind) {
      config.options = config.options || {};
      config.options.plugins = {
        ...(config.options.plugins || {}),
        datalabels: { display: false, ...(config.options.plugins?.datalabels || {}) },
      };
      return config;
    }
    const baseLabels = (Dashboard.chartDataLabels || (() => ({ display: true })))(kind);
    const prev = config.options?.plugins?.datalabels || {};
    config.options = config.options || {};
    config.options.plugins = {
      ...(config.options.plugins || {}),
      datalabels: { ...baseLabels, ...prev, display: prev.display === false ? false : true },
    };
    const already = Array.isArray(config.plugins) && config.plugins.includes(ChartDataLabels);
    if (!already) {
      config.plugins = [...(config.plugins || []), ChartDataLabels];
    }
    const pad = kind === 'barHorizontal'
      ? { top: 4, right: 36, bottom: 0, left: 0 }
      : kind === 'line'
        ? { top: 22, right: 8, bottom: 0, left: 0 }
        : { top: 22, right: 8, bottom: 0, left: 0 };
    const prevPad = config.options.layout?.padding;
    config.options.layout = {
      ...(config.options.layout || {}),
      padding: typeof prevPad === 'number'
        ? prevPad
        : { ...pad, ...(prevPad || {}) },
    };
    return config;
  }

  function createChart(name, canvasId, config) {
    destroyChart(name, canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    charts[name] = new Chart(canvas, withUnitSalesDataLabels(config));
    return charts[name];
  }

  function getGoalValue(which) {
    const input = which === 'retail' ? els.goalRetailInput : els.goalSofiaInput;
    const value = parseInt(input?.value, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function saveGoal() {
    scheduleSaveGoals();
  }

  async function loadGoalInputs() {
    try {
      await fetchSharedGoals();
    } catch (err) {
      console.error('[Goals load]', err);
      if (!canEditGoals) return;
      const retail = localStorage.getItem(GOAL_STORAGE_KEYS.retail);
      const sofia = localStorage.getItem(GOAL_STORAGE_KEYS.sofia);
      if (retail && els.goalRetailInput) els.goalRetailInput.value = retail;
      if (sofia && els.goalSofiaInput) els.goalSofiaInput.value = sofia;
    }
  }

  function formatGoalPct(actual, goal) {
    if (!goal || goal <= 0) return '—';
    const pct = (actual / goal) * 100;
    if (pct > 999) return '+999.00%';
    return `${pct.toFixed(2)}%`;
  }

  function setKpiBarFill(key, pct) {
    const el = document.querySelector(`[data-kpi-fill="${key}"]`);
    if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  function renderKpiVisualBars(resumen) {
    const total = Math.max(resumen.totalVentas || 0, 1);
    const goalSofia = getGoalValue('sofia');
    const numerador = resumen.numeradorCobertura
      ?? ((resumen.totalNotificacionesEntrega ?? 0) + (resumen.totalUnidadesFacturadasNoTimbradas ?? 0));

    setKpiBarFill('total', 100);
    setKpiBarFill('retail', ((resumen.totalRetail ?? 0) / total) * 100);
    setKpiBarFill('flotillas', ((resumen.totalFlotillas ?? 0) / total) * 100);
    setKpiBarFill('sofia', ((resumen.totalNotificacionesEntrega ?? 0) / total) * 100);
    setKpiBarFill('carryOver', goalSofia > 0
      ? (((resumen.numeradorCobertura ?? 0) + (resumen.unidadesApartadas ?? 0)) / goalSofia) * 100
      : 0);
    setKpiBarFill('cobertura', goalSofia > 0 ? (numerador / goalSofia) * 100 : 0);
  }

  function formatCoberturaPct(numerador, goal) {
    if (!goal || goal <= 0) return null;
    const pct = (numerador / goal) * 100;
    if (pct > 999) return '+999.00%';
    return `${pct.toFixed(2)}%`;
  }

  const CARRY_OVER_EXCLUDED_APARTADO_POR = [
    'BALDERRAMA CASA INTERCAMBIOS',
  ];

  function normalizeApartadoKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function isExcludedCarryOverApartada(unit) {
    const quien = normalizeApartadoKey(unit?.apartadoPor || unit?.usuarioApartado || '');
    if (!quien) return false;
    return CARRY_OVER_EXCLUDED_APARTADO_POR.some((name) => quien === normalizeApartadoKey(name) || quien.includes(normalizeApartadoKey(name)));
  }

  function filterCarryOverApartadas(units) {
    return (units || []).filter((u) => (u.isApartada || u.situacion === 'SEP') && !isExcludedCarryOverApartada(u));
  }

  async function ensureApartadasInResumen() {
    if (!resumenActual) return;
    try {
      const inv = await Dashboard.api('/inventory?planPisoPeriod=all');
      const units = Array.isArray(inv?.inventoryTable)
        ? inv.inventoryTable
        : (Array.isArray(inv?.units) ? inv.units : []);
      apartadasActuales = filterCarryOverApartadas(units);
      resumenActual.unidadesApartadas = apartadasActuales.length;
    } catch (err) {
      console.warn('[Carry over] No se pudieron cargar apartadas:', err.message);
      if (resumenActual.unidadesApartadas == null) resumenActual.unidadesApartadas = 0;
      if (!apartadasActuales.length) apartadasActuales = [];
    }
  }

  function getCarryOverParts() {
    const apartadas = Number(resumenActual?.unidadesApartadas ?? apartadasActuales.length ?? 0);
    const goal = getGoalValue('sofia');
    const sofia = Number(resumenActual?.totalNotificacionesEntrega ?? 0);
    const facturadas = Number(resumenActual?.totalUnidadesFacturadas ?? resumenActual?.totalVentas ?? 0);
    const sinTimbrar = Number(
      resumenActual?.totalUnidadesFacturadasNoTimbradas
      ?? Math.max(0, facturadas - sofia)
    );
    const numeradorActual = Number(
      resumenActual?.numeradorCobertura != null
        ? resumenActual.numeradorCobertura
        : (sofia + sinTimbrar)
    );
    const numeradorSim = numeradorActual + apartadas;
    return { apartadas, goal, sofia, sinTimbrar, numeradorActual, numeradorSim };
  }

  function renderCarryOverKpi() {
    if (!els.kpiCarryOver || !resumenActual) return;

    const { apartadas, goal, sofia, sinTimbrar, numeradorSim } = getCarryOverParts();

    els.kpiCarryOver.textContent = String(apartadas);

    if (els.kpiCarryOverSub) {
      els.kpiCarryOverSub.textContent = goal
        ? `${apartadas} apartada${apartadas === 1 ? '' : 's'} SEP · clic para ver sim. cobertura`
        : `${apartadas} apartada${apartadas === 1 ? '' : 's'} SEP · defina objetivo SOFIA para el %`;
    }

    setKpiBarFill('carryOver', goal > 0 ? (numeradorSim / goal) * 100 : 0);
    els.kpiCardCarryOver?.classList.toggle('kpi-card--complete', goal > 0 && numeradorSim >= goal);

    if (activeVentasDrawerKpi === 'carryOver' && ventasDrawerUi?.isOpen?.()) {
      ventasDrawerUi.refresh();
    }
  }

  function renderCarryOverSimPanel() {
    const { apartadas, goal, sofia, sinTimbrar, numeradorActual, numeradorSim } = getCarryOverParts();
    const simPct = formatCoberturaPct(numeradorSim, goal);
    const actualPct = formatCoberturaPct(numeradorActual, goal);

    if (els.carryOverSimPct) {
      els.carryOverSimPct.textContent = simPct || (goal ? '—' : String(numeradorSim));
    }

    if (els.carryOverSimFormula) {
      els.carryOverSimFormula.textContent = goal
        ? `(${sofia} + ${sinTimbrar} + ${apartadas}) / ${goal} = ${simPct || '—'}`
        : 'Defina el objetivo SOFIA para calcular el porcentaje';
    }

    if (els.carryOverSimBreakdown) {
      els.carryOverSimBreakdown.innerHTML = [
        `<li><span>SOFIA</span><strong>${sofia}</strong></li>`,
        `<li><span>Sin timbrar</span><strong>${sinTimbrar}</strong></li>`,
        `<li><span>Apartadas SEP</span><strong>${apartadas}</strong></li>`,
        `<li><span>Numerador simulado</span><strong>${numeradorSim}</strong></li>`,
        `<li><span>Objetivo SOFIA</span><strong>${goal || '—'}</strong></li>`,
        actualPct
          ? `<li><span>Cobertura sin apartadas</span><strong>${actualPct}</strong></li>`
          : '',
      ].filter(Boolean).join('');
    }
  }

  function apartadasRowsHtml(rows, emptyMessage) {
    if (!rows.length) {
      return `<tr class="empty-row"><td colspan="8">${emptyMessage || 'No hay unidades apartadas (SEP) en inventario.'}</td></tr>`;
    }
    return rows.map((r) => {
      const serie = r.serie || r.vin || '';
      const modelo = r.tipoAuto || r.catalogo || r.modelo || '';
      const anio = r.anModelo || r.anio || '';
      const color = r.colorExterior || r.color || '';
      const situacion = r.situacionLabel || r.situacion || 'Apartada';
      const dias = r.daysApartado ?? '—';
      const quien = r.apartadoPor || r.usuarioApartado || '—';
      const previas = Number(r.previas || 0);
      return `<tr class="row-apartada">
        <td>${serie}</td><td>${modelo}</td><td>${anio}</td><td>${color}</td>
        <td><span class="badge-tipo badge-flotilla">${situacion}</span></td>
        <td class="cell-num">${dias}</td><td>${quien}</td>
        <td class="cell-num">${previas}</td>
      </tr>`;
    }).join('');
  }

  function renderCarryOverPreview(rows) {
    if (!els.tablaCarryOverPreviewBody) return;
    const term = els.buscarCarryOverPreview?.value?.trim();
    const emptyMessage = term ? 'No hay coincidencias con la búsqueda.' : undefined;
    els.tablaCarryOverPreviewBody.innerHTML = apartadasRowsHtml(rows, emptyMessage);
  }

  function filterApartadasRowsByTerm(term, base) {
    const q = term.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      [r.serie, r.tipoAuto, r.catalogo, r.anModelo, r.colorExterior, r.situacion, r.situacionLabel, r.apartadoPor, r.usuarioApartado, r.previas]
        .some((val) => String(val ?? '').toLowerCase().includes(q))
    );
  }

  function updateCarryOverPanelResumen(count, filteredCount) {
    if (!els.carryOverPanelResumen) return;
    const n = Number(count || 0);
    const filtered = filteredCount !== undefined ? Number(filteredCount) : null;
    const meta = els.carryOverPreviewSearchMeta;
    const { goal, sofia, sinTimbrar, apartadas, numeradorSim } = getCarryOverParts();
    const simPct = formatCoberturaPct(numeradorSim, goal);

    renderCarryOverSimPanel();

    if (filtered !== null && !Number.isNaN(filtered) && filtered !== n) {
      els.carryOverPanelResumen.textContent = `${filtered} de ${n} apartada${n === 1 ? '' : 's'} coinciden`;
      if (meta) {
        meta.textContent = `${filtered} resultado${filtered === 1 ? '' : 's'}`;
        meta.classList.remove('hidden');
      }
      return;
    }

    if (meta) meta.classList.add('hidden');
    els.carryOverPanelResumen.textContent = n
      ? `${n} unidad${n === 1 ? '' : 'es'} apartada${n === 1 ? '' : 's'} · sim. ${(sofia + sinTimbrar + apartadas)} / ${goal || '—'} = ${simPct || numeradorSim}`
      : 'Sin unidades apartadas (SEP) · el % solo suma SOFIA + sin timbrar';
  }

  function clearCarryOverPreviewSearch() {
    if (els.buscarCarryOverPreview) els.buscarCarryOverPreview.value = '';
    els.carryOverPreviewSearchMeta?.classList.add('hidden');
  }

  function applyCarryOverPreviewSearch() {
    const base = apartadasActuales;
    const term = els.buscarCarryOverPreview?.value || '';
    const filtered = filterApartadasRowsByTerm(term, base);
    renderCarryOverPreview(filtered);
    updateCarryOverPanelResumen(base.length, term.trim() ? filtered.length : undefined);
  }

  function closeCarryOverPanelUi() {
    ensureVentasKpiDrawer().close();
  }

  function setCarryOverPanelOpen(open) {
    const drawer = ensureVentasKpiDrawer();
    if (!open) {
      drawer.close();
      return;
    }
    drawer.open('carryOver', els.kpiCardCarryOver);
  }

  function toggleCarryOverPanel() {
    setCarryOverPanelOpen(true);
  }

  function updateTopBarSummary(resumen) {
    if (!els.topBarSummary || !resumen) return;
    const ventas = resumen.totalVentas ?? 0;
    const sofia = resumen.totalNotificacionesEntrega ?? 0;
    els.topBarSummary.textContent = `${ventas} ventas · ${sofia} entregas SOFIA`;
  }

  function formatGoalCounts(actual, goal, unitLabel) {
    const safeActual = Number.isFinite(actual) ? actual : 0;
    if (!goal || goal <= 0) {
      return `${safeActual} lograda${safeActual === 1 ? '' : 's'}`;
    }
    return `${safeActual} de ${goal} ${unitLabel}`;
  }

  function updateGoalProgress(which, actual, goal) {
    const isRetail = which === 'retail';
    const progressEl = isRetail ? els.goalRetailProgress : els.goalSofiaProgress;
    const trackEl = isRetail ? els.goalRetailProgressTrack : els.goalSofiaProgressTrack;
    const safeActual = Number.isFinite(actual) ? actual : 0;

    if (!progressEl || !trackEl) return;

    if (!goal || goal <= 0) {
      progressEl.style.width = '0%';
      progressEl.classList.remove('is-complete');
      trackEl.setAttribute('aria-valuenow', '0');
      trackEl.setAttribute('aria-valuetext', 'Sin objetivo definido');
      return;
    }

    const pct = Math.min(100, Math.round((safeActual / goal) * 1000) / 10);
    progressEl.style.width = `${pct}%`;
    progressEl.classList.toggle('is-complete', safeActual >= goal);
    trackEl.setAttribute('aria-valuenow', String(pct));
    trackEl.setAttribute('aria-valuetext', `${pct}% del objetivo`);
  }

  function renderGoalChart(which, actual, goal) {
    const isRetail = which === 'retail';
    const canvasId = isRetail ? 'chartGoalRetail' : 'chartGoalSofia';
    const chartName = isRetail ? 'goalRetail' : 'goalSofia';
    const pctEl = isRetail ? els.goalRetailPct : els.goalSofiaPct;
    const countsEl = isRetail ? els.goalRetailCounts : els.goalSofiaCounts;
    const panelEl = isRetail ? els.goalRetailPanel : els.goalSofiaPanel;
    const mainColor = isRetail ? '#27AE60' : '#E056FD';
    const exceedColor = '#F59E0B';
    const trackColor = '#DDE3EC';
    const unitLabel = isRetail ? 'unidades' : 'notificaciones';

    const safeActual = Number.isFinite(actual) ? actual : 0;
    let chartData;
    const doughnutStyle = {
      borderWidth: 2,
      borderColor: '#FFFFFF',
      hoverOffset: 0,
      borderRadius: 12,
      spacing: 2,
    };

    if (!goal || goal <= 0) {
      chartData = {
        labels: ['Avance', 'Sin objetivo'],
        datasets: [{
          data: safeActual > 0 ? [safeActual, 0.0001] : [0.0001, 1],
          backgroundColor: [mainColor, trackColor],
          ...doughnutStyle,
        }],
      };
      pctEl.textContent = '—';
      countsEl.textContent = formatGoalCounts(safeActual, 0, unitLabel);
      panelEl?.classList.remove('goal-chart-panel--complete');
    } else if (safeActual >= goal) {
      const excess = safeActual - goal;
      chartData = {
        labels: ['Objetivo', 'Excedente'],
        datasets: [{
          data: excess > 0 ? [goal, excess] : [goal, 0.0001],
          backgroundColor: [mainColor, exceedColor],
          ...doughnutStyle,
        }],
      };
      pctEl.textContent = formatGoalPct(safeActual, goal);
      countsEl.textContent = formatGoalCounts(safeActual, goal, unitLabel);
      panelEl?.classList.add('goal-chart-panel--complete');
    } else {
      const pending = goal - safeActual;
      chartData = {
        labels: ['Avance', 'Pendiente'],
        datasets: [{
          data: safeActual > 0 ? [safeActual, pending] : [0.0001, pending],
          backgroundColor: [mainColor, trackColor],
          ...doughnutStyle,
        }],
      };
      pctEl.textContent = formatGoalPct(safeActual, goal);
      countsEl.textContent = formatGoalCounts(safeActual, goal, unitLabel);
      panelEl?.classList.remove('goal-chart-panel--complete');
    }

    updateGoalProgress(which, safeActual, goal);

    createChart(chartName, canvasId, {
      type: 'doughnut',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        // El centro HTML ya muestra % y conteo: el tooltip encima lo tapa (ver solape Avance/%).
        events: [],
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
  }

  function renderCoberturaKpi() {
    if (!els.kpiCobertura || !resumenActual) return;

    const goal = getGoalValue('sofia');
    const reportadas = resumenActual.totalNotificacionesEntrega ?? 0;
    const facturadas = resumenActual.totalUnidadesFacturadas ?? resumenActual.totalVentas ?? 0;
    const noTimbradas = resumenActual.totalUnidadesFacturadasNoTimbradas ?? Math.max(0, facturadas - reportadas);
    const numerador = resumenActual.numeradorCobertura ?? (reportadas + noTimbradas);

    if (!goal) {
      els.kpiCobertura.textContent = String(numerador);
      els.kpiCardCobertura?.classList.remove('kpi-card--complete');
      setKpiBarFill('cobertura', 0);
      return;
    }

    const pct = (numerador / goal) * 100;
    els.kpiCobertura.textContent = pct > 999 ? '+999.00%' : `${pct.toFixed(2)}%`;
    els.kpiCardCobertura?.classList.toggle('kpi-card--complete', numerador >= goal);
    setKpiBarFill('cobertura', (numerador / goal) * 100);
    renderCarryOverKpi();
  }

  function renderGoalCharts(resumen) {
    goalActualRetail = resumen?.totalRetail ?? 0;
    goalActualSofia = resumen?.totalNotificacionesEntrega ?? 0;
    renderGoalChart('retail', goalActualRetail, getGoalValue('retail'));
    renderGoalChart('sofia', goalActualSofia, getGoalValue('sofia'));
  }

  function onGoalInputChange(which) {
    if (!canEditGoals) return;
    saveGoal();
    updateGoalHistoricLabels({ retailSource: 'saved', sofiaSource: 'saved' });
    const actual = which === 'retail' ? goalActualRetail : goalActualSofia;
    renderGoalChart(which, actual, getGoalValue(which));
    if (which === 'sofia') {
      renderCoberturaKpi();
      if (resumenActual) renderKpiVisualBars(resumenActual);
    }
  }

  function adjustGoal(which, delta) {
    if (!canEditGoals) return;
    const input = which === 'retail' ? els.goalRetailInput : els.goalSofiaInput;
    if (!input) return;
    const current = parseInt(input.value, 10);
    const base = Number.isFinite(current) && current > 0 ? current : 0;
    const next = Math.max(1, base + delta);
    input.value = String(next);
    onGoalInputChange(which);
  }

  function toggleVistaMensual(activo) {
    els.chartsMensuales.classList.toggle('hidden', !activo);
    els.kpisMensuales.classList.toggle('hidden', !activo);
  }

  function renderChartsMensuales(comparativo, resumen) {
    const { porMes, porMesPorTipo, porMesTopVendedores, porMesFlotillaRetail, porMesPorCanal, promedioMensual, mesMaximo, mesMinimo } = comparativo;

    els.kpiPromedioMes.textContent = promedioMensual;
    els.kpiMejorMes.textContent = mesMaximo ? `${mesMaximo.label} (${mesMaximo.count})` : '-';
    els.kpiMenorMes.textContent = mesMinimo ? `${mesMinimo.label} (${mesMinimo.count})` : '-';
    els.kpiAcumuladoAnio.textContent = resumen.totalVentas;

    createChart('mesFlotilla', 'chartMesFlotilla', {
      type: 'bar',
      data: {
        labels: porMesFlotillaRetail.labels,
        datasets: [
          { label: 'Retail', data: porMesFlotillaRetail.retail, backgroundColor: chartColors.secondary },
          { label: 'Flotillas', data: porMesFlotillaRetail.flotilla, backgroundColor: chartColors.tertiary },
        ],
      },
      options: chartOptions({ scales: { x: { stacked: true }, y: { stacked: true } } }),
    });

    createChart('mesTotal', 'chartMesTotal', {
      type: 'bar',
      data: {
        labels: porMes.map((m) => m.label),
        datasets: [{
          label: 'Ventas del mes',
          data: porMes.map((m) => m.count),
          backgroundColor: porMes.map((m) => (mesMaximo && m.key === mesMaximo.key ? chartColors.tertiary : chartColors.primary)),
        }],
      },
      options: chartOptions({ plugins: { legend: { display: false } } }),
    });

    createChart('mesTipo', 'chartMesTipo', {
      type: 'bar',
      data: {
        labels: porMesPorTipo.labels,
        datasets: porMesPorTipo.series.map((serie, i) => ({
          label: serie.label, data: serie.data, backgroundColor: chartPalette[i % chartPalette.length],
        })),
      },
      options: chartOptions({ scales: { x: { stacked: true }, y: { stacked: true } } }),
    });

    destroyChart('mesCanal', 'chartMesCanal');
    if (porMesPorCanal?.series?.length) {
      createChart('mesCanal', 'chartMesCanal', {
        type: 'bar',
        data: {
          labels: porMesPorCanal.labels,
          datasets: porMesPorCanal.series.map((serie) => ({
            label: serie.label, data: serie.data, backgroundColor: CANAL_COLORS[serie.label] || chartColors.slate,
          })),
        },
        options: chartOptions({ scales: { x: { stacked: true }, y: { stacked: true } } }),
      });
    }

    destroyChart('mesEntregasSofia', 'chartMesEntregasSofia');
    if (comparativo.porMesEntregasSofia) {
      createChart('mesEntregasSofia', 'chartMesEntregasSofia', {
        type: 'bar',
        data: {
          labels: comparativo.porMesEntregasSofia.labels,
          datasets: [{ label: 'Entregas SOFIA', data: comparativo.porMesEntregasSofia.data, backgroundColor: chartColors.secondary }],
        },
        options: chartOptions({ plugins: { legend: { display: false } } }),
      });
    }

    createChart('mesVendedor', 'chartMesVendedor', {
      type: 'line',
      data: {
        labels: porMesTopVendedores.labels,
        datasets: porMesTopVendedores.series.map((serie, i) => ({
          label: serie.label.split(' ').slice(0, 3).join(' '),
          data: serie.data,
          borderColor: chartPalette[i % chartPalette.length],
          tension: 0.25,
          fill: false,
        })),
      },
      options: chartOptions(),
    });
  }

  function syncYtdQuarterChips() {
    const avail = new Set((lastYtd?.trimestres || []).map((t) => Number(t.quarter)).filter((q) => q >= 1 && q <= 4));
    els.ytdQuarterChips?.querySelectorAll('[data-ytd-quarter]').forEach((btn) => {
      const q = Number(btn.dataset.ytdQuarter);
      const visible = !avail.size || avail.has(q);
      btn.hidden = !visible;
      btn.disabled = !visible;
      const on = visible && ytdQuarters.has(q);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function initYtdQuartersFromData(comparativoYtd) {
    const avail = (comparativoYtd?.trimestres || []).map((t) => Number(t.quarter)).filter((q) => q >= 1 && q <= 4);
    ytdQuarters = avail.length ? new Set(avail) : new Set([1, 2, 3, 4]);
  }

  function toggleYtdQuarter(q) {
    const n = Number(q);
    if (!Number.isFinite(n) || n < 1 || n > 4) return;
    if (ytdQuarters.has(n)) {
      if (ytdQuarters.size <= 1) return;
      ytdQuarters.delete(n);
    } else {
      ytdQuarters.add(n);
    }
    syncYtdQuarterChips();
    if (lastYtd) renderYtdChart(lastYtd, { keepQuarters: true });
  }

  function renderYtdChart(comparativoYtd, { keepQuarters = false } = {}) {
    if (!comparativoYtd) return;
    lastYtd = comparativoYtd;
    if (!keepQuarters) initYtdQuartersFromData(comparativoYtd);
    syncYtdQuarterChips();

    const {
      anioActual, anioAnterior, corte, totalActual, totalAnterior, variacion,
      labels: flatLabels, series: flatSeries, mesEnCursoExcluido, trimestres,
    } = comparativoYtd;

    els.ytdLabelActual.textContent = `YTD ${anioActual}`;
    els.ytdLabelAnterior.textContent = `YTD ${anioAnterior}`;
    els.ytdTotalActual.textContent = totalActual;
    els.ytdTotalAnterior.textContent = totalAnterior;
    const corteFmt = String(corte || '').split('-').reverse().join('/');

    if (variacion === null) {
      els.ytdVariacion.textContent = '-';
      els.ytdVariacion.className = 'ytd-stat-value';
    } else {
      els.ytdVariacion.textContent = `${variacion >= 0 ? '+' : ''}${variacion}%`;
      els.ytdVariacion.className = `ytd-stat-value ${variacion >= 0 ? 'ytd-up' : 'ytd-down'}`;
    }

    const selected = (trimestres || []).filter((t) => ytdQuarters.has(t.quarter));
    const monthPoints = selected.flatMap((t) => (t.meses || []).map((m) => ({
      ...m,
      quarterLabel: t.label,
    })));

    let labels;
    let actual;
    let anterior;
    let multiQ = false;

    if (monthPoints.length) {
      multiQ = selected.length > 1;
      labels = monthPoints.map((m) => (multiQ ? `${m.quarterLabel} ${m.label}` : m.label));
      actual = monthPoints.map((m) => Number(m.actual || 0));
      anterior = monthPoints.map((m) => Number(m.anterior || 0));
      els.ytdSubtitle.textContent = mesEnCursoExcluido
        ? `Acumulado al ${corteFmt} · meses del trimestre · mes en curso excluido`
        : `Acumulado al ${corteFmt} · meses del trimestre · ${anioActual} vs ${anioAnterior}`;
    } else {
      // Fallback si el API aún no trae trimestres
      labels = flatLabels || [];
      actual = flatSeries?.actual || [];
      anterior = flatSeries?.anterior || [];
      els.ytdSubtitle.textContent = mesEnCursoExcluido
        ? `Acumulado del 1 ene al ${corteFmt} · mes en curso excluido hasta cierre`
        : `Acumulado del 1 ene al ${corteFmt} · comparación año contra año`;
    }

    createChart('ytd', 'chartYtd', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: `YTD ${anioAnterior}`, data: anterior, backgroundColor: chartColors.slate },
          { label: `YTD ${anioActual}`, data: actual, backgroundColor: chartColors.primary },
        ],
      },
      options: chartOptions({
        plugins: {
          tooltip: {
            callbacks: {
              title(items) {
                if (!monthPoints.length) return undefined;
                const i = items?.[0]?.dataIndex;
                if (i == null) return '';
                const m = monthPoints[i];
                return `${m.quarterLabel} · ${m.label}`;
              },
              afterBody(items) {
                if (!monthPoints.length) return undefined;
                const i = items?.[0]?.dataIndex;
                if (i == null) return '';
                const a = actual[i];
                const b = anterior[i];
                if (!b) return a ? 'Sin base año anterior' : '';
                const delta = a - b;
                const p = ((delta / b) * 100).toFixed(1);
                const sign = delta > 0 ? '+' : '';
                return `Var: ${sign}${delta} (${sign}${p}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#94a3b8',
              font: { size: 11 },
              maxRotation: multiQ ? 45 : 0,
              minRotation: multiQ ? 30 : 0,
            },
          },
        },
      }),
    });
  }

  function moneyCell(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return typeof fmt !== 'undefined' && fmt.money
      ? fmt.money(Number(n))
      : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  }

  function pctCell(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Number(n).toFixed(1)}%`;
  }

  function renderCarlineUtilidad(utilidadCarline, comparativoYtd) {
    const body = els.carlineUtilidadBody;
    const sub = els.carlineUtilidadSubtitle;
    if (!body) return;

    const periodo = utilidadCarline?.periodo || {};
    const fi = periodo.fechaInicio || (comparativoYtd?.corte ? `${String(comparativoYtd.corte).slice(0, 4)}-01-01` : null);
    const ff = periodo.fechaFin || comparativoYtd?.corte || null;
    if (sub) {
      const rango = fi && ff
        ? `${String(fi).slice(0, 10).split('-').reverse().join('/')} â†’ ${String(ff).slice(0, 10).split('-').reverse().join('/')}`
        : 'YTD';
      sub.textContent = `Mejor versión por utilidad unitaria · ${rango}`;
    }

    const rows = utilidadCarline?.porCarline || [];
    if (!utilidadCarline?.available) {
      body.innerHTML = `<tr><td colspan="4" class="empty-row">${escapeHtml(utilidadCarline?.reason || 'Sin datos de utilidad por carline.')}</td></tr>`;
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-row">Sin ventas con utilidad en el acumulado anual.</td></tr>';
      return;
    }

    body.innerHTML = rows.map((c) => {
      const m = c.mejorVersion || {};
      // Siempre utilidad por unidad (promedio), nunca el acumulado total
      const utilPorUnidad = m.utilidadPromedio != null
        ? Number(m.utilidadPromedio)
        : (m.unidades > 0 && m.utilidadTotal != null
          ? Number(m.utilidadTotal) / Number(m.unidades)
          : null);
      const utilClass = utilPorUnidad != null && utilPorUnidad >= 0 ? 'cell-money--pos' : 'cell-money--neg';
      const titleBits = [
        m.version || '',
        m.unidades != null ? `${m.unidades} uds en el periodo` : '',
        m.utilidadTotal != null ? `utilidad total ${moneyCell(m.utilidadTotal)}` : '',
      ].filter(Boolean).join(' · ');
      return `<tr>
        <td class="carline-utilidad-carline"><strong>${escapeHtml(c.carline || '—')}</strong></td>
        <td class="carline-utilidad-version" title="${escapeHtml(titleBits)}">
          <span class="carline-utilidad-version__text">${escapeHtml(m.version || '—')}</span>
        </td>
        <td class="cell-num cell-money carline-utilidad-num ${utilClass}">${moneyCell(utilPorUnidad)}</td>
        <td class="cell-num carline-utilidad-num">${pctCell(m.margenBrutoPct)}</td>
      </tr>`;
    }).join('');
  }

  function renderCharts(resumen) {
    const esAcumulado = resumen.mostrarComparativoMensual && resumen.comparativoMensual;
    toggleVistaMensual(Boolean(esAcumulado));
    if (esAcumulado) renderChartsMensuales(resumen.comparativoMensual, resumen);

    destroyChart('departamento', 'chartDepartamento');
    const porCanalRaw = resumen.porCanal?.length
      ? resumen.porCanal
      : (typeof CanalesVenta !== 'undefined' ? CanalesVenta.countByCanal(registrosActuales) : []);
    const porCanal = [...(porCanalRaw || [])].sort((a, b) => Number(b.count || 0) - Number(a.count || 0)
      || String(a.label || '').localeCompare(String(b.label || ''), 'es'));
    if (porCanal.length) {
      createChart('departamento', 'chartDepartamento', {
        type: 'bar',
        data: {
          labels: porCanal.map((x) => x.label),
          datasets: [{
            label: 'Ventas',
            data: porCanal.map((x) => x.count),
            backgroundColor: porCanal.map((x) => (CANAL_COLORS && CANAL_COLORS[x.label]) || (chartColors && chartColors.slate) || '#94a3b8'),
          }],
        },
        options: chartOptions({ plugins: { legend: { display: false } } }),
      });
    }

    try {
      const topVendedores = buildTopVendedoresRetailPorFuerza(10);
      if (topVendedores.labels.length && topVendedores.datasets.length) {
        createChart('vendedor', 'chartVendedor', {
          type: 'bar',
          data: {
            labels: topVendedores.labels,
            datasets: topVendedores.datasets,
          },
          options: chartOptions({
            indexAxis: 'y',
            scales: {
              x: { stacked: true, beginAtZero: true },
              y: { stacked: true },
            },
            plugins: {
              legend: { display: true, position: 'bottom' },
            },
          }),
        });
      } else {
        destroyChart('vendedor', 'chartVendedor');
      }
    } catch (err) {
      console.error('[Sales] chartVendedor', err);
      destroyChart('vendedor', 'chartVendedor');
    }

    try {
      const mix = buildMixVentaAutos(resumen, 10);
      lastMixAutos = mix;
      destroyChart('mixAutos', 'chartMixAutos');
      wireMixOtrosControls();
      renderMixOtrosDetalle(mix);
      if (mix.labels.length) {
        const palette = (chartPalette && chartPalette.length)
          ? chartPalette
          : ['#2D5BFF', '#9B51E0', '#27AE60', '#E056FD', '#f59e0b', '#14b8a6', '#ef4444', '#64748b', '#0ea5e9', '#2C3E50'];
        createChart('mixAutos', 'chartMixAutos', {
          type: 'bar',
          data: {
            labels: mix.labels,
            datasets: [{
              label: 'Unidades',
              data: mix.data,
              backgroundColor: mix.labels.map((label, i) => {
                if (label === 'Otros') return '#94a3b8';
                return palette[i % palette.length];
              }),
              borderRadius: 8,
              maxBarThickness: 28,
            }],
          },
          options: chartOptions({
            indexAxis: 'y',
            onClick(_evt, elements) {
              if (!elements?.length) {
                openMixAutosDrawer();
                return;
              }
              const idx = elements[0].index;
              const label = mix.labels[idx];
              if (!label) {
                openMixAutosDrawer();
                return;
              }
              openMixAutosDrawer({
                filter: { dim: 'carline', value: label, label },
              });
              if (label === 'Otros' && (mix.otrosDetalle || []).length) {
                setMixOtrosExpanded(true);
              }
            },
            onHover(evt, elements) {
              const canvas = evt?.native?.target || evt?.chart?.canvas;
              if (!canvas?.style) return;
              canvas.style.cursor = elements?.length ? 'pointer' : 'default';
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label(ctx) {
                    const val = Number(ctx.raw || 0);
                    const total = mix.total || 0;
                    const p = total > 0 ? Math.round((val / total) * 1000) / 10 : 0;
                    return ` ${val} uds · ${p}% del mix · clic para analizar`;
                  },
                },
              },
            },
            scales: {
              x: { beginAtZero: true, ticks: { precision: 0 } },
              y: { grid: { display: false } },
            },
          }),
        });
      } else {
        setMixOtrosExpanded(false);
      }
    } catch (err) {
      console.error('[Sales] chartMixAutos', err);
      destroyChart('mixAutos', 'chartMixAutos');
      lastMixAutos = null;
      renderMixOtrosDetalle(null);
    }
  }

  function normalizeCarlineLabel(raw) {
    const u = String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    if (!u || u === '(SIN DATO)') return 'Otros';

    // Aveo: 4 PTAS = Sedán · 5 PTAS = HB (hatchback)
    if (u.includes('AVEO')) {
      if (
        /\b5\s*PTAS?\b/.test(u)
        || /\bHB\b/.test(u)
        || u.includes('HATCH')
        || u.includes('HATCHBACK')
      ) {
        return 'Aveo HB';
      }
      if (
        /\b4\s*PTAS?\b/.test(u)
        || u.includes('SEDAN')
        || u.includes('SEDÁN')
      ) {
        return 'Aveo Sedán';
      }
      return 'Aveo';
    }

    // Captiva: separar PHEV (híbrido enchufable) del resto
    if (u.includes('CAPTIVA')) {
      if (/\bPHEV\b/.test(u) || u.includes('PLUGIN') || u.includes('PLUG-IN') || u.includes('PLUG IN')) {
        return 'Captiva PHEV';
      }
      return 'Captiva';
    }

    const known = [
      'SUBURBAN', 'TAHOE', 'CHEYENNE', 'TRAVERSE', 'BLAZER',
      'COLORADO', 'SILVERADO', 'TORNADO', 'MONTANA', 'GROOVE', 'TRACKER',
      'ONIX', 'EQUINOX', 'TRAILBLAZER', 'SPARK', 'CAVALIER', 'S10',
    ];
    for (const k of known) {
      if (u.includes(k)) return k === 'S10' ? 'S10' : k.charAt(0) + k.slice(1).toLowerCase();
    }
    const first = u.split(/\s+/)[0];
    return first ? first.charAt(0) + first.slice(1).toLowerCase() : 'Otros';
  }

  function buildMixVentaAutos(resumen, limit = 10) {
    const counts = new Map();
    const rows = Array.isArray(registrosActuales) && registrosActuales.length
      ? registrosActuales
      : null;

    if (rows) {
      for (const row of rows) {
        const key = normalizeCarlineLabel(row.VEH_TIPOAUTO);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    } else {
      const fromResumen = Array.isArray(resumen?.porModelo) ? resumen.porModelo : [];
      for (const row of fromResumen) {
        const key = normalizeCarlineLabel(row.label || row.key || row.modelo);
        counts.set(key, (counts.get(key) || 0) + Number(row.count || row.unidades || 0));
      }
    }

    const ranked = [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));

    if (!ranked.length) {
      return {
        labels: [],
        data: [],
        total: 0,
        otrosDetalle: [],
        otrosTotal: 0,
      };
    }

    const top = ranked.slice(0, limit);
    const rest = ranked.slice(limit);
    const restSum = rest.reduce((s, [, n]) => s + n, 0);
    if (restSum > 0) top.push(['Otros', restSum]);

    const total = top.reduce((s, [, n]) => s + n, 0);
    return {
      labels: top.map(([label]) => label),
      data: top.map(([, n]) => n),
      total,
      otrosDetalle: rest,
      otrosTotal: restSum,
    };
  }

  function buildTopVendedoresRetailPorFuerza(limit = 10) {
    const retail = getRetailRows();
    const byVendor = new Map();

    for (const row of retail) {
      const vendedor = String(row.VENDEDOR || '(Sin dato)').trim() || '(Sin dato)';
      const fuerza = String(row.CANAL_LABEL || 'Otros').trim() || 'Otros';
      if (!byVendor.has(vendedor)) {
        byVendor.set(vendedor, { total: 0, byFuerza: new Map() });
      }
      const entry = byVendor.get(vendedor);
      entry.total += 1;
      entry.byFuerza.set(fuerza, (entry.byFuerza.get(fuerza) || 0) + 1);
    }

    const canalOrden = (typeof CanalesVenta !== 'undefined' && Array.isArray(CanalesVenta.CANALES_ORDEN))
      ? CanalesVenta.CANALES_ORDEN
      : ['PISO', 'FORANEOS', 'CHOLULA', 'ZACATELCO', 'SUAUTO', 'CASA', 'OTROS'];
    const labelOf = (c) => (typeof CanalesVenta !== 'undefined' && CanalesVenta.getCanalLabel)
      ? CanalesVenta.getCanalLabel(c)
      : c;
    const fuerzaOrder = canalOrden
      .filter((c) => c !== 'FLOTILLAS' && c !== 'PERDIDA')
      .map((c) => labelOf(c));
    const fallbackOrder = ['Piso', 'Foraneos', 'Cholula', 'Zacatelco', 'Suauto', 'Casa', 'Otros'];
    const order = fuerzaOrder.length ? fuerzaOrder : fallbackOrder;
    const fuerzaRank = (name) => {
      const idx = order.indexOf(name);
      return idx >= 0 ? idx : 999;
    };

    const ranked = [...byVendor.entries()]
      .map(([name, stats]) => {
        let dominante = 'Otros';
        let max = -1;
        for (const [f, n] of stats.byFuerza.entries()) {
          if (n > max || (n === max && fuerzaRank(f) < fuerzaRank(dominante))) {
            max = n;
            dominante = f;
          }
        }
        return [name, { total: stats.total, byFuerza: stats.byFuerza, dominante }];
      })
      .sort((a, b) =>
        b[1].total - a[1].total
        || fuerzaRank(a[1].dominante) - fuerzaRank(b[1].dominante)
        || a[0].localeCompare(b[0], 'es')
      )
      .slice(0, limit);

    const fuerzasPresentes = new Set();
    for (const [, stats] of ranked) {
      for (const f of stats.byFuerza.keys()) fuerzasPresentes.add(f);
    }

    const fuerzas = [
      ...order.filter((f) => fuerzasPresentes.has(f)),
      ...[...fuerzasPresentes].filter((f) => !order.includes(f)).sort((a, b) => a.localeCompare(b, 'es')),
    ];

    // Eje Y = vendedor; cada segmento de color = fuerza de ventas
    const labels = ranked.map(([name, stats]) => {
      const short = name.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
      return stats.dominante && stats.dominante !== 'Otros'
        ? `${short} · ${stats.dominante}`
        : short;
    });

    const datasets = fuerzas.map((fuerza) => ({
      label: fuerza,
      data: ranked.map(([, stats]) => stats.byFuerza.get(fuerza) || 0),
      backgroundColor: (CANAL_COLORS && CANAL_COLORS[fuerza]) || (chartColors && chartColors.slate) || '#94a3b8',
      borderWidth: 0,
      borderRadius: 3,
      stack: 'fuerza',
    }));

    return { labels, datasets, ranked };
  }

  function isDemoRow(row) {
    return Boolean(row.IS_DEMO);
  }

  function isFlotillaRow(row) {
    return row.TIPOVENTA === 'FLOTILLA';
  }

  function getRetailRows() {
    return registrosActuales.filter((row) => !isFlotillaRow(row));
  }

  function getFlotillaRows() {
    return registrosActuales.filter((row) => isFlotillaRow(row));
  }

  function getDemoRows() {
    return registrosActuales.filter((row) => isDemoRow(row));
  }

  function renderDemosNota(resumen) {
    const note = document.getElementById('ventasDemosNota');
    if (!note) return;
    const n = Number(resumen?.totalDemos || 0);
    const text = resumen?.demosNota
      || (n > 0
        ? `${n} demo${n === 1 ? '' : 's'} incluidos en el total de facturas.`
        : '');
    if (!text) {
      note.classList.add('hidden');
      note.textContent = '';
      return;
    }
    note.classList.remove('hidden');
    note.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">info</span> ${escapeHtml(text)}`;
  }

  function ventasRowsHtml(rows, emptyMessage) {
    if (!rows.length) {
      return `<tr class="empty-row"><td colspan="10">${emptyMessage || 'No hay ventas en el periodo seleccionado.'}</td></tr>`;
    }
    return rows.map((row) => {
      const esFlotilla = isFlotillaRow(row);
      return `<tr class="${esFlotilla ? 'row-flotilla' : ''}">
        <td>${row.VTE_FECHDOCTO ?? ''}</td><td>${row.VTE_DOCTO ?? ''}</td><td>${row.VENDEDOR ?? ''}</td>
        <td>${row.CLIENTE ?? ''}</td><td>${row.VTE_SERIE ?? ''}</td><td>${row.VEH_TIPOAUTO ?? ''}</td>
        <td>${row.VEH_ANMODELO ?? ''}</td><td>${row.COL_DESCRIPCION ?? ''}</td><td>${row.CANAL_LABEL ?? ''}</td>
        <td><span class="badge-tipo ${esFlotilla ? 'badge-flotilla' : ''}">${row.TIPOVENTA ?? ''}</span></td>
      </tr>`;
    }).join('');
  }

  function renderVentasPreview(rows) {
    if (!els.tablaVentasPreviewBody) return;
    const term = els.buscarVentasPreview?.value?.trim();
    const emptyMessage = term ? 'No hay coincidencias con la búsqueda.' : undefined;
    els.tablaVentasPreviewBody.innerHTML = ventasRowsHtml(rows, emptyMessage);
  }

  function getVentasRowsByType(type) {
    if (type === 'flotilla') return getFlotillaRows();
    if (type === 'retail') return getRetailRows();
    return registrosActuales;
  }

  function updateVentasPanelResumen(type, count, filteredCount) {
    if (!els.ventasPanelResumen) return;
    const n = Number(count || 0);
    const label = type === 'flotilla' ? 'flotilla' : 'retail';
    const filtered = filteredCount !== undefined ? Number(filteredCount) : null;
    const meta = els.ventasPreviewSearchMeta;

    if (filtered !== null && !Number.isNaN(filtered) && filtered !== n) {
      els.ventasPanelResumen.textContent = `${filtered} de ${n} venta${n === 1 ? '' : 's'} ${label} coinciden con la búsqueda`;
      if (meta) {
        meta.textContent = `${filtered} resultado${filtered === 1 ? '' : 's'}`;
        meta.classList.remove('hidden');
      }
      return;
    }

    if (meta) meta.classList.add('hidden');
    els.ventasPanelResumen.textContent = n
      ? `${n} venta${n === 1 ? '' : 's'} ${label} en el periodo seleccionado`
      : `No hay ventas ${label} en el periodo seleccionado.`;
  }

  function applyVentasPreviewSearch() {
    if (ventasDrawerUi?.isOpen?.()) {
      ventasDrawerUi.refresh();
      return;
    }
    if (!activeVentasKpiType) return;
    const base = getVentasRowsByType(activeVentasKpiType);
    const term = els.buscarVentasPreview?.value || '';
    const filtered = filterVentasRowsByTerm(term, base);
    renderVentasPreview(filtered);
    updateVentasPanelResumen(activeVentasKpiType, base.length, term.trim() ? filtered.length : undefined);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function countByField(rows, keyFn) {
    const map = new Map();
    for (const r of rows || []) {
      const label = String(keyFn(r) || 'Sin dato').trim() || 'Sin dato';
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function ventasKpiMeta(key) {
    const map = {
      retail: {
        title: 'Ventas retail',
        hint: 'Unidades retail del periodo (excluye flotilla)',
        icon: 'storefront',
        card: () => els.kpiCardRetail,
      },
      flotilla: {
        title: 'Flotillas',
        hint: 'Unidades flotilla del periodo',
        icon: 'local_shipping',
        card: () => els.kpiCardFlotillas,
      },
      sofia: {
        title: 'Notificaciones SOFIA',
        hint: 'Timbrados SOFIA por fecha de registro · sin FLOT · FLOTGMF solo si contrato AO ≠ flotilla',
        icon: 'notifications_active',
        card: () => els.kpiCardEntregasSofia,
      },
      carryOver: {
        title: 'Carry over para facturar',
        hint: 'Apartadas SEP + simulación de cobertura',
        icon: 'pending_actions',
        card: () => els.kpiCardCarryOver,
      },
      tomasACuenta: {
        title: 'Tomas a cuenta',
        hint: 'Usados tomados y cuántos ya se vendieron el mismo mes',
        icon: 'swap_horiz',
        card: () => els.sectionTomasACuenta,
      },
      mixAutos: {
        title: 'Mix de venta de autos',
        hint: 'Participación por carline / modelo del periodo · filtros dinámicos',
        icon: 'pie_chart',
        card: () => document.getElementById('secMixAutos'),
      },
    };
    return map[key] || { title: key, hint: '', icon: 'analytics', card: () => null };
  }

  function rowsForVentasDrawer(key) {
    if (key === 'retail') return getRetailRows();
    if (key === 'flotilla') return getFlotillaRows();
    if (key === 'sofia') return entregasActuales;
    if (key === 'carryOver') return apartadasActuales;
    if (key === 'tomasACuenta') return tomasACuentaActuales;
    if (key === 'mixAutos') return Array.isArray(registrosActuales) ? registrosActuales : [];
    return [];
  }

  function openMixAutosDrawer({ filter = null } = {}) {
    const drawer = ensureVentasKpiDrawer();
    const card = document.getElementById('secMixAutos');
    drawer.open('mixAutos', card, { filter: filter || null, forceOpen: true });
  }

  function clearVentasKpiSelection() {
    [els.kpiCardRetail, els.kpiCardFlotillas, els.kpiCardEntregasSofia, els.kpiCardCarryOver]
      .forEach((card) => {
        card?.classList.remove('is-selected', 'is-open');
        card?.setAttribute('aria-expanded', 'false');
      });
    els.sectionTomasACuenta?.classList.remove('section-focus', 'is-selected', 'is-open');
    document.getElementById('secMixAutos')?.classList.remove('is-selected', 'is-open', 'section-focus');
  }

  function formatTomaFecha(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(value.trim())) {
      return value.trim().slice(0, 10);
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function tomaRecordKey(r) {
    return `${r.idPedido || ''}|${String(r.vinToma || '').toUpperCase()}|${r.facturaNuevo || ''}`;
  }

  let tomaDetailFloat = null;

  function ensureTomaDetailFloat() {
    if (tomaDetailFloat) return tomaDetailFloat;
    const el = document.createElement('div');
    el.id = 'tomaACuentaFloat';
    el.className = 'toma-float hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Detalle toma a cuenta');
    el.innerHTML = `
      <div class="toma-float__header" data-toma-drag>
        <div class="toma-float__title-wrap">
          <span class="material-symbols-outlined">swap_horiz</span>
          <div>
            <h3 class="toma-float__title" data-toma-title>Toma a cuenta</h3>
            <p class="toma-float__subtitle" data-toma-sub></p>
          </div>
        </div>
        <button type="button" class="toma-float__icon-btn" data-toma-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="toma-float__body custom-scrollbar" data-toma-body></div>
      <div class="toma-float__footer" data-toma-footer></div>
    `;
    document.body.appendChild(el);
    el.querySelector('[data-toma-close]')?.addEventListener('click', () => {
      el.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.classList.contains('hidden')) el.classList.add('hidden');
    });

    const dragHandle = el.querySelector('[data-toma-drag]');
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    dragHandle?.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.setPointerCapture?.(e.pointerId);
    });
    dragHandle?.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, e.clientX - offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, e.clientY - offsetY));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });
    const endDrag = () => { dragging = false; };
    dragHandle?.addEventListener('pointerup', endDrag);
    dragHandle?.addEventListener('pointercancel', endDrag);

    tomaDetailFloat = el;
    return el;
  }

  function openTomaDetail(record) {
    if (!record) return;
    const el = ensureTomaDetailFloat();
    el.querySelector('[data-toma-title]').textContent = record.vinToma || 'Toma a cuenta';
    el.querySelector('[data-toma-sub]').textContent = [
      record.modeloToma || 'Usado',
      record.anModeloToma || '',
    ].filter(Boolean).join(' · ');

    const row = (label, value) => `
      <div class="toma-float__row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value == null || value === '' ? '—' : String(value))}</dd>
      </div>`;

    el.querySelector('[data-toma-body]').innerHTML = `
      <section class="toma-float__section">
        <h4>Vehículo tomado</h4>
        <dl class="toma-float__grid">
          ${row('VIN toma', record.vinToma)}
          ${row('Modelo', record.modeloToma)}
          ${row('Año', record.anModeloToma)}
          ${row('Importe vehículo', moneyCell(record.importeVehiculo))}
          ${row('Importe adquisición', moneyCell(record.importeAdquisicion))}
          ${row('Fecha toma', formatTomaFecha(record.fechaToma))}
          ${row('Usuario toma', record.usuarioToma)}
        </dl>
      </section>
      <section class="toma-float__section">
        <h4>Venta del usado (mismo mes)</h4>
        <dl class="toma-float__grid">
          ${row('Estatus', record.vendidoMismoMes ? 'Vendido' : 'Sin venta en el mes de la toma')}
          ${row('Fecha venta', formatTomaFecha(record.fechaVentaUsado))}
          ${row('Pedido USN', record.pedidoUsn)}
          ${row('Monto venta', moneyCell(record.montoVentaUsado))}
          ${row('Cliente usado', record.clienteUsado)}
          ${row('Vendedor usado', record.vendedorUsado)}
        </dl>
      </section>
      <section class="toma-float__section">
        <h4>Venta nueva asociada</h4>
        <dl class="toma-float__grid">
          ${row('Serie / VIN nuevo', record.serieNuevo)}
          ${row('Modelo nuevo', record.modeloNuevo)}
          ${row('Año nuevo', record.anModeloNuevo)}
          ${row('Factura', record.facturaNuevo)}
          ${row('Fecha factura', formatTomaFecha(record.fechaFactura))}
          ${row('Pedido', record.idPedido)}
          ${row('Cliente', record.cliente)}
          ${row('Vendedor', record.vendedor)}
        </dl>
      </section>
    `;

    const vin = encodeURIComponent(record.vinToma || '');
    el.querySelector('[data-toma-footer]').innerHTML = vin
      ? `<a class="btn-glass btn-primary" href="/seguimiento.html?q=${vin}" target="_blank" rel="noopener">
           <span class="material-symbols-outlined">person_search</span>
           Abrir en Seguimiento 360
         </a>`
      : '';

    el.classList.remove('hidden');
    if (!el.style.left && !el.style.top) {
      el.style.right = '28px';
      el.style.bottom = '28px';
      el.style.left = 'auto';
      el.style.top = 'auto';
    }
  }

  function filterTomasACuentaByTerm(term, base) {
    const q = String(term || '').trim().toLowerCase();
    if (!q) return base;
    return base.filter((row) =>
      [
        row.vinToma, row.serieNuevo, row.facturaNuevo, row.cliente, row.vendedor,
        row.modeloToma, row.modeloNuevo, row.anModeloToma, row.anModeloNuevo,
        row.usuarioToma, row.idPedido, row.fechaToma, row.fechaFactura,
        row.clienteUsado, row.vendedorUsado, row.pedidoUsn, row.fechaVentaUsado,
        row.vendidoMismoMes ? 'vendido' : 'pendiente',
      ].some((val) => String(val ?? '').toLowerCase().includes(q))
    );
  }

  function toggleTomasACuentaPanel() {
    ensureVentasKpiDrawer().open('tomasACuenta', els.sectionTomasACuenta);
    els.sectionTomasACuenta?.classList.add('section-focus');
  }

  function renderTomasSection(resumen, tomasMensual) {
    const rows = tomasACuentaActuales || [];
    const tomas = Number(resumen?.totalTomasACuenta ?? rows.length ?? 0);
    const vendidas = Number(
      resumen?.totalTomasVendidasMismoMes
      ?? tomasACuentaMeta.totalVendidosMismoMes
      ?? rows.filter((r) => r.vendidoMismoMes).length
    );
    const pct = Number(
      resumen?.pctTomasVendidasMismoMes
      ?? tomasACuentaMeta.pctVendidosMismoMes
      ?? (tomas > 0 ? Math.round((vendidas / tomas) * 1000) / 10 : 0)
    );

    if (els.tomasStatTomados) els.tomasStatTomados.textContent = String(tomas);
    if (els.tomasStatVendidos) els.tomasStatVendidos.textContent = String(vendidas);
    if (els.tomasStatPct) els.tomasStatPct.textContent = tomas > 0 ? `${pct}%` : '—';
    if (els.tomasSectionSubtitle) {
      els.tomasSectionSubtitle.textContent = tomas > 0
        ? `${vendidas} de ${tomas} usados tomados del periodo ya se vendieron en el mismo mes · ${pct}%`
        : 'Usados tomados del periodo · cuántos ya se vendieron el mismo mes';
    }

    const fi = els.fechaInicio?.value || '';
    const ff = els.fechaFin?.value || '';
    if (els.tomasInfoSubtitle) {
      const rango = fi && ff
        ? `${fi.split('-').reverse().join('/')} – ${ff.split('-').reverse().join('/')}`
        : 'Periodo seleccionado';
      els.tomasInfoSubtitle.textContent = tomas > 0
        ? `${tomas} tomas · ${vendidas} vendidas · ${rango}`
        : `Sin tomas · ${rango}`;
    }

    renderTomasMensualChart(tomasMensual);

    if (!els.tomasSectionBody) return;
    if (!rows.length) {
      els.tomasSectionBody.innerHTML = '<tr><td colspan="3" class="empty-row">Sin tomas en el periodo.</td></tr>';
      return;
    }

    // Compacto: pendientes primero, luego vendidos; máx. 10 filas (el resto en Detalle).
    const ordenadas = rows.slice().sort((a, b) => {
      if (Boolean(a.vendidoMismoMes) !== Boolean(b.vendidoMismoMes)) {
        return a.vendidoMismoMes ? 1 : -1;
      }
      return String(b.fechaToma || '').localeCompare(String(a.fechaToma || ''));
    });
    const visibles = ordenadas.slice(0, 10);
    const resto = Math.max(0, ordenadas.length - visibles.length);

    els.tomasSectionBody.innerHTML = `${visibles.map((r) => `
      <tr class="tomas-row" data-toma-key="${escapeHtml(tomaRecordKey(r))}" title="Ver ficha rápida">
        <td><strong class="toma-vin-link">${escapeHtml(r.vinToma || '—')}</strong></td>
        <td>
          <span class="carline-utilidad-carline" title="${escapeHtml(r.modeloToma || '')}">${escapeHtml(r.modeloToma || '—')}</span>
        </td>
        <td>
          <span class="tomas-badge ${r.vendidoMismoMes ? 'tomas-badge--vendido' : 'tomas-badge--pendiente'}">
            ${r.vendidoMismoMes ? 'Vendido' : 'No vendido'}
          </span>
        </td>
      </tr>
    `).join('')}${resto > 0 ? `
      <tr>
        <td colspan="3" class="empty-row" style="font-size:11px">
          +${resto} más · abre <strong>Detalle</strong>
        </td>
      </tr>
    ` : ''}`;
  }

  function buildTomasTrimestres(tomasMensual) {
    const meses = tomasMensual?.meses || [];
    const byQ = { 1: [], 2: [], 3: [], 4: [] };
    for (const m of meses) {
      const month = Number(m.month || 0);
      if (month < 1 || month > 12) continue;
      const q = Math.ceil(month / 3);
      byQ[q].push(m);
    }
    return [1, 2, 3, 4]
      .filter((q) => byQ[q].length)
      .map((q) => ({
        quarter: q,
        label: `T${q}`,
        meses: byQ[q],
      }));
  }

  function syncTomasQuarterChips() {
    const avail = new Set(buildTomasTrimestres(lastTomasMensual).map((t) => Number(t.quarter)));
    els.tomasQuarterChips?.querySelectorAll('[data-tomas-quarter]').forEach((btn) => {
      const q = Number(btn.dataset.tomasQuarter);
      const visible = !avail.size || avail.has(q);
      btn.hidden = !visible;
      btn.disabled = !visible;
      const on = visible && tomasQuarters.has(q);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function initTomasQuartersFromData(tomasMensual) {
    const avail = buildTomasTrimestres(tomasMensual).map((t) => Number(t.quarter));
    tomasQuarters = avail.length ? new Set(avail) : new Set([1, 2, 3, 4]);
  }

  function toggleTomasQuarter(q) {
    const n = Number(q);
    if (!Number.isFinite(n) || n < 1 || n > 4) return;
    if (tomasQuarters.has(n)) {
      if (tomasQuarters.size <= 1) return;
      tomasQuarters.delete(n);
    } else {
      tomasQuarters.add(n);
    }
    syncTomasQuarterChips();
    if (lastTomasMensual) renderTomasMensualChart(lastTomasMensual, { keepQuarters: true });
  }

  function renderTomasMensualChart(tomasMensual, { keepQuarters = false } = {}) {
    if (!document.getElementById('chartTomasMensual')) return;
    if (tomasMensual) lastTomasMensual = tomasMensual;
    const data = lastTomasMensual || {};
    if (!keepQuarters) initTomasQuartersFromData(data);
    syncTomasQuarterChips();

    const anio = data.anio || new Date().getFullYear();
    const corteFmt = String(data.corte || '').split('-').reverse().join('/');
    const trimestres = buildTomasTrimestres(data);
    const selected = trimestres.filter((t) => tomasQuarters.has(t.quarter));
    const monthPoints = selected.flatMap((t) => (t.meses || []).map((m) => ({
      ...m,
      quarterLabel: t.label,
    })));
    const multiQ = selected.length > 1;
    const labels = monthPoints.map((m) => (multiQ ? `${m.quarterLabel} ${m.label}` : m.label));
    const tomados = monthPoints.map((m) => Number(m.tomados || 0));
    const vendidos = monthPoints.map((m) => Number(m.vendidos || 0));

    if (els.tomasChartSubtitle) {
      els.tomasChartSubtitle.textContent = data.mesEnCursoExcluido
        ? `Acumulado ${anio} al ${corteFmt || 'corte'} · meses del trimestre · mes en curso excluido`
        : `Acumulado ${anio}${corteFmt ? ` al ${corteFmt}` : ''} · tomados vs vendidos el mismo mes`;
    }

    createChart('tomasMensual', 'chartTomasMensual', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Tomados',
            data: tomados,
            backgroundColor: chartColors?.slate || '#2C3E50',
          },
          {
            label: 'Vendidos mismo mes',
            data: vendidos,
            backgroundColor: chartColors?.primary || '#2D5BFF',
          },
        ],
      },
      options: chartOptions({
        plugins: {
          tooltip: {
            callbacks: {
              title(items) {
                const i = items?.[0]?.dataIndex;
                if (i == null) return '';
                const m = monthPoints[i];
                return m ? `${m.quarterLabel} · ${m.label} ${m.year || anio}` : '';
              },
              afterBody(items) {
                const i = items?.[0]?.dataIndex;
                if (i == null) return '';
                const t = Number(tomados[i] || 0);
                const v = Number(vendidos[i] || 0);
                if (!t) return 'Sin tomas en el mes';
                const p = ((v / t) * 100).toFixed(1);
                return `% revendidos: ${p}%`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#94a3b8',
              font: { size: 11 },
              maxRotation: multiQ ? 45 : 0,
              minRotation: multiQ ? 30 : 0,
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: '#94a3b8',
            },
          },
        },
      }),
    });
  }

  function ensureVentasKpiDrawer() {
    if (ventasDrawerUi) return ventasDrawerUi;

    const backdrop = document.createElement('div');
    backdrop.className = 'ops-orders-backdrop';
    backdrop.id = 'ventasKpiBackdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'ops-orders-drawer';
    panel.id = 'ventasKpiDrawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Detalle de ventas');
    panel.innerHTML = `
      <div class="ops-orders-drawer__header">
        <div class="ops-orders-drawer__title-wrap">
          <span class="material-symbols-outlined ops-orders-drawer__logo" data-ventas-kpi-logo>shopping_cart</span>
          <div>
            <h2 class="ops-orders-drawer__title" data-ventas-kpi-title>Detalle de ventas</h2>
            <span class="ops-orders-drawer__status" data-ventas-kpi-status>0 registros</span>
          </div>
        </div>
        <div class="ops-orders-drawer__actions">
          <button type="button" class="ops-orders-drawer__icon-btn" data-ventas-kpi-download title="Descargar CSV" aria-label="Descargar CSV">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-ventas-kpi-expand title="Expandir" aria-label="Expandir panel">
            <span class="material-symbols-outlined" data-ventas-kpi-expand-icon>open_in_full</span>
          </button>
          <button type="button" class="ops-orders-drawer__icon-btn" data-ventas-kpi-close title="Cerrar" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div class="ops-orders-drawer__toolbar">
        <label class="ops-orders-drawer__search" for="ventasKpiSearch">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="ventasKpiSearch" type="search" placeholder="Buscar..." autocomplete="off"/>
        </label>
        <button type="button" class="ops-orders-drawer__filter-chip" data-ventas-kpi-filter-chip hidden title="Quitar filtro"></button>
        <span class="ops-orders-drawer__meta" data-ventas-kpi-meta></span>
      </div>
      <div class="ops-orders-drawer__main">
        <aside class="ops-orders-drawer__summary custom-scrollbar" data-ventas-kpi-summary></aside>
        <div class="ops-orders-drawer__body custom-scrollbar" data-ventas-kpi-body></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-ventas-kpi-status]');
    const metaEl = panel.querySelector('[data-ventas-kpi-meta]');
    const bodyEl = panel.querySelector('[data-ventas-kpi-body]');
    const summaryEl = panel.querySelector('[data-ventas-kpi-summary]');
    const searchEl = panel.querySelector('#ventasKpiSearch');
    const filterChip = panel.querySelector('[data-ventas-kpi-filter-chip]');
    const expandBtn = panel.querySelector('[data-ventas-kpi-expand]');
    const expandIcon = panel.querySelector('[data-ventas-kpi-expand-icon]');
    const downloadBtn = panel.querySelector('[data-ventas-kpi-download]');
    const titleEl = panel.querySelector('[data-ventas-kpi-title]');
    const logoEl = panel.querySelector('[data-ventas-kpi-logo]');

    let expanded = false;
    let activeFilter = null;
    let sourceRows = [];
    let lastExportRows = [];
    let currentMeta = { kpi: '', title: 'Detalle', hint: '', icon: 'shopping_cart' };
    let lastCard = null;

    const FILTER_DIM_LABEL = {
      canal: 'Canal',
      vendedor: 'Vendedor',
      tipo: 'Tipo',
      estatus: 'Estatus',
      modelo: 'Modelo',
      carline: 'Carline',
      quien: 'Apartó',
      modeloToma: 'Modelo toma',
      modeloNuevo: 'Modelo nuevo',
      vendido: 'Estatus usado',
      vendedorUsado: 'Vendedor usado',
    };

    function placeNearKpi(card) {
      if (expanded) return;
      const kpiBlock = document.querySelector('#panelVentasUnidades .kpi-grid');
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
      const { dim, value } = activeFilter;
      if (currentMeta.kpi === 'mixAutos') {
        if (dim === 'carline') {
          const carline = normalizeCarlineLabel(r.VEH_TIPOAUTO);
          if (value === 'Otros') {
            const otrosKeys = new Set((lastMixAutos?.otrosDetalle || []).map(([k]) => k));
            return otrosKeys.has(carline);
          }
          return carline === value;
        }
        if (dim === 'canal') return String(r.CANAL_LABEL || 'Sin canal') === value;
        if (dim === 'vendedor') return String(r.VENDEDOR || 'Sin vendedor') === value;
        if (dim === 'tipo') return String(r.TIPOVENTA || 'Sin tipo') === value;
      }
      if (currentMeta.kpi === 'retail' || currentMeta.kpi === 'flotilla') {
        if (dim === 'canal') return String(r.CANAL_LABEL || 'Sin canal') === value;
        if (dim === 'vendedor') return String(r.VENDEDOR || 'Sin vendedor') === value;
        if (dim === 'tipo') return String(r.TIPOVENTA || 'Sin tipo') === value;
        if (dim === 'modelo') return String(r.VEH_TIPOAUTO || 'Sin modelo') === value;
      }
      if (currentMeta.kpi === 'sofia') {
        if (dim === 'estatus') return String(r.SOF_Estatus || 'Sin estatus') === value;
        if (dim === 'vendedor') return String(r.SOF_CveUSu || 'Sin usuario') === value;
      }
      if (currentMeta.kpi === 'carryOver') {
        if (dim === 'modelo') return String(r.tipoAuto || r.catalogo || r.modelo || 'Sin modelo') === value;
        if (dim === 'quien') return String(r.apartadoPor || r.usuarioApartado || 'Sin dato') === value;
      }
      if (currentMeta.kpi === 'tomasACuenta') {
        if (dim === 'modeloToma') return String(r.modeloToma || 'Sin modelo') === value;
        if (dim === 'vendedor') return String(r.vendedor || 'Sin vendedor') === value;
        if (dim === 'modeloNuevo') return String(r.modeloNuevo || 'Sin modelo') === value;
        if (dim === 'vendedorUsado') return String(r.vendedorUsado || 'Sin vendedor') === value;
        if (dim === 'vendido') {
          if (value === 'Vendido mismo mes') return Boolean(r.vendidoMismoMes);
          if (value === 'Sin venta en el mes') return !r.vendidoMismoMes;
        }
      }
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
      updateFilterChip();
      renderList(searchEl?.value || '');
    }

    function filterBySearch(term, rows) {
      if (currentMeta.kpi === 'sofia') return filterEntregasRowsByTerm(term, rows);
      if (currentMeta.kpi === 'carryOver') return filterApartadasRowsByTerm(term, rows);
      if (currentMeta.kpi === 'tomasACuenta') return filterTomasACuentaByTerm(term, rows);
      return filterVentasRowsByTerm(term, rows);
    }

    function renderSummary(rows) {
      const isActive = (dim, value) => activeFilter && activeFilter.dim === dim && activeFilter.value === value;
      const block = (titulo, dim, items) => `
        <div class="ops-orders-drawer__group">
          <h5>${escapeHtml(titulo)}</h5>
          ${items.length
            ? items.slice(0, 12).map((x) => `
              <button type="button"
                class="ops-orders-drawer__row ops-orders-drawer__row--filter${isActive(dim, x.label) ? ' is-active' : ''}"
                data-ventas-filter-dim="${escapeHtml(dim)}"
                data-ventas-filter-value="${escapeHtml(x.label)}"
                title="Filtrar por ${escapeHtml(x.label)}">
                <span class="lbl">${escapeHtml(x.label)}</span>
                <span class="val">${x.value}</span>
              </button>`).join('')
            : '<p class="ops-orders-drawer__hint">Sin datos</p>'}
        </div>`;

      if (currentMeta.kpi === 'carryOver') {
        const { apartadas, goal, sofia, sinTimbrar, numeradorActual, numeradorSim } = getCarryOverParts();
        const simPct = formatCoberturaPct(numeradorSim, goal);
        const actualPct = formatCoberturaPct(numeradorActual, goal);
        const pctDisplay = escapeHtml(simPct || (goal ? '—' : String(numeradorSim)));
        const formula = goal
          ? `(${sofia} + ${sinTimbrar} + ${apartadas}) / ${goal} = ${simPct || '—'}`
          : 'Defina el objetivo SOFIA para calcular el porcentaje';
        summaryEl.innerHTML = `
          <div class="ops-orders-drawer__group ops-orders-drawer__group--carry-sim">
            <aside class="carry-over-sim-card carry-over-sim-card--drawer" aria-label="Simulación de cobertura">
              <span class="carry-over-sim-label">Sim. cobertura</span>
              <div class="carry-over-sim-pct">${pctDisplay}</div>
              <p class="carry-over-sim-formula">${escapeHtml(formula)}</p>
              <ul class="carry-over-sim-breakdown">
                <li><span>SOFIA</span><strong>${sofia}</strong></li>
                <li><span>Sin timbrar</span><strong>${sinTimbrar}</strong></li>
                <li><span>Apartadas SEP</span><strong>${apartadas}</strong></li>
                <li><span>Numerador simulado</span><strong>${numeradorSim}</strong></li>
                <li><span>Objetivo SOFIA</span><strong>${goal || '—'}</strong></li>
                ${actualPct ? `<li><span>Cobertura sin apartadas</span><strong>${escapeHtml(actualPct)}</strong></li>` : ''}
              </ul>
            </aside>
          </div>
          ${block('Por modelo', 'modelo', countByField(rows, (r) => r.tipoAuto || r.catalogo || r.modelo))}
          ${block('Quién apartó', 'quien', countByField(rows, (r) => r.apartadoPor || r.usuarioApartado))}
        `;
        return;
      }

      if (currentMeta.kpi === 'sofia') {
        summaryEl.innerHTML = `
          <div class="ops-orders-drawer__group">
            <h5>Resumen</h5>
            <div class="ops-orders-drawer__row"><span class="lbl">Entregas</span><span class="val">${rows.length}</span></div>
            <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
          </div>
          ${block('Estatus', 'estatus', countByField(rows, (r) => r.SOF_Estatus))}
          ${block('Usuario', 'vendedor', countByField(rows, (r) => r.SOF_CveUSu))}
        `;
        return;
      }

      if (currentMeta.kpi === 'tomasACuenta') {
        const monto = rows.reduce((s, r) => s + (Number(r.importeVehiculo) || 0), 0);
        const montoAdq = rows.reduce((s, r) => s + (Number(r.importeAdquisicion) || 0), 0);
        const vendidas = rows.filter((r) => r.vendidoMismoMes).length;
        const pct = rows.length > 0
          ? Math.round((vendidas / rows.length) * 1000) / 10
          : Number(resumenActual?.pctTomasVendidasMismoMes ?? 0);
        const montoVentaUsado = rows.reduce((s, r) => s + (Number(r.montoVentaUsado) || 0), 0);
        const fi = els.fechaInicio?.value || '';
        const ff = els.fechaFin?.value || '';
        const periodoLabel = fi && ff ? `${fi} â†’ ${ff}` : 'Periodo seleccionado';
        summaryEl.innerHTML = `
          <div class="ops-orders-drawer__group">
            <h5>Resumen del periodo</h5>
            <p class="ops-orders-drawer__hint">${escapeHtml(periodoLabel)}</p>
            <div class="ops-orders-drawer__row"><span class="lbl">Tomas</span><span class="val">${rows.length}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Vendidas mismo mes</span><span class="val">${vendidas}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">% revendidas</span><span class="val">${pct}%</span></div>
            <p class="ops-orders-drawer__hint">${vendidas} de ${rows.length} usados tomados ya se vendieron en el mismo mes de la toma</p>
          </div>
          <div class="ops-orders-drawer__group">
            <h5>Montos</h5>
            <div class="ops-orders-drawer__row"><span class="lbl">Monto usado (toma)</span><span class="val">${escapeHtml(moneyCell(monto))}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Monto adquisición</span><span class="val">${escapeHtml(moneyCell(montoAdq))}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Monto venta usados</span><span class="val">${escapeHtml(moneyCell(montoVentaUsado))}</span></div>
          </div>
          ${block('Modelo toma', 'modeloToma', countByField(rows, (r) => r.modeloToma))}
          ${block('Estatus usado', 'vendido', [
            { label: 'Vendido mismo mes', value: vendidas },
            { label: 'Sin venta en el mes', value: Math.max(0, rows.length - vendidas) },
          ])}
          ${block('Vendedor usado', 'vendedorUsado', countByField(rows.filter((r) => r.vendidoMismoMes), (r) => r.vendedorUsado))}
        `;
        return;
      }

      if (currentMeta.kpi === 'mixAutos') {
        const total = rows.length;
        const withMixPct = (items) => items.map((x) => ({
          label: x.label,
          value: total > 0
            ? `${x.value} · ${Math.round((x.value / total) * 1000) / 10}%`
            : x.value,
        }));
        const fi = els.fechaInicio?.value || '';
        const ff = els.fechaFin?.value || '';
        const periodoLabel = fi && ff ? `${fi} → ${ff}` : 'Periodo seleccionado';
        const topCarlines = countByField(rows, (r) => normalizeCarlineLabel(r.VEH_TIPOAUTO));
        summaryEl.innerHTML = `
          <div class="ops-orders-drawer__group">
            <h5>Resumen del mix</h5>
            <p class="ops-orders-drawer__hint">${escapeHtml(periodoLabel)}</p>
            <div class="ops-orders-drawer__row"><span class="lbl">Unidades</span><span class="val">${total}</span></div>
            <div class="ops-orders-drawer__row"><span class="lbl">Carlines</span><span class="val">${topCarlines.length}</span></div>
            <p class="ops-orders-drawer__hint">Detalle por unidad (serie / factura). Filtra por carline o modelo.</p>
          </div>
          ${block('Carline / modelo', 'carline', withMixPct(topCarlines))}
          ${block('Tipo venta', 'tipo', withMixPct(countByField(rows, (r) => r.TIPOVENTA)))}
          ${block('Vendedor', 'vendedor', withMixPct(countByField(rows, (r) => r.VENDEDOR)))}
        `;
        return;
      }

      summaryEl.innerHTML = `
        <div class="ops-orders-drawer__group">
          <h5>Resumen</h5>
          <div class="ops-orders-drawer__row"><span class="lbl">Unidades</span><span class="val">${rows.length}</span></div>
          <p class="ops-orders-drawer__hint">${escapeHtml(currentMeta.hint || '')}</p>
        </div>
        ${block('Canal', 'canal', countByField(rows, (r) => r.CANAL_LABEL))}
        ${block('Vendedor', 'vendedor', countByField(rows, (r) => r.VENDEDOR))}
        ${block('Modelo', 'modelo', countByField(rows, (r) => r.VEH_TIPOAUTO))}
      `;
    }

    function renderList(term) {
      const filtered = filterBySearch(term || '', sourceRows).filter(matchesActiveFilter);
      lastExportRows = filtered;
      if (statusEl) {
        statusEl.textContent = `${filtered.length} registro${filtered.length === 1 ? '' : 's'}`;
      }
      if (metaEl) {
        metaEl.textContent = filtered.length !== sourceRows.length
          ? `${filtered.length} de ${sourceRows.length}`
          : `${sourceRows.length} en periodo`;
      }
      renderSummary(sourceRows);

      if (!filtered.length) {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__empty">
            <span class="material-symbols-outlined">inbox</span>
            <p>Sin registros para este indicador</p>
          </div>`;
        return;
      }

      if (currentMeta.kpi === 'sofia') {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__list-head">
            <span>Entregas SOFIA</span><span>${filtered.length}</span>
          </div>
          ${filtered.map((r) => `
            <div class="ops-orders-drawer__item" style="cursor:default">
              <div class="ops-orders-drawer__item-head">
                <strong>${escapeHtml(r.SOF_VIN || 'Sin serie')}</strong>
                <span class="ops-orders-drawer__tag">${escapeHtml(r.SOF_Estatus || '—')}</span>
              </div>
              <p class="ops-orders-drawer__msg">${escapeHtml(r.CLIENTE || '—')} · Factura ${escapeHtml(r.SOF_Factura || '—')}</p>
              <div class="ops-orders-drawer__facts">
                <span>${escapeHtml(r.SOF_FechAct || r.FECHA_PERIODO || '—')}</span>
                <span>Previas ${Number(r.PREVIAS || 0)}</span>
                <span>${escapeHtml(r.SOF_CveUSu || '—')}</span>
              </div>
            </div>`).join('')}`;
        return;
      }

      if (currentMeta.kpi === 'carryOver') {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__list-head">
            <span>Apartadas SEP</span><span>${filtered.length}</span>
          </div>
          ${filtered.map((r) => `
            <div class="ops-orders-drawer__item" style="cursor:default">
              <div class="ops-orders-drawer__item-head">
                <strong>${escapeHtml(r.serie || r.vin || 'Sin serie')}</strong>
                <span class="ops-orders-drawer__tag">${escapeHtml(r.situacionLabel || r.situacion || 'SEP')}</span>
              </div>
              <p class="ops-orders-drawer__msg">${escapeHtml(r.tipoAuto || r.catalogo || r.modelo || '—')} · ${escapeHtml(r.colorExterior || r.color || '—')}</p>
              <div class="ops-orders-drawer__facts">
                <span>${escapeHtml(String(r.daysApartado ?? '—'))} días</span>
                <span>${escapeHtml(r.apartadoPor || r.usuarioApartado || '—')}</span>
                <span>Previas ${Number(r.previas || 0)}</span>
              </div>
            </div>`).join('')}`;
        return;
      }

      if (currentMeta.kpi === 'tomasACuenta') {
        const vendidas = filtered.filter((r) => r.vendidoMismoMes).length;
        const monto = filtered.reduce((s, r) => s + (Number(r.importeVehiculo) || 0), 0);
        const pct = filtered.length > 0
          ? Math.round((vendidas / filtered.length) * 1000) / 10
          : 0;
        bodyEl.innerHTML = `
          <div class="toma-period-banner" aria-label="Resumen del periodo">
            <div class="toma-period-banner__item">
              <span class="toma-period-banner__label">Tomados</span>
              <strong>${filtered.length}</strong>
              <small>${escapeHtml(moneyCell(monto))}</small>
            </div>
            <div class="toma-period-banner__item">
              <span class="toma-period-banner__label">Vendidos mismo mes</span>
              <strong>${vendidas}</strong>
              <small>usados revendidos</small>
            </div>
            <div class="toma-period-banner__item">
              <span class="toma-period-banner__label">% revendidos</span>
              <strong>${pct}%</strong>
              <small>de las tomas</small>
            </div>
          </div>
          <div class="ops-orders-drawer__list-head">
            <span>Tomas a cuenta</span><span>${filtered.length}</span>
          </div>
          ${filtered.map((r) => `
            <button type="button" class="ops-orders-drawer__item ops-orders-drawer__item--clickable" data-toma-key="${escapeHtml(tomaRecordKey(r))}" title="Ver detalle de la toma">
              <div class="ops-orders-drawer__item-head">
                <strong class="toma-vin-link">${escapeHtml(r.vinToma || 'Sin VIN toma')}</strong>
                <span class="ops-orders-drawer__tag">${r.vendidoMismoMes ? 'Vendido' : 'Pendiente'}</span>
              </div>
              <p class="ops-orders-drawer__msg">${escapeHtml(r.modeloToma || 'Usado')} ${escapeHtml(r.anModeloToma || '')}${r.vendidoMismoMes ? ` · venta ${escapeHtml(formatTomaFecha(r.fechaVentaUsado))}` : ''}</p>
              <div class="ops-orders-drawer__facts">
                <span>Toma ${escapeHtml(formatTomaFecha(r.fechaToma))}</span>
                <span>${escapeHtml(moneyCell(r.importeVehiculo))}</span>
                <span>${escapeHtml(r.vendedorUsado || r.vendedor || '—')}</span>
              </div>
              <p class="ops-orders-drawer__sub">${r.vendidoMismoMes
                ? `${escapeHtml(r.clienteUsado || '—')} · Pedido USN ${escapeHtml(String(r.pedidoUsn ?? '—'))} · ${escapeHtml(moneyCell(r.montoVentaUsado))}`
                : `${escapeHtml(r.cliente || '—')} · Pedido nuevo ${escapeHtml(String(r.idPedido ?? '—'))}`}</p>
            </button>`).join('')}`;
        return;
      }

      if (currentMeta.kpi === 'mixAutos') {
        bodyEl.innerHTML = `
          <div class="ops-orders-drawer__list-head">
            <span>Unidades</span><span>${filtered.length}</span>
          </div>
          ${filtered.map((r) => `
            <div class="ops-orders-drawer__item" style="cursor:default">
              <div class="ops-orders-drawer__item-head">
                <strong>${escapeHtml(r.VTE_SERIE || 'Sin serie')}</strong>
                <span class="ops-orders-drawer__tag">${escapeHtml(normalizeCarlineLabel(r.VEH_TIPOAUTO) || '—')}</span>
              </div>
              <p class="ops-orders-drawer__msg">${escapeHtml(r.CLIENTE || '—')} · ${escapeHtml(r.VENDEDOR || '—')}</p>
              <div class="ops-orders-drawer__facts">
                <span>${escapeHtml(r.VTE_FECHDOCTO || '—')}</span>
                <span>${escapeHtml(r.TIPOVENTA || '—')}</span>
                <span>${escapeHtml(r.COL_DESCRIPCION || '—')}</span>
              </div>
              <p class="ops-orders-drawer__sub">Doc. ${escapeHtml(r.VTE_DOCTO || '—')} · ${escapeHtml(r.CANAL_LABEL || '—')}</p>
            </div>`).join('')}`;
        return;
      }

      bodyEl.innerHTML = `
        <div class="ops-orders-drawer__list-head">
          <span>${currentMeta.kpi === 'flotilla' ? 'Flotillas' : 'Retail'}</span><span>${filtered.length}</span>
        </div>
        ${filtered.map((r) => `
          <div class="ops-orders-drawer__item" style="cursor:default">
            <div class="ops-orders-drawer__item-head">
              <strong>${escapeHtml(r.VTE_SERIE || 'Sin serie')}</strong>
              <span class="ops-orders-drawer__tag">${escapeHtml(r.TIPOVENTA || '—')}</span>
            </div>
            <p class="ops-orders-drawer__msg">${escapeHtml(r.CLIENTE || '—')} · ${escapeHtml(r.VENDEDOR || '—')}</p>
            <div class="ops-orders-drawer__facts">
              <span>${escapeHtml(r.VTE_FECHDOCTO || '—')}</span>
              <span>${escapeHtml(r.VEH_TIPOAUTO || '—')}</span>
              <span>${escapeHtml(r.CANAL_LABEL || '—')}</span>
            </div>
            <p class="ops-orders-drawer__sub">Doc. ${escapeHtml(r.VTE_DOCTO || '—')} · ${escapeHtml(r.COL_DESCRIPCION || '—')}</p>
          </div>`).join('')}`;
    }

    function close() {
      panel.classList.remove('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ops-orders-drawer-open');
      setExpanded(false);
      clearPlacement();
      activeVentasDrawerKpi = null;
      activeVentasKpiType = null;
      clearVentasKpiSelection();
    }

    function open(kpiKey, card, opts = {}) {
      const meta = ventasKpiMeta(kpiKey);
      const resolvedCard = card || meta.card?.() || null;
      const initialFilter = opts.filter || null;
      const forceOpen = Boolean(opts.forceOpen);

      if (activeVentasDrawerKpi === kpiKey && panel.classList.contains('ops-orders-drawer--open')) {
        if (initialFilter) {
          activeFilter = {
            dim: initialFilter.dim,
            value: initialFilter.value,
            label: initialFilter.label || initialFilter.value,
          };
          updateFilterChip();
          renderList(searchEl?.value || '');
          return;
        }
        if (!forceOpen) {
          close();
          return;
        }
      }

      currentMeta = {
        kpi: kpiKey,
        title: meta.title,
        hint: meta.hint,
        icon: meta.icon,
      };
      lastCard = resolvedCard;
      activeVentasDrawerKpi = kpiKey;
      activeVentasKpiType = (kpiKey === 'retail' || kpiKey === 'flotilla') ? kpiKey : null;

      if (titleEl) titleEl.textContent = currentMeta.title;
      if (logoEl) logoEl.textContent = currentMeta.icon;
      panel.setAttribute('aria-label', currentMeta.title);
      if (searchEl) {
        searchEl.placeholder = kpiKey === 'sofia'
          ? 'Buscar factura, VIN, cliente, estatus...'
          : kpiKey === 'carryOver'
            ? 'Buscar serie, modelo, color, quién apartó...'
            : kpiKey === 'tomasACuenta'
              ? 'Buscar VIN toma, factura, cliente, modelo...'
              : kpiKey === 'mixAutos'
                ? 'Buscar carline, vendedor, cliente, serie, canal...'
                : 'Buscar vendedor, cliente, serie, modelo...';
        searchEl.value = '';
      }

      sourceRows = rowsForVentasDrawer(kpiKey).slice();
      activeFilter = initialFilter
        ? {
          dim: initialFilter.dim,
          value: initialFilter.value,
          label: initialFilter.label || initialFilter.value,
        }
        : null;
      updateFilterChip();
      clearVentasKpiSelection();
      resolvedCard?.classList.add('is-selected', 'is-open');
      resolvedCard?.setAttribute('aria-expanded', 'true');
      placeNearKpi(resolvedCard);
      setExpanded(true);
      renderList('');
      panel.classList.add('ops-orders-drawer--open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('ops-orders-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ops-orders-drawer-open');
      window.setTimeout(() => searchEl?.focus({ preventScroll: true }), 180);
    }

    backdrop.addEventListener('click', close);
    panel.querySelector('[data-ventas-kpi-close]')?.addEventListener('click', close);
    expandBtn?.addEventListener('click', () => setExpanded(!expanded));
    filterChip?.addEventListener('click', clearFilter);
    searchEl?.addEventListener('input', () => renderList(searchEl.value));
    downloadBtn?.addEventListener('click', () => {
      if (!lastExportRows.length) {
        window.alert('No hay registros para descargar.');
        return;
      }
      const fi = els.fechaInicio?.value || 'inicio';
      const ff = els.fechaFin?.value || 'fin';
      if (currentMeta.kpi === 'sofia') {
        downloadCsv(
          ['FechaRegistro', 'FechaFactura', 'Hora', 'Factura', 'VIN', 'Previas', 'Pedido', 'NoTransaccion', 'Cliente', 'Estatus', 'Usuario'],
          ['SOF_FechAct', 'FECHA_FACTURA', 'SOF_HoraAct', 'SOF_Factura', 'SOF_VIN', 'PREVIAS', 'SOF_Pedido', 'SOF_NoTransaccion', 'CLIENTE', 'SOF_Estatus', 'SOF_CveUSu'],
          lastExportRows,
          `entregas_sofia_${fi}_${ff}.csv`
        );
      } else if (currentMeta.kpi === 'carryOver') {
        const lines = [['Serie', 'Modelo', 'Anio', 'Color', 'Situacion', 'Dias', 'Aparto', 'Previas'].join(',')];
        for (const r of lastExportRows) {
          lines.push([
            r.serie || r.vin || '',
            r.tipoAuto || r.catalogo || r.modelo || '',
            r.anModelo || r.anio || '',
            r.colorExterior || r.color || '',
            r.situacionLabel || r.situacion || '',
            r.daysApartado ?? '',
            r.apartadoPor || r.usuarioApartado || '',
            r.previas ?? 0,
          ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `carry_over_${fi}_${ff}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (currentMeta.kpi === 'tomasACuenta') {
        const lines = [[
          'Pedido', 'VINToma', 'ModeloToma', 'AnioToma', 'ImporteVehiculo', 'ImporteAdquisicion',
          'FechaToma', 'VendidoMismoMes', 'FechaVentaUsado', 'PedidoUsn', 'MontoVentaUsado', 'ClienteUsado', 'VendedorUsado',
          'SerieNuevo', 'ModeloNuevo', 'AnioNuevo', 'Factura', 'FechaFactura', 'Cliente', 'Vendedor', 'UsuarioToma',
        ].join(',')];
        for (const r of lastExportRows) {
          lines.push([
            r.idPedido ?? '',
            r.vinToma || '',
            r.modeloToma || '',
            r.anModeloToma || '',
            r.importeVehiculo ?? '',
            r.importeAdquisicion ?? '',
            formatTomaFecha(r.fechaToma),
            r.vendidoMismoMes ? 'SI' : 'NO',
            formatTomaFecha(r.fechaVentaUsado),
            r.pedidoUsn ?? '',
            r.montoVentaUsado ?? '',
            r.clienteUsado || '',
            r.vendedorUsado || '',
            r.serieNuevo || '',
            r.modeloNuevo || '',
            r.anModeloNuevo || '',
            r.facturaNuevo || '',
            formatTomaFecha(r.fechaFactura),
            r.cliente || '',
            r.vendedor || '',
            r.usuarioToma || '',
          ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tomas_a_cuenta_${fi}_${ff}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        downloadCsv(
          ['Fecha', 'Documento', 'Vendedor', 'Cliente', 'Serie', 'Modelo', 'Anio', 'Color', 'Departamento', 'TipoVenta', 'FormaPago'],
          ['VTE_FECHDOCTO', 'VTE_DOCTO', 'VENDEDOR', 'CLIENTE', 'VTE_SERIE', 'VEH_TIPOAUTO', 'VEH_ANMODELO', 'COL_DESCRIPCION', 'CANAL_LABEL', 'TIPOVENTA', 'FORMAPAGO_ORIGINAL'],
          lastExportRows,
          `ventas_${currentMeta.kpi}_${fi}_${ff}.csv`
        );
      }
    });
    summaryEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ventas-filter-dim]');
      if (!btn || !summaryEl.contains(btn)) return;
      setFilter(btn.dataset.ventasFilterDim, btn.dataset.ventasFilterValue, btn.dataset.ventasFilterValue);
    });
    bodyEl.addEventListener('click', (e) => {
      const tomaBtn = e.target.closest('[data-toma-key]');
      if (!tomaBtn || !bodyEl.contains(tomaBtn)) return;
      const key = tomaBtn.getAttribute('data-toma-key');
      const record = (tomasACuentaActuales || []).find((r) => tomaRecordKey(r) === key)
        || (lastExportRows || []).find((r) => tomaRecordKey(r) === key);
      if (record) openTomaDetail(record);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('ops-orders-drawer--open')) close();
    });

    ventasDrawerUi = {
      open,
      close,
      isOpen: () => panel.classList.contains('ops-orders-drawer--open'),
      refresh() {
        if (!panel.classList.contains('ops-orders-drawer--open') || !activeVentasDrawerKpi) return;
        sourceRows = rowsForVentasDrawer(activeVentasDrawerKpi).slice();
        renderList(searchEl?.value || '');
      },
      getExportRows: () => lastExportRows,
      getActiveKpi: () => activeVentasDrawerKpi,
    };
    return ventasDrawerUi;
  }

  function closeVentasPanel() {
    ensureVentasKpiDrawer().close();
  }

  function setVentasPanelOpen(type, open) {
    const drawer = ensureVentasKpiDrawer();
    if (!open) {
      drawer.close();
      return;
    }
    drawer.open(type, type === 'flotilla' ? els.kpiCardFlotillas : els.kpiCardRetail);
  }

  function bindKpiCard(card, onToggle) {
    if (!card) return;
    card.addEventListener('click', onToggle);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    });
  }

  function entregasRowsHtml(rows, emptyMessage) {
    if (!rows.length) {
      return `<tr class="empty-row"><td colspan="11">${emptyMessage || 'No hay notificaciones de entrega en el periodo.'}</td></tr>`;
    }
    return rows.map((row) => `<tr class="row-sofia">
      <td>${row.SOF_FechAct ?? row.FECHA_PERIODO ?? ''}</td>
      <td>${row.FECHA_FACTURA ?? row.SOF_FechFact ?? ''}</td>
      <td>${row.SOF_HoraAct ?? ''}</td>
      <td>${row.SOF_Factura ?? ''}</td><td>${row.SOF_VIN ?? ''}</td>
      <td class="cell-num">${Number(row.PREVIAS || 0)}</td>
      <td>${row.SOF_Pedido ?? ''}</td>
      <td>${row.SOF_NoTransaccion ?? ''}</td><td>${row.CLIENTE ?? ''}</td>
      <td><span class="badge-tipo badge-sofia">${row.SOF_Estatus ?? ''}</span></td><td>${row.SOF_CveUSu ?? ''}</td>
    </tr>`).join('');
  }

  function renderEntregasPreview(rows) {
    if (!els.tablaEntregasPreviewBody) return;
    const term = els.buscarSofiaPreview?.value?.trim();
    const emptyMessage = term ? 'No hay coincidencias con la búsqueda.' : undefined;
    els.tablaEntregasPreviewBody.innerHTML = entregasRowsHtml(rows, emptyMessage);
  }

  function updateSofiaPanelResumen(count, filteredCount) {
    if (!els.sofiaPanelResumen) return;
    const n = Number(count || 0);
    const filtered = filteredCount !== undefined ? Number(filteredCount) : null;
    const meta = els.sofiaPreviewSearchMeta;

    if (filtered !== null && !Number.isNaN(filtered) && filtered !== n) {
      els.sofiaPanelResumen.textContent = `${filtered} de ${n} notificación${n === 1 ? '' : 'es'} coinciden con la búsqueda`;
      if (meta) {
        meta.textContent = `${filtered} resultado${filtered === 1 ? '' : 's'}`;
        meta.classList.remove('hidden');
      }
      return;
    }

    if (meta) meta.classList.add('hidden');
    els.sofiaPanelResumen.textContent = n
      ? `${n} notificación${n === 1 ? '' : 'es'} en el periodo (sin FLOT · FLOTGMF solo menudeo)`
      : 'No hay notificaciones de entrega en el periodo (FLOT exenta; FLOTGMF con contrato flotilla AO no cuenta).';
  }

  function clearSofiaPreviewSearch() {
    if (els.buscarSofiaPreview) els.buscarSofiaPreview.value = '';
    els.sofiaPreviewSearchMeta?.classList.add('hidden');
  }

  function applySofiaPreviewSearch() {
    const base = entregasActuales;
    const term = els.buscarSofiaPreview?.value || '';
    const filtered = filterEntregasRowsByTerm(term, base);
    renderEntregasPreview(filtered);
    updateSofiaPanelResumen(base.length, term.trim() ? filtered.length : undefined);
  }

  function setSofiaPanelOpen(open) {
    const drawer = ensureVentasKpiDrawer();
    if (!open) {
      drawer.close();
      return;
    }
    drawer.open('sofia', els.kpiCardEntregasSofia);
  }

  function toggleSofiaPanel() {
    setSofiaPanelOpen(true);
  }

  function getVentasExportRows() {
    const drawer = ventasDrawerUi;
    if (drawer?.isOpen?.() && (drawer.getActiveKpi() === 'retail' || drawer.getActiveKpi() === 'flotilla')) {
      return drawer.getExportRows() || [];
    }
    return registrosActuales;
  }

  function getSofiaExportRows() {
    const drawer = ventasDrawerUi;
    if (drawer?.isOpen?.() && drawer.getActiveKpi() === 'sofia') {
      return drawer.getExportRows() || [];
    }
    return entregasActuales;
  }

  function filterVentasRowsByTerm(term, base) {
    const q = term.trim().toLowerCase();
    if (!q) return base;
    return base.filter((row) =>
      [row.VTE_FECHDOCTO, row.VTE_DOCTO, row.VENDEDOR, row.CLIENTE, row.VTE_SERIE, row.VEH_TIPOAUTO, row.VEH_ANMODELO, row.COL_DESCRIPCION, row.CANAL_LABEL, row.TIPOVENTA, row.FORMAPAGO_ORIGINAL]
        .some((val) => String(val || '').toLowerCase().includes(q))
    );
  }

  function filterEntregasRowsByTerm(term, base) {
    const q = term.trim().toLowerCase();
    if (!q) return base;
    return base.filter((row) =>
      [row.SOF_FechAct, row.FECHA_FACTURA || row.SOF_FechFact, row.SOF_HoraAct, row.SOF_Factura, row.SOF_VIN, row.PREVIAS, row.SOF_Pedido, row.SOF_NoTransaccion, row.CLIENTE, row.SOF_Estatus, row.SOF_CveUSu]
        .some((val) => String(val ?? '').toLowerCase().includes(q))
    );
  }

  function downloadCsv(headers, keys, rows, filename) {
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(keys.map((key) => {
        const value = key === 'FECHA_PERIODO' ? (row.FECHA_PERIODO ?? row.SOF_FechFact ?? '') : row[key];
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
      }).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function consultar({ quiet = false, fresh = false } = {}) {
    const fechaInicio = els.fechaInicio.value;
    const fechaFin = els.fechaFin.value;
    if (!fechaInicio || !fechaFin) { setStatus('Seleccione ambas fechas', 'error'); return; }

    // Recargar pestaña activa de inmediato con el periodo elegido.
    // Antes Leads/Afluencia esperaban a /api/ventas; si fallaba o tardaba, quedaban en mes en curso.
    pendingLeads = { fechaInicio, fechaFin };
    pendingAfluencia = { fechaInicio, fechaFin };
    const sideLoads = [];
    if (activeSalesTab === 'leads' && window.LeadsVentas?.load) {
      sideLoads.push(window.LeadsVentas.load(fechaInicio, fechaFin, { force: true }));
    }
    if (activeSalesTab === 'afluencia' && window.AfluenciaVentas?.load) {
      sideLoads.push(window.AfluenciaVentas.load(fechaInicio, fechaFin, { force: true }));
    }
    if (activeSalesTab === 'comisiones' && window.ComisionesVentas?.load) {
      sideLoads.push(window.ComisionesVentas.load(fechaInicio, fechaFin, { force: true }));
    }
    // Financiamiento: arrancar de inmediato con el periodo del filtro (no esperar /api/ventas).
    // Así no se queda pintado el mes anterior mientras carga ventas/SOFIA.
    if (activeSalesTab === 'financiamiento' && window.FinanciamientoVentas?.load) {
      sideLoads.push(window.FinanciamientoVentas.load(
        fechaInicio,
        fechaFin,
        null,
        [],
        [],
        { force: true },
      ));
    }
    const sideLoadPromise = Promise.allSettled(sideLoads);

    const refreshBtn = document.getElementById('btnRefreshEntregasSofia');
    if (!quiet) {
      setStatus('Consultando...', 'loading');
      els.btnConsultar.disabled = true;
      Dashboard.showLoading(true);
    } else if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('is-refreshing');
      if (els.kpiEntregasSofiaSub) els.kpiEntregasSofiaSub.textContent = 'Actualizando SOFIA…';
    }

    try {
      const qs = new URLSearchParams({ fechaInicio, fechaFin });
      if (fresh) qs.set('fresh', '1');
      const response = await fetch(`/api/ventas?${qs.toString()}`, { credentials: 'same-origin' });
      const raw = await response.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          response.status === 404
            ? 'API /api/ventas no encontrada. Detenga el servidor anterior y ejecute npm start de nuevo.'
            : `Respuesta inválida del servidor (${response.status}). Reinicie con npm start.`
        );
      }
      if (!response.ok) throw new Error(data.error || `Error al consultar (${response.status})`);

      const registrosRaw = Array.isArray(data.registros) ? data.registros : [];
      registrosActuales = registrosRaw.map((row) => CanalesVenta.enrichRegistro(row));
      entregasActuales = Array.isArray(data.entregasSofia) ? data.entregasSofia : [];
      tomasACuentaActuales = Array.isArray(data.tomasACuenta) ? data.tomasACuenta : [];
      tomasACuentaMeta = data.tomasACuentaMeta || {
        porModeloToma: [],
        montoAdquisicion: 0,
        totalVendidosMismoMes: 0,
        pctVendidosMismoMes: 0,
        montoVentasUsado: 0,
      };
      const { resumen } = data;
      if (!resumen || typeof resumen !== 'object') {
        throw new Error('La API de ventas no devolvió resumen. Reinicie el backend.');
      }

      if (!resumen.porCanal?.length) {
        resumen.porCanal = CanalesVenta.countByCanal(registrosActuales.filter((r) => !r.IS_DEMO));
      }

      resumenActual = resumen;
      els.kpiTotal.textContent = resumen.totalVentas;
      els.kpiRetail.textContent = resumen.totalRetail;
      els.kpiFlotillas.textContent = resumen.totalFlotillas;
      renderDemosNota(resumen);
      els.kpiEntregasSofia.textContent = resumen.totalNotificacionesEntrega ?? 0;
      renderTomasSection(resumen, data.tomasMensual);
      if (els.kpiEntregasSofiaSub) {
        const stamp = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        const demosBit = Number(resumen.totalDemosSofia || 0) > 0
          ? `${resumen.totalDemosSofia} demo${Number(resumen.totalDemosSofia) === 1 ? '' : 's'} del mes · `
          : '';
        els.kpiEntregasSofiaSub.textContent = `${demosBit}Actualizado ${stamp}`;
      }

      await fetchSharedGoals().catch((err) => console.warn('[Goals]', err.message));
      await ensureApartadasInResumen();
      renderCarryOverKpi();
      renderCoberturaKpi();
      renderKpiVisualBars(resumenActual);
      updateTopBarSummary(resumen);
      els.lastUpdated.textContent = `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`;

      renderGoalCharts(resumen);
      renderCharts(resumen);
      renderYtdChart(data.comparativoYtd);
      renderCarlineUtilidad(data.utilidadCarline, data.comparativoYtd);
      if (ventasDrawerUi?.isOpen?.()) {
        ventasDrawerUi.refresh();
      }

      els.btnExportar.disabled = registrosActuales.length === 0;
      els.btnExportarEntregas.disabled = entregasActuales.length === 0;

      const modo = resumen.mostrarComparativoMensual ? ' · comparativo mensual' : '';
      if (!quiet) {
        setStatus(`${resumen.totalVentas} ventas · ${resumen.totalNotificacionesEntrega ?? 0} entregas SOFIA${modo}`);
      }
      Dashboard.updateCompactFilterLabels();
      if (!quiet) compactFilters?.closeAll?.();

      if (window.KpiInsights?.apply) {
        try {
        const tomasRows = tomasACuentaActuales || [];
        const tomasTotal = Number(resumen.totalTomasACuenta ?? tomasRows.length ?? 0);
        const tomasVendidos = Number(
          resumen.totalTomasVendidasMismoMes
          ?? tomasACuentaMeta.totalVendidosMismoMes
          ?? tomasRows.filter((r) => r.vendidoMismoMes).length
        );
        const pendientesRows = tomasRows.filter((r) => !r.vendidoMismoMes);
        const byModelo = new Map();
        for (const r of tomasRows) {
          const modelo = String(r.modeloToma || 'Sin modelo').trim() || 'Sin modelo';
          const cur = byModelo.get(modelo) || { modelo, tomas: 0, vendidos: 0, pendientes: 0 };
          cur.tomas += 1;
          if (r.vendidoMismoMes) cur.vendidos += 1;
          else cur.pendientes += 1;
          byModelo.set(modelo, cur);
        }
        const modelosDificiles = [...byModelo.values()]
          .map((m) => ({
            ...m,
            pct: m.tomas > 0 ? Math.round((m.vendidos / m.tomas) * 1000) / 10 : 0,
          }))
          .filter((m) => m.pendientes > 0)
          .sort((a, b) => b.pendientes - a.pendientes || a.pct - b.pct || b.tomas - a.tomas)
          .slice(0, 5);
        const unidadesDificiles = pendientesRows
          .slice()
          .sort((a, b) => String(a.fechaToma || '').localeCompare(String(b.fechaToma || '')))
          .slice(0, 8)
          .map((r) => ({
            vin: r.vinToma,
            modelo: r.modeloToma,
            fechaToma: r.fechaToma,
          }));

        window.KpiInsights.apply('ventas', {
          fechaInicio,
          fechaFin,
          resumen: {
            totalVentas: resumen.totalVentas,
            totalRetail: resumen.totalRetail,
            totalFlotillas: resumen.totalFlotillas,
            totalNotificacionesEntrega: resumen.totalNotificacionesEntrega,
            totalEntregasSinPrevias: resumen.totalEntregasSinPrevias,
            totalUnidadesFacturadasNoTimbradas: resumen.totalUnidadesFacturadasNoTimbradas,
            numeradorCobertura: resumen.numeradorCobertura,
            unidadesApartadas: resumen.unidadesApartadas ?? 0,
            totalTomasACuenta: tomasTotal,
            totalTomasVendidasMismoMes: tomasVendidos,
            pctTomasVendidasMismoMes: Number(resumen.pctTomasVendidasMismoMes || 0),
            montoTomasACuenta: resumen.montoTomasACuenta ?? 0,
            porModelo: (resumen.porModelo || []).slice(0, 12).map((m) => ({
              label: m.label || m.key || m.modelo,
              count: Number(m.count || m.unidades || 0),
            })),
          },
          tomas: {
            total: tomasTotal,
            vendidosMismoMes: tomasVendidos,
            pendientes: pendientesRows.length,
            pctVendidos: tomasTotal > 0
              ? Math.round((tomasVendidos / tomasTotal) * 1000) / 10
              : 0,
            modelosDificiles,
            unidadesDificiles,
          },
          goals: {
            retail: getGoalValue('retail'),
            sofia: getGoalValue('sofia'),
          },
          ytd: lastYtd ? {
            variacion: lastYtd.variacion,
            totalActual: lastYtd.totalActual,
            totalAnterior: lastYtd.totalAnterior,
          } : null,
          utilidadCarline: (() => {
            const uc = data.utilidadCarline;
            if (!uc) return null;
            return {
              available: uc.available !== false,
              lider: uc.lider || null,
              porCarline: (uc.porCarline || []).slice(0, 20).map((c) => ({
                carline: c.carline,
                unidadesCarline: c.unidadesCarline,
                mejorVersion: c.mejorVersion ? {
                  version: c.mejorVersion.version,
                  utilidadPromedio: c.mejorVersion.utilidadPromedio,
                  utilidadTotal: c.mejorVersion.utilidadTotal,
                  margenBrutoPct: c.mejorVersion.margenBrutoPct,
                  unidades: c.mejorVersion.unidades,
                } : null,
              })),
            };
          })(),
        });
        } catch (insightErr) {
          console.warn('[KpiInsights]', insightErr);
        }
      }

      if (window.FinanciamientoVentas?.load) {
        pendingFinanciamiento = {
          fechaInicio,
          fechaFin,
          porTipoVentaRetail: resumen.porTipoVentaRetail,
          registrosVentas: registrosActuales,
          entregasSofia: entregasActuales,
        };
        if (activeSalesTab === 'financiamiento' && window.FinanciamientoVentas?.applyVentasMix) {
          try {
            await window.FinanciamientoVentas.applyVentasMix(registrosActuales, entregasActuales);
          } catch (fiErr) {
            console.warn('[Financiamiento mix]', fiErr.message);
          }
        }
      }

      // Precarga en segundo plano las otras secciones del mismo periodo.
      prefetchSalesTabs(fechaInicio, fechaFin, {
        porTipoVentaRetail: resumen.porTipoVentaRetail,
        registrosVentas: registrosActuales,
        entregasSofia: entregasActuales,
      });

      // Leads/Afluencia/Comisiones ya se dispararon al inicio con el periodo seleccionado.
      syncSofiaLiveMode(data.sofiaLiveUpdate);
    } catch (err) {
      console.error('[Sales]', err);
      if (!quiet) setStatus(err.message, 'error');
      if (els.kpiEntregasSofiaSub) {
        const short = String(err.message || 'Error al actualizar SOFIA').slice(0, 90);
        els.kpiEntregasSofiaSub.textContent = quiet ? short : 'Error al actualizar SOFIA';
      }
    } finally {
      await sideLoadPromise;
      if (!quiet) {
        els.btnConsultar.disabled = false;
        Dashboard.showLoading(false);
      }
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('is-refreshing');
      }
    }
  }

  function stopSofiaLivePolling() {
    if (sofiaLiveTimer) {
      clearInterval(sofiaLiveTimer);
      sofiaLiveTimer = null;
    }
    sofiaLiveActive = false;
  }

  function applySofiaLivePeriod(ctx, { force = false } = {}) {
    if (!ctx?.active || !ctx.fechaInicio || !ctx.fechaFin || !els?.fechaInicio) return false;
    const changed = els.fechaInicio.value !== ctx.fechaInicio || els.fechaFin.value !== ctx.fechaFin;
    if (!changed) return false;
    // Solo forzar el periodo de cierre SOFIA al activar el modo en vivo.
    // No pisar un rango que el usuario ya eligió (p. ej. mes pasado en Leads).
    if (!force) return false;
    els.fechaInicio.value = ctx.fechaInicio;
    els.fechaFin.value = ctx.fechaFin;
    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.classList.remove('active', 'chip--active');
    });
    const lbl = document.getElementById('filterPresetLabel');
    if (lbl) {
      lbl.textContent = ctx.deferredFromNonWorking
        ? `Cierre ${ctx.periodKey} (hábil)`
        : `Cierre ${ctx.periodKey}`;
    }
    Dashboard.updateCompactFilterLabels?.();
    return true;
  }

  function syncSofiaLiveMode(ctx) {
    if (!ctx?.active) {
      stopSofiaLivePolling();
      return;
    }
    const firstActivation = !sofiaLiveActive;
    // Nunca pisar el filtro en pestañas CRM/histórico (Leads/Afluencia/Financiamiento).
    if (
      firstActivation
      && activeSalesTab !== 'leads'
      && activeSalesTab !== 'afluencia'
      && activeSalesTab !== 'financiamiento'
    ) {
      applySofiaLivePeriod(ctx, { force: true });
    }
    if (sofiaLiveActive && sofiaLiveTimer) return;
    sofiaLiveActive = true;
    const minutes = Math.max(1, Number(ctx.intervalMinutes) || 2);
    const badge = els?.statusBadge;
    if (badge && !badge.classList.contains('status-error')) {
      const note = ctx.deferredFromNonWorking
        ? ` · SOFIA en vivo (cierre ${ctx.periodKey}, diferido)`
        : ` · SOFIA en vivo (cierre ${ctx.periodKey})`;
      if (!String(badge.textContent || '').includes('SOFIA en vivo')) {
        badge.textContent = `${badge.textContent || ''}${note}`.trim();
      }
    }
    sofiaLiveTimer = setInterval(() => {
      if (document.hidden) return;
      consultar({ quiet: true }).catch(() => {});
    }, minutes * 60 * 1000);
  }

  async function ensureSofiaLiveOnBoot() {
    try {
      const res = await fetch('/api/ventas/sofia-live-status', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      const ctx = data?.context;
      if (!ctx?.active) return;
      if (typeof data.intervalMinutes === 'number') ctx.intervalMinutes = data.intervalMinutes;
      // No forzar periodo SOFIA si la URL abre directo en CRM/histórico.
      const bootTab = getSalesTabFromUrl();
      if (bootTab !== 'leads' && bootTab !== 'afluencia' && bootTab !== 'financiamiento') {
        applySofiaLivePeriod(ctx, { force: true });
      }
      syncSofiaLiveMode(ctx);
    } catch {
      /* opcional */
    }
  }

  function bindElements() {
    els = {
      fechaInicio: document.getElementById('fechaInicio'),
      fechaFin: document.getElementById('fechaFin'),
      btnConsultar: document.getElementById('btnConsultar'),
      btnExportar: document.getElementById('btnExportar'),
      btnExportarEntregas: document.getElementById('btnExportarEntregas'),
      statusBadge: document.getElementById('statusBadge'),
      lastUpdated: document.getElementById('lastUpdated'),
      topBarSummary: document.getElementById('topBarSummary'),
      kpiTotal: document.getElementById('kpiTotal'),
      kpiRetail: document.getElementById('kpiRetail'),
      kpiFlotillas: document.getElementById('kpiFlotillas'),
      kpiCardRetail: document.getElementById('kpiCardRetail'),
      kpiCardFlotillas: document.getElementById('kpiCardFlotillas'),
      sectionTomasACuenta: document.getElementById('sectionTomasACuenta'),
      tomasSectionSubtitle: document.getElementById('tomasSectionSubtitle'),
      tomasChartSubtitle: document.getElementById('tomasChartSubtitle'),
      tomasInfoSubtitle: document.getElementById('tomasInfoSubtitle'),
      tomasQuarterChips: document.getElementById('tomasQuarterChips'),
      tomasStatTomados: document.getElementById('tomasStatTomados'),
      tomasStatVendidos: document.getElementById('tomasStatVendidos'),
      tomasStatPct: document.getElementById('tomasStatPct'),
      tomasSectionBody: document.getElementById('tomasSectionBody'),
      btnTomasDetalle: document.getElementById('btnTomasDetalle'),
      chartTomasMensual: document.getElementById('chartTomasMensual'),
      panelVentasDetalle: document.getElementById('panelVentasDetalle'),
      ventasPanelTitulo: document.getElementById('ventasPanelTitulo'),
      ventasPanelResumen: document.getElementById('ventasPanelResumen'),
      tablaVentasPreviewBody: document.getElementById('tablaVentasPreviewBody'),
      buscarVentasPreview: document.getElementById('buscarVentasPreview'),
      ventasPreviewSearchMeta: document.getElementById('ventasPreviewSearchMeta'),
      btnCerrarVentasPanel: document.getElementById('btnCerrarVentasPanel'),
      kpiEntregasSofia: document.getElementById('kpiEntregasSofia'),
      kpiEntregasSofiaSub: document.getElementById('kpiEntregasSofiaSub'),
      kpiCardCobertura: document.getElementById('kpiCardCobertura'),
      kpiCobertura: document.getElementById('kpiCobertura'),
      kpiCardEntregasSofia: document.getElementById('kpiCardEntregasSofia'),
      btnRefreshEntregasSofia: document.getElementById('btnRefreshEntregasSofia'),
      panelEntregasSofia: document.getElementById('panelEntregasSofia'),
      sofiaPanelResumen: document.getElementById('sofiaPanelResumen'),
      tablaEntregasPreviewBody: document.getElementById('tablaEntregasPreviewBody'),
      buscarSofiaPreview: document.getElementById('buscarSofiaPreview'),
      sofiaPreviewSearchMeta: document.getElementById('sofiaPreviewSearchMeta'),
      btnCerrarSofiaPanel: document.getElementById('btnCerrarSofiaPanel'),
      kpiCardCarryOver: document.getElementById('kpiCardCarryOver'),
      kpiCarryOver: document.getElementById('kpiCarryOver'),
      kpiCarryOverSub: document.getElementById('kpiCarryOverSub'),
      panelCarryOver: document.getElementById('panelCarryOver'),
      carryOverPanelResumen: document.getElementById('carryOverPanelResumen'),
      carryOverSimPct: document.getElementById('carryOverSimPct'),
      carryOverSimFormula: document.getElementById('carryOverSimFormula'),
      carryOverSimBreakdown: document.getElementById('carryOverSimBreakdown'),
      tablaCarryOverPreviewBody: document.getElementById('tablaCarryOverPreviewBody'),
      buscarCarryOverPreview: document.getElementById('buscarCarryOverPreview'),
      carryOverPreviewSearchMeta: document.getElementById('carryOverPreviewSearchMeta'),
      btnCerrarCarryOverPanel: document.getElementById('btnCerrarCarryOverPanel'),
      ytdSubtitle: document.getElementById('ytdSubtitle'),
      ytdLabelActual: document.getElementById('ytdLabelActual'),
      ytdLabelAnterior: document.getElementById('ytdLabelAnterior'),
      ytdTotalActual: document.getElementById('ytdTotalActual'),
      ytdTotalAnterior: document.getElementById('ytdTotalAnterior'),
      ytdVariacion: document.getElementById('ytdVariacion'),
      ytdQuarterChips: document.getElementById('ytdQuarterChips'),
      carlineUtilidadBody: document.getElementById('carlineUtilidadBody'),
      carlineUtilidadSubtitle: document.getElementById('carlineUtilidadSubtitle'),
      chartsMensuales: document.getElementById('chartsMensuales'),
      kpisMensuales: document.getElementById('kpisMensuales'),
      kpiPromedioMes: document.getElementById('kpiPromedioMes'),
      kpiMejorMes: document.getElementById('kpiMejorMes'),
      kpiMenorMes: document.getElementById('kpiMenorMes'),
      kpiAcumuladoAnio: document.getElementById('kpiAcumuladoAnio'),
      goalRetailInput: document.getElementById('goalRetailInput'),
      goalSofiaInput: document.getElementById('goalSofiaInput'),
      goalRetailPanel: document.getElementById('goalRetailPanel'),
      goalSofiaPanel: document.getElementById('goalSofiaPanel'),
      goalRetailPct: document.getElementById('goalRetailPct'),
      goalSofiaPct: document.getElementById('goalSofiaPct'),
      goalRetailCounts: document.getElementById('goalRetailCounts'),
      goalSofiaCounts: document.getElementById('goalSofiaCounts'),
      goalRetailProgress: document.getElementById('goalRetailProgress'),
      goalSofiaProgress: document.getElementById('goalSofiaProgress'),
      goalRetailProgressTrack: document.getElementById('goalRetailProgressTrack'),
      goalSofiaProgressTrack: document.getElementById('goalSofiaProgressTrack'),
    };

    const required = ['fechaInicio', 'fechaFin', 'btnConsultar', 'kpiTotal'];
    for (const key of required) {
      if (!els[key]) throw new Error(`Elemento #${key} no encontrado en sales.html`);
    }
  }

  function getSalesTabFromUrl() {
    const hash = String(location.hash || '').replace(/^#/, '').toLowerCase();
    if (hash === 'financiamiento' || hash === 'financiera' || hash === 'fi') return 'financiamiento';
    if (hash === 'leads' || hash === 'lead' || hash === 'oportunidades') return 'leads';
    if (
      hash === 'afluencia'
      || hash === 'afluencia-mtk'
      || hash === 'mtk'
      || hash === 'marketing'
      || hash === 'trafico'
      || hash === 'tráfico'
    ) return 'afluencia';
    if (hash === 'comisiones' || hash === 'comision' || hash === 'comisiones-fi') return 'comisiones';
    const params = new URLSearchParams(location.search);
    const tab = String(params.get('tab') || '').toLowerCase();
    if (tab === 'financiamiento' || tab === 'financiera' || tab === 'fi') return 'financiamiento';
    if (tab === 'leads' || tab === 'lead' || tab === 'oportunidades') return 'leads';
    if (tab === 'afluencia' || tab === 'trafico' || tab === 'tráfico' || tab === 'mtk' || tab === 'marketing') return 'afluencia';
    if (tab === 'comisiones' || tab === 'comision') return 'comisiones';
    return 'ventas';
  }

  function prefetchSalesTabs(fechaInicio, fechaFin, fiCtx = null) {
    if (!fechaInicio || !fechaFin) return;
    const run = () => {
      const tasks = [];
      if (activeSalesTab !== 'leads' && window.LeadsVentas?.load && !window.LeadsVentas.hasCache?.(fechaInicio, fechaFin)) {
        tasks.push(window.LeadsVentas.load(fechaInicio, fechaFin));
      }
      if (activeSalesTab !== 'afluencia' && window.AfluenciaVentas?.load && !window.AfluenciaVentas.hasCache?.(fechaInicio, fechaFin)) {
        tasks.push(window.AfluenciaVentas.load(fechaInicio, fechaFin));
      }
      if (
        activeSalesTab !== 'financiamiento'
        && window.FinanciamientoVentas?.load
        && fiCtx
        && !window.FinanciamientoVentas.hasCache?.(fechaInicio, fechaFin)
      ) {
        tasks.push(window.FinanciamientoVentas.load(
          fechaInicio,
          fechaFin,
          fiCtx.porTipoVentaRetail,
          fiCtx.registrosVentas,
          fiCtx.entregasSofia,
          { force: true },
        ));
      }
      if (activeSalesTab !== 'comisiones' && window.ComisionesVentas?.load && !window.ComisionesVentas.hasCache?.(fechaInicio, fechaFin)) {
        tasks.push(window.ComisionesVentas.load(fechaInicio, fechaFin));
      }
      Promise.allSettled(tasks).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 120);
    }
  }

  async function ensureActiveTabData(tab) {
    const fi = els.fechaInicio?.value;
    const ff = els.fechaFin?.value;
    if (!fi || !ff) return;

    if (tab === 'financiamiento') {
      if (!window.FinanciamientoVentas?.load) return;
      const p = pendingFinanciamiento;
      const samePeriod = Boolean(p && p.fechaInicio === fi && p.fechaFin === ff);
      const regs = samePeriod ? (p.registrosVentas || []) : [];
      const sofia = samePeriod ? (p.entregasSofia || []) : [];
      if (samePeriod && sofia.length > 0 && window.FinanciamientoVentas.hasCache?.(fi, ff)) {
        await window.FinanciamientoVentas.load(fi, ff, p.porTipoVentaRetail, regs, sofia);
        return;
      }
      void window.FinanciamientoVentas.load(
        fi, ff,
        samePeriod ? p.porTipoVentaRetail : null,
        regs,
        sofia,
        { force: true },
      );
      return;
    }

    if (tab === 'leads' && window.LeadsVentas?.load) {
      pendingLeads = { fechaInicio: fi, fechaFin: ff };
      if (window.LeadsVentas.hasCache?.(fi, ff)) {
        await window.LeadsVentas.load(fi, ff);
        return;
      }
      void window.LeadsVentas.load(fi, ff);
      return;
    }

    if (tab === 'afluencia' && window.AfluenciaVentas?.load) {
      pendingAfluencia = { fechaInicio: fi, fechaFin: ff };
      if (window.AfluenciaVentas.hasCache?.(fi, ff)) {
        await window.AfluenciaVentas.load(fi, ff);
        return;
      }
      void window.AfluenciaVentas.load(fi, ff);
      return;
    }

    if (tab === 'comisiones' && window.ComisionesVentas?.load) {
      if (window.ComisionesVentas.hasCache?.(fi, ff)) {
        await window.ComisionesVentas.load(fi, ff);
        return;
      }
      void window.ComisionesVentas.load(fi, ff);
    }
  }

  async function switchSalesTab(tab) {
    const next = ['financiamiento', 'leads', 'afluencia', 'comisiones'].includes(tab) ? tab : 'ventas';
    activeSalesTab = next;
    if (next !== 'ventas') {
      ventasDrawerUi?.close?.();
    }

    document.querySelectorAll('#salesMainTabs [data-sales-tab]').forEach((btn) => {
      const on = btn.dataset.salesTab === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const panelVentas = document.getElementById('panelVentasUnidades');
    const panelFi = document.getElementById('panelVentasFinanciamiento');
    const panelLd = document.getElementById('panelVentasLeads');
    const panelAf = document.getElementById('panelVentasAfluencia');
    const panelCom = document.getElementById('panelVentasComisiones');
    if (panelVentas) {
      panelVentas.classList.toggle('hidden', next !== 'ventas');
      panelVentas.hidden = next !== 'ventas';
    }
    if (panelFi) {
      panelFi.classList.toggle('hidden', next !== 'financiamiento');
      panelFi.hidden = next !== 'financiamiento';
    }
    if (panelLd) {
      panelLd.classList.toggle('hidden', next !== 'leads');
      panelLd.hidden = next !== 'leads';
    }
    if (panelAf) {
      panelAf.classList.toggle('hidden', next !== 'afluencia');
      panelAf.hidden = next !== 'afluencia';
    }
    if (panelCom) {
      panelCom.classList.toggle('hidden', next !== 'comisiones');
      panelCom.hidden = next !== 'comisiones';
    }

    const title = document.querySelector('.top-bar-title');
    if (title) {
      title.textContent = next === 'financiamiento'
        ? 'Financiamiento'
        : (next === 'leads'
          ? 'Leads'
          : (next === 'afluencia'
            ? 'Afluencia'
            : (next === 'comisiones' ? 'Comisiones' : 'Ventas de Unidades')));
    }

    if (next === 'financiamiento') {
      if (location.hash !== '#financiamiento') {
        history.replaceState(null, '', `${location.pathname}${location.search}#financiamiento`);
      }
    } else if (next === 'leads') {
      if (location.hash !== '#leads') {
        history.replaceState(null, '', `${location.pathname}${location.search}#leads`);
      }
    } else if (next === 'afluencia') {
      const hash = String(location.hash || '').toLowerCase();
      const wantsMtk = hash === '#afluencia-mtk' || hash === '#mtk' || hash === '#marketing';
      if (!hash.startsWith('#afluencia') && hash !== '#mtk' && hash !== '#marketing' && hash !== '#trafico' && hash !== '#tráfico') {
        history.replaceState(null, '', `${location.pathname}${location.search}#afluencia`);
      }
      window.AfluenciaVentas?.setInnerTab?.(wantsMtk ? 'mtk' : 'general');
    } else if (next === 'comisiones') {
      if (location.hash !== '#comisiones') {
        history.replaceState(null, '', `${location.pathname}${location.search}#comisiones`);
      }
    } else if (
      location.hash === '#financiamiento' || location.hash === '#financiera' || location.hash === '#fi'
      || location.hash === '#leads' || location.hash === '#lead' || location.hash === '#oportunidades'
      || location.hash === '#afluencia' || location.hash === '#afluencia-mtk' || location.hash === '#mtk'
      || location.hash === '#marketing' || location.hash === '#trafico' || location.hash === '#tráfico'
      || location.hash === '#comisiones' || location.hash === '#comision'
    ) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }

    // Cambio de panel inmediato; datos en cache = instantáneo, si no se cargan en background.
    await ensureActiveTabData(next);
  }

  function bindEvents() {
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => { applyPreset(btn.dataset.preset); consultar(); });
    });

    document.getElementById('salesMainTabs')?.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-sales-tab]');
      if (!tab) return;
      switchSalesTab(tab.dataset.salesTab).catch((err) => console.warn('[Sales tabs]', err));
    });

    els.ytdQuarterChips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ytd-quarter]');
      if (!btn) return;
      toggleYtdQuarter(btn.dataset.ytdQuarter);
    });

    els.tomasQuarterChips?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tomas-quarter]');
      if (!btn || btn.disabled) return;
      toggleTomasQuarter(btn.dataset.tomasQuarter);
    });

    els.btnConsultar.addEventListener('click', () => consultar({ quiet: false }));
    document.getElementById('btnRefreshEntregasSofia')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      consultar({ quiet: true, fresh: true }).catch((err) => {
        console.error('[SOFIA refresh]', err);
      });
    });
    els.btnExportar.addEventListener('click', () => downloadCsv(
      ['Fecha', 'Documento', 'Vendedor', 'Cliente', 'Serie', 'Modelo', 'Anio', 'Color', 'Departamento', 'TipoVenta', 'FormaPago'],
      ['VTE_FECHDOCTO', 'VTE_DOCTO', 'VENDEDOR', 'CLIENTE', 'VTE_SERIE', 'VEH_TIPOAUTO', 'VEH_ANMODELO', 'COL_DESCRIPCION', 'CANAL_LABEL', 'TIPOVENTA', 'FORMAPAGO_ORIGINAL'],
      getVentasExportRows(),
      `ventas_${els.fechaInicio.value}_${els.fechaFin.value}.csv`
    ));
    els.btnExportarEntregas.addEventListener('click', () => downloadCsv(
      ['FechaFactura', 'FechaRegistro', 'Hora', 'Factura', 'VIN', 'Previas', 'Pedido', 'NoTransaccion', 'Cliente', 'Estatus', 'Usuario'],
      ['FECHA_PERIODO', 'SOF_FechAct', 'SOF_HoraAct', 'SOF_Factura', 'SOF_VIN', 'PREVIAS', 'SOF_Pedido', 'SOF_NoTransaccion', 'CLIENTE', 'SOF_Estatus', 'SOF_CveUSu'],
      getSofiaExportRows(),
      `entregas_sofia_${els.fechaInicio.value}_${els.fechaFin.value}.csv`
    ));
    els.buscarVentasPreview?.addEventListener('input', () => applyVentasPreviewSearch());
    els.buscarSofiaPreview?.addEventListener('input', () => applySofiaPreviewSearch());
    els.buscarCarryOverPreview?.addEventListener('input', () => applyCarryOverPreviewSearch());

    bindKpiCard(els.kpiCardRetail, () => setVentasPanelOpen('retail', true));
    bindKpiCard(els.kpiCardFlotillas, () => setVentasPanelOpen('flotilla', true));
    els.btnTomasDetalle?.addEventListener('click', () => toggleTomasACuentaPanel());
    els.tomasSectionBody?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-toma-key]');
      if (!row) return;
      const record = (tomasACuentaActuales || []).find((r) => tomaRecordKey(r) === row.dataset.tomaKey);
      if (record) openTomaDetail(record);
      else toggleTomasACuentaPanel();
    });
    bindKpiCard(els.kpiCardEntregasSofia, toggleSofiaPanel);
    bindKpiCard(els.kpiCardCarryOver, toggleCarryOverPanel);

    els.goalRetailInput?.addEventListener('input', () => onGoalInputChange('retail'));
    els.goalRetailInput?.addEventListener('change', () => onGoalInputChange('retail'));
    els.goalSofiaInput?.addEventListener('input', () => onGoalInputChange('sofia'));
    els.goalSofiaInput?.addEventListener('change', () => onGoalInputChange('sofia'));

    document.querySelectorAll('[data-goal-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.goalStep;
        const dir = parseInt(btn.dataset.dir, 10);
        if (which === 'retail' || which === 'sofia') adjustGoal(which, dir);
      });
    });

    ['fechaInicio', 'fechaFin'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        document.querySelectorAll('[data-preset]').forEach((b) => {
          b.classList.remove('active', 'chip--active');
        });
        const lbl = document.getElementById('filterPresetLabel');
        if (lbl) lbl.textContent = 'Personalizado';
        Dashboard.updateCompactFilterLabels();
      });
    });
  }

  async function boot() {
    try {
      if (typeof Dashboard === 'undefined') throw new Error('shared.js no cargó correctamente');
      if (typeof CanalesVenta === 'undefined') throw new Error('canales.js no cargó correctamente');
      if (typeof Chart === 'undefined') throw new Error('Chart.js no cargó correctamente');

      chartOptions = Dashboard.chartOptions;
      chartPalette = Dashboard.chartPalette;
      chartColors = Dashboard.chartColors;
      CANAL_COLORS = {
        Piso: chartColors.primary,
        Foraneos: chartColors.violet,
        Cholula: chartColors.secondary,
        Zacatelco: chartColors.rose,
        Suauto: chartColors.tertiary,
        Casa: chartColors.teal,
        'Seminuevos Nuevos': '#7c3aed',
        Flotillas: chartColors.tertiary,
        Perdida: chartColors.error,
        Otros: chartColors.slate,
      };

      bindElements();
      bindEvents();
      await resolveGoalEditPermission();
      window.FinanciamientoVentas?.init?.();
      window.LeadsVentas?.init?.();
      window.AfluenciaVentas?.init?.();
      window.ComisionesVentas?.init?.();
      compactFilters = Dashboard.initCompactFilters();
      setDefaultDates();
      Dashboard.setActivePresetChip('mes-actual');
      await ensureSofiaLiveOnBoot();
      await switchSalesTab(getSalesTabFromUrl());
      await consultar();
      window.__salesPageInit = true;
      window.__salesPageInitBuild = SALES_JS_BUILD;
    } catch (err) {
      console.error('[Sales init]', err);
      const badge = document.getElementById('statusBadge');
      if (badge) {
        badge.textContent = err.message;
        badge.className = 'sidebar-status-line status-error';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

