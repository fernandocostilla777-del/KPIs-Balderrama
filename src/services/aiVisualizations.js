const CHART_COLORS = [
  '#2D5BFF', '#9B51E0', '#27AE60', '#f59e0b', '#E056FD',
  '#3498db', '#e74c3c', '#1abc9c', '#95a5a6', '#2C3E50',
];

function fmtNum(n) {
  return new Intl.NumberFormat('es-MX').format(Math.round(n || 0));
}

function fmtMoney(n) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
}

function fmtPct(n, sign = true) {
  const v = Number(n || 0);
  const prefix = sign && v > 0 ? '+' : '';
  return `${prefix}${v.toFixed(1)}%`;
}

function topItems(items, limit = 6) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, limit);
}

function barChart(title, items, { labelKey = 'label', valueKey = 'count', horizontal = false } = {}) {
  const data = topItems(items, 8);
  if (!data.length) return null;
  return {
    type: 'chart',
    chartType: horizontal ? 'bar-h' : 'bar',
    title,
    labels: data.map((i) => i[labelKey] || i.label || '—'),
    datasets: [{
      label: 'Unidades',
      data: data.map((i) => Number(i[valueKey] ?? i.count ?? i.units ?? i.value ?? 0)),
      backgroundColor: CHART_COLORS,
    }],
  };
}

function doughnutChart(title, items, { labelKey = 'label', valueKey = 'count' } = {}) {
  const data = topItems(items, 6);
  if (!data.length) return null;
  return {
    type: 'chart',
    chartType: 'doughnut',
    title,
    labels: data.map((i) => i[labelKey] || i.label || '—'),
    datasets: [{
      data: data.map((i) => Number(i[valueKey] ?? i.count ?? i.units ?? 0)),
      backgroundColor: CHART_COLORS,
    }],
  };
}

function lineChart(title, labels, series) {
  if (!labels?.length || !series?.length) return null;
  return {
    type: 'chart',
    chartType: 'line',
    title,
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: s.data,
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: `${CHART_COLORS[i % CHART_COLORS.length]}22`,
      fill: true,
      tension: 0.35,
    })),
  };
}

function kpiRow(title, items) {
  const valid = (items || []).filter((i) => i && i.value != null);
  if (!valid.length) return null;
  return { type: 'kpi-row', title, items: valid };
}

function dataTable(title, headers, rows) {
  if (!rows?.length) return null;
  return { type: 'table', title, headers, rows: rows.slice(0, 10) };
}

function insightCard(variant, title, text) {
  if (!text) return null;
  return { type: 'insight', variant, title, text };
}

function blocksFromVentas(data) {
  const blocks = [];
  const r = data.resumen;
  const ytd = data.comparativoYtd;
  if (!r) return blocks;

  blocks.push(kpiRow('Indicadores de ventas', [
    { label: 'Total ventas', value: fmtNum(r.totalVentas), sub: 'unidades', icon: 'directions_car' },
    { label: 'Retail', value: fmtNum(r.totalRetail), sub: 'unidades', icon: 'storefront' },
    { label: 'Flotilla', value: fmtNum(r.totalFlotillas), sub: 'unidades', icon: 'local_shipping' },
    { label: 'Vendedores', value: fmtNum(r.totalVendedores), sub: 'activos', icon: 'groups' },
  ]));

  if (ytd) {
    const variacion = ytd.variacion ?? ytd.variacionPct ?? ytd.deltaPct;
    blocks.push(kpiRow('Comparativo YTD', [
      { label: `${ytd.anioActual || 'Año actual'}`, value: fmtNum(ytd.totalActual), sub: 'unidades YTD', icon: 'calendar_today' },
      { label: `${ytd.anioAnterior || 'Año anterior'}`, value: fmtNum(ytd.totalAnterior), sub: 'mismo periodo', icon: 'history' },
      {
        label: 'Variación',
        value: variacion != null ? fmtPct(variacion) : '—',
        sub: 'vs año anterior',
        icon: 'trending_up',
        trend: variacion,
        trendUp: Number(variacion) >= 0,
      },
    ]));

    if (ytd.labels?.length && ytd.series) {
      const ytdLine = lineChart('YTD mensual comparativo', ytd.labels, [
        { label: String(ytd.anioActual), data: ytd.series.actual || [] },
        { label: String(ytd.anioAnterior), data: ytd.series.anterior || [] },
      ]);
      if (ytdLine) blocks.push(ytdLine);
    }
  }

  const canalChart = barChart('Ventas por canal', r.porCanal, { horizontal: true });
  if (canalChart) blocks.push(canalChart);

  const tipoChart = doughnutChart('Distribución por tipo de venta', r.porTipoVenta);
  if (tipoChart) blocks.push(tipoChart);

  const vendedorTable = dataTable(
    'Top vendedores',
    ['Vendedor', 'Unidades'],
    topItems(r.porVendedor, 8).map((v) => [v.label, fmtNum(v.count)]),
  );
  if (vendedorTable) blocks.push(vendedorTable);

  const modeloChart = barChart('Modelos más vendidos', r.porModelo);
  if (modeloChart) blocks.push(modeloChart);

  if (r.comparativoMensual?.porMes?.length) {
    const meses = r.comparativoMensual.porMes;
    const line = lineChart('Tendencia mensual', meses.map((m) => m.label), [{
      label: 'Ventas',
      data: meses.map((m) => m.count),
    }]);
    if (line) blocks.push(line);
  }

  if (r.totalFlotillas === 0 && r.totalRetail > 0) {
    blocks.push(insightCard('warning', 'Oportunidad', 'No hay ventas de flotilla en el periodo. Vale la pena revisar estrategia comercial B2B.'));
  }

  return blocks.filter(Boolean);
}

function blocksFromOverview(data) {
  const blocks = [];
  const k = data.kpis;
  const sales = data.financial?.sales;
  if (!k) return blocks;

  blocks.push(kpiRow('Resumen ejecutivo', [
    { label: 'Unidades vendidas', value: fmtNum(k.totalUnits), sub: 'en el periodo', icon: 'directions_car' },
    { label: 'Ingreso ventas', value: fmtMoney(k.totalRevenue), sub: 'subtotal', icon: 'payments' },
    { label: 'Utilidad', value: fmtMoney(k.totalUtility), sub: 'margen operativo', icon: 'savings' },
    { label: 'Inventario disp.', value: fmtNum(k.availableUnits), sub: 'unidades', icon: 'inventory_2' },
  ]));

  if (sales) {
    blocks.push(kpiRow('Desglose comercial', [
      { label: 'Retail', value: fmtNum(sales.retailUnits), icon: 'storefront' },
      { label: 'Flotilla', value: fmtNum(sales.flotillaUnits), icon: 'local_shipping' },
      { label: 'Margen', value: fmtPct(sales.marginPct, false), icon: 'percent' },
      { label: 'Ticket prom.', value: fmtMoney(sales.ticketPromedio), icon: 'receipt_long' },
    ]));
  }

  const service = data.financial?.service;
  if (service) {
    blocks.push(kpiRow('Post-venta / servicio', [
      { label: 'Órdenes ingresadas', value: fmtNum(service.ingresadas), icon: 'build' },
      { label: 'Facturadas', value: fmtNum(service.facturadas), icon: 'check_circle' },
      { label: 'Importe facturado', value: fmtMoney(service.importeFacturado), icon: 'account_balance_wallet' },
      { label: '% facturado', value: fmtPct(service.pctFacturado, false), icon: 'pie_chart' },
    ]));
  }

  if (data.monthlyTrend?.length) {
    const line = lineChart(
      'Tendencia mensual de ventas',
      data.monthlyTrend.map((m) => m.label || m.month),
      [{ label: 'Unidades', data: data.monthlyTrend.map((m) => m.units || m.count || 0) }],
    );
    if (line) blocks.push(line);
  }

  if (data.byEstado?.length) {
    const estadoChart = barChart('Ventas por estado', data.byEstado.map((e) => ({
      label: e.estado || e.label,
      count: e.units || e.count,
    })));
    if (estadoChart) blocks.push(estadoChart);
  }

  if (data.topModels?.length) {
    const table = dataTable(
      'Top modelos',
      ['Modelo', 'Vendidos', 'Stock'],
      topItems(data.topModels, 8).map((m) => [m.model, fmtNum(m.unitsSold), fmtNum(m.stock)]),
    );
    if (table) blocks.push(table);
  }

  return blocks.filter(Boolean);
}

function blocksFromInventory(data) {
  const blocks = [];
  const summary = data.summary || data.resumen || data;
  if (!summary?.totalUnits && !data.byFamilia?.length) return blocks;

  blocks.push(kpiRow('Inventario', [
    { label: 'Total unidades', value: fmtNum(summary.totalUnits), icon: 'inventory_2' },
    { label: 'Disponibles', value: fmtNum(summary.available), icon: 'check_circle' },
    { label: 'Días prom.', value: fmtNum(summary.avgDaysAvailable), sub: 'en stock', icon: 'schedule' },
    { label: 'Plan piso', value: fmtMoney(summary.planPisoTotal), sub: `${fmtNum(summary.planPisoUnits)} unidades`, icon: 'account_balance' },
  ]));

  if (data.byFamilia?.length) {
    const chart = barChart('Inventario por familia', data.byFamilia.map((m) => ({
      label: m.familia || m.label,
      count: m.count || m.units || m.total,
    })), { horizontal: true });
    if (chart) blocks.push(chart);
  }

  if (data.ageingChart?.labels?.length) {
    const ageing = lineChart('Antigüedad de inventario', data.ageingChart.labels, [{
      label: 'Unidades',
      data: data.ageingChart.data || data.ageingChart.values || [],
    }]);
    if (ageing) blocks.push(ageing);
  }

  return blocks.filter(Boolean);
}

function blocksFromPostventa(data) {
  const blocks = [];
  const records = data.records?.total ?? data.records;
  if (!records && !data.openSnapshot) return blocks;

  const ingresadas = data.records?.ingresadas ?? data.total ?? 0;
  const facturadas = data.records?.facturadas ?? 0;

  blocks.push(kpiRow('Post-venta', [
    { label: 'Órdenes', value: fmtNum(data.total ?? ingresadas), icon: 'build' },
    { label: 'Abiertas', value: fmtNum(data.openTotal ?? data.openSnapshot?.length ?? 0), icon: 'pending' },
  ]));

  return blocks.filter(Boolean);
}

function blocksFromContabilidad(data) {
  const blocks = [];
  const summary = data.summary || data.resumen;
  if (!summary) return blocks;

  const items = [];
  if (summary.ventaTotal != null) items.push({ label: 'Venta total', value: fmtMoney(summary.ventaTotal), icon: 'payments' });
  if (summary.utilidad != null) items.push({ label: 'Utilidad', value: fmtMoney(summary.utilidad), icon: 'savings' });
  if (summary.unidades != null) items.push({ label: 'Unidades', value: fmtNum(summary.unidades), icon: 'directions_car' });
  if (summary.margenPct != null) items.push({ label: 'Margen', value: fmtPct(summary.margenPct, false), icon: 'percent' });

  if (items.length) blocks.push(kpiRow('Contabilidad', items));
  return blocks.filter(Boolean);
}

function blocksFromSql(data) {
  if (!data.datos?.length) return [];
  const cols = data.columnas || Object.keys(data.datos[0]);
  const rows = data.datos.slice(0, 8).map((row) => cols.map((c) => {
    const v = row[c];
    return typeof v === 'number' ? fmtNum(v) : String(v ?? '—');
  }));
  return [dataTable(`Resultado SQL (${data.filas} filas)`, cols, rows)].filter(Boolean);
}

function blocksFromForecast(data) {
  const blocks = [];
  const kpis = data.kpis;
  const history = data.history || [];
  const forecast = data.forecast || [];

  if (kpis) {
    blocks.push(kpiRow('Pronóstico', [
      { label: 'Próximo mes', value: fmtNum(kpis.nextMonthUnits), sub: kpis.nextMonthLabel, icon: 'event' },
      { label: 'Horizonte', value: fmtNum(kpis.horizonTotal), sub: `${kpis.horizonMonths} meses`, icon: 'timeline' },
      { label: 'Prom. 12 meses', value: fmtNum(kpis.avgLast12), icon: 'analytics' },
      {
        label: 'Variación',
        value: kpis.variationPct != null ? fmtPct(kpis.variationPct) : '—',
        trend: kpis.variationPct,
        trendUp: Number(kpis.variationPct) >= 0,
        icon: 'trending_up',
      },
    ]));
  }

  if (history.length || forecast.length) {
    const labels = [...history, ...forecast].map((p) => p.label);
    const line = lineChart('Histórico y proyección', labels, [
      { label: 'Real', data: [...history.map((p) => p.units), ...forecast.map(() => null)] },
      { label: 'Pronóstico', data: [...history.map(() => null), ...forecast.map((p) => p.units)] },
    ]);
    if (line) blocks.push(line);
  } else if (data.breakdown?.byTipo?.length) {
    const chart = doughnutChart('Mix pronóstico por tipo', data.breakdown.byTipo, { valueKey: 'units' });
    if (chart) blocks.push(chart);
  }

  return blocks.filter(Boolean);
}

const BUILDERS = {
  consultar_ventas: blocksFromVentas,
  consultar_resumen_ejecutivo: blocksFromOverview,
  consultar_analytics_ventas: (data) => {
    const blocks = [];
    const matrix = data.modelMatrix || data.matriz || data.quadrants;
    if (Array.isArray(matrix) && matrix.length) {
      blocks.push(dataTable(
        'Matriz modelo (volumen / margen)',
        ['Modelo', 'Unidades', 'Margen', 'Segmento'],
        topItems(matrix, 8).map((m) => [
          m.model || m.modelo,
          fmtNum(m.units || m.unidades),
          fmtPct(m.marginPct || m.margen, false),
          m.segment || m.segmento || '—',
        ]),
      ));
    }
    return blocks.filter(Boolean);
  },
  consultar_inventario: blocksFromInventory,
  consultar_postventa: blocksFromPostventa,
  consultar_contabilidad: blocksFromContabilidad,
  consultar_pronostico: blocksFromForecast,
  ejecutar_consulta_sql: blocksFromSql,
};

function buildVisualizations(toolSnapshots = []) {
  const blocks = [];
  const seen = new Set();

  for (const snap of toolSnapshots) {
    if (!snap?.name || snap.result?.error) continue;
    const builder = BUILDERS[snap.name];
    if (!builder) continue;

    const key = snap.name;
    if (seen.has(key)) continue;
    seen.add(key);

    const generated = builder(snap.result);
    for (const block of generated) {
      if (block) blocks.push(block);
    }
  }

  return blocks.slice(0, 8);
}

module.exports = { buildVisualizations, fmtNum, fmtMoney, fmtPct };
