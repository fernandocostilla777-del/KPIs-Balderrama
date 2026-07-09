(function () {
  'use strict';

  let allRecords = [];
  let openSnapshot = [];
  const charts = {};

  const FILTER_IDS = {
    status: 'fStatus',
    asesor: 'fAsesor',
    tipo: 'fTipo',
    antiguedad: 'fAntiguedad',
    importeMin: 'fImporteMin',
    importeMax: 'fImporteMax',
    soloCriticas: 'fCriticas',
    promesaVencida: 'fPromesa',
    buscar: 'buscarOrdenes',
  };

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function getFilters() {
    return {
      status: document.getElementById(FILTER_IDS.status)?.value || '',
      asesor: document.getElementById(FILTER_IDS.asesor)?.value || '',
      tipo: document.getElementById(FILTER_IDS.tipo)?.value || '',
      antiguedad: document.getElementById(FILTER_IDS.antiguedad)?.value || '',
      importeMin: document.getElementById(FILTER_IDS.importeMin)?.value || '',
      importeMax: document.getElementById(FILTER_IDS.importeMax)?.value || '',
      soloCriticas: document.getElementById(FILTER_IDS.soloCriticas)?.checked || false,
      promesaVencida: document.getElementById(FILTER_IDS.promesaVencida)?.checked || false,
      buscar: document.getElementById(FILTER_IDS.buscar)?.value || '',
    };
  }

  function populateSelect(id, options, allLabel) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>${(options || []).map((o) => `<option value="${o}">${o}</option>`).join('')}`;
    if (current && options.includes(current)) sel.value = current;
  }

  function populateFilterOptions(options) {
    populateSelect(FILTER_IDS.status, options.status, 'Todos');
    populateSelect(FILTER_IDS.asesor, options.asesor, 'Todos');
    populateSelect(FILTER_IDS.tipo, options.tipo, 'Todos');
    populateSelect(FILTER_IDS.antiguedad, options.antiguedad, 'Todas');
  }

  function kpiCard(title, value, sub, cls) {
    return `<div class="kpi-card kpi-card--${cls || 'blue'}"><span class="kpi-title">${title}</span><div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}<div class="kpi-accent"></div></div>`;
  }

  function kpiGroup(title, cards) {
    return `<div class="kpi-group"><h4 class="kpi-group-title">${title}</h4><div class="kpi-grid">${cards.join('')}</div></div>`;
  }

  function growthLabel(value, prevHasData) {
    if (!prevHasData) return 'sin mes anterior en el periodo';
    if (value === 0 || value == null || Number.isNaN(value)) return 'sin variación vs mes anterior';
    return 'vs mes anterior';
  }

  function renderKpis(d) {
    const { fmt } = Dashboard;
    const s = d.summary || { ...d.executive, ...d.finance };
    const a = d.aging;
    const r = d.risk;

    document.getElementById('kpiSummary').innerHTML = [
      kpiGroup('Volumen · periodo', [
        kpiCard('Órdenes ingresadas', fmt.number(s.totalOrdenes), 'en el rango de fechas', 'blue'),
        kpiCard('Facturadas', fmt.number(s.facturadas), `${s.pctFacturado}% del total · ${fmt.currency(s.importeFacturado)}`, 'green'),
        kpiCard('Abiertas hoy', fmt.number(s.abiertas), fmt.currency(s.importeAbierto), 'amber'),
        kpiCard('Canceladas', fmt.number(s.canceladas), 'en el periodo', 'rose'),
      ]),
      kpiGroup('Importes · periodo', [
        kpiCard('Importe ingresado', fmt.currency(s.importeIngresado), `ticket prom. ${fmt.currency(s.ticketPromIngresado)}`, 'violet'),
        kpiCard('Importe facturado', fmt.currency(s.importeFacturado), `${s.pctImporteFacturado}% del ingresado`, 'green'),
        kpiCard('Backlog abierto', fmt.currency(s.importeAbierto), 'valor en taller a hoy', 'amber'),
        kpiCard('Ticket prom. facturado', fmt.currency(s.ticketPromFacturado), 'por orden facturada', 'blue'),
      ]),
      kpiGroup('Tendencia y riesgo', [
        kpiCard(`Facturado · ${s.ultimoMesLabel}`, fmt.currency(s.facturadoUltimoMes), 'último mes del periodo', 'violet'),
        kpiCard('Crecimiento facturado', `${s.crecimientoFacturado > 0 ? '+' : ''}${s.crecimientoFacturado}%`, growthLabel(s.crecimientoFacturado, s.tieneMesAnterior), s.crecimientoFacturado >= 0 ? 'green' : 'rose'),
        kpiCard('Mejor mes', s.mejorMes, fmt.currency(s.mejorMesImporte), 'green'),
        kpiCard('Riesgo +120 días', fmt.currency(s.riesgo120), 'importe abierto en órdenes críticas', 'rose'),
      ]),
    ].join('');

    document.getElementById('kpiAging').innerHTML = [
      kpiCard('0-30 días', fmt.number(a.b0_30), '', 'green'),
      kpiCard('31-60 días', fmt.number(a.b31_60), '', 'amber'),
      kpiCard('61-90 días', fmt.number(a.b61_90), '', 'rose'),
      kpiCard('91-120 días', fmt.number(a.b91_120), '', 'rose'),
      kpiCard('+120 días', fmt.number(a.b120p), '', 'rose'),
    ].join('');

    document.getElementById('kpiRisk').innerHTML = [
      kpiCard('Críticas +60 días', fmt.number(r.criticas60), '', 'rose'),
      kpiCard('Promesas vencidas', fmt.number(r.promesasVencidas), '', 'amber'),
      kpiCard('Promedio semanal', fmt.number(r.promedioSemanal), 'órdenes/semana', 'blue'),
      kpiCard('Sin importe', fmt.number(r.sinImporte), '', 'violet'),
      kpiCard('Sin aseguradora', fmt.number(r.sinAseguradora), '', 'amber'),
      kpiCard('Abiertas sin promesa', fmt.number(r.abiertasSinPromesa), '', 'rose'),
      kpiCard('Sin fecha ingreso', fmt.number(r.sinFechaIngreso), '', 'rose'),
      kpiCard('Registros excluidos', fmt.number(r.excluidos), '', 'violet'),
    ].join('');
  }

  function semaforoBadge(s) {
    const map = { Verde: 'badge-running', Amarillo: 'badge-flotilla', Rojo: 'badge-alert', Cerrada: 'badge-tipo' };
    return `<span class="badge-tipo ${map[s] || ''}">${s}</span>`;
  }

  function renderTables(d) {
    const { fmt } = Dashboard;
    const t = d.tables;

    document.getElementById('tblCriticas').innerHTML = t.criticas.length
      ? t.criticas.map((r) => `<tr><td><strong>${r.orden}</strong></td><td>${r.nombre}</td><td>${r.asesor}</td><td>${r.dias}</td><td>${fmt.money(r.importe)}</td><td>${semaforoBadge(r.semaforo)}</td><td>${r.promesa || '—'}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="7">Sin órdenes críticas en el filtro actual.</td></tr>';

    document.getElementById('tblAsesor').innerHTML = t.productividadAsesor.length
      ? t.productividadAsesor.map((r) => `<tr><td>${r.asesor}</td><td>${r.ordenes}</td><td>${r.facturadas}</td><td>${r.abiertas}</td><td>${fmt.money(r.importe)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="5">Sin datos.</td></tr>';

    document.getElementById('tblAseg').innerHTML = t.controlAseguradora.length
      ? t.controlAseguradora.map((r) => `<tr><td>${r.aseguradora}</td><td>${r.ordenes}</td><td>${r.facturadas}</td><td>${fmt.money(r.importeFacturado)}</td><td>${r.abiertas}</td><td>${fmt.money(r.importeAbierto)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Sin órdenes con aseguradora en el filtro actual.</td></tr>';

    document.getElementById('tblControlOrdenes').innerHTML = t.controlOrdenes.length
      ? t.controlOrdenes.map((r) => `<tr><td>${r.tipoOrden}</td><td>${r.ordenes}</td><td>${r.facturadas}</td><td>${fmt.money(r.importeFacturado)}</td><td>${r.abiertas}</td><td>${fmt.money(r.importeAbierto)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Sin órdenes sin aseguradora en el filtro actual.</td></tr>';

    document.getElementById('tblFinMes').innerHTML = t.finanzasMensuales.length
      ? t.finanzasMensuales.map((r) => `<tr><td>${r.mes}</td><td>${r.ingresadas}</td><td>${r.facturadas}</td><td>${fmt.money(r.importeIngresado)}</td><td>${fmt.money(r.importeFacturado)}</td><td>${fmt.money(r.importeAbierto)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">Sin datos.</td></tr>';

    document.getElementById('ordersCount').textContent = `${t.detalle.length} órdenes (filtro activo)`;
    document.getElementById('ordersTable').innerHTML = t.detalle.length
      ? t.detalle.slice(0, 500).map((r) => `<tr>
        <td><strong>${r.orden}</strong></td><td>${r.nombre}</td><td>${r.asesor}</td>
        <td><span class="badge-tipo">${r.statusLabel}</span></td><td>${r.tipoOrden}</td><td>${semaforoBadge(r.semaforo)}</td>
        <td>${r.ingreso || '—'}</td><td>${r.promesa || '—'}</td><td>${r.dias}</td>
        <td>${fmt.money(r.importe)}</td><td>${r.aseguradora || '—'}</td><td>${r.serie || '—'}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="12">Sin órdenes en el filtro actual.</td></tr>';
  }

  function renderCharts(c, opts) {
    const { chartOptions, chartColors, chartPalette } = Dashboard;

    destroyChart('cStatus');
    charts.cStatus = new Chart(document.getElementById('cStatus'), {
      type: 'doughnut',
      data: {
        labels: c.statusDonut.map((x) => x.label),
        datasets: [{ data: c.statusDonut.map((x) => x.value), backgroundColor: chartPalette, borderWidth: 0 }],
      },
      options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
    });

    destroyChart('cAging');
    charts.cAging = new Chart(document.getElementById('cAging'), {
      type: 'bar',
      data: {
        labels: c.agingOpen.map((x) => x.label),
        datasets: [{ label: 'Abiertas', data: c.agingOpen.map((x) => x.value), backgroundColor: chartColors.primary, borderRadius: 8 }],
      },
      options: chartOptions({ plugins: { legend: { display: false } } }),
    });

    destroyChart('cMonthlyOps');
    charts.cMonthlyOps = new Chart(document.getElementById('cMonthlyOps'), {
      type: 'bar',
      data: {
        labels: c.monthlyOps.map((x) => x.label),
        datasets: [
          { label: 'Ingresadas', data: c.monthlyOps.map((x) => x.ingresadas), backgroundColor: chartColors.primary, borderRadius: 6 },
          { label: 'Facturadas', data: c.monthlyOps.map((x) => x.facturadas), backgroundColor: chartColors.secondary, borderRadius: 6 },
        ],
      },
      options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
    });

    destroyChart('cWeekly');
    charts.cWeekly = new Chart(document.getElementById('cWeekly'), {
      type: 'line',
      data: {
        labels: c.weeklyFlow.map((x) => x.label),
        datasets: [
          { label: 'Ingresadas', data: c.weeklyFlow.map((x) => x.ingresadas), borderColor: chartColors.primary, tension: 0.3 },
          { label: 'Facturadas', data: c.weeklyFlow.map((x) => x.facturadas), borderColor: chartColors.rose, tension: 0.3 },
        ],
      },
      options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
    });

    const weekLabels = c.statusByWeek.map((x) => x.label);
    const weekGroups = [...new Set(c.statusByWeek.flatMap((x) => Object.keys(x.groups)))];
    destroyChart('cStatusWeek');
    charts.cStatusWeek = new Chart(document.getElementById('cStatusWeek'), {
      type: 'bar',
      data: {
        labels: weekLabels,
        datasets: weekGroups.map((g, i) => ({
          label: g,
          data: c.statusByWeek.map((w) => w.groups[g] || 0),
          backgroundColor: chartPalette[i % chartPalette.length],
          borderRadius: 4,
        })),
      },
      options: chartOptions({ scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: 'bottom' } } }),
    });

    destroyChart('cTipo');
    charts.cTipo = new Chart(document.getElementById('cTipo'), {
      type: 'bar',
      data: {
        labels: c.tipoOrden.map((x) => x.label.slice(0, 18)),
        datasets: [{ label: 'Órdenes', data: c.tipoOrden.map((x) => x.value), backgroundColor: chartColors.secondary, borderRadius: 8 }],
      },
      options: chartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });

    destroyChart('cImporteTipo');
    charts.cImporteTipo = new Chart(document.getElementById('cImporteTipo'), {
      type: 'bar',
      data: {
        labels: c.importeAbiertoTipo.map((x) => x.label.slice(0, 18)),
        datasets: [{ label: 'Importe abierto', data: c.importeAbiertoTipo.map((x) => x.value), backgroundColor: chartColors.rose, borderRadius: 8 }],
      },
      options: chartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });

    destroyChart('cMonthlyFin');
    charts.cMonthlyFin = new Chart(document.getElementById('cMonthlyFin'), {
      type: 'line',
      data: {
        labels: c.monthlyFinance.map((x) => x.label),
        datasets: [
          { label: 'Ingresado', data: c.monthlyFinance.map((x) => x.ingresado), borderColor: chartColors.primary, tension: 0.3 },
          { label: 'Facturado', data: c.monthlyFinance.map((x) => x.facturado), borderColor: chartColors.secondary, tension: 0.3 },
          { label: 'Abierto', data: c.monthlyFinance.map((x) => x.abierto), borderColor: chartColors.rose, tension: 0.3 },
        ],
      },
      options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
    });

    destroyChart('cGrowth');
    charts.cGrowth = new Chart(document.getElementById('cGrowth'), {
      type: 'bar',
      data: {
        labels: c.monthlyGrowth.map((x) => x.label),
        datasets: [{ label: 'Crecimiento %', data: c.monthlyGrowth.map((x) => x.growth), backgroundColor: chartColors.primary, borderRadius: 8 }],
      },
      options: chartOptions({ plugins: { legend: { display: false } } }),
    });

    destroyChart('cSeason');
    charts.cSeason = new Chart(document.getElementById('cSeason'), {
      type: 'bar',
      data: {
        labels: c.seasonality.map((x) => x.label),
        datasets: [{ label: 'Ticket prom.', data: c.seasonality.map((x) => x.value), backgroundColor: chartColors.violet || chartColors.primary, borderRadius: 8 }],
      },
      options: chartOptions({ plugins: { legend: { display: false } } }),
    });

    destroyChart('cRiskAging');
    charts.cRiskAging = new Chart(document.getElementById('cRiskAging'), {
      type: 'bar',
      data: {
        labels: c.riskAging.map((x) => x.label),
        datasets: [{ label: 'Importe abierto', data: c.riskAging.map((x) => x.value), backgroundColor: chartColors.rose, borderRadius: 8 }],
      },
      options: chartOptions({ plugins: { legend: { display: false } } }),
    });

    destroyChart('cAsegImporte');
    charts.cAsegImporte = new Chart(document.getElementById('cAsegImporte'), {
      type: 'bar',
      data: {
        labels: c.asegAbierto.map((x) => x.label.slice(0, 16)),
        datasets: [{ label: 'Importe abierto', data: c.asegAbierto.map((x) => x.value), backgroundColor: chartColors.tertiary, borderRadius: 8 }],
      },
      options: chartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });

    destroyChart('cAbiertasAsesor');
    charts.cAbiertasAsesor = new Chart(document.getElementById('cAbiertasAsesor'), {
      type: 'bar',
      data: {
        labels: c.abiertasAsesor.map((x) => x.label.slice(0, 14)),
        datasets: [
          { label: 'Por asesor', data: c.abiertasAsesor.map((x) => x.value), backgroundColor: chartColors.primary, borderRadius: 6 },
          { label: 'Por aseguradora', data: c.abiertasAseg.map((x) => x.value), backgroundColor: chartColors.secondary, borderRadius: 6 },
        ],
      },
      options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
    });
  }

  function countActiveFilters() {
    const f = getFilters();
    let n = 0;
    if (f.status) n += 1;
    if (f.asesor) n += 1;
    if (f.tipo) n += 1;
    if (f.antiguedad) n += 1;
    if (f.importeMin !== '' && f.importeMin != null) n += 1;
    if (f.importeMax !== '' && f.importeMax != null) n += 1;
    if (f.soloCriticas) n += 1;
    if (f.promesaVencida) n += 1;
    if (f.buscar.trim()) n += 1;
    return n;
  }

  function formatPeriodLabel(fi, ff) {
    if (!fi || !ff) return 'Seleccione un rango de fechas';
    const start = new Date(`${fi}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = new Date(`${ff}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Periodo cargado: ${start} → ${end}`;
  }

  function updateFilterUI(filteredCount) {
    const active = countActiveFilters();
    const badge = document.getElementById('filterActiveCount');
    if (badge) {
      badge.textContent = active
        ? `${active} filtro${active === 1 ? '' : 's'} operativo${active === 1 ? '' : 's'}`
        : 'Sin filtros operativos';
      badge.classList.toggle('is-active', active > 0);
    }

    const fi = document.getElementById('fechaInicio')?.value;
    const ff = document.getElementById('fechaFin')?.value;
    const periodEl = document.getElementById('filterPeriodLabel');
    if (periodEl) {
      const base = formatPeriodLabel(fi, ff);
      periodEl.textContent = filteredCount != null && fi && ff
        ? `${base} · ${filteredCount} órdenes visibles`
        : base;
    }

    const opsLbl = document.getElementById('filterOpsLabel');
    if (opsLbl) {
      opsLbl.textContent = active
        ? `${active} activo${active === 1 ? '' : 's'}`
        : 'Todos';
    }
  }

  function clearPresetChips() {
    document.querySelectorAll('.filters-panel [data-preset]').forEach((b) => b.classList.remove('chip--active'));
  }

  function clearOperationalFilters() {
    Object.values(FILTER_IDS).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
    refreshDashboard();
  }

  function refreshDashboard() {
    if (!allRecords.length && !openSnapshot.length) return;
    const dash = PostSalesAnalytics.computeDashboard(allRecords, getFilters(), openSnapshot);
    renderKpis(dash);
    renderCharts(dash.charts);
    renderTables(dash);
    Dashboard.setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')} · ${dash.filtered.length} órdenes`);
    updateFilterUI(dash.filtered.length);
  }

  async function loadData(fechaInicio, fechaFin) {
    const data = await Dashboard.api(`/post-sales?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    allRecords = data.records || [];
    openSnapshot = data.openSnapshot || [];
    populateFilterOptions(PostSalesAnalytics.buildFilterOptions(allRecords, openSnapshot));
    refreshDashboard();
    return allRecords.length;
  }

  function bindFilterEvents() {
    const rerender = () => refreshDashboard();
    ['fStatus', 'fAsesor', 'fTipo', 'fAntiguedad'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', rerender);
    });
    ['fImporteMin', 'fImporteMax', 'buscarOrdenes'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', rerender);
    });
    ['fCriticas', 'fPromesa'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', rerender);
    });

    document.getElementById('btnClearFilters')?.addEventListener('click', clearOperationalFilters);

    document.querySelectorAll('.filters-panel [data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filters-panel [data-preset]').forEach((b) => b.classList.remove('chip--active'));
        btn.classList.add('chip--active');
      });
    });

    ['fechaInicio', 'fechaFin'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', clearPresetChips);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindFilterEvents();
    Dashboard.initDateFilter({
      onConsult: async (fi, ff) => {
        const n = await loadData(fi, ff);
        return n;
      },
    });
  });
})();
