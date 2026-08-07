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

function barChart(title, items, { labelKey = 'label', valueKey = 'count', horizontal = false, seriesLabel = 'Unidades' } = {}) {
  const data = topItems(items, 8);
  if (!data.length) return null;
  return {
    type: 'chart',
    chartType: horizontal ? 'bar-h' : 'bar',
    title,
    labels: data.map((i) => i[labelKey] || i.label || '—'),
    datasets: [{
      label: seriesLabel,
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
  const r = data.resumen;
  const areaLabel = data.interpretacion?.area || data.filtros?.area || 'PostVenta';

  if (r) {
    blocks.push(kpiRow(`PostVenta · ${areaLabel}`, [
      kpiItem('Órdenes filtradas', fmtNum(r.totalFiltrado), {
        sub: data.filtros?.estatus || 'todas',
        icon: 'build',
        drilldown: data.porEstatus?.length
          ? drilldownChart('Por estatus', data.porEstatus.map((e) => ({
            label: e.estatus,
            count: e.ordenes,
          })))
          : null,
      }),
      kpiItem('Abiertas en periodo', fmtNum(r.abiertasEnPeriodo), {
        icon: 'pending',
        sub: fmtMoney(r.importeAbierto),
      }),
      kpiItem('Facturadas', fmtNum(r.facturadasEnPeriodo), {
        icon: 'check_circle',
        sub: fmtMoney(r.importeFacturado),
        trend: r.pctFacturado,
        trendUp: Number(r.pctFacturado) >= 50,
      }),
      kpiItem('% facturado', r.pctFacturado != null ? fmtPct(r.pctFacturado, false) : '—', {
        icon: 'pie_chart',
        sub: `Abiertas actuales: ${fmtNum(r.abiertasActualesDelArea)}`,
      }),
    ]));

    blocks.push(kpiRow('Importes', [
      kpiItem('Importe filtrado', fmtMoney(r.importeFiltrado), { icon: 'payments' }),
      kpiItem('Importe abierto', fmtMoney(r.importeAbierto), { icon: 'hourglass_empty' }),
      kpiItem('Importe facturado', fmtMoney(r.importeFacturado), { icon: 'account_balance_wallet' }),
      kpiItem('Ingresadas área', fmtNum(r.ingresadasAreaPeriodo), { icon: 'login' }),
    ]));
  } else {
    const ingresadas = data.records?.ingresadas ?? data.total ?? 0;
    if (!ingresadas && !data.openSnapshot) return blocks;
    blocks.push(kpiRow('Post-venta', [
      { label: 'Órdenes', value: fmtNum(data.total ?? ingresadas), icon: 'build' },
      { label: 'Abiertas', value: fmtNum(data.openTotal ?? data.openSnapshot?.length ?? 0), icon: 'pending' },
    ]));
  }

  if (data.porEstatus?.length) {
    const chart = doughnutChart(
      'Distribución por estatus',
      data.porEstatus.map((e) => ({ label: e.estatus, count: e.ordenes })),
    );
    if (chart) blocks.push(chart);
  }

  if (data.porLetra?.length) {
    const chart = barChart(
      'Órdenes por letra de folio',
      data.porLetra.map((l) => ({
        label: l.letra || l.label,
        count: l.total ?? l.ordenes ?? l.count,
      })),
      { horizontal: true, seriesLabel: 'Órdenes' },
    );
    if (chart) blocks.push(chart);
  }

  if (data.porAsesor?.length) {
    const chart = barChart(
      'Órdenes por asesor',
      data.porAsesor.map((a) => ({ label: a.asesor, count: a.ordenes })),
      { horizontal: true, seriesLabel: 'Órdenes' },
    );
    if (chart) blocks.push(chart);

    const table = dataTable(
      'Asesores · detalle',
      ['Asesor', 'Órdenes', 'Abiertas', 'Facturadas', 'Importe'],
      topItems(data.porAsesor, 10).map((a) => [
        a.asesor,
        fmtNum(a.ordenes),
        fmtNum(a.abiertas),
        fmtNum(a.facturadas),
        fmtMoney(a.importe),
      ]),
    );
    if (table) blocks.push(table);
  }

  if (data.muestra?.length) {
    const table = dataTable(
      'Muestra de órdenes',
      ['Orden', 'Estatus', 'Cliente', 'Asesor', 'Importe'],
      topItems(data.muestra, 10).map((o) => [
        o.orden,
        o.statusLabel || o.status || '—',
        (o.cliente || '—').slice(0, 28),
        (o.asesor || '—').slice(0, 22),
        fmtMoney(o.importe),
      ]),
    );
    if (table) blocks.push(table);
  }

  if (data.advertencia) {
    blocks.push(insightCard('warning', 'Filtro de área', data.advertencia));
  } else if (data.interpretacion?.estatus) {
    blocks.push(insightCard('info', 'Criterio', `${data.interpretacion.area}. ${data.interpretacion.estatus}.`));
  }

  return blocks.filter(Boolean);
}

function blocksFromObjetivos(data) {
  const blocks = [];
  const retail = data.retail;
  const sofia = data.sofia;
  const avance = data.avance || {};
  if (retail == null && sofia == null && avance.retail == null) return blocks;

  const retailPct = retail > 0 && avance.retail != null
    ? Math.round((Number(avance.retail) / Number(retail)) * 1000) / 10
    : null;
  const sofiaPct = sofia > 0 && avance.retail != null
    ? Math.round((Number(avance.retail) / Number(sofia)) * 1000) / 10
    : null;

  blocks.push(kpiRow('Objetivos de ventas', [
    kpiItem('Objetivo retail', retail != null ? fmtNum(retail) : '—', {
      icon: 'flag',
      sub: data.retailSource === 'historic' ? `Histórico ${data.historicMonth || ''}`.trim() : 'Guardado',
    }),
    kpiItem('Objetivo SOFIA', sofia != null ? fmtNum(sofia) : '—', {
      icon: 'military_tech',
      sub: data.sofiaSource === 'historic' ? `Histórico ${data.historicMonth || ''}`.trim() : 'Guardado',
    }),
    kpiItem('Retail real', avance.retail != null ? fmtNum(avance.retail) : '—', {
      icon: 'storefront',
      sub: avance.total != null ? `Total periodo: ${fmtNum(avance.total)}` : undefined,
      trend: retailPct,
      trendUp: retailPct == null ? undefined : retailPct >= 100,
    }),
    kpiItem('Cobertura SOFIA', sofiaPct != null ? fmtPct(sofiaPct, false) : '—', {
      icon: 'speed',
      sub: retailPct != null ? `Avance retail ${fmtPct(retailPct, false)}` : undefined,
      trend: sofiaPct,
      trendUp: sofiaPct == null ? undefined : sofiaPct >= 100,
    }),
  ]));

  const metaItems = [];
  if (retail != null) metaItems.push({ label: 'Meta retail', count: Number(retail) });
  if (avance.retail != null) metaItems.push({ label: 'Retail real', count: Number(avance.retail) });
  if (sofia != null) metaItems.push({ label: 'Meta SOFIA', count: Number(sofia) });
  if (avance.flotilla != null) metaItems.push({ label: 'Flotilla', count: Number(avance.flotilla) });
  const metaChart = barChart('Meta vs avance', metaItems, { horizontal: true, seriesLabel: 'Unidades' });
  if (metaChart) blocks.push(metaChart);

  if (retailPct != null || sofiaPct != null) {
    let text = '';
    if (retailPct != null) {
      text += retailPct >= 100
        ? `Retail ya cubre la meta (${fmtPct(retailPct, false)}). `
        : `Retail lleva ${fmtPct(retailPct, false)} de la meta. `;
    }
    if (sofiaPct != null) {
      text += sofiaPct >= 100
        ? `Cobertura SOFIA alcanzada (${fmtPct(sofiaPct, false)}).`
        : `Faltan ${fmtNum(Math.max(0, Number(sofia) - Number(avance.retail || 0)))} unidades para SOFIA.`;
    }
    blocks.push(insightCard(
      (sofiaPct ?? retailPct ?? 0) >= 100 ? 'info' : 'warning',
      'Ritmo del periodo',
      text.trim(),
    ));
  }

  if (data.fechaInicio && data.fechaFin) {
    blocks.push(insightCard(
      'info',
      'Periodo',
      `Objetivos del ${data.fechaInicio} al ${data.fechaFin}.`,
    ));
  }

  return blocks.filter(Boolean);
}

function blocksFromVentasDia(data) {
  const blocks = [];
  const s = data.summary;
  const units = Array.isArray(data.units) ? data.units : [];
  if (!s && !units.length) return blocks;

  const retail = units.filter((u) => !u.flotilla).length;
  const flotilla = units.filter((u) => u.flotilla).length;

  blocks.push(kpiRow(`Ventas del día · ${data.fecha || ''}`, [
    kpiItem('Unidades', fmtNum(s?.units ?? units.length), { icon: 'directions_car' }),
    kpiItem('Venta', fmtMoney(s?.ventaSubtotal), { icon: 'payments' }),
    kpiItem('Utilidad', fmtMoney(s?.utilidad), { icon: 'savings' }),
    kpiItem('Margen', s?.margenPct != null ? fmtPct(s.margenPct, false) : '—', {
      icon: 'percent',
      sub: `Retail ${fmtNum(retail)} · Flotilla ${fmtNum(flotilla)}`,
    }),
  ]));

  const mix = [
    { label: 'Retail', count: retail },
    { label: 'Flotilla', count: flotilla },
  ].filter((x) => x.count > 0);
  const mixChart = doughnutChart('Mix del día', mix);
  if (mixChart) blocks.push(mixChart);

  if (units.length) {
    const byModelo = new Map();
    for (const u of units) {
      const key = u.modelo || 'Sin modelo';
      byModelo.set(key, (byModelo.get(key) || 0) + 1);
    }
    const modeloItems = [...byModelo.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    const modeloChart = barChart('Unidades por modelo', modeloItems, { horizontal: true });
    if (modeloChart) blocks.push(modeloChart);

    const byEstado = new Map();
    for (const u of units) {
      const key = u.estado || '—';
      byEstado.set(key, (byEstado.get(key) || 0) + 1);
    }
    if (byEstado.size > 1) {
      const estadoChart = doughnutChart(
        'Por sucursal/estado',
        [...byEstado.entries()].map(([label, count]) => ({ label, count })),
      );
      if (estadoChart) blocks.push(estadoChart);
    }

    const table = dataTable(
      'Detalle de unidades',
      ['Modelo', 'Cliente', 'Canal', 'Venta', 'Utilidad'],
      topItems(units, 12).map((u) => [
        (u.modelo || '—').slice(0, 28),
        (u.cliente || '—').slice(0, 22),
        u.flotilla ? 'Flotilla' : 'Retail',
        fmtMoney(u.ventaSubtotal),
        u.utilidad != null ? fmtMoney(u.utilidad) : '—',
      ]),
    );
    if (table) blocks.push(table);
  }

  return blocks.filter(Boolean);
}

function blocksFromAnalytics(data) {
  const blocks = [];
  const ren = data.rentabilidad;
  const aging = data.aging;
  const fi = data.fi;
  const fv = data.fuerzaVentas;
  if (!ren && !aging && !fv) return blocks;

  if (ren) {
    blocks.push(kpiRow('Analytics · rentabilidad', [
      kpiItem('Margen bruto', fmtPct(ren.margenBrutoPct, false), { icon: 'percent' }),
      kpiItem('Utilidad bruta', fmtMoney(ren.utilidadBrutaTotal), { icon: 'savings' }),
      kpiItem('Margen / unidad', fmtMoney(ren.margenBrutoUnitario), {
        icon: 'sell',
        sub: `${fmtNum(ren.unidadesAnalizadas)} unidades`,
      }),
      kpiItem('Bonificaciones', fmtMoney(ren.bonificacionesTotal), {
        icon: 'local_offer',
        sub: `${fmtPct(ren.bonificacionesPctGanancia, false)} de utilidad potencial`,
        trend: ren.bonificacionesPctGanancia,
        trendUp: Number(ren.bonificacionesPctGanancia) < 10,
      }),
    ]));
  }

  if (aging?.buckets?.length) {
    const agingChart = barChart(
      'Aging de inventario al vender',
      aging.buckets.map((b) => ({ label: b.label, count: b.units })),
      { horizontal: true, seriesLabel: 'Unidades' },
    );
    if (agingChart) blocks.push(agingChart);

    const agingTable = dataTable(
      'Aging · margen y bonificación',
      ['Bucket', 'Unidades', 'Margen avg', 'Bonif. avg'],
      aging.buckets.map((b) => [
        b.label,
        fmtNum(b.units),
        fmtPct(b.avgMarginPct, false),
        fmtMoney(b.avgBonificacion),
      ]),
    );
    if (agingTable) blocks.push(agingTable);

    if (aging.estancadosMayorDescuento) {
      blocks.push(insightCard(
        'warning',
        'Aging',
        'Las unidades estancadas (+60 días) concentran mayor bonificación promedio vs. sanas.',
      ));
    }
  }

  if (fi && (fi.creditoUnits || fi.contadoUnits)) {
    const fiMix = doughnutChart('Mix financiamiento', [
      { label: 'Crédito', count: fi.creditoUnits },
      { label: 'Contado', count: fi.contadoUnits },
    ].filter((x) => x.count > 0));
    if (fiMix) blocks.push(fiMix);

    blocks.push(kpiRow('F&I · margen', [
      kpiItem('Crédito', fmtPct(fi.creditoAvgMarginPct, false), {
        icon: 'credit_card',
        sub: `${fmtNum(fi.creditoUnits)} und · ${fmtMoney(fi.creditoAvgUtilidadUnit)}/u`,
      }),
      kpiItem('Contado', fmtPct(fi.contadoAvgMarginPct, false), {
        icon: 'payments',
        sub: `${fmtNum(fi.contadoUnits)} und · ${fmtMoney(fi.contadoAvgUtilidadUnit)}/u`,
      }),
      kpiItem('Más rentable', fi.masRentable === 'credito' ? 'Crédito' : fi.masRentable === 'contado' ? 'Contado' : 'Empate', {
        icon: 'emoji_events',
      }),
    ]));
  }

  if (fv?.ranking?.length) {
    const volChart = barChart(
      'Fuerza de ventas · volumen',
      fv.ranking.map((a) => ({ label: a.vendedor, count: a.units })),
      { horizontal: true, seriesLabel: 'Unidades' },
    );
    if (volChart) blocks.push(volChart);

    const marginChart = barChart(
      'Fuerza de ventas · margen %',
      fv.ranking.map((a) => ({ label: a.vendedor, count: a.avgMarginPct })),
      { horizontal: true, seriesLabel: 'Margen %' },
    );
    if (marginChart) blocks.push(marginChart);

    const table = dataTable(
      'Asesores · cuadrante',
      ['Asesor', 'Unidades', 'Margen %', 'Utilidad', 'Cuadrante'],
      topItems(fv.ranking, 10).map((a) => [
        a.vendedor,
        fmtNum(a.units),
        fmtPct(a.avgMarginPct, false),
        fmtMoney(a.utilidadTotal),
        a.quadrantLabel || a.quadrant || '—',
      ]),
    );
    if (table) blocks.push(table);
  }

  if (ren?.paretoTop?.length) {
    const table = dataTable(
      'Pareto · modelos que más aportan utilidad',
      ['Modelo', 'Unidades', 'Utilidad', '% acum.'],
      topItems(ren.paretoTop, 8).map((m) => [
        m.model || m.modelo,
        fmtNum(m.units || m.unidades),
        fmtMoney(m.utilidad ?? m.utilidadReportada),
        m.cumulativePct != null || m.pctAcum != null
          ? fmtPct(m.cumulativePct ?? m.pctAcum, false)
          : '—',
      ]),
    );
    if (table) blocks.push(table);
  }

  if (Array.isArray(data.recomendaciones) && data.recomendaciones.length) {
    blocks.push(insightCard(
      'info',
      'Recomendaciones',
      data.recomendaciones.slice(0, 3).join(' '),
    ));
  }

  return blocks.filter(Boolean);
}

function blocksFromQuejasCsi(data) {
  const blocks = [];
  if (!data) return blocks;

  const totales = data.totalesPersona || data.totales || {};
  const modo = data.modo || (data.encontrado ? 'persona' : 'ranking');

  blocks.push(kpiRow(modo === 'persona' ? 'Quejas CSI · persona' : 'Quejas CSI · panorama', [
    kpiItem('Total quejas', fmtNum(totales.total ?? data.totales?.total), { icon: 'report' }),
    kpiItem('Posventa / asesor', fmtNum(totales.posventa ?? data.totales?.posventa), {
      icon: 'build',
      sub: 'CSI Posventa',
    }),
    kpiItem('Ventas / ejecutivo', fmtNum(totales.ventas ?? data.totales?.ventas), {
      icon: 'storefront',
      sub: 'CSI Ventas',
    }),
    kpiItem('Área principal', (totales.porArea || data.porArea || [])[0]?.area || '—', {
      icon: 'category',
    }),
  ]));

  if (Array.isArray(data.porPersona) && data.porPersona.length) {
    const table = dataTable(
      'Coincidencias por nombre',
      ['Nombre', 'Rol', 'Quejas', 'Área top'],
      data.porPersona.map((p) => [
        p.nombre,
        p.rol === 'asesor_servicio' ? 'Asesor servicio' : 'Vendedor',
        fmtNum(p.quejas),
        p.porArea?.[0]?.area || '—',
      ]),
    );
    if (table) blocks.push(table);
  }

  if (data.rankingAsesoresServicio?.length) {
    const chart = barChart(
      'Ranking asesores de servicio (CSI Posventa)',
      data.rankingAsesoresServicio.map((r) => ({ label: r.asesor, count: r.quejas })),
      { horizontal: true, seriesLabel: 'Quejas' },
    );
    if (chart) blocks.push(chart);
  }

  if (data.rankingVendedores?.length) {
    const chart = barChart(
      'Ranking vendedores / ejecutivos (CSI Ventas)',
      data.rankingVendedores.map((r) => ({ label: r.vendedor, count: r.quejas })),
      { horizontal: true, seriesLabel: 'Quejas' },
    );
    if (chart) blocks.push(chart);
  }

  const areas = totales.porArea || data.porArea || [];
  if (areas.length) {
    const chart = doughnutChart(
      'Quejas por área',
      areas.map((a) => ({ label: a.area, count: a.count })),
    );
    if (chart) blocks.push(chart);
  }

  if (data.detalle?.length) {
    const table = dataTable(
      'Muestra de quejas',
      ['Fecha', 'Persona', 'Rol', 'Área', 'Cliente', 'Comentario'],
      topItems(data.detalle, 10).map((q) => [
        String(q.fecha || '—').slice(0, 10),
        (q.persona || '—').slice(0, 24),
        q.rol === 'asesor_servicio' ? 'Asesor' : 'Vendedor',
        (q.area || '—').slice(0, 22),
        (q.cliente || '—').slice(0, 20),
        (q.comentario || '—').slice(0, 50),
      ]),
    );
    if (table) blocks.push(table);
  }

  if (data.sugerencia) {
    blocks.push(insightCard('warning', 'Sin coincidencia', data.sugerencia));
  } else if (data.semantica?.tipoQuejas) {
    blocks.push(insightCard('info', 'Criterio', data.semantica.tipoQuejas));
  }

  return blocks.filter(Boolean);
}

function blocksFromBuscarCrm(data) {
  const blocks = [];
  const rows = Array.isArray(data.resultados) ? data.resultados : (Array.isArray(data) ? data : []);
  if (!rows.length) return blocks;

  blocks.push(kpiRow('Búsqueda CRM', [
    kpiItem('Coincidencias', fmtNum(rows.length), { icon: 'search' }),
    kpiItem('Con compras', fmtNum(rows.filter((r) => Number(r.compras || 0) > 0).length), { icon: 'sell' }),
    kpiItem('Con leads', fmtNum(rows.filter((r) => Number(r.leads || 0) > 0).length), { icon: 'diversity_3' }),
    kpiItem('Con solicitudes', fmtNum(rows.filter((r) => Number(r.solicitudes || 0) > 0).length), { icon: 'description' }),
  ]));

  const table = dataTable(
    'Resultados de búsqueda',
    ['ID CRM', 'Nombre', 'Ciclos', 'Actividades', 'Compras', 'Leads', 'Última act.'],
    topItems(rows, 12).map((r) => [
      r.id_contacto,
      (r.nombre || '—').slice(0, 30),
      fmtNum(r.ciclos),
      fmtNum(r.actividades),
      fmtNum(r.compras),
      fmtNum(r.leads || 0),
      String(r.ultima_actividad || '—').slice(0, 10),
    ]),
  );
  if (table) blocks.push(table);

  blocks.push(insightCard(
    'info',
    'Siguiente paso',
    'Usa historico_cliente_crm con el id_contacto para ver ficha 360, timeline, compras y taller.',
  ));

  return blocks.filter(Boolean);
}

function blocksFromHistoricoCrm(data) {
  const blocks = [];
  if (!data || data.encontrado === false) return blocks;

  const t = data.resumen || {};
  const f = data.ficha360 || {};
  const nombre = data.nombre || `Cliente ${data.idContacto || ''}`.trim();

  blocks.push(kpiRow(`CRM 360 · ${nombre}`, [
    kpiItem('Compras (VIN)', fmtNum(t.totalCompras ?? f.historialCompras), { icon: 'sell' }),
    kpiItem('Leads', fmtNum(t.totalLeads), { icon: 'diversity_3' }),
    kpiItem('Contratos F&I', fmtNum(t.totalContratosFinanciamiento), { icon: 'description' }),
    kpiItem('Órdenes taller', fmtNum(t.totalOrdenesServicio ?? f.serviciosRealizados), { icon: 'build' }),
  ]));

  if (f.modeloActual || f.vinActual || f.numeroContrato) {
    blocks.push(kpiRow('Unidad / contrato actual', [
      kpiItem('Modelo', f.modeloActual || '—', {
        icon: 'directions_car',
        sub: f.anModelo ? `Año ${f.anModelo}` : undefined,
      }),
      kpiItem('VIN', f.vinActual ? String(f.vinActual).slice(-8) : '—', {
        icon: 'pin',
        sub: f.fechaUltimaCompra || undefined,
      }),
      kpiItem('Contrato', f.numeroContrato || '—', {
        icon: 'receipt_long',
        sub: [f.tipoCompra, f.plazoContratado ? `${f.plazoContratado}m` : null].filter(Boolean).join(' · ') || undefined,
      }),
      kpiItem('Seguro', f.seguroAuto || '—', {
        icon: 'verified_user',
      }),
      kpiItem('Km', f.kilometraje != null ? fmtNum(f.kilometraje) : '—', {
        icon: 'speed',
        sub: f.ultimaVisitaTaller ? `Taller ${f.ultimaVisitaTaller}` : undefined,
      }),
    ]));
  }

  if (f.saldoEstimado != null || f.mensualidadesPagadas != null) {
    blocks.push(kpiRow('Financiamiento estimado', [
      kpiItem('Mensualidades', f.mensualidadesPagadas != null ? `${fmtNum(f.mensualidadesPagadas)}/${fmtNum(f.plazoContratado)}` : '—', { icon: 'calendar_month' }),
      kpiItem('Saldo est.', fmtMoney(f.saldoEstimado), { icon: 'account_balance' }),
      kpiItem('Valor est.', fmtMoney(f.valorEstimadoUnidad), { icon: 'payments' }),
      kpiItem('Quejas', fmtNum(f.quejasIncidencias ?? t.totalQuejas), {
        icon: 'report',
        sub: f.quejasAreaPrincipal || undefined,
      }),
    ]));
  }

  const timeline = Array.isArray(data.timeline360) ? data.timeline360 : [];
  if (timeline.length) {
    const byCat = new Map();
    for (const e of timeline) {
      const key = e.categoria || 'otro';
      byCat.set(key, (byCat.get(key) || 0) + 1);
    }
    const catChart = doughnutChart(
      'Timeline 360 · categorías',
      [...byCat.entries()].map(([label, count]) => ({ label, count })),
    );
    if (catChart) blocks.push(catChart);

    const tlTable = dataTable(
      'Timeline reciente',
      ['Fecha', 'Categoría', 'Evento', 'Detalle'],
      topItems(timeline, 10).map((e) => [
        String(e.fecha || '—').slice(0, 10),
        e.categoria || '—',
        (e.titulo || '—').slice(0, 28),
        (e.detalle || '—').slice(0, 40),
      ]),
    );
    if (tlTable) blocks.push(tlTable);
  }

  const compras = Array.isArray(data.compras) ? data.compras : [];
  if (compras.length) {
    const table = dataTable(
      'Compras',
      ['VIN', 'Producto', 'Factura', 'Entrega', 'Vendedor'],
      topItems(compras, 8).map((c) => [
        c.vin ? String(c.vin).slice(-8) : '—',
        (c.producto || '—').slice(0, 28),
        c.numFactura || '—',
        String(c.fechaEntrega || c.fechaFactura || '—').slice(0, 10),
        (c.vendedor || '—').slice(0, 20),
      ]),
    );
    if (table) blocks.push(table);
  }

  const contratos = Array.isArray(data.contratosFinanciamiento) ? data.contratosFinanciamiento : [];
  if (contratos.length) {
    const table = dataTable(
      'Contratos F&I',
      ['Contrato', 'Unidad', 'Plazo', 'Tipo', 'PVAs'],
      topItems(contratos, 8).map((c) => [
        c.no_contrato || c.contrato || '—',
        (c.unidad || '—').slice(0, 24),
        c.plazo_meses != null ? `${c.plazo_meses}m` : '—',
        c.tipo_compra || c.plan_2 || c.plan || '—',
        fmtNum(Array.isArray(c.pvas) ? c.pvas.length : 0),
      ]),
    );
    if (table) blocks.push(table);
  }

  if (f.metodologia?.saldo) {
    blocks.push(insightCard(
      'warning',
      'Nota metodológica',
      'Saldo y mensualidades son estimaciones lineales; no confirman pagos reales ni mora.',
    ));
  }

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
  const blocks = [];
  const cols = data.columnas || Object.keys(data.datos[0]);
  const sample = data.datos.slice(0, 25);

  const numericCols = cols.filter((c) =>
    sample.some((row) => typeof row[c] === 'number' && Number.isFinite(row[c])));
  const labelCol = cols.find((c) => !numericCols.includes(c)) || cols[0];
  const valueCol = numericCols.find((c) => c !== labelCol) || numericCols[0];

  if (labelCol && valueCol && sample.length >= 2) {
    const items = sample
      .map((row) => ({
        label: String(row[labelCol] ?? '—').slice(0, 28),
        count: Number(row[valueCol] || 0),
      }))
      .filter((i) => Number.isFinite(i.count))
      .sort((a, b) => Math.abs(b.count) - Math.abs(a.count));
    const chart = barChart(`SQL · ${valueCol} por ${labelCol}`, items, {
      horizontal: true,
      seriesLabel: valueCol,
    });
    if (chart) blocks.push(chart);
  }

  const rows = data.datos.slice(0, 10).map((row) => cols.map((c) => {
    const v = row[c];
    return typeof v === 'number' ? fmtNum(v) : String(v ?? '—');
  }));
  blocks.push(dataTable(`Resultado SQL (${data.filas} filas)`, cols, rows));
  return blocks.filter(Boolean);
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

function convPct(num, den) {
  const d = Number(den || 0);
  if (!d) return 0;
  return Math.round((Number(num || 0) / d) * 10000) / 100;
}

function blocksFromLeads(data) {
  const blocks = [];
  const t = data.totales || {};
  const grupos = Array.isArray(data.grupos) ? data.grupos : [];
  const leads = Number(t.leads || 0);
  const contactados = Number(t.contactados || 0);
  const citas = Number(t.citas || 0);
  const compras = Number(t.compras || 0);
  const agrupar = data.agruparPor || 'canal';
  const dimLabel = {
    canal: 'canal',
    sucursal: 'sucursal',
    ejecutivo: 'ejecutivo',
    campana: 'campaña',
    resultado: 'resultado',
    tipo: 'tipo',
    mes: 'mes',
  }[agrupar] || agrupar;

  if (!leads && !grupos.length) return blocks;

  blocks.push(kpiRow('Leads · embudo de conversión', [
    kpiItem('Leads', fmtNum(leads), { icon: 'diversity_3', sub: data.filtros?.periodo || 'cohorte' }),
    kpiItem('Contactados', fmtNum(contactados), { icon: 'call', sub: `${convPct(contactados, leads)}%` }),
    kpiItem('Citas', fmtNum(citas), { icon: 'event', sub: `${convPct(citas, leads)}%` }),
    kpiItem('Compras (VIN)', fmtNum(compras), {
      icon: 'sell',
      sub: `${convPct(compras, leads)}% conversión`,
      trend: convPct(compras, leads),
      trendUp: compras > 0,
    }),
  ]));

  if (grupos.length) {
    const leadsChart = barChart(
      `Leads por ${dimLabel}`,
      grupos.map((g) => ({ label: g.grupo, count: Number(g.leads || 0) })),
      { horizontal: true, seriesLabel: 'Leads' },
    );
    if (leadsChart) blocks.push(leadsChart);

    if (grupos.some((g) => Number(g.compras || 0) > 0)) {
      const comprasChart = barChart(
        `Compras por ${dimLabel}`,
        grupos.map((g) => ({ label: g.grupo, count: Number(g.compras || 0) })),
        { horizontal: true, seriesLabel: 'Compras' },
      );
      if (comprasChart) blocks.push(comprasChart);
    }

    const convChart = barChart(
      `Conversión % por ${dimLabel}`,
      grupos.map((g) => ({
        label: g.grupo,
        count: convPct(g.compras, g.leads),
      })),
      { horizontal: true, seriesLabel: 'Conversión %' },
    );
    if (convChart) blocks.push(convChart);

    const table = dataTable(
      `Detalle por ${dimLabel}`,
      ['Grupo', 'Leads', 'Contactados', 'Citas', 'Compras', 'Conv. %'],
      topItems(grupos, 10).map((g) => [
        g.grupo,
        fmtNum(g.leads),
        fmtNum(g.contactados),
        fmtNum(g.citas),
        fmtNum(g.compras),
        `${convPct(g.compras, g.leads)}%`,
      ]),
    );
    if (table) blocks.push(table);

    const byVolume = [...grupos].sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0))[0];
    const byConversion = [...grupos]
      .filter((g) => Number(g.leads || 0) >= Math.max(20, leads * 0.05))
      .sort((a, b) => convPct(b.compras, b.leads) - convPct(a.compras, a.leads))[0];
    if (byVolume) {
      let text = `${byVolume.grupo} concentra más volumen (${fmtNum(byVolume.leads)} leads, ${convPct(byVolume.compras, byVolume.leads)}% conv.).`;
      if (byConversion && byConversion.grupo !== byVolume.grupo) {
        text += ` Mejor conversión relativa: ${byConversion.grupo} (${convPct(byConversion.compras, byConversion.leads)}%).`;
      }
      blocks.push(insightCard('info', 'Lectura de canales', text));
    }
  }

  if (data.semantica?.compras || data.reglaCompra) {
    blocks.push(insightCard(
      'warning',
      'Nota metodológica',
      data.semantica?.compras || data.reglaCompra,
    ));
  }

  return blocks.filter(Boolean);
}

function blocksFromSeguimiento360(data) {
  const blocks = [];
  const leads = data.leads || {};
  const solicitudes = data.solicitudes || {};
  const pruebas = data.pruebasManejo || {};
  const conv = data.conversiones || {};

  if (!leads.total && !solicitudes.total && !pruebas.total) return blocks;

  blocks.push(kpiRow('Seguimiento 360 · conversiones', [
    kpiItem('Leads', fmtNum(leads.total), { icon: 'diversity_3', sub: `${fmtNum(leads.conCompra)} con compra` }),
    kpiItem('Lead → compra', `${Number(conv.leadACompraPct || 0).toFixed(1)}%`, { icon: 'trending_up' }),
    kpiItem('Solicitudes F&I', fmtNum(solicitudes.total), { icon: 'description', sub: `${fmtNum(solicitudes.conCompra)} con compra` }),
    kpiItem('Pruebas manejo', fmtNum(pruebas.total), { icon: 'speed', sub: `${fmtNum(pruebas.conCompra)} con compra` }),
  ]));

  const funnel = [
    { label: 'Leads', count: Number(leads.total || 0) },
    { label: 'Contactados', count: Number(leads.contactados || 0) },
    { label: 'Citas', count: Number(leads.citas || 0) },
    { label: 'Compras', count: Number(leads.conCompra || 0) },
  ].filter((x) => x.count > 0);
  const funnelChart = barChart('Embudo leads', funnel, { horizontal: true, seriesLabel: 'Cantidad' });
  if (funnelChart) blocks.push(funnelChart);

  const mix = [
    { label: 'Leads', count: Number(leads.total || 0) },
    { label: 'Solicitudes', count: Number(solicitudes.total || 0) },
    { label: 'Pruebas', count: Number(pruebas.total || 0) },
  ].filter((x) => x.count > 0);
  const mixChart = doughnutChart('Volumen por fuente 360', mix);
  if (mixChart) blocks.push(mixChart);

  return blocks.filter(Boolean);
}

const BUILDERS = {
  consultar_ventas_modelo: blocksFromVentasModelo,
  consultar_ventas: blocksFromVentas,
  consultar_ventas_por_auto: blocksFromVentasPorAuto,
  consultar_resumen_ejecutivo: blocksFromOverview,
  consultar_analytics_ventas: blocksFromAnalytics,
  consultar_inventario: blocksFromInventory,
  consultar_postventa: blocksFromPostventa,
  consultar_contabilidad: blocksFromContabilidad,
  consultar_ventas_dia: blocksFromVentasDia,
  consultar_objetivos_ventas: blocksFromObjetivos,
  consultar_pronostico: blocksFromForecast,
  consultar_quejas_csi: blocksFromQuejasCsi,
  buscar_cliente_crm: blocksFromBuscarCrm,
  historico_cliente_crm: blocksFromHistoricoCrm,
  resumen_leads: blocksFromLeads,
  resumen_seguimiento_360: blocksFromSeguimiento360,
  consultar_recomendaciones_directivas: (data) => {
    if (!data?.available) return [];
    const blocks = [];
    const ritmo = data.ritmo || {};
    const recs = data.recomendaciones || [];
    blocks.push(kpiRow('Recomendaciones directivas', [
      kpiItem('Señal', String(ritmo.senalPresion || '—').replace(/_/g, ' '), { icon: 'campaign' }),
      kpiItem('Avance retail', ritmo.retailAvancePct != null ? `${ritmo.retailAvancePct}%` : '—', {
        icon: 'trending_up',
        sub: ritmo.paceEsperadoPct != null ? `Ritmo ${ritmo.paceEsperadoPct}%` : undefined,
      }),
      kpiItem('Faltan', ritmo.faltanRetail != null ? fmtNum(ritmo.faltanRetail) : '—', {
        icon: 'flag',
        sub: ritmo.runRateNecesarioUdsDia != null ? `${ritmo.runRateNecesarioUdsDia}/día` : undefined,
      }),
      kpiItem('Cuellos', fmtNum((data.funnel?.cuellos || []).length), { icon: 'warning' }),
    ]));
    const funnelBars = [
      { label: 'Leads/día', count: Number(data.funnel?.ritmos?.leadsPorDia?.actual || 0) },
      { label: 'Citas/día', count: Number(data.funnel?.ritmos?.citasPorDia?.actual || 0) },
      { label: 'Solic./día', count: Number(data.funnel?.ritmos?.solicitudesPorDia?.actual || 0) },
    ].filter((x) => x.count > 0);
    const funnelChart = barChart('Ritmo embudo / día', funnelBars, { horizontal: true, seriesLabel: 'Por día' });
    if (funnelChart) blocks.push(funnelChart);
    if (recs.length) {
      blocks.push(dataTable(
        'Prioridades gerencia',
        ['#', 'Área', 'Acción'],
        recs.slice(0, 5).map((r, i) => [String(i + 1), r.titulo || r.area || '—', r.accion || '—']),
      ));
    }
    if (data.diagnosticoEjecutivo) {
      blocks.push(insightCard('warning', 'Diagnóstico', data.diagnosticoEjecutivo));
    }
    return blocks.filter(Boolean);
  },
  listar_vendedores_360: (data) => {
    const rows = data?.vendedores || [];
    if (!rows.length) return [];
    const blocks = [
      kpiRow('Vendedores · Seguimiento 360', [
        kpiItem('Vendedores', fmtNum(rows.length), { icon: 'groups' }),
        kpiItem('Clientes (top)', fmtNum(Math.max(...rows.map((v) => Number(v.clientes || 0)), 0)), { icon: 'group' }),
      ]),
      dataTable(
        'Ranking de vendedores',
        ['Vendedor', 'Clientes', 'Fuentes'],
        topItems(rows, 12).map((v) => [
          v.vendedor,
          fmtNum(v.clientes),
          Array.isArray(v.fuentes) ? v.fuentes.join(', ') : '—',
        ]),
      ),
    ];
    const chart = barChart(
      'Clientes por vendedor',
      rows.map((v) => ({ label: v.vendedor, count: Number(v.clientes || 0) })),
      { horizontal: true, seriesLabel: 'Clientes' },
    );
    if (chart) blocks.splice(1, 0, chart);
    return blocks.filter(Boolean);
  },
  consultar_financiamiento: (data) => {
    if (!data?.available) {
      return [insightCard('warn', 'F&I', data?.reason || 'Sin base CRM de financiamiento')].filter(Boolean);
    }
    const blocks = [];
    const mod = data.modalidad?.aplicada || 'todos';
    const modLabel = mod === 'leasing' ? 'Leasing' : mod === 'credito' ? 'Crédito' : 'F&I';
    const p = data.periodo || {};
    const r = data.resumen || {};
    const lider = data.lider;

    blocks.push(kpiRow(`${modLabel} · ${p.key || 'periodo'}`, [
      kpiItem('Contratos', fmtNum(r.contratos), {
        icon: 'description',
        sub: `${p.fechaInicio || '—'} → ${p.fechaFin || '—'}`,
      }),
      kpiItem('Crédito (periodo)', fmtNum(r.creditoEnPeriodo), { icon: 'credit_card' }),
      kpiItem('Leasing (periodo)', fmtNum(r.leasingEnPeriodo), { icon: 'key' }),
      kpiItem('Líder', lider?.asesor || '—', {
        icon: 'emoji_events',
        sub: lider ? `${fmtNum(lider.contratos)} contratos` : 'sin datos',
      }),
    ]));

    const ranking = Array.isArray(data.rankingAsesores) ? data.rankingAsesores : [];
    if (ranking.length) {
      const chart = barChart(
        `Top asesores · ${modLabel}`,
        ranking.slice(0, 8).map((a) => ({ label: a.asesor, count: Number(a.contratos || 0) })),
        { horizontal: true, seriesLabel: 'Contratos' },
      );
      if (chart) blocks.push(chart);
      const table = dataTable(
        'Ranking asesores F&I',
        ['#', 'Asesor', 'Contratos', '%'],
        ranking.slice(0, 10).map((a) => [
          a.rank,
          a.asesor,
          fmtNum(a.contratos),
          a.pct != null ? `${a.pct}%` : '—',
        ]),
      );
      if (table) blocks.push(table);
    }

    const sugeridos = Array.isArray(data.periodosSugeridos) ? data.periodosSugeridos : [];
    if (sugeridos.length) {
      blocks.push(insightCard(
        'info',
        'Periodos sugeridos',
        sugeridos.map((s) => {
          const top = s.topAsesor ? ` · líder ${s.topAsesor.asesor} (${s.topAsesor.contratos})` : '';
          return `${s.label}: ${fmtNum(s.contratos)} contratos${top}`;
        }).join(' · '),
      ));
    }

    return blocks.filter(Boolean);
  },
  consultar_utilidad_carline: (data) => {
    if (!data?.available) {
      return [insightCard('warn', 'Utilidad carline', data?.reason || 'Sin datos')].filter(Boolean);
    }
    const blocks = [];
    const p = data.periodo || {};
    const r = data.resumen || {};
    const lider = data.lider;
    const rows = Array.isArray(data.porCarline) ? data.porCarline : [];

    blocks.push(kpiRow(`Utilidad por carline · ${p.label || p.key || 'periodo'}`, [
      kpiItem('Carlines', fmtNum(r.carlines), {
        icon: 'directions_car',
        sub: `${p.fechaInicio || '—'} → ${p.fechaFin || '—'}`,
      }),
      kpiItem('Unidades', fmtNum(r.unidades), { icon: 'inventory_2' }),
      kpiItem('Utilidad total', fmtMoney(r.utilidadTotal), { icon: 'savings' }),
      kpiItem('Top versión', lider?.version || '—', {
        icon: 'emoji_events',
        sub: lider
          ? `${lider.carline} · margen ${lider.margenBrutoPct != null ? `${lider.margenBrutoPct}%` : '—'}`
          : 'sin datos',
      }),
    ]));

    if (rows.length) {
      const chart = barChart(
        'Mejor utilidad promedio por carline',
        rows.slice(0, 10).map((c) => ({
          label: c.carline,
          count: Number(c.mejorVersion?.utilidadPromedio || 0),
        })),
        { horizontal: true, seriesLabel: 'Utilidad prom.' },
      );
      if (chart) blocks.push(chart);

      const table = dataTable(
        'Mejor versión por carline',
        ['Carline', 'Versión', 'Uds', 'Util. prom.', 'Margen bruto'],
        rows.slice(0, 15).map((c) => {
          const m = c.mejorVersion || {};
          return [
            c.carline,
            m.version || '—',
            fmtNum(m.unidades),
            fmtMoney(m.utilidadPromedio),
            m.margenBrutoPct != null ? `${m.margenBrutoPct}%` : '—',
          ];
        }),
      );
      if (table) blocks.push(table);
    }

    const sugeridos = Array.isArray(data.periodosSugeridos) ? data.periodosSugeridos : [];
    if (sugeridos.length) {
      blocks.push(insightCard(
        'info',
        'Periodos sugeridos',
        sugeridos.map((s) => {
          const t = s.topVersion
            ? ` · top ${s.topVersion.carline}: ${s.topVersion.version} (${s.topVersion.margenBrutoPct}% MB)`
            : '';
          return `${s.label}${t}`;
        }).join(' · '),
      ));
    }

    return blocks.filter(Boolean);
  },
  resumen_vendedor_360: (data) => {
    if (!data?.vendedor) return [];
    const t = data.totales || {};
    const d = data.desempenoComercial || {};
    const q = data.quejasCsi || {};
    const blocks = [
      kpiRow(`Seguimiento 360 · ${data.vendedor}`, [
        kpiItem('Unidades vendidas', fmtNum(d.unidadesVendidas), { icon: 'directions_car', sub: d.fuenteUnidades || 'libro' }),
        kpiItem('Clientes', fmtNum(t.clientes), { icon: 'group' }),
        kpiItem('Contratos F&I', fmtNum(d.contratosFi), { icon: 'description' }),
        kpiItem('Promedio PVAs', d.promedioCantidadPvasPorContrato ?? '—', { icon: 'add_shopping_cart', sub: 'productos/contrato' }),
        kpiItem('Pruebas de manejo', fmtNum(t.pruebas), { icon: 'speed' }),
        kpiItem('Retorno taller', d.retornoTallerPct != null ? `${d.retornoTallerPct}%` : '—', { icon: 'build' }),
      ]),
    ];
    if (Number(q.total || 0) > 0 || q.encontrado) {
      blocks.push(kpiRow('Quejas CSI vinculadas', [
        kpiItem('Total', fmtNum(q.total), { icon: 'report' }),
        kpiItem('Como asesor', fmtNum(q.posventa), { icon: 'build', sub: 'CSI Posventa' }),
        kpiItem('Como vendedor', fmtNum(q.ventas), { icon: 'storefront', sub: 'CSI Ventas' }),
        kpiItem('Área top', q.porArea?.[0]?.area || '—', { icon: 'category' }),
      ]));
      if (q.muestra?.length) {
        blocks.push(dataTable(
          'Muestra de quejas CSI',
          ['Fecha', 'Rol', 'Área', 'Comentario'],
          topItems(q.muestra, 8).map((row) => [
            String(row.fecha || '—').slice(0, 10),
            row.rol === 'asesor_servicio' ? 'Asesor' : 'Vendedor',
            (row.area || '—').slice(0, 22),
            (row.comentario || '—').slice(0, 55),
          ]),
        ));
      }
    }
    if (Array.isArray(d.plazos) && d.plazos.length) {
      blocks.push(barChart(
        'Distribución de plazos',
        d.plazos.map((p) => ({ label: `${p.plazo}m`, count: p.count })),
        { seriesLabel: 'Contratos' },
      ));
    }
    if (Array.isArray(d.pvasPorTipo) && d.pvasPorTipo.length) {
      blocks.push(doughnutChart(
        'Mix PVAs',
        d.pvasPorTipo.map((p) => ({
          label: p.label || p.producto || '—',
          count: Number(p.contratos ?? p.count ?? 0),
        })),
      ));
      blocks.push(dataTable(
        'PVAs por producto',
        ['Producto', 'Contratos', 'Penetración'],
        topItems(d.pvasPorTipo, 8).map((p) => [
          p.label || p.producto || '—',
          fmtNum(p.contratos ?? p.count),
          p.penetracionPct != null ? `${p.penetracionPct}%` : '—',
        ]),
      ));
    }
    return blocks.filter(Boolean);
  },
  ejecutar_consulta_sql: blocksFromSql,
  consultar_lista_precios: (data) => {
    if (!data) return [];
    if (data.available === false) {
      return [insightCard('warn', 'Lista de precios', 'No hay catálogo de planes vigente publicado.')].filter(Boolean);
    }
    const blocks = [];
    const k = data.kpis || {};
    blocks.push(kpiRow(`Lista de precios · ${data.seccionLabel || data.seccion || 'Planes'}`, [
      kpiItem('Vigencia', data.vigencia || '—', { icon: 'event' }),
      kpiItem('Modelos', fmtNum((data.modelos || []).length), {
        icon: 'directions_car',
        sub: data.fuentePdf || undefined,
      }),
      kpiItem('Versiones c/stock', fmtNum(k.versionesConStock ?? k.conStock ?? '—'), { icon: 'inventory_2' }),
      kpiItem('Unidades', fmtNum(k.unidadesDisponibles ?? k.stockTotal ?? '—'), { icon: 'garage' }),
    ]));
    const rows = [];
    for (const m of (data.modelos || []).slice(0, 8)) {
      for (const v of (m.versions || []).slice(0, 2)) {
        rows.push([
          m.modelo,
          v.version,
          fmtMoney(v.precioVentaGmmx ?? v.msrp),
          fmtNum(v.stockDisponible),
          fmtMoney(v.resumen?.precioFinalDesde),
        ]);
      }
    }
    if (rows.length) {
      blocks.push(dataTable(
        'Precio de Venta GMMX · muestra',
        ['Modelo', 'Versión', 'GMMX', 'Stock', 'Desde'],
        rows,
      ));
    }
    const stockBars = (data.modelos || [])
      .map((m) => ({ label: m.modelo, count: Number(m.stockTotal || 0) }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
    const chart = barChart('Stock por modelo', stockBars, { horizontal: true, seriesLabel: 'Unidades' });
    if (chart) blocks.push(chart);
    return blocks.filter(Boolean);
  },
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

  return blocks.slice(0, 14);
}

module.exports = { buildVisualizations, fmtNum, fmtMoney, fmtPct };
