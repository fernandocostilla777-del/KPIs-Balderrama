let selectedDailyFecha = null;

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
    card.classList.remove('kpi-card--loss', 'kpi-card--gain', 'kpi-card--green', 'kpi-card--violet', 'kpi-card--amber');
    if (n < 0) card.classList.add('kpi-card--loss');
    else if (n > 0) card.classList.add('kpi-card--gain');
    else card.classList.add('kpi-card--slate');
  }

  if (sub) {
    sub.textContent = subText;
    sub.classList.remove('kpi-subtitle--loss', 'kpi-subtitle--gain', 'kpi-subtitle--warn');
    if (marginPct != null && marginPct < 0) sub.classList.add('kpi-subtitle--loss');
    else if (marginPct != null && marginPct > 0) sub.classList.add('kpi-subtitle--gain');
    else if (marginPct != null && marginPct === 0) sub.classList.add('kpi-subtitle--warn');
  }
}

function setPlainKpi(valueId, value) {
  const el = document.getElementById(valueId);
  if (!el) return;
  const n = Number(value) || 0;
  el.textContent = Dashboard.fmt.currency(n);
  el.classList.remove('kpi-value--negative', 'kpi-value--positive');
}

function kpiCard(title, value, sub, cls) {
  const money = String(value).includes('$');
  return `<div class="kpi-card kpi-card--${cls || 'blue'}"><span class="kpi-title">${title}</span><div class="kpi-value${money ? ' money' : ''}">${value}</div>${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}</div>`;
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

  body.innerHTML = vtasmen.resultLines.map((row) => {
    const cls = moneyClass(row.value);
    const indent = row.level ? ` class="eeff-vtasmen-row eeff-vtasmen-row--l${row.level}${row.highlight ? ' row-highlight' : ''}"` : (row.highlight ? ' class="row-highlight"' : '');
    return `
    <tr${indent}>
      <td>${row.level ? `<span class="eeff-vtasmen-branch">${row.label}</span>` : `<strong>${row.label}</strong>`}</td>
      <td class="cell-money ${cls}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderLinesTable(tbodyId, lines) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin datos en el periodo.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    const cls = moneyClass(row.value);
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td>${row.label}</td>
      <td class="cell-money ${cls}"><strong>${Dashboard.fmt.money(row.value)}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderBalanceTable(balance, fmt) {
  const body = document.getElementById('balanceTable');
  if (!body) return;
  if (!balance?.available) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin tabla CON_CTAS para el año seleccionado.</td></tr>';
    return;
  }

  const rows = [];

  if (balance.consolidated !== false) {
    rows.push(...(balance.sections || []).map((s) => [s.label, s.value]));
    rows.push(['Total activo', balance.totals.activoTotal]);
    rows.push(['Total pasivo', balance.totals.pasivoTotal]);
    rows.push(['Capital contable', balance.totals.capital]);
    rows.push(['Pasivo + capital', balance.totals.pasivoMasCapital]);
  } else if (balance.branchPosition) {
    rows.push([balance.branchPosition.label, balance.branchPosition.value]);
    rows.push(['Nota', null]);
  } else {
    rows.push(['Posición sucursal', null]);
  }

  body.innerHTML = rows.map(([label, value], i) => {
    if (value == null) {
      const note = label === 'Nota'
        ? 'Balance parcial por sucursal (cartera y CxC). El balance consolidado requiere filtro Consolidado.'
        : 'Sin cuentas de balance para este filtro.';
      return `<tr class="empty-row"><td colspan="2">${note}</td></tr>`;
    }
    const cls = moneyClass(value);
    return `
    <tr${i >= rows.length - 4 && balance.consolidated !== false ? ' class="row-highlight"' : ''}>
      <td>${label}</td>
      <td class="cell-money ${cls}"><strong>${fmt.money(value)}</strong></td>
    </tr>
  `;
  }).join('');
}

function renderRatios(ratios, fmt) {
  const el = document.getElementById('ratiosEeff');
  if (!el) return;
  if (!ratios) {
    el.innerHTML = '<p class="section-subtitle">Sin ratios disponibles.</p>';
    return;
  }

  el.innerHTML = [
    ratioCard('Margen bruto', ratios.margenBrutoPct, 'Utilidad bruta / ventas'),
    ratioCard('Margen operación', ratios.margenOperacionPct, 'Utilidad operación / ventas'),
    ratioCard('Margen neto', ratios.margenNetoPct, 'Utilidad del periodo / ventas'),
    kpiCard('Liquidez corriente', ratios.liquidezCorriente ?? '—', 'Activo circ. / pasivo corto plazo', 'blue'),
    kpiCard('Endeudamiento', ratios.endeudamientoPct != null ? `${ratios.endeudamientoPct}%` : '—', 'Pasivo / activo total', 'slate'),
  ].join('');
}

function ratioCard(title, pct, sub) {
  const n = Number(pct);
  const cls = Number.isFinite(n) ? (n < 0 ? 'loss' : n > 0 ? 'gain' : 'amber') : 'slate';
  const value = pct != null ? `${pct}%` : '—';
  return `<div class="kpi-card kpi-card--eeff kpi-card--${cls}"><span class="kpi-title">${title}</span><div class="kpi-value${Number.isFinite(n) && n < 0 ? ' kpi-value--negative' : Number.isFinite(n) && n > 0 ? ' kpi-value--positive' : ''}">${value}</div><p class="kpi-subtitle">${sub}</p></div>`;
}

function formatDayLabel(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clearDailyDetail() {
  selectedDailyFecha = null;
  const panel = document.getElementById('dailySalesDetail');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.innerHTML = '';
  document.querySelectorAll('#dailySalesTable tr.row-selectable').forEach((tr) => {
    tr.classList.remove('row-active');
    tr.setAttribute('aria-selected', 'false');
  });
}

function renderDailySalesDetail(fecha, data, fmt) {
  const panel = document.getElementById('dailySalesDetail');
  if (!panel) return;

  const units = data.units || [];
  if (!units.length) {
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="daily-detail-panel">
        <h4 class="daily-detail-title">Detalle · ${formatDayLabel(fecha)}</h4>
        <p class="section-subtitle">Sin unidades facturadas en esta fecha.</p>
      </div>
    `;
    return;
  }

  const s = data.summary || {};
  const utilCls = moneyClass(s.utilidad);
  const margenCls = moneyClass(s.margenPct);

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="daily-detail-panel">
      <div class="daily-detail-head">
        <div>
          <h4 class="daily-detail-title">Detalle · ${formatDayLabel(fecha)}</h4>
          <p class="daily-detail-hint">Unidades facturadas del día seleccionado</p>
        </div>
        <button type="button" class="btn-glass daily-detail-close" aria-label="Cerrar detalle">Cerrar</button>
      </div>
      <div class="daily-detail-kpis">
        <div class="daily-detail-kpi">
          <span class="daily-detail-kpi__label">Unidades</span>
          <strong class="daily-detail-kpi__value">${fmt.number(s.units)}</strong>
        </div>
        <div class="daily-detail-kpi">
          <span class="daily-detail-kpi__label">Venta</span>
          <strong class="daily-detail-kpi__value">${fmt.money(s.ventaSubtotal)}</strong>
        </div>
        <div class="daily-detail-kpi">
          <span class="daily-detail-kpi__label">Costo</span>
          <strong class="daily-detail-kpi__value">${fmt.money(s.costoNeto)}</strong>
        </div>
        <div class="daily-detail-kpi daily-detail-kpi--highlight">
          <span class="daily-detail-kpi__label">Utilidad</span>
          <strong class="daily-detail-kpi__value ${utilCls}">${fmt.money(s.utilidad)}</strong>
          <span class="daily-detail-kpi__sub ${margenCls}">Margen ${s.margenPct ?? 0}%</span>
        </div>
      </div>
      <div class="daily-units-grid">
        ${units.map((u) => {
          const uCls = moneyClass(u.utilidad);
          const mCls = moneyClass(u.margenPct);
          const flotilla = u.flotilla ? '<span class="badge-tipo badge-flotilla">Flotilla</span>' : '';
          return `
          <article class="daily-unit-card">
            <div class="daily-unit-card__head">
              <div class="daily-unit-card__ids">
                <span class="daily-unit-card__factura">${escHtml(u.factura)}</span>
                ${flotilla}
              </div>
              <span class="daily-unit-card__margen ${mCls}">${u.margenPct != null ? `${u.margenPct}%` : '—'}</span>
            </div>
            <p class="daily-unit-card__vin" title="${escHtml(u.serie)}">${escHtml(u.serie)}</p>
            <p class="daily-unit-card__modelo" title="${escHtml(u.modelo)}">${escHtml(u.modelo)}</p>
            <p class="daily-unit-card__cliente" title="${escHtml(u.cliente)}">${escHtml(u.cliente)}</p>
            <div class="daily-unit-card__meta">
              <span>${escHtml(u.estado)}</span>
              <span>${escHtml(u.formaPago)}</span>
              ${u.anioModelo ? `<span>Año ${escHtml(u.anioModelo)}</span>` : ''}
            </div>
            <div class="daily-unit-card__amounts">
              <div class="daily-unit-card__amount">
                <span>Venta</span>
                <strong>${fmt.money(u.ventaSubtotal)}</strong>
              </div>
              <div class="daily-unit-card__amount">
                <span>Costo</span>
                <strong>${fmt.money(u.costoNeto)}</strong>
              </div>
              <div class="daily-unit-card__amount daily-unit-card__amount--result">
                <span>Utilidad</span>
                <strong class="${uCls}">${u.utilidad != null ? fmt.money(u.utilidad) : '—'}</strong>
              </div>
            </div>
          </article>
        `;
        }).join('')}
      </div>
    </div>
  `;

  panel.querySelector('.daily-detail-close')?.addEventListener('click', clearDailyDetail);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function selectDailyDate(fecha, fmt) {
  if (selectedDailyFecha === fecha) {
    clearDailyDetail();
    return;
  }

  selectedDailyFecha = fecha;
  document.querySelectorAll('#dailySalesTable tr.row-selectable').forEach((tr) => {
    const active = tr.dataset.fecha === fecha;
    tr.classList.toggle('row-active', active);
    tr.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const panel = document.getElementById('dailySalesDetail');
  if (panel) {
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="daily-detail-panel"><p class="daily-detail-loading">Cargando unidades…</p></div>';
  }

  try {
    const data = await Dashboard.api(`/contabilidad/ventas-dia?fecha=${encodeURIComponent(fecha)}`);
    renderDailySalesDetail(fecha, data, fmt);
  } catch (err) {
    if (panel) {
      panel.innerHTML = `<div class="daily-detail-panel"><p class="daily-detail-error">${escHtml(err.message)}</p></div>`;
    }
  }
}

function bindDailySalesRows(fmt) {
  const body = document.getElementById('dailySalesTable');
  if (!body) return;

  body.querySelectorAll('tr.row-selectable').forEach((tr) => {
    tr.addEventListener('click', () => selectDailyDate(tr.dataset.fecha, fmt));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectDailyDate(tr.dataset.fecha, fmt);
      }
    });
  });
}

function renderDailySalesTable(rows, fmt) {
  const body = document.getElementById('dailySalesTable');
  const foot = document.getElementById('dailySalesFoot');
  if (!body) return;

  clearDailyDetail();

  if (!rows?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Sin unidades facturadas en el periodo.</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }

  const totals = rows.reduce((acc, row) => ({
    units: acc.units + Number(row.units || 0),
    ventaSubtotal: acc.ventaSubtotal + Number(row.ventaSubtotal || 0),
    costoNeto: acc.costoNeto + Number(row.costoNeto || 0),
    utilidad: acc.utilidad + Number(row.utilidad || 0),
  }), { units: 0, ventaSubtotal: 0, costoNeto: 0, utilidad: 0 });

  const margenTotal = totals.ventaSubtotal
    ? Math.round((totals.utilidad / totals.ventaSubtotal) * 1000) / 10
    : 0;

  body.innerHTML = rows.map((row) => {
    const utilCls = moneyClass(row.utilidad);
    const margenCls = moneyClass(row.margenPct);
    return `
    <tr class="row-selectable" data-fecha="${row.fecha}" tabindex="0" role="button" aria-selected="false" title="Ver detalle de unidades">
      <td>${formatDayLabel(row.fecha)}</td>
      <td class="cell-num">${fmt.number(row.units)}</td>
      <td class="cell-money">${fmt.money(row.ventaSubtotal)}</td>
      <td class="cell-money">${fmt.money(row.costoNeto)}</td>
      <td class="cell-money ${utilCls}"><strong>${fmt.money(row.utilidad)}</strong></td>
      <td class="cell-num ${margenCls}">${row.margenPct ?? 0}%</td>
    </tr>
  `;
  }).join('');

  if (foot) {
    const totalUtilCls = moneyClass(totals.utilidad);
    const totalMargenCls = moneyClass(margenTotal);
    foot.innerHTML = `
      <tr class="row-highlight">
        <td><strong>Total periodo</strong></td>
        <td class="cell-num"><strong>${fmt.number(totals.units)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(totals.ventaSubtotal)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(totals.costoNeto)}</strong></td>
        <td class="cell-money ${totalUtilCls}"><strong>${fmt.money(totals.utilidad)}</strong></td>
        <td class="cell-num ${totalMargenCls}"><strong>${margenTotal}%</strong></td>
      </tr>
    `;
  }

  bindDailySalesRows(fmt);
}

function getFiltrosContabilidad() {
  return {
    sucursal: document.getElementById('filtroSucursal')?.value || 'todos',
    area: document.getElementById('filtroArea')?.value || 'todos',
  };
}

async function loadContabilidad(fechaInicio, fechaFin) {
  const { fmt, api, setText } = Dashboard;
  const { sucursal, area } = getFiltrosContabilidad();
  const qs = new URLSearchParams({ fechaInicio, fechaFin, sucursal, area });
  const data = await api(`/contabilidad?${qs.toString()}`);
  const s = data.summary;
  const eeff = data.eeff || {};
  const useVtasmenKpis = area === 'autosNuevos';
  const kpiEeff = useVtasmenKpis ? (data.ventasAutosNuevosEeff || eeff.income) : eeff.income;
  const kpiSummary = useVtasmenKpis ? (data.ventasAutosNuevosEeff?.summary || s) : s;
  const scope = eeff.filtros?.scopeLabel || data.filtros?.scopeLabel || 'Consolidado';

  const scopeEl = document.getElementById('filterScopeLabel');
  if (scopeEl) scopeEl.textContent = scope;

  setPlainKpi('kpiVentasNetas', kpiSummary.ventasNetas);
  setText('kpiVentasNetasSub', `Margen bruto ${kpiSummary.margenBrutoPct ?? '—'}%`);
  document.getElementById('kpiVentasNetasSub')?.classList.toggle('kpi-subtitle--loss', (kpiSummary.margenBrutoPct ?? 0) < 0);

  setSignedKpi('kpiUtilidadBruta', 'kpiCardUtilidadBruta', kpiSummary.utilidadBruta, 'kpiUtilidadBrutaSub', 'Ventas − costo de ventas');
  setSignedKpi(
    'kpiUtilidadOperacion',
    'kpiCardUtilidadOperacion',
    kpiSummary.utilidadOperacion,
    'kpiUtilidadOperacionSub',
    useVtasmenKpis
      ? `Después de gastos operativos y administración · margen ${kpiSummary.margenOperacionPct ?? '—'}%`
      : `Utilidad bruta − gastos operación y administración · margen ${kpiSummary.margenOperacionPct ?? '—'}%`,
    kpiSummary.margenOperacionPct,
  );
  setSignedKpi(
    'kpiUtilidadPeriodo',
    'kpiCardUtilidadPeriodo',
    kpiSummary.utilidadPeriodo ?? kpiSummary.utilidadAntesImpuestos,
    'kpiUtilidadPeriodoSub',
    useVtasmenKpis ? 'Utilidad antes de impuestos' : 'Resultado contable neto',
  );

  setPlainKpi('kpiActivoTotal', s.activoTotal);
  setText('kpiActivoTotalSub', eeff.balance?.consolidated === false
    ? 'Posición parcial sucursal'
    : (eeff.balance?.available ? `Al ${eeff.balance.asOf}` : 'Sin balance'));
  setPlainKpi('kpiPasivoCapital', (s.pasivoTotal || 0) + (s.capitalContable || 0));
  setText('kpiPasivoCapitalSub', `Capital ${fmt.currency(s.capitalContable)}`);
  setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);

  renderBalanceTable(eeff.balance, fmt);
  renderLinesTable('resultadoTable', useVtasmenKpis ? kpiEeff?.resultLines : eeff.income?.resultLines);
  renderVtasmenTable(data.ventasAutosNuevosEeff, fmt);
  renderLinesTable('ingresosEeffTable', useVtasmenKpis ? kpiEeff?.revenueLines : eeff.income?.revenueLines);
  renderRatios(eeff.ratios, fmt);
  renderDailySalesTable(data.dailyBreakdown || [], fmt);
}

Dashboard.initDateFilter({ onConsult: loadContabilidad });

['filtroSucursal', 'filtroArea'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => {
    const fi = document.getElementById('fechaInicio')?.value;
    const ff = document.getElementById('fechaFin')?.value;
    if (fi && ff) loadContabilidad(fi, ff);
  });
});
