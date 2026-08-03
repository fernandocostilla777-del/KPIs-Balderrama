function kpiCard(title, value, sub, cls, id) {
  const money = String(value).includes('$');
  const idAttr = id ? ` id="${id}"` : '';
  return `<div class="kpi-card kpi-card--${cls || 'blue'}"${idAttr}><span class="kpi-title">${title}</span><div class="kpi-value${money ? ' money' : ''}">${value}</div>${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}</div>`;
}

function kpiGroup(title, cards) {
  return `<div class="kpi-group"><h4 class="kpi-group-title">${title}</h4><div class="kpi-grid">${cards.join('')}</div></div>`;
}

function analyticsBlock(title, subtitle, bodyHtml) {
  return `<div class="analytics-block"><h4 class="kpi-group-title">${title}</h4>${subtitle ? `<p class="analytics-block-desc">${subtitle}</p>` : ''}${bodyHtml}</div>`;
}

function analyticsTable(headers, rows, emptyMsg) {
  if (!rows.length) {
    return `<p class="kpi-subtitle">${emptyMsg || 'Sin datos en el periodo.'}</p>`;
  }
  return `<div class="table-scroll analytics-table-wrap"><table class="data-table analytics-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function quadrantBadge(id, label) {
  return `<span class="quadrant-badge quadrant-badge--${id}">${label}</span>`;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function renderSalesAnalytics(a, fmt) {
  if (!a || !a.rentabilidad) {
    return `<div class="analytics-block"><p class="kpi-subtitle">No se pudo cargar el análisis de ventas. Reinicie el servidor (<code>npm start</code>) y vuelva a consultar.</p></div>`;
  }

  const { rentabilidad: r, fuerzaVentas, recomendaciones } = a;
  const money = (n) => fmt.money(n);

  const advisorRows = fuerzaVentas.ranking.slice(0, 15).map((v) => `
    <tr>
      <td><strong>${v.vendedor}</strong></td>
      <td>${fmt.number(v.units)}</td>
      <td>${money(v.avgUtilidadUnit)}</td>
      <td>${v.avgMarginPct}%</td>
      <td>${money(v.utilidadTotal)}</td>
      <td>${quadrantBadge(v.quadrant, v.quadrantLabel)}</td>
    </tr>`);

  const unitsNote = r.unidadesAnalizadas
    ? `${fmt.number(r.unidadesAnalizadas)} unidades con costo${r.unidadesExcluidasSinCosto ? ` · ${fmt.number(r.unidadesExcluidasSinCosto)} sin costo excluidas` : ''}`
    : '';

  const recsHtml = recomendaciones?.length
    ? `<ul class="exec-insight-list">${recomendaciones.map((t) => `<li>${t}</li>`).join('')}</ul>`
    : '';

  return [
    analyticsBlock(
      '1. Rentabilidad y salud financiera · <a href="/sales.html">ver ventas</a>',
      `El volumen engaña; la utilidad sostiene el negocio. ${unitsNote}`,
      [
        kpiGroup('', [
          kpiCard('Margen bruto real', `${r.margenBrutoPct}%`, `${money(r.margenBrutoUnitario)} prom. por unidad`, 'green'),
          kpiCard('Utilidad bruta', money(r.utilidadBrutaTotal), 'Venta subtotal − costo neto', 'blue'),
          kpiCard('Impacto descuentos', `${r.bonificacionesPctGanancia}%`, `${money(r.bonificacionesTotal)} sobre utilidad bruta`, 'amber'),
        ]),
      ].join('')
    ),
    analyticsBlock(
      '2. Desempeño de la fuerza de ventas',
      'Identificar quién vende por precio y quién vende por valor.',
      [
        kpiGroup('', [
          kpiCard('Asesores activos', fmt.number(fuerzaVentas.ranking.length), `mediana volumen: ${fuerzaVentas.medians.volume} uds.`, 'blue'),
          kpiCard('Mediana utilidad bruta', fmt.currency(fuerzaVentas.medians.quality), 'por unidad vendida', 'green'),
          kpiCard('Alerta margen', fmt.number(fuerzaVentas.ranking.filter((v) => v.quadrant === 'regalo').length), 'asesores alto volumen · bajo margen', 'rose'),
        ]),
        analyticsTable(['Asesor', 'Volumen', 'Utilidad bruta/u', 'Margen %', 'Utilidad total', 'Cuadrante'], advisorRows, 'Sin asesores en el periodo.'),
      ].join('')
    ),
    recsHtml ? analyticsBlock('Recomendaciones estratégicas', 'Acciones directas para el próximo pedido a planta.', recsHtml) : '',
  ].join('');
}

function formatFullMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Dashboard.fmt.money(n);
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPuntoEquilibrioOverview(pe) {
  if (!pe?.agencia && !pe?.summary && !pe?.segmentos?.length) {
    return '';
  }

  const temporal = pe.temporal || {};
  const segmentos = pe.segmentos || [];
  const a = pe.agencia || pe.summary || {};
  const tone = (row) => (row.alcanzoEquilibrio ? 'pe-card-ok kpi-card--green' : 'pe-card-gap kpi-card--rose');

  const cards = segmentos.map((row) => {
    const peVal = row.puntoEquilibrio != null ? formatFullMoney(row.puntoEquilibrio) : '—';
    const cob = row.coberturaPct ?? row.cumplimientoPct;
    const sub = cob != null
      ? `Cobertura ${cob}%${row.coberturaRatio != null ? ` (${row.coberturaRatio}×)` : ''} · MC ${row.margenContribucionPct ?? '—'}%`
      : `MC ${row.margenContribucionPct ?? '—'}%`;
    const idAttr = row.id === 'agencia' ? ' id="kpiCardPuntoEquilibrio"' : '';
    return `<div class="kpi-card kpi-card--eeff ${tone(row)}"${idAttr}>
      <div class="kpi-card-head"><span class="kpi-title">${escHtml(row.label)}</span><span class="material-symbols-outlined kpi-icon">flag</span></div>
      <div class="kpi-value money">${peVal}</div>
      <p class="kpi-subtitle">${escHtml(sub)}</p>
    </div>`;
  }).join('');

  const tableRows = segmentos.map((row) => `<tr class="${row.id === 'agencia' ? 'row-total' : ''}">
    <td>${escHtml(row.label)}</td>
    <td class="cell-money">${formatFullMoney(row.ventas)}</td>
    <td class="cell-money">${row.margenContribucionPct != null ? `${row.margenContribucionPct}%` : '—'}</td>
    <td class="cell-money">${formatFullMoney(row.gastosFijos)}</td>
    <td class="cell-money">${row.puntoEquilibrio != null ? formatFullMoney(row.puntoEquilibrio) : '—'}</td>
    <td class="cell-num">${(row.coberturaPct ?? row.cumplimientoPct) != null ? `${row.coberturaPct ?? row.cumplimientoPct}%` : '—'}</td>
  </tr>`).join('');

  const detailRows = [
    ['Ventas del periodo', a.ventas],
    ['Costos variables', a.costosVariables],
    ['Margen de contribución', a.margenContribucion],
    ['Margen de contribución %', a.margenContribucionPct != null ? `${a.margenContribucionPct}%` : null, true],
    ['Gastos fijos', a.gastosFijos],
    ['Punto de equilibrio', a.puntoEquilibrio],
    ['Ratio de cobertura', a.coberturaRatio != null ? `${a.coberturaRatio} veces` : null, true],
    ['Cobertura porcentual', (a.coberturaPct ?? a.cumplimientoPct) != null ? `${a.coberturaPct ?? a.cumplimientoPct}%` : null, true],
    ['Brecha para alcanzar el equilibrio', a.brechaEquilibrioPct != null ? `${a.brechaEquilibrioPct}%` : null, true],
    ['Ventas adicionales requeridas', a.ventasAdicionalesRequeridas],
    ['Faltante / (excedente)', a.faltante],
    ['Utilidad / (pérdida) operativa', a.utilidadOperativa],
  ].map(([label, value, plain]) => {
    const display = value == null ? '—' : (plain ? escHtml(String(value)) : formatFullMoney(value));
    const hl = label.startsWith('Punto');
    return `<tr class="${hl ? 'row-highlight' : ''}"><td>${escHtml(label)}</td><td class="cell-money">${display}</td></tr>`;
  }).join('');

  const insight = pe.insight;
  const insightHtml = renderPeAgencyInsightHtml(insight);

  const badgeMode = temporal.mode || '';
  const badgeLabel = temporal.label || '—';
  const purpose = temporal.purpose
    || 'PE = Gastos fijos ÷ Margen de contribución % · preliminar operativo';
  const link = '<a href="/contabilidad.html?tab=eeff">ver en EEFF</a>';

  return `<div class="kpi-group pe-overview-block" id="panelPuntoEquilibrioOverview">
    <div class="section-head-row">
      <div>
        <h4 class="kpi-group-title">Punto de equilibrio operativo · ${link}</h4>
        <p class="kpi-subtitle" style="margin:0">${escHtml(purpose)}</p>
      </div>
      <span class="pe-mode-badge" data-mode="${escHtml(badgeMode)}">${escHtml(badgeLabel)}</span>
    </div>
    <div class="kpi-grid kpi-grid--eeff pe-segment-grid">${cards}</div>
    <div class="chart-grid pe-detail-grid" style="margin-top:14px">
      <div class="section-panel table-panel" style="margin:0;padding:0;border:none;box-shadow:none;background:transparent">
        <h4 class="kpi-group-title" style="margin-bottom:8px">Detalle agencia</h4>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Concepto</th><th class="cell-money">Importe</th></tr></thead><tbody>${detailRows}</tbody></table></div>
      </div>
      <div class="section-panel table-panel" style="margin:0;padding:0;border:none;box-shadow:none;background:transparent">
        <h4 class="kpi-group-title" style="margin-bottom:8px">Por departamento</h4>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Departamento</th><th class="cell-money">Ventas</th><th class="cell-money">MC %</th><th class="cell-money">Gastos fijos</th><th class="cell-money">Punto equilibrio</th><th class="cell-num">Cobertura</th></tr></thead>
          <tbody>${tableRows || '<tr class="empty-row"><td colspan="6">Sin datos</td></tr>'}</tbody>
        </table></div>
        ${insightHtml}
      </div>
    </div>
  </div>`;
}

function renderPeAgencyInsightHtml(insight) {
  if (!insight?.title) return '';
  const badgeTone = insight.severity === 'critical'
    ? 'rose'
    : (insight.severity === 'warning' ? 'amber' : (insight.severity === 'info' ? 'green' : 'blue'));
  const facts = Array.isArray(insight.facts) ? insight.facts : [];
  const recs = Array.isArray(insight.recommendations) ? insight.recommendations : [];
  const criterio = Array.isArray(insight.criterio) ? insight.criterio : [];
  const criticalCls = insight.severity === 'critical' ? ' pe-insight-note--critical' : '';
  const warnCls = insight.severity === 'warning' ? ' pe-insight-note--warning' : '';
  return `<div class="liquidez-note pe-insight-note${criticalCls}${warnCls}" id="peAgenciaInsight" aria-live="polite">
    <span class="liquidez-note__badge liquidez-note__badge--${badgeTone}">${escHtml(insight.badge || 'Alerta inteligente')}</span>
    <p class="liquidez-note__summary"><strong>${escHtml(insight.title)}</strong></p>
    <p class="liquidez-note__summary">${escHtml(insight.summary || '')}</p>
    ${facts.length ? `<ul class="liquidez-note__facts">${facts.map((f) => `<li><strong>${escHtml(f.label)}:</strong> ${escHtml(f.value)}</li>`).join('')}</ul>` : ''}
    <p class="liquidez-note__hint"><strong>Interpretación.</strong> ${escHtml(insight.analysis || '')}</p>
    ${criterio.length ? `<p class="liquidez-note__hint"><strong>Criterio de lectura</strong></p><ul class="liquidez-note__facts">${criterio.map((c) => `<li>${escHtml(c)}</li>`).join('')}</ul>` : ''}
    ${recs.length ? `<p class="liquidez-note__hint"><strong>Acciones sugeridas</strong></p><ul class="liquidez-note__facts">${recs.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderFinancialSummary(f, salesAnalytics, operaciones = {}, puntoEquilibrio = null) {
  const { fmt } = Dashboard;
  const { sales, service, inventory, consolidated } = f;
  const ops = operaciones;

  const unidades = ops.unidadesVendidas ?? sales.units;
  const retail = ops.retail ?? ops.retailUnits ?? sales.retailUnits ?? 0;
  const flotilla = ops.flotillas ?? ops.flotillaUnits ?? sales.flotillaUnits ?? 0;
  const ordenesAbiertas = Math.max(0, Number(service.ingresadas || 0) - Number(service.facturadas || 0));

  document.getElementById('financialSummary').innerHTML = [
    kpiGroup('Tablero ejecutivo · alta dirección', [
      kpiCard('Unidades vendidas', fmt.number(unidades), `${fmt.number(retail)} retail · ${fmt.number(flotilla)} flotilla`, 'blue', 'ovUnidades'),
      kpiCard('Utilidad bruta', fmt.currency(consolidated.utilidadVentas), `${sales.marginPct}% margen`, 'green', 'ovUtilidadBruta'),
      kpiCard('Ingreso ventas', fmt.currency(sales.revenue), 'venta subtotal · sin IVA', 'blue'),
      kpiCard('Ingreso consolidado', fmt.currency(consolidated.ingresoTotal), 'ventas + facturación taller', 'violet'),
      kpiCard('Órdenes taller', fmt.number(service.ingresadas), `${fmt.number(ordenesAbiertas)} pendientes de facturar`, 'blue', 'ovOrdenesTaller'),
      kpiCard('Facturación taller', fmt.currency(consolidated.facturacionServicio), `${fmt.number(service.facturadas)} facturadas · ${service.pctFacturado}%`, 'violet', 'ovFacturacionTaller'),
      kpiCard('Ticket taller', fmt.currency(service.ticketFacturado), 'promedio por orden facturada', 'violet', 'ovTicketTaller'),
      kpiCard('Mano de obra', fmt.currency(service.manoObra), `${pct(service.manoObra, service.importeFacturado)}% del facturado taller`, 'green', 'ovManoObra'),
      kpiCard('Inventario disponible', fmt.number(inventory.availableUnits), `${fmt.number(inventory.availableLibres ?? 0)} libres · ${fmt.number(inventory.availableApartadas ?? 0)} apartadas`, 'green'),
      kpiCard('Sin previas (stock)', fmt.number(inventory.sinPrevias), `${fmt.number(inventory.conPrevias ?? 0)} con previas`, 'amber', 'ovStockSinPrevias'),
      kpiCard('Plan piso', fmt.currency(inventory.planPisoTotal), `${fmt.number(inventory.planPisoUnits ?? 0)} unidades`, 'rose', 'ovPlanPiso'),
      kpiCard('Envejecidas 60+', fmt.number(inventory.ageingAlertsCount), 'alertas de aging en inventario', 'rose', 'ovAging'),
      kpiCard('Valor inventario', fmt.currency(consolidated.valorInventario), `${fmt.number(inventory.availableUnits)} uds. disponibles`, 'amber'),
      kpiCard('Días prom. inventario', `${inventory.avgDaysInventory || 0} días`, 'antigüedad promedio disponibles', 'blue'),
    ]),
    renderPuntoEquilibrioOverview(puntoEquilibrio),
    renderSalesAnalytics(salesAnalytics, fmt),
    kpiGroup('Servicio y postventa · <a href="/post-sales.html">ver detalle</a>', [
      kpiCard('Órdenes ingresadas', fmt.number(service.ingresadas), 'en el periodo', 'blue'),
      kpiCard('Facturadas', fmt.number(service.facturadas), `${service.pctFacturado}% del total`, 'green'),
      kpiCard('Importe facturado', fmt.currency(service.importeFacturado), `ticket prom. ${fmt.currency(service.ticketFacturado)}`, 'violet'),
      kpiCard('Mano de obra', fmt.currency(service.manoObra), `${pct(service.manoObra, service.importeFacturado)}% del facturado`, 'green'),
      kpiCard('Refacciones', fmt.currency(service.refacciones), `${pct(service.refacciones, service.importeFacturado)}% del facturado`, 'amber'),
    ]),
  ].join('');
}

async function renderOverview(fechaInicio, fechaFin) {
  const { api, setText, showLoading } = Dashboard;
  showLoading(true);
  try {
    const data = await api(`/overview?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    let salesAnalytics = data.salesAnalytics;
    if (!salesAnalytics?.rentabilidad) {
      salesAnalytics = await api(`/overview/analytics?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    }

    renderFinancialSummary(data.financial, salesAnalytics, data.operaciones || data.kpis || {}, data.puntoEquilibrio);

    setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);

    if (window.KpiInsights?.apply) {
      const f = data.financial || {};
      window.KpiInsights.apply('overview', {
        fechaInicio,
        fechaFin,
        operaciones: data.operaciones || data.kpis || {},
        financial: {
          sales: f.sales || {},
          service: f.service || {},
          inventory: f.inventory || {},
          consolidated: f.consolidated || {},
        },
        salesAnalytics: salesAnalytics || null,
        puntoEquilibrio: data.puntoEquilibrio || null,
      });
    }
  } finally {
    showLoading(false);
  }
}

Dashboard.initDateFilter({ onConsult: renderOverview });
