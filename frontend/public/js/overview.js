let trendChart, estadoChart;

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

  const { rentabilidad: r, aging, fi, fuerzaVentas, recomendaciones } = a;
  const money = (n) => fmt.money(n);

  const paretoTopRows = r.paretoTop.map((m) => `
    <tr>
      <td><strong>${m.model}</strong></td>
      <td>${fmt.number(m.units)}</td>
      <td>${money(m.utilidad)}</td>
      <td>${m.marginPct}%</td>
      <td>${m.sharePct}%</td>
      <td>${m.cumulativePct}% acum.</td>
    </tr>`);

  const paretoBottomRows = r.paretoBottom.map((m) => `
    <tr>
      <td><strong>${m.model}</strong></td>
      <td>${fmt.number(m.units)}</td>
      <td>${m.marginPct}%</td>
      <td>${money(m.utilidad)}</td>
      <td>${money(m.bonificacion)}</td>
    </tr>`);

  const bonifRows = r.bonificacionesPorModelo.map((m) => `
    <tr>
      <td><strong>${m.model}</strong></td>
      <td>${fmt.number(m.units)}</td>
      <td>${money(m.bonificacion)}</td>
      <td>${m.pctGanancia}%</td>
    </tr>`);

  const bonifTable = bonifRows.length
    ? analyticsTable(['Modelo', 'Uds.', 'Descuento / bonificación', '% utilidad bruta'], bonifRows)
    : `<p class="kpi-subtitle">${money(r.bonificacionesTotal)} en descuentos/bonificaciones agregados (${r.bonificacionesPctGanancia}% de la utilidad bruta).</p>`;

  const agingRows = aging.buckets.map((b) => `
    <tr>
      <td><strong>${b.label}</strong></td>
      <td>${fmt.number(b.units)}</td>
      <td>${b.avgMarginPct}%</td>
      <td>${money(b.avgBonificacion)}</td>
    </tr>`);

  const advisorRows = fuerzaVentas.ranking.slice(0, 15).map((v) => `
    <tr>
      <td><strong>${v.vendedor}</strong></td>
      <td>${fmt.number(v.units)}</td>
      <td>${money(v.avgUtilidadUnit)}</td>
      <td>${v.avgMarginPct}%</td>
      <td>${money(v.utilidadTotal)}</td>
      <td>${quadrantBadge(v.quadrant, v.quadrantLabel)}</td>
    </tr>`);

  const fiMasRentable = fi.masRentable === 'credito'
    ? 'Crédito retiene mayor margen'
    : fi.masRentable === 'contado'
      ? 'Contado retiene mayor margen'
      : 'Margen similar entre crédito y contado';

  const agingInsight = aging.estancadosMayorDescuento
    ? 'Sí — unidades +60 días salieron con bonificaciones mayores que las sanas.'
    : 'No — los estancados no muestran bonificaciones superiores en promedio.';

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
        '<p class="analytics-table-label">Top 3 modelos — concentración Pareto de utilidad</p>',
        analyticsTable(['Modelo', 'Uds.', 'Utilidad', 'Margen', 'Share', 'Acumulado'], paretoTopRows, 'Sin utilidad positiva en el periodo.'),
        '<p class="analytics-table-label">Bottom 3 — menor margen bruto (mín. 2 uds.)</p>',
        analyticsTable(['Modelo', 'Uds.', 'Margen', 'Utilidad', 'Bonificaciones'], paretoBottomRows, 'Insuficientes datos por modelo.'),
        '<p class="analytics-table-label">Descuentos y bonificaciones por modelo</p>',
        bonifTable,
      ].join('')
    ),
    analyticsBlock(
      '2. Eficiencia de inventario y flujo de efectivo',
      'Un auto parado es dinero que cuesta (costo de piso o plan piso).',
      [
        kpiGroup('', [
          kpiCard('Aging al facturar', aging.buckets.map((b) => b.label.split(' ')[0]).join(' · '), aging.sinDatoUnits ? `${aging.sinDatoUnits} sin fecha remisión` : 'días remisión → venta', 'violet'),
          kpiCard('Estancados + descuento', aging.estancadosMayorDescuento ? 'Sí' : 'No', agingInsight, aging.estancadosMayorDescuento ? 'rose' : 'green'),
        ]),
        analyticsTable(['Bloque aging', 'Uds.', 'Margen bruto prom.', 'Bonificación prom.'], agingRows, 'Sin ventas con dato de inventario.'),
      ].join('')
    ),
    analyticsBlock(
      '3. Penetración F&amp;I (financiamiento)',
      'El piso gana por volumen; la agencia gana por financiamiento.',
      [
        kpiGroup('', [
          kpiCard('Crédito', `${fi.creditoPct}%`, `${fmt.number(fi.creditoUnits)} uds. · margen ${fi.creditoAvgMarginPct}%`, 'blue'),
          kpiCard('Contado', `${fi.contadoPct}%`, `${fmt.number(fi.contadoUnits)} uds. · margen ${fi.contadoAvgMarginPct}%`, 'green'),
          kpiCard('Conclusión F&I', fiMasRentable, fi.excluidasFlotilla ? `${fi.excluidasFlotilla} uds. flotilla/perdida excluidas` : 'retail y crédito bancario', 'violet'),
        ]),
      ].join('')
    ),
    analyticsBlock(
      '4. Desempeño de la fuerza de ventas',
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

function renderFinancialSummary(f, salesAnalytics, operaciones = {}) {
  const { fmt } = Dashboard;
  const { sales, service, inventory, consolidated } = f;
  const ops = operaciones;

  const unidades = ops.unidadesVendidas ?? sales.units;
  const retail = ops.retail ?? ops.retailUnits ?? sales.retailUnits ?? 0;
  const flotilla = ops.flotillas ?? ops.flotillaUnits ?? sales.flotillaUnits ?? 0;
  const entregasSofia = ops.entregasSofia ?? 0;
  const sinTimbrar = ops.sinTimbrar ?? 0;
  const entregasSinPrevias = ops.entregasSinPrevias ?? 0;

  document.getElementById('financialSummary').innerHTML = [
    kpiGroup('Tablero ejecutivo · alta dirección', [
      kpiCard('Unidades vendidas', fmt.number(unidades), `${fmt.number(retail)} retail · ${fmt.number(flotilla)} flotilla`, 'blue', 'ovUnidades'),
      kpiCard('Utilidad bruta', fmt.currency(consolidated.utilidadVentas), `${sales.marginPct}% margen`, 'green', 'ovUtilidadBruta'),
      kpiCard('Ingreso ventas', fmt.currency(sales.revenue), 'venta subtotal · sin IVA', 'blue'),
      kpiCard('Ingreso consolidado', fmt.currency(consolidated.ingresoTotal), 'ventas + facturación taller', 'violet'),
      kpiCard('Ticket promedio', fmt.currency(sales.ticketPromedio), 'por unidad vendida', 'violet'),
      kpiCard('Entregas SOFIA', fmt.number(entregasSofia), `${fmt.number(sinTimbrar)} sin timbrar`, 'amber', 'ovEntregasSofia'),
      kpiCard('Entregas sin previa', fmt.number(entregasSinPrevias), 'de entregas SOFIA del periodo', 'amber', 'ovEntregasSinPrevias'),
      kpiCard('Facturación taller', fmt.currency(consolidated.facturacionServicio), `${fmt.number(service.ingresadas)} órdenes · ${service.pctFacturado}% facturadas`, 'violet', 'ovFacturacionTaller'),
      kpiCard('Inventario disponible', fmt.number(inventory.availableUnits), `${fmt.number(inventory.availableLibres ?? 0)} libres · ${fmt.number(inventory.availableApartadas ?? 0)} apartadas`, 'green'),
      kpiCard('Sin previas (stock)', fmt.number(inventory.sinPrevias), `${fmt.number(inventory.conPrevias ?? 0)} con previas`, 'amber', 'ovStockSinPrevias'),
      kpiCard('Plan piso', fmt.currency(inventory.planPisoTotal), `${fmt.number(inventory.planPisoUnits ?? 0)} unidades`, 'rose', 'ovPlanPiso'),
      kpiCard('Envejecidas 60+', fmt.number(inventory.ageingAlertsCount), 'alertas de aging en inventario', 'rose', 'ovAging'),
      kpiCard('Valor inventario', fmt.currency(consolidated.valorInventario), `${fmt.number(inventory.availableUnits)} uds. disponibles`, 'amber'),
      kpiCard('Días prom. inventario', `${inventory.avgDaysInventory || 0} días`, 'antigüedad promedio disponibles', 'blue'),
    ]),
    renderSalesAnalytics(salesAnalytics, fmt),
    kpiGroup('Servicio y postventa · <a href="/post-sales.html">ver detalle</a>', [
      kpiCard('Órdenes ingresadas', fmt.number(service.ingresadas), 'en el periodo', 'blue'),
      kpiCard('Facturadas', fmt.number(service.facturadas), `${service.pctFacturado}% del total`, 'green'),
      kpiCard('Importe facturado', fmt.currency(service.importeFacturado), `ticket prom. ${fmt.currency(service.ticketFacturado)}`, 'violet'),
      kpiCard('Mano de obra', fmt.currency(service.manoObra), `${pct(service.manoObra, service.importeFacturado)}% del facturado`, 'green'),
      kpiCard('Refacciones', fmt.currency(service.refacciones), `${pct(service.refacciones, service.importeFacturado)}% del facturado`, 'amber'),
    ]),
    kpiGroup('Inventario nuevos · <a href="/inventory.html">ver detalle</a>', [
      kpiCard('Unidades totales', fmt.number(inventory.totalUnits), 'registradas en stock', 'blue'),
      kpiCard('Disponibles', fmt.number(inventory.availableUnits), `${pct(inventory.availableUnits, inventory.totalUnits)}% del total`, 'green'),
      kpiCard('Sin previas', fmt.number(inventory.sinPrevias), `${fmt.number(inventory.conPrevias ?? 0)} con previas`, 'amber'),
      kpiCard('Plan piso', fmt.currency(inventory.planPisoTotal), `${fmt.number(inventory.planPisoUnits ?? 0)} unidades`, 'rose'),
      kpiCard('Días prom. inventario', `${inventory.avgDaysInventory} días`, 'rotación ventas periodo', 'blue'),
    ]),
  ].join('');
}

async function renderOverview(fechaInicio, fechaFin) {
  const { fmt, api, setText, statusBadge, chartOptions, chartPalette, showLoading } = Dashboard;
  showLoading(true);
  try {
    const data = await api(`/overview?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    let salesAnalytics = data.salesAnalytics;
    if (!salesAnalytics?.rentabilidad) {
      salesAnalytics = await api(`/overview/analytics?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    }

    renderFinancialSummary(data.financial, salesAnalytics, data.operaciones || data.kpis || {});

  setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);

  document.getElementById('modelsTable').innerHTML = data.topModels.length
    ? data.topModels.map((m) => `
      <tr>
        <td>${m.model}</td>
        <td style="color:#7F8C8D">${m.brand}</td>
        <td><strong>${fmt.number(m.unitsSold)}</strong></td>
        <td>${fmt.number(m.stock)}</td>
        <td>${statusBadge(m.status)}</td>
      </tr>`).join('')
    : '<tr class="empty-row"><td colspan="5">Sin datos en el periodo seleccionado.</td></tr>';

  const labels = data.monthlyTrend.map((r) => fmt.monthLabel(r.yr, r.mo));
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Unidades', data: data.monthlyTrend.map((r) => r.units), borderColor: chartPalette[0], backgroundColor: 'rgba(45,91,255,0.08)', fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3 },
        { label: 'Ingresos (k)', data: data.monthlyTrend.map((r) => Math.round(r.revenue / 1000)), borderColor: chartPalette[2], tension: 0.35, borderWidth: 2.5, pointRadius: 3 },
      ],
    },
    options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
  });

  if (estadoChart) estadoChart.destroy();
  estadoChart = new Chart(document.getElementById('estadoChart'), {
    type: 'doughnut',
    data: {
      labels: data.byEstado.map((r) => r.state),
      datasets: [{ data: data.byEstado.map((r) => r.units), backgroundColor: chartPalette, borderWidth: 0 }],
    },
    options: chartOptions({ plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }),
  });

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
    });
  }
  } finally {
    showLoading(false);
  }
}

Dashboard.initDateFilter({ onConsult: renderOverview });
