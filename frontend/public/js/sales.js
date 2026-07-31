(function () {
  'use strict';

  if (window.__salesPageInit) return;

  let registrosActuales = [];
  let entregasActuales = [];
  let apartadasActuales = [];
  let activeVentasKpiType = null;
  let activeVentasDrawerKpi = null;
  let ventasDrawerUi = null;
  let lastYtd = null;
  let ytdQuarters = new Set([1, 2, 3, 4]);
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

    const needsMigrate = data.retail == null && data.sofia == null;
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
    if (retailLabel) {
      retailLabel.textContent = month && data.retailSource === 'historic'
        ? `Objetivo del periodo · histórico ${month}`
        : 'Objetivo del periodo';
    }
    if (sofiaLabel) {
      sofiaLabel.textContent = month && data.sofiaSource === 'historic'
        ? `Objetivo del periodo · histórico ${month}`
        : 'Objetivo del periodo';
    }
  }

  async function persistSharedGoals() {
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

  function createChart(name, canvasId, config) {
    destroyChart(name, canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    charts[name] = new Chart(canvas, config);
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
        ? `${String(fi).slice(0, 10).split('-').reverse().join('/')} → ${String(ff).slice(0, 10).split('-').reverse().join('/')}`
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
    const porCanal = resumen.porCanal?.length
      ? resumen.porCanal
      : (typeof CanalesVenta !== 'undefined' ? CanalesVenta.countByCanal(registrosActuales) : []);
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

  function isFlotillaRow(row) {
    return row.TIPOVENTA === 'FLOTILLA';
  }

  function getRetailRows() {
    return registrosActuales.filter((row) => !isFlotillaRow(row));
  }

  function getFlotillaRows() {
    return registrosActuales.filter((row) => isFlotillaRow(row));
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
        hint: 'Entregas reportadas en SOFIA en el periodo',
        icon: 'notifications_active',
        card: () => els.kpiCardEntregasSofia,
      },
      carryOver: {
        title: 'Carry over para facturar',
        hint: 'Apartadas SEP + simulación de cobertura',
        icon: 'pending_actions',
        card: () => els.kpiCardCarryOver,
      },
    };
    return map[key] || { title: key, hint: '', icon: 'analytics', card: () => null };
  }

  function rowsForVentasDrawer(key) {
    if (key === 'retail') return getRetailRows();
    if (key === 'flotilla') return getFlotillaRows();
    if (key === 'sofia') return entregasActuales;
    if (key === 'carryOver') return apartadasActuales;
    return [];
  }

  function clearVentasKpiSelection() {
    [els.kpiCardRetail, els.kpiCardFlotillas, els.kpiCardEntregasSofia, els.kpiCardCarryOver]
      .forEach((card) => {
        card?.classList.remove('is-selected', 'is-open');
        card?.setAttribute('aria-expanded', 'false');
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
      quien: 'Apartó',
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
                <span>${escapeHtml(r.FECHA_PERIODO ?? r.SOF_FechFact ?? '—')}</span>
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

    function open(kpiKey, card) {
      const meta = ventasKpiMeta(kpiKey);
      const resolvedCard = card || meta.card?.() || null;
      if (activeVentasDrawerKpi === kpiKey && panel.classList.contains('ops-orders-drawer--open')) {
        close();
        return;
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
            : 'Buscar vendedor, cliente, serie, modelo...';
        searchEl.value = '';
      }

      sourceRows = rowsForVentasDrawer(kpiKey).slice();
      activeFilter = null;
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
          ['FechaFactura', 'FechaRegistro', 'Hora', 'Factura', 'VIN', 'Previas', 'Pedido', 'NoTransaccion', 'Cliente', 'Estatus', 'Usuario'],
          ['FECHA_PERIODO', 'SOF_FechAct', 'SOF_HoraAct', 'SOF_Factura', 'SOF_VIN', 'PREVIAS', 'SOF_Pedido', 'SOF_NoTransaccion', 'CLIENTE', 'SOF_Estatus', 'SOF_CveUSu'],
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
      <td>${row.FECHA_PERIODO ?? row.SOF_FechFact ?? ''}</td><td>${row.SOF_FechAct ?? ''}</td><td>${row.SOF_HoraAct ?? ''}</td>
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
      ? `${n} notificación${n === 1 ? '' : 'es'} en el periodo seleccionado`
      : 'No hay notificaciones de entrega en el periodo seleccionado.';
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
      [row.FECHA_PERIODO, row.SOF_FechAct, row.SOF_HoraAct, row.SOF_Factura, row.SOF_VIN, row.PREVIAS, row.SOF_Pedido, row.SOF_NoTransaccion, row.CLIENTE, row.SOF_Estatus, row.SOF_CveUSu]
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

  async function consultar() {
    const fechaInicio = els.fechaInicio.value;
    const fechaFin = els.fechaFin.value;
    if (!fechaInicio || !fechaFin) { setStatus('Seleccione ambas fechas', 'error'); return; }

    setStatus('Consultando...', 'loading');
    els.btnConsultar.disabled = true;
    Dashboard.showLoading(true);

    try {
      const response = await fetch(`/api/ventas?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`, { credentials: 'same-origin' });
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

      registrosActuales = data.registros.map((row) => CanalesVenta.enrichRegistro(row));
      entregasActuales = data.entregasSofia ?? [];
      const { resumen } = data;

      if (!resumen.porCanal?.length) resumen.porCanal = CanalesVenta.countByCanal(registrosActuales);

      resumenActual = resumen;
      els.kpiTotal.textContent = resumen.totalVentas;
      els.kpiRetail.textContent = resumen.totalRetail;
      els.kpiFlotillas.textContent = resumen.totalFlotillas;
      els.kpiEntregasSofia.textContent = resumen.totalNotificacionesEntrega ?? 0;

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
      setStatus(`${resumen.totalVentas} ventas · ${resumen.totalNotificacionesEntrega ?? 0} entregas SOFIA${modo}`);
      Dashboard.updateCompactFilterLabels();
      compactFilters?.closeAll?.();

      if (window.KpiInsights?.apply) {
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
        });
      }

      if (window.FinanciamientoVentas?.load) {
        pendingFinanciamiento = {
          fechaInicio,
          fechaFin,
          porTipoVentaRetail: resumen.porTipoVentaRetail,
          registrosVentas: registrosActuales,
          entregasSofia: entregasActuales,
        };
        if (activeSalesTab === 'financiamiento') {
          await window.FinanciamientoVentas.load(
            fechaInicio,
            fechaFin,
            resumen.porTipoVentaRetail,
            registrosActuales,
            entregasActuales,
          );
        }
      }

      if (window.LeadsVentas?.load) {
        pendingLeads = { fechaInicio, fechaFin };
        if (activeSalesTab === 'leads') {
          await window.LeadsVentas.load(fechaInicio, fechaFin);
        }
      }

      if (window.AfluenciaVentas?.load) {
        pendingAfluencia = { fechaInicio, fechaFin };
        if (activeSalesTab === 'afluencia') {
          await window.AfluenciaVentas.load(fechaInicio, fechaFin);
        }
      }

      syncSofiaLiveMode(data.sofiaLiveUpdate);
    } catch (err) {
      console.error('[Sales]', err);
      setStatus(err.message, 'error');
    } finally {
      els.btnConsultar.disabled = false;
      Dashboard.showLoading(false);
    }
  }

  function stopSofiaLivePolling() {
    if (sofiaLiveTimer) {
      clearInterval(sofiaLiveTimer);
      sofiaLiveTimer = null;
    }
    sofiaLiveActive = false;
  }

  function applySofiaLivePeriod(ctx) {
    if (!ctx?.active || !ctx.fechaInicio || !ctx.fechaFin || !els?.fechaInicio) return;
    const changed = els.fechaInicio.value !== ctx.fechaInicio || els.fechaFin.value !== ctx.fechaFin;
    if (!changed) return false;
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
    applySofiaLivePeriod(ctx);
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
      consultar().catch(() => {});
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
      applySofiaLivePeriod(ctx);
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
      panelVentasDetalle: document.getElementById('panelVentasDetalle'),
      ventasPanelTitulo: document.getElementById('ventasPanelTitulo'),
      ventasPanelResumen: document.getElementById('ventasPanelResumen'),
      tablaVentasPreviewBody: document.getElementById('tablaVentasPreviewBody'),
      buscarVentasPreview: document.getElementById('buscarVentasPreview'),
      ventasPreviewSearchMeta: document.getElementById('ventasPreviewSearchMeta'),
      btnCerrarVentasPanel: document.getElementById('btnCerrarVentasPanel'),
      kpiEntregasSofia: document.getElementById('kpiEntregasSofia'),
      kpiCardCobertura: document.getElementById('kpiCardCobertura'),
      kpiCobertura: document.getElementById('kpiCobertura'),
      kpiCardEntregasSofia: document.getElementById('kpiCardEntregasSofia'),
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
    const params = new URLSearchParams(location.search);
    const tab = String(params.get('tab') || '').toLowerCase();
    if (tab === 'financiamiento' || tab === 'financiera' || tab === 'fi') return 'financiamiento';
    if (tab === 'leads' || tab === 'lead' || tab === 'oportunidades') return 'leads';
    if (tab === 'afluencia' || tab === 'trafico' || tab === 'tráfico' || tab === 'mtk' || tab === 'marketing') return 'afluencia';
    return 'ventas';
  }

  async function switchSalesTab(tab) {
    const next = ['financiamiento', 'leads', 'afluencia'].includes(tab) ? tab : 'ventas';
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

    const title = document.querySelector('.top-bar-title');
    if (title) {
      title.textContent = next === 'financiamiento'
        ? 'Financiamiento'
        : (next === 'leads'
          ? 'Leads'
          : (next === 'afluencia' ? 'Afluencia' : 'Ventas de Unidades'));
    }

    if (next === 'financiamiento') {
      if (location.hash !== '#financiamiento') {
        history.replaceState(null, '', `${location.pathname}${location.search}#financiamiento`);
      }
      if (pendingFinanciamiento && window.FinanciamientoVentas?.load) {
        const p = pendingFinanciamiento;
        await window.FinanciamientoVentas.load(
          p.fechaInicio,
          p.fechaFin,
          p.porTipoVentaRetail,
          p.registrosVentas,
          p.entregasSofia,
        );
      }
    } else if (next === 'leads') {
      if (location.hash !== '#leads') {
        history.replaceState(null, '', `${location.pathname}${location.search}#leads`);
      }
      if (pendingLeads && window.LeadsVentas?.load) {
        await window.LeadsVentas.load(pendingLeads.fechaInicio, pendingLeads.fechaFin);
      } else if (els.fechaInicio?.value && els.fechaFin?.value && window.LeadsVentas?.load) {
        pendingLeads = { fechaInicio: els.fechaInicio.value, fechaFin: els.fechaFin.value };
        await window.LeadsVentas.load(pendingLeads.fechaInicio, pendingLeads.fechaFin);
      }
    } else if (next === 'afluencia') {
      const hash = String(location.hash || '').toLowerCase();
      const wantsMtk = hash === '#afluencia-mtk' || hash === '#mtk' || hash === '#marketing';
      if (!hash.startsWith('#afluencia') && hash !== '#mtk' && hash !== '#marketing' && hash !== '#trafico' && hash !== '#tráfico') {
        history.replaceState(null, '', `${location.pathname}${location.search}#afluencia`);
      }
      if (pendingAfluencia && window.AfluenciaVentas?.load) {
        await window.AfluenciaVentas.load(pendingAfluencia.fechaInicio, pendingAfluencia.fechaFin);
      } else if (els.fechaInicio?.value && els.fechaFin?.value && window.AfluenciaVentas?.load) {
        pendingAfluencia = { fechaInicio: els.fechaInicio.value, fechaFin: els.fechaFin.value };
        await window.AfluenciaVentas.load(pendingAfluencia.fechaInicio, pendingAfluencia.fechaFin);
      }
      window.AfluenciaVentas?.setInnerTab?.(wantsMtk ? 'mtk' : 'general');
    } else if (
      location.hash === '#financiamiento' || location.hash === '#financiera' || location.hash === '#fi'
      || location.hash === '#leads' || location.hash === '#lead' || location.hash === '#oportunidades'
      || location.hash === '#afluencia' || location.hash === '#afluencia-mtk' || location.hash === '#mtk'
      || location.hash === '#marketing' || location.hash === '#trafico' || location.hash === '#tráfico'
    ) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
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

    els.btnConsultar.addEventListener('click', consultar);
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
        Flotillas: chartColors.tertiary,
        Perdida: chartColors.error,
        Otros: chartColors.slate,
      };

      bindElements();
      bindEvents();
      window.FinanciamientoVentas?.init?.();
      window.LeadsVentas?.init?.();
      window.AfluenciaVentas?.init?.();
      compactFilters = Dashboard.initCompactFilters();
      setDefaultDates();
      Dashboard.setActivePresetChip('mes-actual');
      await ensureSofiaLiveOnBoot();
      await switchSalesTab(getSalesTabFromUrl());
      await consultar();
      window.__salesPageInit = true;
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
