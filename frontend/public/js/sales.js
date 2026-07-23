(function () {
  'use strict';

  if (window.__salesPageInit) return;

  let registrosActuales = [];
  let entregasActuales = [];
  let apartadasActuales = [];
  let activeVentasKpiType = null;
  let lastYtd = null;
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

  async function ensureApartadasInResumen() {
    if (!resumenActual) return;
    try {
      const inv = await Dashboard.api('/inventory?planPisoPeriod=all');
      const units = Array.isArray(inv?.inventoryTable)
        ? inv.inventoryTable
        : (Array.isArray(inv?.units) ? inv.units : []);
      apartadasActuales = units.filter((u) => u.isApartada || u.situacion === 'SEP');
      const apartadas = Number(inv?.summary?.availableApartadas ?? apartadasActuales.length ?? 0);
      resumenActual.unidadesApartadas = apartadas;
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

    if (!els.panelCarryOver?.classList.contains('hidden')) {
      renderCarryOverSimPanel();
      updateCarryOverPanelResumen(apartadasActuales.length);
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
    els.panelCarryOver?.classList.add('hidden');
    els.kpiCardCarryOver?.classList.remove('is-selected', 'is-open');
    els.kpiCardCarryOver?.setAttribute('aria-expanded', 'false');
    clearCarryOverPreviewSearch();
  }

  function setCarryOverPanelOpen(open) {
    if (!els.panelCarryOver || !els.kpiCardCarryOver) return;
    const isOpen = Boolean(open);
    if (isOpen) {
      closeVentasPanel();
      els.panelEntregasSofia?.classList.add('hidden');
      els.kpiCardEntregasSofia?.classList.remove('is-selected');
      els.kpiCardEntregasSofia?.setAttribute('aria-expanded', 'false');
      clearSofiaPreviewSearch();
    }
    if (!isOpen) {
      closeCarryOverPanelUi();
      return;
    }

    const wasOpen = !els.panelCarryOver.classList.contains('hidden');
    if (wasOpen) {
      closeCarryOverPanelUi();
      return;
    }

    els.panelCarryOver.classList.remove('hidden');
    els.kpiCardCarryOver.classList.add('is-selected', 'is-open');
    els.kpiCardCarryOver.setAttribute('aria-expanded', 'true');
    clearCarryOverPreviewSearch();
    renderCarryOverSimPanel();
    renderCarryOverPreview(apartadasActuales);
    updateCarryOverPanelResumen(apartadasActuales.length);
    els.panelCarryOver.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => els.buscarCarryOverPreview?.focus({ preventScroll: true }), 180);
  }

  function toggleCarryOverPanel() {
    const isOpen = !els.panelCarryOver?.classList.contains('hidden');
    setCarryOverPanelOpen(!isOpen);
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

  function renderYtdChart(comparativoYtd) {
    if (!comparativoYtd) return;
    lastYtd = comparativoYtd;
    const { anioActual, anioAnterior, corte, totalActual, totalAnterior, variacion, labels, series, mesEnCursoExcluido } = comparativoYtd;

    els.ytdLabelActual.textContent = `YTD ${anioActual}`;
    els.ytdLabelAnterior.textContent = `YTD ${anioAnterior}`;
    els.ytdTotalActual.textContent = totalActual;
    els.ytdTotalAnterior.textContent = totalAnterior;
    const corteFmt = corte.split('-').reverse().join('/');
    els.ytdSubtitle.textContent = mesEnCursoExcluido
      ? `Acumulado del 1 ene al ${corteFmt} · mes en curso excluido hasta cierre`
      : `Acumulado del 1 ene al ${corteFmt} · comparación año contra año`;

    if (variacion === null) {
      els.ytdVariacion.textContent = '-';
      els.ytdVariacion.className = 'ytd-stat-value';
    } else {
      els.ytdVariacion.textContent = `${variacion >= 0 ? '+' : ''}${variacion}%`;
      els.ytdVariacion.className = `ytd-stat-value ${variacion >= 0 ? 'ytd-up' : 'ytd-down'}`;
    }

    createChart('ytd', 'chartYtd', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: `YTD ${anioAnterior}`, data: series.anterior, backgroundColor: chartColors.slate },
          { label: `YTD ${anioActual}`, data: series.actual, backgroundColor: chartColors.primary },
        ],
      },
      options: chartOptions(),
    });
  }

  function renderCharts(resumen) {
    const esAcumulado = resumen.mostrarComparativoMensual && resumen.comparativoMensual;
    toggleVistaMensual(Boolean(esAcumulado));
    if (esAcumulado) renderChartsMensuales(resumen.comparativoMensual, resumen);

    destroyChart('departamento', 'chartDepartamento');
    const porCanal = resumen.porCanal?.length ? resumen.porCanal : CanalesVenta.countByCanal(registrosActuales);
    if (porCanal.length) {
      createChart('departamento', 'chartDepartamento', {
        type: 'bar',
        data: {
          labels: porCanal.map((x) => x.label),
          datasets: [{ label: 'Ventas', data: porCanal.map((x) => x.count), backgroundColor: porCanal.map((x) => CANAL_COLORS[x.label] || chartColors.slate) }],
        },
        options: chartOptions({ plugins: { legend: { display: false } } }),
      });
    }

    const topVendedores = (resumen.porVendedorRetail || []).slice(0, 10);
    createChart('vendedor', 'chartVendedor', {
      type: 'bar',
      data: {
        labels: topVendedores.map((x) => x.label.split(' ').slice(0, 2).join(' ')),
        datasets: [{ label: 'Ventas retail', data: topVendedores.map((x) => x.count), backgroundColor: chartColors.primary }],
      },
      options: chartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });
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

  function clearVentasPreviewSearch() {
    if (els.buscarVentasPreview) els.buscarVentasPreview.value = '';
    els.ventasPreviewSearchMeta?.classList.add('hidden');
  }

  function applyVentasPreviewSearch() {
    if (!activeVentasKpiType) return;
    const base = getVentasRowsByType(activeVentasKpiType);
    const term = els.buscarVentasPreview?.value || '';
    const filtered = filterVentasRowsByTerm(term, base);
    renderVentasPreview(filtered);
    updateVentasPanelResumen(activeVentasKpiType, base.length, term.trim() ? filtered.length : undefined);
  }

  function closeVentasPanel() {
    activeVentasKpiType = null;
    els.panelVentasDetalle?.classList.add('hidden');
    els.kpiCardRetail?.classList.remove('is-selected');
    els.kpiCardFlotillas?.classList.remove('is-selected');
    els.kpiCardRetail?.setAttribute('aria-expanded', 'false');
    els.kpiCardFlotillas?.setAttribute('aria-expanded', 'false');
    clearVentasPreviewSearch();
  }

  function setVentasPanelOpen(type, open) {
    if (!els.panelVentasDetalle) return;
    if (!open) {
      closeVentasPanel();
      return;
    }

    setSofiaPanelOpen(false);
    closeCarryOverPanelUi();
    const isSame = activeVentasKpiType === type && !els.panelVentasDetalle.classList.contains('hidden');
    if (isSame) {
      closeVentasPanel();
      return;
    }

    activeVentasKpiType = type;
    const rows = getVentasRowsByType(type);
    const isFlotilla = type === 'flotilla';

    els.panelVentasDetalle.classList.remove('hidden');
    els.panelVentasDetalle.classList.toggle('kpi-detail-panel--flotilla', isFlotilla);
    els.panelVentasDetalle.classList.toggle('kpi-detail-panel--retail', !isFlotilla);
    els.kpiCardRetail?.classList.toggle('is-selected', !isFlotilla);
    els.kpiCardFlotillas?.classList.toggle('is-selected', isFlotilla);
    els.kpiCardRetail?.setAttribute('aria-expanded', !isFlotilla ? 'true' : 'false');
    els.kpiCardFlotillas?.setAttribute('aria-expanded', isFlotilla ? 'true' : 'false');

    if (els.ventasPanelTitulo) {
      els.ventasPanelTitulo.textContent = isFlotilla ? 'Detalle flotillas' : 'Detalle ventas retail';
    }

    clearVentasPreviewSearch();
    renderVentasPreview(rows);
    updateVentasPanelResumen(type, rows.length);
    els.panelVentasDetalle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => els.buscarVentasPreview?.focus({ preventScroll: true }), 180);
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
    if (!els.panelEntregasSofia || !els.kpiCardEntregasSofia) return;
    const isOpen = Boolean(open);
    if (isOpen) {
      closeVentasPanel();
      closeCarryOverPanelUi();
    }
    if (!isOpen) {
      els.panelEntregasSofia.classList.add('hidden');
      els.kpiCardEntregasSofia.classList.remove('is-selected');
      els.kpiCardEntregasSofia.setAttribute('aria-expanded', 'false');
      clearSofiaPreviewSearch();
      return;
    }

    const wasOpen = !els.panelEntregasSofia.classList.contains('hidden');
    if (wasOpen) {
      els.panelEntregasSofia.classList.add('hidden');
      els.kpiCardEntregasSofia.classList.remove('is-selected');
      els.kpiCardEntregasSofia.setAttribute('aria-expanded', 'false');
      clearSofiaPreviewSearch();
      return;
    }

    els.panelEntregasSofia.classList.remove('hidden');
    els.kpiCardEntregasSofia.classList.add('is-selected');
    els.kpiCardEntregasSofia.setAttribute('aria-expanded', 'true');
    clearSofiaPreviewSearch();
    renderEntregasPreview(entregasActuales);
    updateSofiaPanelResumen(entregasActuales.length);
    els.panelEntregasSofia.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => els.buscarSofiaPreview?.focus({ preventScroll: true }), 180);
  }

  function toggleSofiaPanel() {
    const isOpen = !els.panelEntregasSofia?.classList.contains('hidden');
    setSofiaPanelOpen(!isOpen);
  }

  function getVentasExportRows() {
    if (!els.panelVentasDetalle?.classList.contains('hidden') && activeVentasKpiType) {
      const base = getVentasRowsByType(activeVentasKpiType);
      return filterVentasRowsByTerm(els.buscarVentasPreview?.value || '', base);
    }
    return registrosActuales;
  }

  function getSofiaExportRows() {
    if (!els.panelEntregasSofia?.classList.contains('hidden')) {
      return filterEntregasRowsByTerm(els.buscarSofiaPreview?.value || '', entregasActuales);
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
      if (activeVentasKpiType) {
        applyVentasPreviewSearch();
      }
      if (!els.panelEntregasSofia?.classList.contains('hidden')) {
        applySofiaPreviewSearch();
      }
      if (!els.panelCarryOver?.classList.contains('hidden')) {
        applyCarryOverPreviewSearch();
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
    } catch (err) {
      console.error('[Sales]', err);
      setStatus(err.message, 'error');
    } finally {
      els.btnConsultar.disabled = false;
      Dashboard.showLoading(false);
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
    const params = new URLSearchParams(location.search);
    const tab = String(params.get('tab') || '').toLowerCase();
    if (tab === 'financiamiento' || tab === 'financiera' || tab === 'fi') return 'financiamiento';
    return 'ventas';
  }

  async function switchSalesTab(tab) {
    const next = tab === 'financiamiento' ? 'financiamiento' : 'ventas';
    activeSalesTab = next;

    document.querySelectorAll('#salesMainTabs [data-sales-tab]').forEach((btn) => {
      const on = btn.dataset.salesTab === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const panelVentas = document.getElementById('panelVentasUnidades');
    const panelFi = document.getElementById('panelVentasFinanciamiento');
    if (panelVentas) {
      panelVentas.classList.toggle('hidden', next !== 'ventas');
      panelVentas.hidden = next !== 'ventas';
    }
    if (panelFi) {
      panelFi.classList.toggle('hidden', next !== 'financiamiento');
      panelFi.hidden = next !== 'financiamiento';
    }

    const title = document.querySelector('.top-bar-title');
    if (title) {
      title.textContent = next === 'financiamiento' ? 'Financiamiento' : 'Ventas de Unidades';
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
    } else if (location.hash === '#financiamiento' || location.hash === '#financiera' || location.hash === '#fi') {
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
    els.btnCerrarVentasPanel?.addEventListener('click', () => closeVentasPanel());

    bindKpiCard(els.kpiCardEntregasSofia, toggleSofiaPanel);
    els.btnCerrarSofiaPanel?.addEventListener('click', () => setSofiaPanelOpen(false));

    bindKpiCard(els.kpiCardCarryOver, toggleCarryOverPanel);
    els.btnCerrarCarryOverPanel?.addEventListener('click', () => setCarryOverPanelOpen(false));

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
      compactFilters = Dashboard.initCompactFilters();
      setDefaultDates();
      Dashboard.setActivePresetChip('mes-actual');
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
