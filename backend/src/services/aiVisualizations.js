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

function kpiItem(label, value, opts = {}) {
  return {
    label,
    value,
    icon: opts.icon,
    sub: opts.sub,
    trend: opts.trend,
    trendUp: opts.trendUp,
    drilldown: opts.drilldown || null,
  };
}

function drilldownChart(title, items, opts = {}) {
  const chart = barChart(title, items, {
    labelKey: opts.labelKey || 'label',
    valueKey: opts.valueKey || 'count',
    horizontal: opts.horizontal !== false,
  });
  if (!chart) return null;
  return { ...chart, title: title || chart.title };
}

function drilldownTable(title, headers, rows) {
  if (!rows?.length) return null;
  return { type: 'table', title, headers, rows: rows.slice(0, 12) };
}

function drilldownRetailFilter(title, drillData, filtros = {}) {
  if (!drillData?.periodo?.length && !drillData?.fechas?.length) return null;
  return {
    type: 'retail-filter',
    title,
    fechaInicio: filtros.fechaInicio || null,
    fechaFin: filtros.fechaFin || null,
    fechas: drillData.fechas || [],
    byFecha: drillData.byFecha || {},
    periodo: drillData.periodo || [],
  };
}

function sucursalItems(items) {
  return (items || []).filter((i) => i.canal !== 'PERDIDA' && i.count > 0);
}

function dataTable(title, headers, rows) {
  if (!rows?.length) return null;
  return { type: 'table', title, headers, rows: rows.slice(0, 10) };
}

function insightCard(variant, title, text) {
  if (!text) return null;
  return { type: 'insight', variant, title, text };
}

function kpiRow(title, items) {
  const valid = (items || []).filter((i) => i && i.value != null);
  if (!valid.length) return null;
  return { type: 'kpi-row', title, items: valid };
}

function blocksFromVentas(data) {
  const blocks = [];
  const r = data.resumen;
  const ytd = data.comparativoYtd;
  if (!r) return blocks;

  const porSucursal = sucursalItems(r.porSucursal || r.porCanal);
  const porSucursalRetail = sucursalItems(r.porSucursalRetail);
  const porSucursalFlotilla = sucursalItems(r.porSucursalFlotilla || r.porCanal?.filter((c) => c.canal === 'FLOTILLAS'));

  blocks.push(kpiRow('Indicadores de ventas', [
    kpiItem('Total ventas', fmtNum(r.totalVentas), {
      sub: 'unidades',
      icon: 'directions_car',
      drilldown: drilldownChart('Ventas por sucursal', porSucursal),
    }),
    kpiItem('Retail', fmtNum(r.totalRetail), {
      sub: 'menudeo',
      icon: 'storefront',
      drilldown: drilldownRetailFilter(
        'Retail por sucursal',
        r.retailDrilldown,
        data.filtros,
      ) || drilldownChart('Retail por sucursal', porSucursalRetail),
    }),
    kpiItem('Flotilla', fmtNum(r.totalFlotillas), {
      sub: 'B2B',
      icon: 'local_shipping',
      drilldown: drilldownChart('Flotilla por sucursal', porSucursalFlotilla),
    }),
    kpiItem('Vendedores', fmtNum(r.totalVendedores), {
      sub: 'activos',
      icon: 'groups',
      drilldown: drilldownTable(
        'Top vendedores',
        ['Vendedor', 'Unidades'],
        topItems(r.porVendedor, 10).map((v) => [v.label, fmtNum(v.count)]),
      ),
    }),
  ]));

  if (ytd) {
    const variacion = ytd.variacion ?? ytd.variacionPct ?? ytd.deltaPct;
    blocks.push(kpiRow('Comparativo YTD', [
      kpiItem(`${ytd.anioActual || 'Año actual'}`, fmtNum(ytd.totalActual), {
        sub: 'unidades YTD',
        icon: 'calendar_today',
        drilldown: ytd.labels?.length && ytd.series?.actual
          ? drilldownChart('YTD · año actual', ytd.labels.map((label, i) => ({
            label,
            count: ytd.series.actual[i] || 0,
          })), { horizontal: false })
          : null,
      }),
      kpiItem(`${ytd.anioAnterior || 'Año anterior'}`, fmtNum(ytd.totalAnterior), {
        sub: 'mismo periodo',
        icon: 'history',
        drilldown: ytd.labels?.length && ytd.series?.anterior
          ? drilldownChart('YTD · año anterior', ytd.labels.map((label, i) => ({
            label,
            count: ytd.series.anterior[i] || 0,
          })), { horizontal: false })
          : null,
      }),
      kpiItem('Variación', variacion != null ? fmtPct(variacion) : '—', {
        sub: 'vs año anterior',
        icon: 'trending_up',
        trend: variacion,
        trendUp: Number(variacion) >= 0,
      }),
    ]));

    if (ytd.labels?.length && ytd.series) {
      const ytdLine = lineChart('YTD mensual comparativo', ytd.labels, [
        { label: String(ytd.anioActual), data: ytd.series.actual || [] },
        { label: String(ytd.anioAnterior), data: ytd.series.anterior || [] },
      ]);
      if (ytdLine) blocks.push(ytdLine);
    }
  }

  const sucursalChart = barChart('Ventas por sucursal', porSucursal, { horizontal: true });
  if (sucursalChart) blocks.push(sucursalChart);

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
    kpiItem('Unidades vendidas', fmtNum(k.totalUnits), {
      sub: 'en el periodo',
      icon: 'directions_car',
      drilldown: data.topModels?.length
        ? drilldownTable(
          'Top modelos vendidos',
          ['Modelo', 'Unidades', 'Stock'],
          topItems(data.topModels, 8).map((m) => [m.model, fmtNum(m.unitsSold), fmtNum(m.stock)]),
        )
        : null,
    }),
    kpiItem('Ingreso ventas', fmtMoney(k.totalRevenue), { sub: 'subtotal', icon: 'payments' }),
    kpiItem('Utilidad', fmtMoney(k.totalUtility), { sub: 'margen operativo', icon: 'savings' }),
    kpiItem('Inventario disp.', fmtNum(k.availableUnits), { sub: 'unidades', icon: 'inventory_2' }),
  ]));

  if (sales) {
    blocks.push(kpiRow('Desglose comercial', [
      kpiItem('Retail', fmtNum(sales.retailUnits), {
        icon: 'storefront',
        drilldown: drilldownTable('Retail vs flotilla', ['Canal', 'Unidades'], [
          ['Retail', fmtNum(sales.retailUnits)],
          ['Flotilla', fmtNum(sales.flotillaUnits)],
        ]),
      }),
      kpiItem('Flotilla', fmtNum(sales.flotillaUnits), { icon: 'local_shipping' }),
      kpiItem('Margen', fmtPct(sales.marginPct, false), { icon: 'percent' }),
      kpiItem('Ticket prom.', fmtMoney(sales.ticketPromedio), { icon: 'receipt_long' }),
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

  const branches = data.ventasAutosNuevosEeff?.branches || [];
  const branchDrill = branches.length
    ? drilldownChart('Ventas por sucursal (VTASMEN)', branches.map((b) => ({
      label: b.label,
      count: Math.round(b.ventas || 0),
    })), { valueKey: 'count' })
    : null;

  const items = [];
  if (summary.ventaTotal != null) {
    items.push(kpiItem('Venta total', fmtMoney(summary.ventaTotal), { icon: 'payments', drilldown: branchDrill }));
  } else if (summary.ventasTotales != null) {
    items.push(kpiItem('Ventas totales', fmtMoney(summary.ventasTotales), { icon: 'payments', drilldown: branchDrill }));
  }
  if (summary.utilidad != null) {
    items.push(kpiItem('Utilidad', fmtMoney(summary.utilidad), { icon: 'savings' }));
  } else if (summary.utilidadOperacion != null) {
    items.push(kpiItem('Utilidad operación', fmtMoney(summary.utilidadOperacion), { icon: 'savings' }));
  }
  if (summary.unidades != null) {
    items.push(kpiItem('Unidades', fmtNum(summary.unidades), { icon: 'directions_car', drilldown: branchDrill }));
  } else if (summary.unidadesVendidas != null) {
    items.push(kpiItem('Unidades vendidas', fmtNum(summary.unidadesVendidas), { icon: 'directions_car', drilldown: branchDrill }));
  }
  if (summary.margenPct != null) {
    items.push(kpiItem('Margen', fmtPct(summary.margenPct, false), { icon: 'percent' }));
  } else if (summary.margenOperacionPct != null) {
    items.push(kpiItem('Margen operación', fmtPct(summary.margenOperacionPct, false), { icon: 'percent' }));
  }

  if (items.length) blocks.push(kpiRow('Contabilidad', items));

  if (branches.length) {
    const sucursalChart = barChart(
      'Ventas por sucursal',
      branches.map((b) => ({ label: b.label, count: Math.round(b.ventas || 0) })),
      { horizontal: true },
    );
    if (sucursalChart) blocks.push(sucursalChart);
  }

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
    const histChart = history.slice(-12);
    const labels = [...histChart, ...forecast].map((p) => p.label);
    const line = lineChart('Histórico (12m) y proyección', labels, [
      { label: 'Real', data: [...histChart.map((p) => p.units), ...forecast.map(() => null)] },
      { label: 'Pronóstico', data: [...histChart.map((_, i) => (i === histChart.length - 1 ? histChart[i].units : null)), ...forecast.map((p) => p.units)] },
    ]);
    if (line) blocks.push(line);
  } else if (data.breakdown?.byTipo?.length) {
    const chart = doughnutChart('Mix pronóstico por tipo', data.breakdown.byTipo, { valueKey: 'units' });
    if (chart) blocks.push(chart);
  }

  return blocks.filter(Boolean);
}

function blocksFromVentasModelo(data) {
  const blocks = [];
  const r = data?.resumen;
  if (!r) return blocks;

  const porSucursal = sucursalItems(data.porSucursal);

  blocks.push(kpiRow(`${data.consulta?.modeloBuscado || 'Modelo'} · ventas`, [
    kpiItem('Unidades vendidas', fmtNum(r.unidadesVendidas), {
      sub: `${data.consulta?.fechaInicio} → ${data.consulta?.fechaFin}`,
      icon: 'directions_car',
      drilldown: drilldownChart('Por sucursal', porSucursal),
    }),
    kpiItem('Retail', fmtNum(r.retail), {
      sub: 'menudeo',
      icon: 'storefront',
      drilldown: drilldownRetailFilter(
        'Retail por sucursal',
        data.retailDrilldown,
        data.consulta,
      ) || drilldownChart('Retail por sucursal', sucursalItems(data.porSucursalRetail)),
    }),
    kpiItem('Flotilla', fmtNum(r.flotilla), {
      sub: 'B2B',
      icon: 'local_shipping',
      drilldown: drilldownChart('Flotilla', sucursalItems(data.porSucursalFlotilla)),
    }),
    kpiItem('Variantes', fmtNum(r.variantesDistintas), {
      sub: 'en catálogo',
      icon: 'category',
      drilldown: drilldownChart('Variantes encontradas', data.porVariante, { horizontal: true }),
    }),
  ]));

  const sucursalChart = barChart('Ventas por sucursal', porSucursal, { horizontal: true });
  if (sucursalChart) blocks.push(sucursalChart);

  const varianteChart = barChart('Variantes encontradas', data.porVariante, { horizontal: true });
  if (varianteChart) blocks.push(varianteChart);

  const mesChart = barChart('Ventas por mes', data.porMes);
  if (mesChart) blocks.push(mesChart);

  if (data.razonamiento?.length) {
    blocks.push(insightCard('info', 'Relación de datos', data.razonamiento.join(' ')));
  }

  return blocks.filter(Boolean);
}

function blocksFromVentasPorAuto(data) {
  const blocks = [];
  const r = data.resumen;
  if (!r) return blocks;

  blocks.push(kpiRow('Ventas por auto', [
    { label: 'Unidades', value: fmtNum(r.totalUnidades), sub: `${fmtNum(r.modelosDistintos)} modelos`, icon: 'directions_car' },
    { label: 'Venta', value: fmtMoney(r.ventaSubtotal), icon: 'payments' },
    { label: 'Utilidad', value: fmtMoney(r.utilidad), icon: 'savings' },
    { label: 'Margen', value: fmtPct(r.margenPct, false), icon: 'percent' },
  ]));

  if (data.porModelo?.length) {
    const chart = barChart('Unidades por modelo', data.porModelo.map((m) => ({
      label: m.modelo,
      count: m.unidades,
    })), { horizontal: true });
    if (chart) blocks.push(chart);

    const table = dataTable(
      'Desglose por modelo',
      ['Modelo', 'Unidades', 'Venta', 'Utilidad', 'Margen'],
      topItems(data.porModelo, 12).map((m) => [
        m.modelo.length > 35 ? `${m.modelo.slice(0, 35)}…` : m.modelo,
        fmtNum(m.unidades),
        fmtMoney(m.ventaSubtotal),
        fmtMoney(m.utilidad),
        m.margenPct != null ? fmtPct(m.margenPct, false) : '—',
      ]),
    );
    if (table) blocks.push(table);
  }

  if (data.unidades?.length) {
    const table = dataTable(
      'Detalle por unidad',
      ['Fecha', 'Modelo', 'Serie', 'Vendedor', 'Venta'],
      topItems(data.unidades, 10).map((u) => [
        u.fecha,
        u.modelo.length > 28 ? `${u.modelo.slice(0, 28)}…` : u.modelo,
        u.serie,
        u.vendedor.length > 22 ? `${u.vendedor.slice(0, 22)}…` : u.vendedor,
        fmtMoney(u.ventaSubtotal),
      ]),
    );
    if (table) blocks.push(table);
  }

  if (data.nota) {
    blocks.push(insightCard('info', 'Nota', data.nota));
  }

  return blocks.filter(Boolean);
}

const BUILDERS = {
  consultar_ventas_modelo: blocksFromVentasModelo,
  consultar_ventas: blocksFromVentas,
  consultar_ventas_por_auto: blocksFromVentasPorAuto,
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
