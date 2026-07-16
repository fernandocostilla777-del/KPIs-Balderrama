let selectedDailyFecha = null;
let activeMainTab = 'catalogo';

function getMainTabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  return tab === 'eeff' ? 'eeff' : 'catalogo';
}

function switchMainTab(tab) {
  activeMainTab = tab;
  document.querySelectorAll('.contabilidad-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('panelContabilidadCatalogo')?.classList.toggle('hidden', tab !== 'catalogo');
  document.getElementById('panelContabilidadEeff')?.classList.toggle('hidden', tab !== 'eeff');
  const scopePill = document.getElementById('pillScope');
  if (scopePill) scopePill.style.display = tab === 'eeff' ? 'none' : '';

  if (tab === 'eeff' && window.EeffSummary?.getComparativa2026DefaultRange) {
    const fi = document.getElementById('fechaInicio');
    const ff = document.getElementById('fechaFin');
    const in2026 = window.EeffSummary.isComparativaYearRange(fi?.value, ff?.value);
    if (!in2026 && fi && ff) {
      const range = window.EeffSummary.getComparativa2026DefaultRange();
      fi.value = range.fechaInicio;
      ff.value = range.fechaFin;
      setTimeout(() => document.getElementById('btnConsultar')?.click(), 0);
    }
  }

  const url = new URL(window.location.href);
  if (tab === 'eeff') url.searchParams.set('tab', 'eeff');
  else url.searchParams.delete('tab');
  window.history.replaceState({}, '', url.pathname + url.search);
}

function moneyClass(value) {
  const n = Number(value) || 0;
  if (n < 0) return 'cell-negative';
  if (n > 0) return 'cell-positive';
  return '';
}

function formatKpiAmount(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1_000_000) return Dashboard.fmt.currency(n);
  return Dashboard.fmt.money(n);
}

function setSignedKpi(valueId, cardId, value, subId, subText, marginPct) {
  const el = document.getElementById(valueId);
  const card = cardId ? document.getElementById(cardId) : el?.closest('.kpi-card');
  const sub = subId ? document.getElementById(subId) : null;
  const n = Number(value) || 0;

  if (el) {
    el.textContent = formatKpiAmount(n);
    el.classList.remove('kpi-value--negative', 'kpi-value--positive');
    if (n < 0) el.classList.add('kpi-value--negative');
    else if (n > 0) el.classList.add('kpi-value--positive');
  }

  if (card) {
    card.classList.remove('kpi-card--loss', 'kpi-card--gain', 'kpi-card--green', 'kpi-card--violet', 'kpi-card--amber', 'kpi-card--slate');
    if (n < 0) card.classList.add('kpi-card--loss');
    else if (n > 0) card.classList.add('kpi-card--gain');
  }

  if (sub) {
    sub.textContent = subText;
    sub.classList.remove('kpi-subtitle--loss', 'kpi-subtitle--gain', 'kpi-subtitle--warn');
    if (marginPct != null && marginPct < 0) sub.classList.add('kpi-subtitle--loss');
    else if (marginPct != null && marginPct > 0) sub.classList.add('kpi-subtitle--gain');
  }
}

function setPlainKpi(valueId, value, suffix = '') {
  const el = document.getElementById(valueId);
  if (!el) return;
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) {
    el.textContent = '—';
    return;
  }
  el.textContent = suffix ? `${n}${suffix}` : formatKpiAmount(n);
}

function renderCatalogLines(tbodyId, lines, fmt) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin movimiento en el periodo.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    const cls = moneyClass(row.value);
    const indent = row.level ? ` style="padding-left:${row.level * 16}px"` : '';
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td${indent}>${row.label}</td>
      <td class="cell-money ${cls}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderResultadoTable(lines, fmt) {
  const body = document.getElementById('resultadoTable');
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin datos.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    if (row.suffix === '%') {
      return `
      <tr>
        <td>${row.label}</td>
        <td class="cell-num ${moneyClass(row.value)}"><strong>${row.value ?? '—'}%</strong></td>
      </tr>`;
    }
    const isMoney = row.group !== 'ratio' || row.key === 'puntoEquilibrio';
    const display = row.value == null && row.key === 'puntoEquilibrio'
      ? '—'
      : isMoney ? fmt.money(row.value) : row.value;
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td>${row.label}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${display}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderDepartmentExpenseTable(departments, fmt) {
  const body = document.getElementById('departmentExpenseTable');
  const foot = document.getElementById('departmentExpenseFoot');
  if (!body) return;
  if (!departments?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Sin departamentos para el alcance.</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  let total = 0;
  body.innerHTML = departments.map((row) => {
    total += Number(row.value || 0);
    return `
    <tr>
      <td>${row.label}</td>
      <td class="cell-num">${row.gpoCont || '—'}</td>
      <td class="cell-num">${row.accountCount ?? '—'}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>`;
  }).join('');
  if (foot) {
    foot.innerHTML = `
      <tr class="row-highlight">
        <td colspan="3"><strong>Total departamentos</strong></td>
        <td class="cell-money"><strong>${fmt.money(total)}</strong></td>
      </tr>`;
  }
}

function renderBalanceTable(balance, fmt) {
  const body = document.getElementById('balanceTable');
  if (!body) return;
  if (!balance?.available) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin balance para el periodo.</td></tr>';
    return;
  }
  const rows = (balance.sections || []).map((s) => [s.label, s.value]);
  if (balance.consolidated !== false) {
    rows.push(['Total activo', balance.totals.activoTotal]);
    rows.push(['Total pasivo', balance.totals.pasivoTotal]);
    rows.push(['Capital contable', balance.totals.capital]);
  }
  body.innerHTML = rows.map(([label, value]) => `
    <tr>
      <td>${label}</td>
      <td class="cell-money ${moneyClass(value)}"><strong>${fmt.money(value)}</strong></td>
    </tr>
  `).join('');
}

function renderRatios(ratios, summary, fmt) {
  const el = document.getElementById('ratiosEeff');
  if (!el) return;
  el.innerHTML = [
    ratioCard('Margen bruto', summary.margenBrutoPct, 'Utilidad bruta / ventas'),
    ratioCard('Margen operación', summary.margenOperacionPct, 'Utilidad operación / ventas'),
    kpiCard('Liquidez corriente', ratios?.liquidezCorriente ?? '—', 'Activo circ. / pasivo CP', 'blue'),
    kpiCard('Punto equilibrio', summary.puntoEquilibrio != null ? fmt.currency(summary.puntoEquilibrio) : '—', 'Gastos 0700 ÷ margen bruto %', 'violet'),
  ].join('');
}

function kpiCard(title, value, sub, cls) {
  return `<div class="kpi-card kpi-card--${cls || 'blue'}"><span class="kpi-title">${title}</span><div class="kpi-value">${value}</div>${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}</div>`;
}

function ratioCard(title, pct, sub) {
  const n = Number(pct);
  const cls = Number.isFinite(n) ? (n < 0 ? 'loss' : n > 0 ? 'gain' : 'amber') : 'slate';
  return `<div class="kpi-card kpi-card--eeff kpi-card--${cls}"><span class="kpi-title">${title}</span><div class="kpi-value">${pct != null ? `${pct}%` : '—'}</div><p class="kpi-subtitle">${sub}</p></div>`;
}

function renderVtasmenTable(vtasmen, fmt) {
  const body = document.getElementById('vtasmenTable');
  const section = document.getElementById('sectionVtasmen');
  if (!body || !section) return;
  if (!vtasmen?.available || !vtasmen.resultLines?.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  body.innerHTML = vtasmen.resultLines.map((row) => `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td>${row.label}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>
  `).join('');
}

function formatDayLabel(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function escHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearDailyDetail() {
  selectedDailyFecha = null;
  const panel = document.getElementById('dailySalesDetail');
  if (panel) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }
}

function renderDailySalesTable(rows, fmt) {
  const body = document.getElementById('dailySalesTable');
  const foot = document.getElementById('dailySalesFoot');
  if (!body) return;
  clearDailyDetail();
  if (!rows?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Sin unidades en el periodo.</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  const totals = rows.reduce((a, r) => ({
    units: a.units + Number(r.units || 0),
    ventaSubtotal: a.ventaSubtotal + Number(r.ventaSubtotal || 0),
    costoNeto: a.costoNeto + Number(r.costoNeto || 0),
    utilidad: a.utilidad + Number(r.utilidad || 0),
  }), { units: 0, ventaSubtotal: 0, costoNeto: 0, utilidad: 0 });
  const margenTotal = totals.ventaSubtotal ? Math.round((totals.utilidad / totals.ventaSubtotal) * 1000) / 10 : 0;

  body.innerHTML = rows.map((row) => `
    <tr class="row-selectable" data-fecha="${row.fecha}" tabindex="0" role="button">
      <td>${formatDayLabel(row.fecha)}</td>
      <td class="cell-num">${fmt.number(row.units)}</td>
      <td class="cell-money">${fmt.money(row.ventaSubtotal)}</td>
      <td class="cell-money">${fmt.money(row.costoNeto)}</td>
      <td class="cell-money ${moneyClass(row.utilidad)}"><strong>${fmt.money(row.utilidad)}</strong></td>
      <td class="cell-num">${row.margenPct ?? 0}%</td>
    </tr>
  `).join('');

  if (foot) {
    foot.innerHTML = `
      <tr class="row-highlight">
        <td><strong>Total</strong></td>
        <td class="cell-num"><strong>${fmt.number(totals.units)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(totals.ventaSubtotal)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(totals.costoNeto)}</strong></td>
        <td class="cell-money ${moneyClass(totals.utilidad)}"><strong>${fmt.money(totals.utilidad)}</strong></td>
        <td class="cell-num"><strong>${margenTotal}%</strong></td>
      </tr>`;
  }

  body.querySelectorAll('tr.row-selectable').forEach((tr) => {
    tr.addEventListener('click', async () => {
      const fecha = tr.dataset.fecha;
      const panel = document.getElementById('dailySalesDetail');
      if (panel) {
        panel.classList.remove('hidden');
        panel.innerHTML = '<p>Cargando…</p>';
      }
      try {
        const data = await Dashboard.api(`/contabilidad/ventas-dia?fecha=${encodeURIComponent(fecha)}`);
        panel.innerHTML = `<div class="daily-detail-panel"><h4>${formatDayLabel(fecha)}</h4><p>${data.units?.length || 0} unidades</p></div>`;
      } catch (err) {
        panel.innerHTML = `<p>${escHtml(err.message)}</p>`;
      }
    });
  });
}

function getFiltrosContabilidad() {
  return {
    sucursal: document.getElementById('filtroSucursal')?.value || 'todos',
    area: document.getElementById('filtroArea')?.value || 'todos',
    includeFi: document.getElementById('filtroIncludeFi')?.checked !== false,
  };
}

async function loadContabilidad(fechaInicio, fechaFin) {
  const { fmt, api, setText } = Dashboard;
  const { sucursal, area, includeFi } = getFiltrosContabilidad();
  const qs = new URLSearchParams({ fechaInicio, fechaFin, sucursal, area, includeFi: String(includeFi) });
  const data = await api(`/contabilidad?${qs.toString()}`);

  const catalog = data.catalogKpis || {};
  const s = catalog.summary || data.summary;
  const eeff = data.eeff || {};

  const scopeEl = document.getElementById('filterScopeLabel');
  if (scopeEl) scopeEl.textContent = catalog.filtros?.scopeLabel || data.filtros?.scopeLabel || 'Consolidado';

  const methodEl = document.getElementById('catalogMethodology');
  if (methodEl && catalog.methodology) {
    methodEl.textContent = `${catalog.methodology.ingresos} · ${catalog.methodology.costos} · ${catalog.methodology.gastos}`;
  }

  setPlainKpi('kpiVentasNetas', s.ventasTotales);
  setText('kpiVentasNetasSub', `Margen bruto ${s.margenBrutoPct ?? '—'}%`);

  setPlainKpi('kpiCostoVentas', s.costoVentas);
  setText('kpiCostoVentasSub', '0600 · cargos al cierre');

  setSignedKpi('kpiUtilidadBruta', 'kpiCardUtilidadBruta', s.utilidadBruta, 'kpiUtilidadBrutaSub', `Ventas − costos · ${s.margenBrutoPct ?? 0}% margen`);

  setPlainKpi('kpiGastoDepartamento', s.gastoDepartamento);
  setText('kpiGastoDepartamentoSub', catalog.filtros?.scopeLabel === 'Consolidado'
    ? 'Suma departamentos · catálogo Excel'
    : `Gasto · ${catalog.filtros?.scopeLabel || 'alcance'}`);

  setPlainKpi('kpiGastosOperacion', s.gastosOperacion);
  setText('kpiGastosOperacionSub', '0700 · total operación (punto equilibrio)');

  setSignedKpi(
    'kpiUtilidadOperacion',
    'kpiCardUtilidadOperacion',
    s.utilidadOperacion,
    'kpiUtilidadOperacionSub',
    `Utilidad bruta − gastos · ${s.margenOperacionPct ?? 0}% margen`,
    s.margenOperacionPct,
  );

  const peEl = document.getElementById('kpiPuntoEquilibrio');
  const peCard = document.getElementById('kpiCardPuntoEquilibrio');
  if (s.puntoEquilibrio != null && s.margenBrutoPct > 0) {
    if (peEl) peEl.textContent = formatKpiAmount(s.puntoEquilibrio);
    setText('kpiPuntoEquilibrioSub', `Gastos ÷ ${s.margenBrutoPct}% margen bruto`);
    peCard?.classList.remove('kpi-card--loss');
  } else {
    if (peEl) peEl.textContent = '—';
    setText('kpiPuntoEquilibrioSub', s.margenBrutoPct <= 0 ? 'Margen bruto ≤ 0 — no calculable' : 'Sin datos');
    peCard?.classList.add('kpi-card--loss');
  }

  renderResultadoTable(catalog.resultLines, fmt);
  renderDepartmentExpenseTable(catalog.departmentExpenseLines, fmt);
  renderCatalogLines('ingresosCatalogTable', catalog.incomeLines, fmt);
  renderCatalogLines('costosCatalogTable', catalog.costLines, fmt);
  renderCatalogLines('gastosCatalogTable', catalog.expenseLines, fmt);
  renderBalanceTable(eeff.balance, fmt);
  renderRatios(eeff.ratios, s, fmt);
  renderVtasmenTable(data.ventasAutosNuevosEeff, fmt);
  renderDailySalesTable(data.dailyBreakdown || [], fmt);
}

async function onConsultContabilidad(fechaInicio, fechaFin) {
  const { setText } = Dashboard;
  await Promise.all([
    loadContabilidad(fechaInicio, fechaFin),
    window.EeffSummary?.load(fechaInicio, fechaFin) ?? Promise.resolve(),
  ]);
  setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
}

document.getElementById('contabilidadMainTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.contabilidad-tab');
  if (!tab) return;
  switchMainTab(tab.dataset.tab);
});

switchMainTab(getMainTabFromUrl());

Dashboard.initDateFilter({
  onConsult: onConsultContabilidad,
  getInitialRange(fromUrl) {
    const onEeff = getMainTabFromUrl() === 'eeff';
    if (onEeff && window.EeffSummary?.getComparativa2026DefaultRange) {
      if (fromUrl.fechaInicio && fromUrl.fechaFin
        && window.EeffSummary.isComparativaYearRange(fromUrl.fechaInicio, fromUrl.fechaFin)) {
        return fromUrl;
      }
      return window.EeffSummary.getComparativa2026DefaultRange();
    }
    if (fromUrl.fechaInicio && fromUrl.fechaFin) return fromUrl;
    return Dashboard.getDefaultDateRange();
  },
});

['filtroSucursal', 'filtroArea', 'filtroIncludeFi'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => {
    if (activeMainTab !== 'catalogo') return;
    const fi = document.getElementById('fechaInicio')?.value;
    const ff = document.getElementById('fechaFin')?.value;
    if (fi && ff) loadContabilidad(fi, ff);
  });
});
