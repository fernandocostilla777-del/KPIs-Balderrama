(function () {
  'use strict';

  let allRecords = [];
  let openSnapshot = [];
  let mesCursoNomenclatura = null;
  const charts = {};
  const MES_CURSO_LETRAS = ['N', 'D', 'Q', 'C', 'X', 'Y'];
  const MES_CURSO_LABELS = {
    N: 'Normal',
    D: 'Reparación',
    Q: 'Normal Zacatelco',
    C: 'Reparación Zacatelco',
    X: 'Reparación Cholula',
    Y: 'Normal Cholula',
  };

  function toIsoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatIsoDisplay(iso) {
    const [y, m, d] = String(iso || '').split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso || '';
  }

  function parseIngresoToIso(r) {
    const s = String(r.ingreso || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (r.ingresoDate && /^\d{4}-\d{2}-\d{2}/.test(String(r.ingresoDate))) {
      return String(r.ingresoDate).slice(0, 10);
    }
    return null;
  }

  function buildMesCursoFromRecords(records) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const fechaInicio = toIsoLocal(new Date(year, month, 1));
    const fechaFin = toIsoLocal(new Date(year, month, now.getDate()));
    const byDate = new Map();

    for (const r of records || []) {
      if (String(r.status || '').toUpperCase() === 'C') continue;
      const letra = String(r.letraOrden || (r.orden || '').trim().charAt(0) || '').toUpperCase();
      if (!MES_CURSO_LETRAS.includes(letra)) continue;
      const fecha = parseIngresoToIso(r);
      if (!fecha || fecha < fechaInicio || fecha > fechaFin) continue;
      if (!byDate.has(fecha)) {
        const row = { fecha, fechaLabel: formatIsoDisplay(fecha), total: 0 };
        MES_CURSO_LETRAS.forEach((L) => { row[L] = 0; });
        byDate.set(fecha, row);
      }
      const day = byDate.get(fecha);
      day[letra] += 1;
      day.total += 1;
    }

    const days = [];
    let acum = 0;
    for (let d = 1; d <= now.getDate(); d += 1) {
      const iso = toIsoLocal(new Date(year, month, d));
      const row = byDate.get(iso) || (() => {
        const empty = { fecha: iso, fechaLabel: formatIsoDisplay(iso), total: 0 };
        MES_CURSO_LETRAS.forEach((L) => { empty[L] = 0; });
        return empty;
      })();
      acum += row.total;
      days.push({ ...row, acumulado: acum });
    }

    const totals = { fechaLabel: 'Total', acumulado: acum, total: 0 };
    MES_CURSO_LETRAS.forEach((L) => {
      totals[L] = days.reduce((s, r) => s + (r[L] || 0), 0);
    });
    totals.total = days.reduce((s, r) => s + (r.total || 0), 0);

    return {
      periodo: { fechaInicio, fechaFin, label: `${formatIsoDisplay(fechaInicio)} — ${formatIsoDisplay(fechaFin)}` },
      letras: MES_CURSO_LETRAS.slice(),
      labels: { ...MES_CURSO_LABELS },
      days,
      totals,
    };
  }

  function resolveMesCursoData() {
    if (mesCursoNomenclatura?.totals?.total > 0) return mesCursoNomenclatura;
    const fromRecords = buildMesCursoFromRecords(allRecords);
    if (fromRecords.totals.total > 0) return fromRecords;
    return mesCursoNomenclatura || fromRecords;
  }

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

  function executiveCard(title, value, sub, cls, icon) {
    return `<div class="kpi-card kpi-card--eeff kpi-card--${cls || 'blue'}">
      <div class="kpi-card-head"><span class="kpi-title">${title}</span><span class="material-symbols-outlined kpi-icon">${icon || 'insights'}</span></div>
      <div class="kpi-value${String(value).includes('$') ? ' money' : ''}">${value}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
    </div>`;
  }

  function renderKpis(d) {
    const { fmt } = Dashboard;
    const s = d.summary || { ...d.executive, ...d.finance };
    const a = d.aging;
    const r = d.risk;

    document.getElementById('kpiExecutive').innerHTML = [
      executiveCard('Importe facturado', fmt.currency(s.importeFacturado), `${fmt.number(s.facturadas)} órdenes · ${s.pctFacturado}% del total`, 'green', 'payments'),
      executiveCard('Tasa de facturación', `${s.pctImporteFacturado}%`, `del ${fmt.currency(s.importeIngresado)} ingresado`, 'blue', 'percent'),
      executiveCard('Backlog abierto', fmt.currency(s.importeAbierto), `${fmt.number(s.abiertas)} órdenes en taller hoy`, 'amber', 'pending_actions'),
      executiveCard(
        'Crecimiento facturado',
        `${s.crecimientoFacturado > 0 ? '+' : ''}${s.crecimientoFacturado}%`,
        growthLabel(s.crecimientoFacturado, s.tieneMesAnterior),
        s.crecimientoFacturado >= 0 ? 'gain' : 'loss',
        'trending_up',
      ),
      executiveCard('Riesgo +120 días', fmt.currency(s.riesgo120), 'importe abierto en órdenes críticas', 'loss', 'warning'),
    ].join('');

    document.getElementById('kpiOperational').innerHTML = [
      kpiGroup('Volumen del periodo', [
        kpiCard('Órdenes ingresadas', fmt.number(s.totalOrdenes), 'en el rango de fechas', 'blue'),
        kpiCard('Facturadas', fmt.number(s.facturadas), `${s.pctFacturado}% del total`, 'green'),
        kpiCard('Abiertas hoy', fmt.number(s.abiertas), fmt.currency(s.importeAbierto), 'amber'),
        kpiCard('Canceladas', fmt.number(s.canceladas), 'en el periodo', 'rose'),
      ]),
      kpiGroup('Importes y tickets', [
        kpiCard('Importe ingresado', fmt.currency(s.importeIngresado), `ticket prom. ${fmt.currency(s.ticketPromIngresado)}`, 'violet'),
        kpiCard('Ticket prom. facturado', fmt.currency(s.ticketPromFacturado), 'por orden facturada', 'blue'),
        kpiCard(`Facturado · ${s.ultimoMesLabel}`, fmt.currency(s.facturadoUltimoMes), 'último mes del periodo', 'violet'),
        kpiCard('Mejor mes', s.mejorMes, fmt.currency(s.mejorMesImporte), 'green'),
      ]),
      kpiGroup('Antigüedad de abiertas', [
        kpiCard('0-30 días', fmt.number(a.b0_30), 'backlog reciente', 'green'),
        kpiCard('31-60 días', fmt.number(a.b31_60), '', 'amber'),
        kpiCard('61-90 días', fmt.number(a.b61_90), '', 'rose'),
        kpiCard('91-120 días', fmt.number(a.b91_120), '', 'rose'),
        kpiCard('+120 días', fmt.number(a.b120p), '', 'rose'),
      ]),
      kpiGroup('Control de taller', [
        kpiCard('Críticas +60 días', fmt.number(r.criticas60), '', 'rose'),
        kpiCard('Promesas vencidas', fmt.number(r.promesasVencidas), '', 'amber'),
        kpiCard('Promedio semanal', fmt.number(r.promedioSemanal), 'órdenes/semana', 'blue'),
        kpiCard('Sin importe', fmt.number(r.sinImporte), '', 'violet'),
        kpiCard('Sin aseguradora', fmt.number(r.sinAseguradora), '', 'amber'),
        kpiCard('Abiertas sin promesa', fmt.number(r.abiertasSinPromesa), '', 'rose'),
        kpiCard('Sin fecha ingreso', fmt.number(r.sinFechaIngreso), '', 'rose'),
        kpiCard('Registros excluidos', fmt.number(r.excluidos), '', 'violet'),
      ]),
    ].join('');
  }

  function semaforoBadge(s) {
    const map = { Verde: 'badge-running', Amarillo: 'badge-flotilla', Rojo: 'badge-alert', Cerrada: 'badge-tipo' };
    return `<span class="badge-tipo ${map[s] || ''}">${s}</span>`;
  }

  function renderMesCursoNomenclatura(raw) {
    const body = document.getElementById('tblMesCursoNomen');
    const labelEl = document.getElementById('mesCursoNomenLabel');
    const legendEl = document.getElementById('mesCursoNomenLegend');
    if (!body) return;

    const data = raw || resolveMesCursoData();
    const letras = data?.letras || MES_CURSO_LETRAS;
    if (labelEl) {
      labelEl.textContent = data?.periodo?.label
        ? `${data.periodo.label} · sin canceladas`
        : 'Mes en curso · sin canceladas';
    }
    if (legendEl) {
      const labels = data?.labels || MES_CURSO_LABELS;
      legendEl.textContent = letras.map((L) => `${L}: ${labels[L] || L}`).join(' · ');
    }

    const activeDays = (data?.days || []).filter((r) => (r.total || 0) > 0);
    if (!activeDays.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="9">Sin órdenes N/D/Q/C/X/Y en el mes en curso (excluye canceladas). Usa periodo “Mes actual” y reinicia el backend si acabas de actualizar.</td></tr>`;
      return;
    }

    const cell = (n) => (n ? String(n) : '—');
    const dayRows = activeDays.map((r) => `
      <tr>
        <td><strong>${r.fechaLabel}</strong></td>
        ${letras.map((L) => `<td class="cell-num">${cell(r[L])}</td>`).join('')}
        <td class="cell-num"><strong>${r.total || 0}</strong></td>
        <td class="cell-num">${r.acumulado || 0}</td>
      </tr>`).join('');

    const t = data.totals || {};
    const totalRow = `
      <tr class="row-highlight">
        <td><strong>Total</strong></td>
        ${letras.map((L) => `<td class="cell-num"><strong>${t[L] || 0}</strong></td>`).join('')}
        <td class="cell-num"><strong>${t.total || 0}</strong></td>
        <td class="cell-num"><strong>${t.acumulado || t.total || 0}</strong></td>
      </tr>`;

    body.innerHTML = dayRows + totalRow;
  }

  function renderTables(d) {
    const { fmt } = Dashboard;
    const t = d.tables;

    renderMesCursoNomenclatura();

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
    renderMesCursoNomenclatura();
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
    mesCursoNomenclatura = data.mesCursoNomenclatura || null;
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
