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

const SUMMARY_SLOT_COUNT = 8;

const SUMMARY_SIZES = [
  { id: 'sm', spaces: 1, label: '1 espacio', description: 'Un cuarto de fila', icon: 'view_column' },
  { id: 'md', spaces: 2, label: '2 espacios', description: 'Media fila', icon: 'view_week' },
  { id: 'lg', spaces: 3, label: '3 espacios', description: 'Tres cuartos de fila', icon: 'table_rows' },
  { id: 'xl', spaces: 4, label: '4 espacios', description: 'Fila completa', icon: 'width_full' },
];
const SUMMARY_SIZE_IDS = SUMMARY_SIZES.map((s) => s.id);
const DEFAULT_SUMMARY_SIZE = 'md';
const SUMMARY_HEIGHTS = [1, 2, 3];
const DEFAULT_SUMMARY_HEIGHT = 1;
const SUMMARY_VIEW_IDS = ['number', 'chart'];
const DEFAULT_SUMMARY_VIEW = 'number';
const SUMMARY_RESIZE_HANDLES = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
const SUMMARY_RESIZE_CURSOR = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

let summaryResizeSession = null;
let summaryIgnoreClick = false;

function normalizeSizes(sizes) {
  const input = Array.isArray(sizes) ? sizes : [];
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) =>
    (SUMMARY_SIZE_IDS.includes(input[index]) ? input[index] : DEFAULT_SUMMARY_SIZE));
}

function normalizeHeights(heights) {
  const input = Array.isArray(heights) ? heights : [];
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) => {
    const value = Number(input[index]);
    return SUMMARY_HEIGHTS.includes(value) ? value : DEFAULT_SUMMARY_HEIGHT;
  });
}

function normalizeViews(views) {
  const input = Array.isArray(views) ? views : [];
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) => {
    const value = String(input[index] || '').trim().toLowerCase();
    return SUMMARY_VIEW_IDS.includes(value) ? value : DEFAULT_SUMMARY_VIEW;
  });
}

function sizeMeta(sizeId) {
  return SUMMARY_SIZES.find((item) => item.id === sizeId) || SUMMARY_SIZES[1];
}

function sizeFromSpaces(spaces) {
  return SUMMARY_SIZES.find((item) => item.spaces === spaces)?.id || DEFAULT_SUMMARY_SIZE;
}

function layoutHint(size, height) {
  const widthLabel = sizeMeta(size).label;
  if (!height || height <= 1) return widthLabel;
  return `${widthLabel} · ${height} de alto`;
}

function renderResizeChrome(index, size, height = DEFAULT_SUMMARY_HEIGHT) {
  return `
    <span class="summary-slot__size-hint">${escHtml(layoutHint(size, height))}</span>
    ${SUMMARY_RESIZE_HANDLES.map((handle) => `
      <button type="button" class="summary-slot__resize summary-slot__resize--${handle}"
        data-summary-resize="${index}" data-resize-corner="${handle}"
        aria-label="Arrastra para cambiar el tamaño hacia ${handle}"></button>
    `).join('')}`;
}

const summaryState = {
  prefs: null,
  catalog: [],
  groups: [],
  profile: { roleId: '', label: '', hint: '', items: [] },
  roleLabel: '',
  lastPayload: null,
  draftSlots: Array(SUMMARY_SLOT_COUNT).fill(null),
  draftSizes: normalizeSizes([]),
  draftHeights: normalizeHeights([]),
  draftViews: normalizeViews([]),
  activeSlot: 0,
  editMode: false,
};

function pctPart(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

const SUMMARY_METRIC_ICONS = {
  unidades: 'directions_car',
  utilidad_bruta: 'savings',
  ingreso_ventas: 'payments',
  ingreso_consolidado: 'account_balance',
  margen_bruto_real: 'percent',
  asesores_activos: 'groups',
  alerta_margen: 'warning',
  retail_units: 'storefront',
  flotilla_units: 'local_shipping',
  inventario_disponible: 'inventory_2',
  sin_previas: 'build_circle',
  plan_piso: 'credit_card',
  aging_60: 'hourglass_bottom',
  valor_inventario: 'warehouse',
  dias_inventario: 'schedule',
  demos: 'directions_car',
  entregas_sin_previas: 'no_photography',
  utilidad_neta_cierre: 'account_balance_wallet',
  ingreso_fi_cierre: 'account_balance',
  iemc_f2: 'monitoring',
  ordenes_taller: 'construction',
  facturacion_taller: 'receipt_long',
  ticket_taller: 'confirmation_number',
  mano_obra: 'engineering',
  refacciones: 'settings',
  ordenes_facturadas: 'task_alt',
  punto_equilibrio: 'balance',
  cobertura_equilibrio: 'speed',
};

const SUMMARY_METRIC_LINKS = {
  unidades: '/sales.html',
  utilidad_bruta: '/sales.html',
  ingreso_ventas: '/sales.html',
  ingreso_consolidado: '/contabilidad.html',
  margen_bruto_real: '/sales.html',
  asesores_activos: '/sales.html',
  alerta_margen: '/sales.html',
  retail_units: '/sales.html',
  flotilla_units: '/sales.html',
  inventario_disponible: '/inventory.html',
  sin_previas: '/inventory.html',
  plan_piso: '/inventory.html',
  aging_60: '/inventory.html',
  valor_inventario: '/inventory.html',
  dias_inventario: '/inventory.html',
  demos: '/inventory.html',
  entregas_sin_previas: '/inventory.html',
  utilidad_neta_cierre: '/inventory.html?tab=cierre',
  ingreso_fi_cierre: '/inventory.html?tab=cierre',
  iemc_f2: '/inventory.html?tab=cierre',
  ordenes_taller: '/post-sales.html',
  facturacion_taller: '/post-sales.html',
  ticket_taller: '/post-sales.html',
  mano_obra: '/post-sales.html',
  refacciones: '/post-sales.html',
  ordenes_facturadas: '/post-sales.html',
  punto_equilibrio: '/contabilidad.html',
  cobertura_equilibrio: '/contabilidad.html',
};

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function resolveSummaryMetric(id, ctx) {
  const { fmt } = Dashboard;
  const { sales, service, inventory, consolidated } = ctx.financial || {};
  const ops = ctx.operaciones || {};
  const cierre = ctx.cierre || {};
  const a = ctx.salesAnalytics;
  const pe = ctx.puntoEquilibrio?.agencia || ctx.puntoEquilibrio?.summary || {};
  const unidades = ops.unidadesVendidas ?? sales?.units ?? 0;
  const retail = ops.retail ?? ops.retailUnits ?? sales?.retailUnits ?? 0;
  const flotilla = ops.flotillas ?? ops.flotillaUnits ?? sales?.flotillaUnits ?? 0;
  const ordenesAbiertas = Math.max(0, Number(service?.ingresadas || 0) - Number(service?.facturadas || 0));
  const ranking = a?.fuerzaVentas?.ranking || [];
  const entregasSinPrevias = Number(ops.entregasSinPrevias ?? 0);
  const entregasSofia = Number(ops.entregasSofia ?? 0);
  const cierreUds = Number(cierre.unidades ?? 0);

  const map = {
    unidades: {
      value: fmt.number(unidades),
      sub: `${fmt.number(retail)} retail · ${fmt.number(flotilla)} flotilla`,
      progress: { pct: pctPart(retail, unidades), label: 'Participación retail' },
      details: [
        { label: 'Unidades totales', value: fmt.number(unidades) },
        { label: 'Retail', value: `${fmt.number(retail)} · ${pctPart(retail, unidades)}%` },
        { label: 'Flotilla', value: `${fmt.number(flotilla)} · ${pctPart(flotilla, unidades)}%` },
        { label: 'Ingreso de ventas', value: fmt.currency(sales?.revenue) },
        { label: 'Ticket promedio', value: fmt.currency(sales?.ticketPromedio) },
      ],
      note: 'Unidades facturadas en el periodo, separadas por canal de venta.',
    },
    utilidad_bruta: {
      value: fmt.currency(consolidated?.utilidadVentas),
      sub: `${sales?.marginPct ?? '—'}% margen`,
      progress: { pct: sales?.marginPct, label: 'Margen sobre venta' },
      details: [
        { label: 'Utilidad bruta', value: fmt.currency(consolidated?.utilidadVentas) },
        { label: 'Ingreso de ventas', value: fmt.currency(sales?.revenue) },
        { label: 'Margen', value: sales?.marginPct != null ? `${sales.marginPct}%` : '—' },
        { label: 'Unidades vendidas', value: fmt.number(unidades) },
      ],
      note: 'Utilidad de ventas de unidades. El margen se calcula sobre la venta subtotal.',
    },
    ingreso_ventas: {
      value: fmt.currency(sales?.revenue),
      sub: 'venta subtotal · sin IVA',
      details: [
        { label: 'Ingreso de ventas', value: fmt.currency(sales?.revenue) },
        { label: 'Unidades', value: fmt.number(unidades) },
        { label: 'Ticket promedio', value: fmt.currency(sales?.ticketPromedio) },
        { label: 'Utilidad bruta', value: fmt.currency(consolidated?.utilidadVentas) },
      ],
      note: 'Venta subtotal sin IVA registrada en el periodo.',
    },
    ingreso_consolidado: {
      value: fmt.currency(consolidated?.ingresoTotal),
      sub: 'ventas + facturación taller',
      progress: {
        pct: pctPart(sales?.revenue, consolidated?.ingresoTotal),
        label: 'Peso de ventas en el ingreso',
      },
      details: [
        { label: 'Ingreso consolidado', value: fmt.currency(consolidated?.ingresoTotal) },
        { label: 'Ventas', value: fmt.currency(sales?.revenue) },
        { label: 'Facturación taller', value: fmt.currency(consolidated?.facturacionServicio ?? service?.importeFacturado) },
      ],
      note: 'Suma del ingreso de ventas de unidades y la facturación de postventa.',
    },
    margen_bruto_real: {
      value: a?.rentabilidad ? `${a.rentabilidad.margenBrutoPct}%` : '—',
      sub: a?.rentabilidad
        ? `${fmt.currency(a.rentabilidad.margenBrutoUnitario)} prom. por unidad`
        : 'Sin análisis de margen',
      progress: { pct: a?.rentabilidad?.margenBrutoPct, label: 'Margen bruto real' },
      details: a?.rentabilidad ? [
        { label: 'Margen bruto', value: `${a.rentabilidad.margenBrutoPct}%` },
        { label: 'Utilidad por unidad', value: fmt.currency(a.rentabilidad.margenBrutoUnitario) },
        { label: 'Utilidad bruta total', value: fmt.currency(a.rentabilidad.utilidadBrutaTotal) },
        { label: 'Unidades analizadas', value: fmt.number(a.rentabilidad.unidadesAnalizadas) },
        { label: 'Impacto de descuentos', value: `${a.rentabilidad.bonificacionesPctGanancia}%` },
      ] : [],
      note: 'Margen calculado solo sobre unidades con costo registrado.',
    },
    asesores_activos: {
      value: fmt.number(ranking.length),
      sub: a?.fuerzaVentas?.medians
        ? `mediana volumen: ${a.fuerzaVentas.medians.volume} uds.`
        : 'asesores con movimiento',
      details: [
        { label: 'Asesores con movimiento', value: fmt.number(ranking.length) },
        { label: 'Mediana de volumen', value: a?.fuerzaVentas?.medians ? `${a.fuerzaVentas.medians.volume} uds.` : '—' },
        { label: 'Mediana utilidad/unidad', value: fmt.currency(a?.fuerzaVentas?.medians?.quality) },
        { label: 'Top asesor', value: ranking[0] ? `${ranking[0].vendedor} · ${fmt.number(ranking[0].units)} uds.` : '—' },
      ],
      note: 'Fuerza de ventas con al menos una unidad facturada en el periodo.',
    },
    alerta_margen: {
      value: fmt.number(ranking.filter((v) => v.quadrant === 'regalo').length),
      sub: 'asesores alto volumen · bajo margen',
      details: [
        { label: 'Asesores en alerta', value: fmt.number(ranking.filter((v) => v.quadrant === 'regalo').length) },
        { label: 'Asesores activos', value: fmt.number(ranking.length) },
        { label: 'Mediana utilidad/unidad', value: fmt.currency(a?.fuerzaVentas?.medians?.quality) },
      ],
      note: 'Asesores que venden mucho volumen sacrificando utilidad por unidad.',
    },
    retail_units: {
      value: fmt.number(retail),
      sub: 'unidades canal retail',
      progress: { pct: pctPart(retail, unidades), label: 'Del total de unidades' },
      details: [
        { label: 'Retail', value: fmt.number(retail) },
        { label: 'Flotilla', value: fmt.number(flotilla) },
        { label: 'Total unidades', value: fmt.number(unidades) },
      ],
      note: 'Ventas a cliente final (canal retail).',
    },
    flotilla_units: {
      value: fmt.number(flotilla),
      sub: 'unidades canal flotilla',
      progress: { pct: pctPart(flotilla, unidades), label: 'Del total de unidades' },
      details: [
        { label: 'Flotilla', value: fmt.number(flotilla) },
        { label: 'Retail', value: fmt.number(retail) },
        { label: 'Total unidades', value: fmt.number(unidades) },
      ],
      note: 'Ventas corporativas o de flotilla.',
    },
    inventario_disponible: {
      value: fmt.number(inventory?.availableUnits),
      sub: `${fmt.number(inventory?.availableLibres ?? 0)} libres · ${fmt.number(inventory?.availableApartadas ?? 0)} apartadas`,
      progress: {
        pct: pctPart(inventory?.availableLibres, inventory?.availableUnits),
        label: 'Unidades libres',
      },
      details: [
        { label: 'Disponibles', value: fmt.number(inventory?.availableUnits) },
        { label: 'Libres', value: fmt.number(inventory?.availableLibres ?? 0) },
        { label: 'Apartadas', value: fmt.number(inventory?.availableApartadas ?? 0) },
        { label: 'Valor de inventario', value: fmt.currency(consolidated?.valorInventario) },
        { label: 'Antigüedad promedio', value: `${inventory?.avgDaysInventory || 0} días` },
      ],
      note: 'Unidades en piso disponibles para venta, libres y apartadas.',
    },
    sin_previas: {
      value: fmt.number(inventory?.sinPrevias),
      sub: `${fmt.number(inventory?.conPrevias ?? 0)} con previas`,
      progress: {
        pct: pctPart(inventory?.sinPrevias, (Number(inventory?.sinPrevias || 0) + Number(inventory?.conPrevias || 0))),
        label: 'Stock sin previa',
      },
      details: [
        { label: 'Sin previas', value: fmt.number(inventory?.sinPrevias) },
        { label: 'Con previas', value: fmt.number(inventory?.conPrevias ?? 0) },
        { label: 'Disponibles', value: fmt.number(inventory?.availableUnits) },
      ],
      note: 'Unidades que aún no pasan por preparación de taller antes de entrega.',
    },
    plan_piso: {
      value: fmt.currency(inventory?.planPisoTotal),
      sub: `${fmt.number(inventory?.planPisoUnits ?? 0)} unidades`,
      details: [
        { label: 'Intereses plan piso', value: fmt.currency(inventory?.planPisoTotal) },
        { label: 'Unidades en plan piso', value: fmt.number(inventory?.planPisoUnits ?? 0) },
        { label: 'Valor de inventario', value: fmt.currency(consolidated?.valorInventario) },
      ],
      note: 'Costo financiero acumulado del inventario financiado con plan piso.',
    },
    aging_60: {
      value: fmt.number(inventory?.ageingAlertsCount),
      sub: 'alertas de antigüedad en inventario',
      details: [
        { label: 'Alertas de antigüedad', value: fmt.number(inventory?.ageingAlertsCount) },
        { label: 'Disponibles', value: fmt.number(inventory?.availableUnits) },
        { label: 'Antigüedad promedio', value: `${inventory?.avgDaysInventory || 0} días` },
      ],
      note: 'Unidades con permanencia prolongada en piso; presionan plan piso y margen.',
    },
    valor_inventario: {
      value: fmt.currency(consolidated?.valorInventario),
      sub: `${fmt.number(inventory?.availableUnits ?? 0)} uds. disponibles`,
      details: [
        { label: 'Valor de inventario', value: fmt.currency(consolidated?.valorInventario) },
        { label: 'Unidades disponibles', value: fmt.number(inventory?.availableUnits ?? 0) },
        { label: 'Antigüedad promedio', value: `${inventory?.avgDaysInventory || 0} días` },
        { label: 'Intereses plan piso', value: fmt.currency(inventory?.planPisoTotal) },
      ],
      note: 'Capital inmovilizado en unidades disponibles.',
    },
    dias_inventario: {
      value: `${inventory?.avgDaysInventory || 0} días`,
      sub: 'antigüedad promedio disponibles',
      details: [
        { label: 'Días promedio', value: `${inventory?.avgDaysInventory || 0} días` },
        { label: 'Unidades disponibles', value: fmt.number(inventory?.availableUnits ?? 0) },
        { label: 'Alertas de antigüedad', value: fmt.number(inventory?.ageingAlertsCount) },
      ],
      note: 'Tiempo promedio que una unidad permanece en piso antes de venderse.',
    },
    demos: {
      value: fmt.number(inventory?.demos),
      sub: inventory?.avgDaysDemo
        ? `${inventory.avgDaysDemo} días prom. · ${fmt.number(inventory?.demosPruebasTotal || 0)} pruebas`
        : 'unidades demo en piso',
      details: [
        { label: 'Demos', value: fmt.number(inventory?.demos) },
        { label: 'Días promedio como demo', value: `${inventory?.avgDaysDemo || 0} días` },
        { label: 'Con pruebas de manejo', value: fmt.number(inventory?.demosConPruebas || 0) },
        { label: 'Pruebas totales', value: fmt.number(inventory?.demosPruebasTotal || 0) },
      ],
      note: 'Unidades en situación DEMO y su uso en pruebas de manejo.',
    },
    entregas_sin_previas: {
      value: fmt.number(entregasSinPrevias),
      sub: entregasSofia
        ? `${pctPart(entregasSinPrevias, entregasSofia)}% de entregas SOFIA`
        : 'entregas SOFIA sin previa',
      progress: {
        pct: pctPart(entregasSinPrevias, entregasSofia),
        label: 'Sin previa vs entregas',
      },
      details: [
        { label: 'Entregas sin previa', value: fmt.number(entregasSinPrevias) },
        { label: 'Entregas SOFIA', value: fmt.number(entregasSofia) },
        { label: 'Sin previas en stock', value: fmt.number(inventory?.sinPrevias) },
      ],
      note: 'Entregas notificadas en SOFIA que no tuvieron orden previa de preparación.',
    },
    utilidad_neta_cierre: {
      value: fmt.currency(cierre.utilidadNeta),
      sub: `${fmt.number(cierreUds)} uds. · bruta ${fmt.currency(cierre.utilidadBruta)}`,
      progress: {
        pct: pctPart(cierre.utilidadNeta, cierre.utilidadBruta),
        label: 'Retención neta / bruta',
      },
      details: [
        { label: 'Utilidad neta', value: fmt.currency(cierre.utilidadNeta) },
        { label: 'Utilidad bruta', value: fmt.currency(cierre.utilidadBruta) },
        { label: 'Comisión E.V.', value: fmt.currency(cierre.comisionEv) },
        { label: 'Gastos extra', value: fmt.currency(cierre.extras) },
        { label: 'Plan piso vendido', value: fmt.currency(cierre.planPiso) },
        { label: 'Unidades del cierre', value: fmt.number(cierreUds) },
      ],
      note: 'Resultado neto del cierre de unidades vendidas: bruta menos comisión, extras y plan piso, más F&I.',
    },
    ingreso_fi_cierre: {
      value: fmt.currency(cierre.ingresoFi),
      sub: `${fmt.number(cierre.conIngresoFi || 0)} de ${fmt.number(cierreUds)} con F&I`,
      progress: {
        pct: pctPart(cierre.conIngresoFi, cierreUds),
        label: 'Unidades con F&I',
      },
      details: [
        { label: 'Ingresos F&I', value: fmt.currency(cierre.ingresoFi) },
        { label: 'Unidades con F&I', value: fmt.number(cierre.conIngresoFi || 0) },
        { label: 'Unidades del cierre', value: fmt.number(cierreUds) },
        { label: 'Utilidad neta', value: fmt.currency(cierre.utilidadNeta) },
      ],
      note: 'Ingresos de financiamiento asociados a las unidades del cierre.',
    },
    iemc_f2: {
      value: cierre.iemcPct == null ? '—' : `${Number(cierre.iemcPct).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`,
      sub: cierre.brecha == null
        ? 'eficiencia vs mix objetivo'
        : `Brecha ${fmt.currency(cierre.brecha)}`,
      progress: {
        pct: cierre.iemcPct == null ? null : Math.min(100, Number(cierre.iemcPct)),
        label: 'IEMC vs objetivo',
      },
      details: [
        { label: 'IEMC (F-2)', value: cierre.iemcPct == null ? '—' : `${cierre.iemcPct}%` },
        { label: 'Margen real', value: cierre.margenRealPct == null ? '—' : `${cierre.margenRealPct}%` },
        { label: 'Margen objetivo mix', value: cierre.margenObjPct == null ? '—' : `${cierre.margenObjPct}%` },
        { label: 'Brecha (F-2.1)', value: cierre.brecha == null ? '—' : fmt.currency(cierre.brecha) },
        { label: 'Unidades del cierre', value: fmt.number(cierreUds) },
      ],
      note: 'Eficiencia de margen bruto real frente al mix objetivo del PDF de metas.',
    },
    ordenes_taller: {
      value: fmt.number(service?.ingresadas),
      sub: `${fmt.number(ordenesAbiertas)} pendientes de facturar`,
      progress: { pct: service?.pctFacturado, label: 'Órdenes facturadas' },
      details: [
        { label: 'Órdenes ingresadas', value: fmt.number(service?.ingresadas) },
        { label: 'Órdenes facturadas', value: fmt.number(service?.facturadas) },
        { label: 'Pendientes de facturar', value: fmt.number(ordenesAbiertas) },
        { label: 'Facturación taller', value: fmt.currency(service?.importeFacturado) },
      ],
      note: 'Órdenes de servicio abiertas en el periodo y su avance de facturación.',
    },
    facturacion_taller: {
      value: fmt.currency(consolidated?.facturacionServicio ?? service?.importeFacturado),
      sub: `${fmt.number(service?.facturadas)} facturadas · ${service?.pctFacturado ?? '—'}%`,
      progress: {
        pct: pctPart(service?.manoObra, service?.importeFacturado),
        label: 'Peso de mano de obra',
      },
      details: [
        { label: 'Facturación taller', value: fmt.currency(service?.importeFacturado) },
        { label: 'Mano de obra', value: `${fmt.currency(service?.manoObra)} · ${pctPart(service?.manoObra, service?.importeFacturado)}%` },
        { label: 'Refacciones', value: `${fmt.currency(service?.refacciones)} · ${pctPart(service?.refacciones, service?.importeFacturado)}%` },
        { label: 'Órdenes facturadas', value: fmt.number(service?.facturadas) },
        { label: 'Ticket promedio', value: fmt.currency(service?.ticketFacturado) },
      ],
      note: 'Importe facturado de postventa, dividido entre mano de obra y refacciones.',
    },
    ticket_taller: {
      value: fmt.currency(service?.ticketFacturado),
      sub: 'promedio por orden facturada',
      details: [
        { label: 'Ticket promedio', value: fmt.currency(service?.ticketFacturado) },
        { label: 'Facturación taller', value: fmt.currency(service?.importeFacturado) },
        { label: 'Órdenes facturadas', value: fmt.number(service?.facturadas) },
      ],
      note: 'Importe promedio por orden de servicio facturada.',
    },
    mano_obra: {
      value: fmt.currency(service?.manoObra),
      sub: `${pctPart(service?.manoObra, service?.importeFacturado)}% del facturado taller`,
      progress: { pct: pctPart(service?.manoObra, service?.importeFacturado), label: 'Del facturado taller' },
      details: [
        { label: 'Mano de obra', value: fmt.currency(service?.manoObra) },
        { label: 'Refacciones', value: fmt.currency(service?.refacciones) },
        { label: 'Facturación taller', value: fmt.currency(service?.importeFacturado) },
      ],
      note: 'Componente de servicio (horas técnicas) dentro de la facturación de taller.',
    },
    refacciones: {
      value: fmt.currency(service?.refacciones),
      sub: `${pctPart(service?.refacciones, service?.importeFacturado)}% del facturado`,
      progress: { pct: pctPart(service?.refacciones, service?.importeFacturado), label: 'Del facturado taller' },
      details: [
        { label: 'Refacciones', value: fmt.currency(service?.refacciones) },
        { label: 'Mano de obra', value: fmt.currency(service?.manoObra) },
        { label: 'Facturación taller', value: fmt.currency(service?.importeFacturado) },
      ],
      note: 'Componente de partes y materiales dentro de la facturación de taller.',
    },
    ordenes_facturadas: {
      value: fmt.number(service?.facturadas),
      sub: `${service?.pctFacturado ?? '—'}% del total ingresado`,
      progress: { pct: service?.pctFacturado, label: 'Del total ingresado' },
      details: [
        { label: 'Órdenes facturadas', value: fmt.number(service?.facturadas) },
        { label: 'Órdenes ingresadas', value: fmt.number(service?.ingresadas) },
        { label: 'Pendientes', value: fmt.number(ordenesAbiertas) },
        { label: 'Ticket promedio', value: fmt.currency(service?.ticketFacturado) },
      ],
      note: 'Avance de cierre de órdenes de servicio en el periodo.',
    },
    punto_equilibrio: {
      value: pe?.puntoEquilibrio != null ? formatFullMoney(pe.puntoEquilibrio) : '—',
      sub: pe?.margenContribucionPct != null
        ? `MC ${pe.margenContribucionPct}%`
        : 'equilibrio operativo agencia',
      progress: { pct: pe?.coberturaPct ?? pe?.cumplimientoPct, label: 'Cobertura del equilibrio' },
      details: [
        { label: 'Punto de equilibrio', value: pe?.puntoEquilibrio != null ? formatFullMoney(pe.puntoEquilibrio) : '—' },
        { label: 'Margen de contribución', value: pe?.margenContribucionPct != null ? `${pe.margenContribucionPct}%` : '—' },
        { label: 'Cobertura', value: (pe?.coberturaPct ?? pe?.cumplimientoPct) != null ? `${pe.coberturaPct ?? pe.cumplimientoPct}%` : '—' },
        { label: 'Ingreso consolidado', value: fmt.currency(consolidated?.ingresoTotal) },
      ],
      note: 'Ingreso mínimo que la agencia necesita para cubrir su costo operativo.',
    },
    cobertura_equilibrio: {
      value: (pe?.coberturaPct ?? pe?.cumplimientoPct) != null
        ? `${pe.coberturaPct ?? pe.cumplimientoPct}%`
        : '—',
      sub: pe?.coberturaRatio != null ? `${pe.coberturaRatio}× cobertura` : 'vs punto de equilibrio',
      progress: { pct: pe?.coberturaPct ?? pe?.cumplimientoPct, label: 'Avance vs equilibrio' },
      details: [
        { label: 'Cobertura', value: (pe?.coberturaPct ?? pe?.cumplimientoPct) != null ? `${pe.coberturaPct ?? pe.cumplimientoPct}%` : '—' },
        { label: 'Razón de cobertura', value: pe?.coberturaRatio != null ? `${pe.coberturaRatio}×` : '—' },
        { label: 'Punto de equilibrio', value: pe?.puntoEquilibrio != null ? formatFullMoney(pe.puntoEquilibrio) : '—' },
        { label: 'Ingreso consolidado', value: fmt.currency(consolidated?.ingresoTotal) },
      ],
      note: 'Qué tanto del punto de equilibrio se ha cubierto con el ingreso del periodo.',
    },
  };

  const base = map[id] || { value: '—', sub: 'Sin dato', details: [] };
  return {
    ...base,
    icon: SUMMARY_METRIC_ICONS[id] || 'analytics',
    link: SUMMARY_METRIC_LINKS[id] || null,
    details: (base.details || []).filter((row) => row && row.value != null && row.value !== ''),
  };
}

function renderSummaryProgress(progress, tone) {
  const pct = clampPct(progress?.pct);
  if (pct == null) return '';
  return `<div class="summary-kpi__bar" role="img" aria-label="${escHtml(progress.label || 'Avance')}: ${pct}%">
    <span class="summary-kpi__bar-fill summary-kpi__bar-fill--${tone || 'blue'}" style="width:${pct}%"></span>
  </div>
  <p class="summary-kpi__bar-label">${escHtml(progress.label || 'Avance')} · <strong>${pct}%</strong></p>`;
}

const SUMMARY_TONE_COLORS = {
  blue: ['#2563eb', '#93c5fd', '#1e40af', '#bfdbfe'],
  green: ['#10b981', '#6ee7b7', '#047857', '#a7f3d0'],
  amber: ['#f59e0b', '#fcd34d', '#b45309', '#fde68a'],
  rose: ['#f43f5e', '#fda4af', '#be123c', '#fecdd3'],
  violet: ['#8b5cf6', '#c4b5fd', '#6d28d9', '#ddd6fe'],
  slate: ['#64748b', '#cbd5e1', '#334155', '#e2e8f0'],
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const SUMMARY_MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function summaryMonthLabel(row, index = 0) {
  if (!row || typeof row !== 'object') return `P${index + 1}`;
  if (row.label) return String(row.label);
  const mo = Number(row.mo ?? row.month);
  if (Number.isFinite(mo) && mo >= 1 && mo <= 12) return SUMMARY_MONTHS_SHORT[mo - 1];
  const fecha = String(row.fecha || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const d = new Date(`${fecha}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return SUMMARY_MONTHS_SHORT[d.getMonth()];
  }
  return `P${index + 1}`;
}

function summaryTopModelsRelation(topModels = [], limit = 8) {
  return (Array.isArray(topModels) ? topModels : [])
    .filter((row) => num(row?.stock) > 0 || num(row?.unitsSold) > 0)
    .slice(0, limit)
    .map((row) => ({
      x: num(row.stock),
      y: num(row.unitsSold),
      label: row.model || 'Modelo',
    }));
}

/** Composición numérica que alimenta el gráfico del panel. */
function summaryChartSpec(id, ctx) {
  const { sales, service, inventory, consolidated } = ctx.financial || {};
  const ops = ctx.operaciones || {};
  const cierre = ctx.cierre || {};
  const a = ctx.salesAnalytics;
  const pe = ctx.puntoEquilibrio?.agencia || ctx.puntoEquilibrio?.summary || {};
  const monthlyTrend = Array.isArray(ctx.monthlyTrend) ? ctx.monthlyTrend : [];
  const topModels = Array.isArray(ctx.topModels) ? ctx.topModels : [];
  const unidades = num(ops.unidadesVendidas ?? sales?.units);
  const retail = num(ops.retail ?? ops.retailUnits ?? sales?.retailUnits);
  const flotilla = num(ops.flotillas ?? ops.flotillaUnits ?? sales?.flotillaUnits);
  const pendientes = Math.max(0, num(service?.ingresadas) - num(service?.facturadas));
  const ranking = a?.fuerzaVentas?.ranking || [];
  const enAlerta = ranking.filter((v) => v.quadrant === 'regalo').length;
  const entregasSinPrevias = num(ops.entregasSinPrevias);
  const entregasSofia = num(ops.entregasSofia);
  const cierreUds = num(cierre.unidades);

  const canal = {
    type: 'stacked100',
    family: 'composicion',
    unit: 'uds.',
    labels: ['Canal'],
    datasets: [
      { label: 'Retail', values: [retail] },
      { label: 'Flotilla', values: [flotilla] },
    ],
  };
  const taller = {
    type: 'stacked100',
    family: 'composicion',
    unit: '$',
    labels: ['Facturación'],
    datasets: [
      { label: 'Mano de obra', values: [num(service?.manoObra)] },
      { label: 'Refacciones', values: [num(service?.refacciones)] },
    ],
  };
  const ordenes = {
    type: 'stacked100',
    family: 'composicion',
    unit: 'órdenes',
    labels: ['Órdenes'],
    datasets: [
      { label: 'Facturadas', values: [num(service?.facturadas)] },
      { label: 'Pendientes', values: [pendientes] },
    ],
  };
  const stock = {
    type: 'stacked100',
    family: 'composicion',
    unit: 'uds.',
    labels: ['Disponible'],
    datasets: [
      { label: 'Libres', values: [num(inventory?.availableLibres)] },
      { label: 'Apartadas', values: [num(inventory?.availableApartadas)] },
    ],
  };
  const relationStockVsSales = summaryTopModelsRelation(topModels);
  const monthlyLabels = monthlyTrend.map(summaryMonthLabel);

  const map = {
    unidades: monthlyTrend.length >= 2
      ? {
          type: 'line',
          family: 'evolucion',
          unit: 'uds.',
          labels: monthlyLabels,
          values: monthlyTrend.map((row) => num(row.units ?? row.count)),
        }
      : canal,
    retail_units: canal,
    flotilla_units: canal,
    utilidad_bruta: {
      type: 'stacked100',
      family: 'composicion',
      unit: '$',
      labels: ['Venta'],
      datasets: [
        { label: 'Utilidad bruta', values: [num(consolidated?.utilidadVentas)] },
        { label: 'Costo / resto', values: [Math.max(0, num(sales?.revenue) - num(consolidated?.utilidadVentas))] },
      ],
    },
    ingreso_ventas: monthlyTrend.length >= 2
      ? {
          type: 'line',
          family: 'evolucion',
          unit: '$',
          labels: monthlyLabels,
          values: monthlyTrend.map((row) => num(row.revenue ?? row.ventaSubtotal)),
        }
      : {
          type: 'barHorizontal',
          family: 'comparar',
          unit: '$',
          labels: ['Ingreso ventas', 'Facturación taller'],
          values: [num(sales?.revenue), num(consolidated?.facturacionServicio ?? service?.importeFacturado)],
        },
    ingreso_consolidado: {
      type: 'stacked100',
      family: 'composicion',
      unit: '$',
      labels: ['Ingreso'],
      datasets: [
        { label: 'Ventas', values: [num(sales?.revenue)] },
        { label: 'Taller', values: [num(consolidated?.facturacionServicio ?? service?.importeFacturado)] },
      ],
    },
    margen_bruto_real: {
      type: 'stacked100',
      family: 'composicion',
      unit: '%',
      labels: ['Margen'],
      datasets: [
        { label: 'Margen', values: [num(a?.rentabilidad?.margenBrutoPct)] },
        { label: 'Resto', values: [Math.max(0, 100 - num(a?.rentabilidad?.margenBrutoPct))] },
      ],
    },
    asesores_activos: {
      type: 'barHorizontal',
      family: 'ranking',
      unit: 'uds.',
      labels: ranking.slice(0, 8).map((v) => v.vendedor),
      values: ranking.slice(0, 8).map((v) => num(v.units)),
    },
    alerta_margen: {
      type: 'stacked100',
      family: 'composicion',
      unit: 'asesores',
      labels: ['Asesores'],
      datasets: [
        { label: 'En alerta', values: [enAlerta] },
        { label: 'Resto', values: [Math.max(0, ranking.length - enAlerta)] },
      ],
    },
    inventario_disponible: relationStockVsSales.length >= 2
      ? {
          type: 'scatter',
          family: 'relacion',
          unit: 'uds.',
          labels: relationStockVsSales.map((row) => row.label),
          points: relationStockVsSales,
          xLabel: 'Stock disponible',
          yLabel: 'Unidades vendidas',
        }
      : stock,
    valor_inventario: relationStockVsSales.length >= 2
      ? {
          type: 'scatter',
          family: 'relacion',
          unit: 'uds.',
          labels: relationStockVsSales.map((row) => row.label),
          points: relationStockVsSales,
          xLabel: 'Stock disponible',
          yLabel: 'Unidades vendidas',
        }
      : stock,
    sin_previas: {
      type: 'stacked100',
      family: 'composicion',
      unit: 'uds.',
      labels: ['Previas'],
      datasets: [
        { label: 'Sin previas', values: [num(inventory?.sinPrevias)] },
        { label: 'Con previas', values: [num(inventory?.conPrevias)] },
      ],
    },
    plan_piso: {
      type: 'barTarget',
      family: 'meta_vs_real',
      unit: 'uds.',
      labels: ['Plan piso'],
      values: [num(inventory?.planPisoUnits)],
      targets: [num(inventory?.availableUnits)],
      targetLabel: 'Disponibles',
    },
    aging_60: {
      type: 'stacked100',
      family: 'composicion',
      unit: 'uds.',
      labels: ['Antigüedad'],
      datasets: [
        { label: 'Con alerta', values: [num(inventory?.ageingAlertsCount)] },
        { label: 'Sin alerta', values: [Math.max(0, num(inventory?.availableUnits) - num(inventory?.ageingAlertsCount))] },
      ],
    },
    dias_inventario: {
      type: 'barTarget',
      family: 'meta_vs_real',
      unit: 'días',
      labels: ['Días promedio'],
      values: [num(inventory?.avgDaysInventory)],
      targets: [60],
      targetLabel: 'Meta 60 d',
    },
    demos: {
      type: 'stacked100',
      family: 'composicion',
      unit: 'uds.',
      labels: ['Demos'],
      datasets: [
        { label: 'Con pruebas', values: [num(inventory?.demosConPruebas)] },
        { label: 'Sin pruebas', values: [Math.max(0, num(inventory?.demos) - num(inventory?.demosConPruebas))] },
      ],
    },
    entregas_sin_previas: {
      type: 'stacked100',
      family: 'composicion',
      unit: 'uds.',
      labels: ['Entregas'],
      datasets: [
        { label: 'Sin previa', values: [entregasSinPrevias] },
        { label: 'Con previa', values: [Math.max(0, entregasSofia - entregasSinPrevias)] },
      ],
    },
    utilidad_neta_cierre: {
      type: 'barHorizontal',
      family: 'comparar',
      unit: '$',
      labels: ['Utilidad neta', 'Utilidad bruta', 'Ingresos F&I'],
      values: [num(cierre.utilidadNeta), num(cierre.utilidadBruta), num(cierre.ingresoFi)],
    },
    ingreso_fi_cierre: {
      type: 'stacked100',
      family: 'composicion',
      unit: 'uds.',
      labels: ['Cierre'],
      datasets: [
        { label: 'Con F&I', values: [num(cierre.conIngresoFi)] },
        { label: 'Sin F&I', values: [Math.max(0, cierreUds - num(cierre.conIngresoFi))] },
      ],
    },
    iemc_f2: {
      type: 'barTarget',
      family: 'meta_vs_real',
      unit: '%',
      labels: ['IEMC'],
      values: [num(cierre.iemcPct)],
      targets: [100],
      targetLabel: 'Objetivo 100%',
    },
    ordenes_taller: ordenes,
    ordenes_facturadas: ordenes,
    facturacion_taller: taller,
    mano_obra: {
      type: 'barHorizontal',
      family: 'comparar',
      unit: '$',
      labels: ['Mano de obra', 'Refacciones'],
      values: [num(service?.manoObra), num(service?.refacciones)],
    },
    refacciones: {
      type: 'barHorizontal',
      family: 'comparar',
      unit: '$',
      labels: ['Refacciones', 'Mano de obra'],
      values: [num(service?.refacciones), num(service?.manoObra)],
    },
    ticket_taller: {
      type: 'barHorizontal',
      family: 'comparar',
      unit: '$',
      labels: ['Mano de obra', 'Refacciones'],
      values: [num(service?.manoObra), num(service?.refacciones)],
    },
    punto_equilibrio: {
      type: 'barTarget',
      family: 'meta_vs_real',
      unit: '$',
      labels: ['Ingreso consolidado'],
      values: [num(consolidated?.ingresoTotal)],
      targets: [num(pe?.puntoEquilibrio)],
      targetLabel: 'Punto de equilibrio',
    },
    cobertura_equilibrio: {
      type: 'barTarget',
      family: 'meta_vs_real',
      unit: '%',
      labels: ['Cobertura'],
      values: [clampPct(pe?.coberturaPct ?? pe?.cumplimientoPct) || 0],
      targets: [100],
      targetLabel: 'Meta 100%',
    },
  };

  const spec = map[id];
  if (!spec) return null;
  if (spec.type === 'scatter') {
    const points = (spec.points || []).filter((point) => num(point?.x) > 0 || num(point?.y) > 0);
    return points.length ? { ...spec, points } : null;
  }
  if (spec.type === 'stacked100') {
    const datasets = (spec.datasets || []).map((item) => ({
      ...item,
      rawValues: (item.values || []).map(num),
    }));
    const totals = (spec.labels || []).map((_, index) =>
      datasets.reduce((sum, item) => sum + num(item.rawValues[index]), 0));
    const normalized = datasets.map((item) => ({
      ...item,
      values: item.rawValues.map((value, index) => {
        const total = totals[index];
        return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
      }),
    }));
    const total = totals.reduce((acc, value) => acc + value, 0);
    return total > 0 ? { ...spec, datasets: normalized } : null;
  }
  const values = (spec.values || []).map(num);
  const targets = (spec.targets || []).map(num);
  if (!values.length || values.every((v) => v <= 0)) return null;
  return { ...spec, values, targets };
}

function createSummaryChart(canvas, spec, tone, compact = false) {
  if (!canvas || !spec || !window.Chart) return null;
  const palette = SUMMARY_TONE_COLORS[tone] || SUMMARY_TONE_COLORS.blue;
  const isBar = ['bar', 'barHorizontal', 'barTarget', 'stacked100'].includes(spec.type);
  const isHorizontal = spec.type === 'barHorizontal';
  const isStacked = spec.type === 'stacked100';
  const isLine = spec.type === 'line';
  const isScatter = spec.type === 'scatter';
  const isTarget = spec.type === 'barTarget';
  const chartType = isLine ? 'line' : isScatter ? 'scatter' : 'bar';
  const colors = (spec.values || []).map((_, i) => palette[i % palette.length]);
  const baseDataset = isScatter
    ? [{
        label: spec.family === 'relacion' ? 'Modelos' : '',
        data: spec.points,
        parsing: false,
        backgroundColor: palette[0],
        borderColor: palette[0],
        pointRadius: compact ? 4 : 5,
        pointHoverRadius: compact ? 5 : 6,
      }]
    : isStacked
      ? (spec.datasets || []).map((dataset, index) => ({
          label: dataset.label,
          data: dataset.values,
          backgroundColor: palette[index % palette.length],
          borderColor: palette[index % palette.length],
          borderWidth: 0,
          borderRadius: 0,
          stack: 'total',
        }))
      : [{
          data: spec.values,
          backgroundColor: colors,
          borderColor: isLine ? palette[0] : colors,
          borderWidth: isLine ? 2 : 0,
          borderRadius: isBar ? 6 : 0,
          fill: false,
          tension: 0.3,
          pointRadius: isLine ? (compact ? 2.5 : 3.5) : 0,
          pointHoverRadius: isLine ? (compact ? 4 : 5) : 0,
        }];
  const datasets = isTarget && spec.targets?.length
    ? [
        ...baseDataset,
        {
          type: 'line',
          label: spec.targetLabel || 'Meta',
          data: spec.targets,
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
        },
      ]
    : baseDataset;

  return new window.Chart(canvas.getContext('2d'), {
    type: chartType,
    data: {
      labels: spec.labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: isStacked || isTarget,
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: compact ? 9 : 11 } },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              if (isScatter) {
                const raw = item.raw || {};
                return `${raw.label || item.label || 'Punto'} · stock ${Dashboard.fmt.number(num(raw.x))} · ventas ${Dashboard.fmt.number(num(raw.y))}`;
              }
              const v = Number(item.raw) || 0;
              const total = isStacked
                ? item.dataset.data.reduce((acc, n) => acc + num(n), 0)
                : (spec.values || []).reduce((acc, n) => acc + n, 0);
              const pctVal = isStacked && total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
              const shown = spec.unit === '$'
                ? Dashboard.fmt.money(v)
                : `${Dashboard.fmt.number(v)}${spec.unit && spec.unit !== '$' ? ` ${spec.unit}` : ''}`;
              if (isStacked) return ` ${item.dataset.label}: ${shown} · ${pctVal}%`;
              if (isTarget && item.datasetIndex > 0) return ` ${item.dataset.label}: ${shown}`;
              return ` ${shown}`;
            },
          },
        },
      },
      scales: isBar || isLine || isScatter ? {
        x: {
          type: isScatter ? 'linear' : 'category',
          beginAtZero: isScatter,
          stacked: isStacked,
          min: isStacked ? 0 : undefined,
          max: isStacked ? 100 : undefined,
          ticks: {
            color: '#94a3b8',
            font: { size: compact ? 9 : 10 },
            callback: isStacked ? (value) => `${value}%` : undefined,
          },
          title: isScatter && spec.xLabel
            ? { display: true, text: spec.xLabel, color: '#64748b', font: { size: compact ? 9 : 10 } }
            : undefined,
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          stacked: isStacked,
          min: isStacked ? 0 : undefined,
          max: isStacked ? 100 : undefined,
          ticks: {
            color: '#94a3b8',
            font: { size: compact ? 9 : 10 },
            callback: isStacked ? (value) => `${value}%` : undefined,
          },
          title: isScatter && spec.yLabel
            ? { display: true, text: spec.yLabel, color: '#64748b', font: { size: compact ? 9 : 10 } }
            : undefined,
          grid: isHorizontal ? { display: false } : undefined,
        },
      } : undefined,
      indexAxis: isHorizontal ? 'y' : 'x',
    },
  });
}

const summaryCardCharts = new Map();

function destroySummaryCardCharts() {
  summaryCardCharts.forEach((chart) => {
    try { chart.destroy(); } catch { /* ignore */ }
  });
  summaryCardCharts.clear();
}

let summaryChartObserver = null;

function resizeSummaryCharts() {
  summaryCardCharts.forEach((chart) => {
    try { chart.resize(); } catch { /* ignore */ }
  });
}

function observeSummaryCharts() {
  if (typeof ResizeObserver === 'undefined') return;
  summaryChartObserver?.disconnect();
  summaryChartObserver = new ResizeObserver(() => resizeSummaryCharts());
  document.querySelectorAll('#financialSummary .summary-kpi__chart, #financialSummary [data-profile-chart]').forEach((el) => {
    summaryChartObserver.observe(el);
  });
}

function mountSummaryCardCharts(ctx) {
  destroySummaryCardCharts();
  document.querySelectorAll('#financialSummary [data-profile-chart]').forEach((canvas) => {
    const id = canvas.dataset.profileChart;
    const spec = id ? summaryChartSpec(id, ctx) : null;
    const meta = findSummaryMeta(id);
    const chart = createSummaryChart(canvas, spec, meta?.tone || 'blue', false);
    if (chart) summaryCardCharts.set(`profile:${id}`, chart);
  });
  document.querySelectorAll('#financialSummary [data-summary-chart]').forEach((canvas) => {
    const index = Number(canvas.dataset.summaryChart);
    const id = summaryState.prefs?.slots?.[index];
    const spec = id ? summaryChartSpec(id, ctx) : null;
    const meta = summaryState.catalog.find((item) => item.id === id);
    const chartBox = canvas.closest('.summary-kpi__chart');
    const slot = canvas.closest('[data-summary-size]');
    const compact = (chartBox?.clientHeight || 0) < 160 || slot?.dataset.summarySize === 'sm';
    const chart = createSummaryChart(canvas, spec, meta?.tone || 'blue', compact);
    if (chart) summaryCardCharts.set(index, chart);
  });
  observeSummaryCharts();
  requestAnimationFrame(() => {
    resizeSummaryCharts();
    requestAnimationFrame(resizeSummaryCharts);
  });
}

function applySummaryEditUi() {
  const editing = !!summaryState.editMode;
  document.getElementById('financialSummary')?.classList.toggle('is-editing', editing);
  document.querySelector('#financialSummary .summary-personalized')?.classList.toggle('is-editing', editing);
  const btn = document.getElementById('btnCustomizeSummary');
  if (btn) {
    btn.classList.toggle('is-active', editing);
    btn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    btn.innerHTML = editing
      ? '<span class="material-symbols-outlined">check</span> Listo'
      : '<span class="material-symbols-outlined">settings</span> Configurar';
  }
  const sub = document.getElementById('summaryHeadSubtitle');
  if (sub) {
    sub.textContent = editing
      ? 'Edita solo el monitoreo · los indicadores de perfil permanecen fijos'
      : 'Resumen fijo de tu perfil con KPIs y gráficas · abajo el monitoreo que configures';
  }
}

function setSummaryEditMode(on) {
  const next = !!on;
  if (summaryState.editMode === next) {
    applySummaryEditUi();
    return;
  }
  summaryState.editMode = next;
  applySummaryEditUi();
  if (summaryState.lastPayload) repaintSummary();
}

let summaryDrawerUi = null;

function ensureSummaryDrawer() {
  if (summaryDrawerUi) return summaryDrawerUi;

  const backdrop = document.createElement('div');
  backdrop.className = 'ops-orders-backdrop';
  backdrop.id = 'summaryKpiBackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'ops-orders-drawer summary-kpi-drawer';
  panel.id = 'summaryKpiDrawer';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Detalle del indicador');
  panel.innerHTML = `
    <div class="ops-orders-drawer__header">
      <div class="ops-orders-drawer__title-wrap">
        <span class="material-symbols-outlined ops-orders-drawer__logo" data-summary-drawer-logo>analytics</span>
        <div>
          <h2 class="ops-orders-drawer__title" data-summary-drawer-title>Detalle del indicador</h2>
          <span class="ops-orders-drawer__status" data-summary-drawer-status></span>
        </div>
      </div>
      <div class="ops-orders-drawer__actions">
        <button type="button" class="ops-orders-drawer__icon-btn" data-summary-drawer-expand title="Expandir" aria-label="Expandir panel">
          <span class="material-symbols-outlined" data-summary-drawer-expand-icon>open_in_full</span>
        </button>
        <button type="button" class="ops-orders-drawer__icon-btn" data-summary-drawer-close title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="ops-orders-drawer__main">
      <aside class="ops-orders-drawer__summary custom-scrollbar" data-summary-drawer-facts></aside>
      <div class="ops-orders-drawer__body custom-scrollbar" data-summary-drawer-body></div>
    </div>`;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  const titleEl = panel.querySelector('[data-summary-drawer-title]');
  const statusEl = panel.querySelector('[data-summary-drawer-status]');
  const logoEl = panel.querySelector('[data-summary-drawer-logo]');
  const factsEl = panel.querySelector('[data-summary-drawer-facts]');
  const bodyEl = panel.querySelector('[data-summary-drawer-body]');
  const expandBtn = panel.querySelector('[data-summary-drawer-expand]');
  const expandIcon = panel.querySelector('[data-summary-drawer-expand-icon]');

  let expanded = false;
  let chart = null;
  let activeIndex = null;
  let lastCard = null;

  function placeNearCard(card) {
    if (expanded) return;
    const rect = card?.getBoundingClientRect?.();
    let top = 108;
    if (rect) top = Math.round(rect.bottom + 12);
    top = Math.max(72, Math.min(top, Math.round(window.innerHeight * 0.3)));
    const maxHeight = Math.max(340, window.innerHeight - top - 24);
    panel.style.top = `${top}px`;
    panel.style.right = window.innerWidth < 640 ? '12px' : '28px';
    panel.style.left = window.innerWidth < 640 ? '12px' : 'auto';
    panel.style.bottom = 'auto';
    panel.style.height = `${Math.min(620, maxHeight)}px`;
  }

  function clearPlacement() {
    panel.style.top = '';
    panel.style.right = '';
    panel.style.left = '';
    panel.style.bottom = '';
    panel.style.height = '';
  }

  function setExpanded(next) {
    expanded = Boolean(next);
    panel.classList.toggle('ops-orders-drawer--expanded', expanded);
    if (expandIcon) expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
    if (expandBtn) expandBtn.title = expanded ? 'Contraer' : 'Expandir';
    if (expanded) clearPlacement();
    else if (panel.classList.contains('ops-orders-drawer--open')) placeNearCard(lastCard);
    if (chart) chart.resize();
  }

  function clearSelection() {
    document.querySelectorAll('#financialSummary [data-summary-card].is-open').forEach((el) => {
      el.classList.remove('is-open');
      el.querySelector('[data-summary-expand], [data-profile-expand]')?.setAttribute('aria-expanded', 'false');
    });
  }

  function destroyChart() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  function close() {
    destroyChart();
    panel.classList.remove('ops-orders-drawer--open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('ops-orders-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ops-orders-drawer-open');
    setExpanded(false);
    clearPlacement();
    clearSelection();
    activeIndex = null;
  }

  function drawChart(spec, tone) {
    const canvas = bodyEl.querySelector('#summaryDrawerChart');
    chart = createSummaryChart(canvas, spec, tone, false);
  }

  function open(index, meta, resolved, spec, card) {
    if (activeIndex === index && panel.classList.contains('ops-orders-drawer--open')) {
      close();
      return;
    }
    destroyChart();
    activeIndex = index;
    lastCard = card;

    const tone = meta.tone || 'blue';
    if (titleEl) titleEl.textContent = meta.label;
    if (logoEl) logoEl.textContent = resolved.icon || 'analytics';
    if (statusEl) statusEl.textContent = resolved.sub || meta.description || '';
    panel.dataset.tone = tone;

    const rows = resolved.details || [];
    factsEl.innerHTML = `
      <div class="ops-orders-drawer__group">
        <h5>Valor actual</h5>
        <p class="summary-drawer__hero summary-drawer__hero--${tone}">${resolved.value}</p>
        ${resolved.progress && clampPct(resolved.progress.pct) != null
          ? `<p class="summary-drawer__hero-sub">${escHtml(resolved.progress.label)} · <strong>${clampPct(resolved.progress.pct)}%</strong></p>`
          : ''}
      </div>
      <div class="ops-orders-drawer__group">
        <h5>Desglose</h5>
        ${rows.length
          ? `<ul class="summary-kpi__facts">${rows.map((row) => `
              <li><span>${escHtml(row.label)}</span><strong>${escHtml(row.value)}</strong></li>`).join('')}</ul>`
          : '<p class="summary-kpi__empty">Sin desglose disponible.</p>'}
      </div>`;

    const note = resolved.note || meta.description || '';
    bodyEl.innerHTML = `
      ${note ? `<p class="summary-drawer__note">${escHtml(note)}</p>` : ''}
      ${spec
        ? `<div class="summary-drawer__chart"><canvas id="summaryDrawerChart" aria-label="Gráfico de ${escHtml(meta.label)}"></canvas></div>`
        : '<p class="summary-kpi__empty">Este indicador no tiene una composición graficable en el periodo.</p>'}
      ${resolved.link
        ? `<a class="summary-kpi__link" href="${escHtml(resolved.link)}">Ver módulo completo
            <span class="material-symbols-outlined">chevron_right</span></a>`
        : ''}`;

    clearSelection();
    card?.classList.add('is-open');
    card?.querySelector('[data-summary-expand], [data-profile-expand]')?.setAttribute('aria-expanded', 'true');

    panel.classList.add('ops-orders-drawer--open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('ops-orders-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ops-orders-drawer-open');
    setExpanded(true);
    drawChart(spec, tone);
    requestAnimationFrame(() => {
      if (chart) {
        try { chart.resize(); } catch { /* ignore */ }
      }
    });
  }

  backdrop.addEventListener('click', close);
  panel.querySelector('[data-summary-drawer-close]')?.addEventListener('click', close);
  expandBtn?.addEventListener('click', () => setExpanded(!expanded));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('ops-orders-drawer--open')) close();
  });
  window.addEventListener('resize', () => {
    if (panel.classList.contains('ops-orders-drawer--open')) placeNearCard(lastCard);
  });

  summaryDrawerUi = { open, close };
  return summaryDrawerUi;
}

function findSummaryMeta(id) {
  return summaryState.catalog.find((item) => item.id === id)
    || (summaryState.profile?.items || []).find((item) => item.id === id)
    || null;
}

function lockedProfileIds() {
  return new Set((summaryState.profile?.items || []).map((item) => item.id));
}

function openSummaryDrawerById(id, card, key = id) {
  const ctx = summaryState.lastPayload;
  if (!ctx || !id) return;
  const meta = findSummaryMeta(id);
  if (!meta) return;
  const resolved = resolveSummaryMetric(id, ctx);
  const spec = summaryChartSpec(id, ctx);
  ensureSummaryDrawer().open(key, meta, resolved, spec, card);
}

function openSummaryDrawer(index) {
  const id = (summaryState.prefs?.slots || [])[index];
  const card = document.querySelector(`#financialSummary [data-summary-card="${index}"]`);
  openSummaryDrawerById(id, card, index);
}

function renderSummaryValueBody(id, meta, ctx, view, index) {
  const resolved = resolveSummaryMetric(id, ctx);
  const tone = meta.tone || 'blue';
  const isMoney = String(resolved.value).includes('$');
  if (view === 'chart') {
    return `<div class="summary-kpi__chart"><canvas data-summary-chart="${index}" aria-label="Gráfico de ${escHtml(meta.label)}"></canvas></div>`;
  }
  return `<span class="kpi-value${isMoney ? ' money' : ''}">${resolved.value}</span>
    ${resolved.sub ? `<span class="kpi-subtitle">${resolved.sub}</span>` : ''}
    ${renderSummaryProgress(resolved.progress, tone)}
    <span class="summary-kpi__more">
      <span class="summary-kpi__more-text">Ver detalle</span>
      <span class="material-symbols-outlined summary-kpi__chevron">open_in_new</span>
    </span>`;
}

function profileLayoutForCount(count, index) {
  if (count <= 1) return { size: 'xl', height: 2 };
  if (count === 2) return { size: 'md', height: 2 };
  if (count === 3) return index === 0 ? { size: 'xl', height: 2 } : { size: 'md', height: 2 };
  return { size: 'md', height: 2 };
}

function renderLockedProfileCard(item, ctx) {
  const resolved = resolveSummaryMetric(item.id, ctx);
  const tone = item.tone || 'blue';
  const idAttr = item.kpiId ? ` id="${escHtml(item.kpiId)}"` : '';
  return `<article class="summary-exec-kpi-wrap" data-summary-card="profile:${escHtml(item.id)}">
    <button type="button" class="kpi-card kpi-card--eeff kpi-card--${tone} summary-exec-kpi" data-profile-expand="${escHtml(item.id)}"
      aria-expanded="false" aria-haspopup="dialog" aria-controls="summaryKpiDrawer" title="Abrir detalle de ${escHtml(item.label)}"${idAttr}>
      <div class="kpi-card-head">
        <span class="kpi-title">${escHtml(item.label)}</span>
        <span class="material-symbols-outlined kpi-icon">${escHtml(resolved.icon)}</span>
      </div>
      <div class="kpi-value${String(resolved.value).includes('$') ? ' money' : ''}">${resolved.value}</div>
      <p class="kpi-subtitle">${escHtml(resolved.sub || item.description || 'Indicador de perfil')}</p>
    </button>
  </article>`;
}

function renderProfileStrip(ctx) {
  const items = summaryState.profile?.items || [];
  if (!items.length) return '';
  const label = summaryState.profile.label || summaryState.roleLabel || 'Tu perfil';
  const recs = ctx.salesAnalytics?.recomendaciones || [];
  const chartItems = items.filter((item) => summaryChartSpec(item.id, ctx)).slice(0, 3);
  const top = items[0] ? resolveSummaryMetric(items[0].id, ctx) : null;
  const bannerText = top
    ? `${label}: ${items[0].label} en ${top.value}${top.sub ? ` · ${top.sub}` : ''}.`
    : `Indicadores fijos de ${label}.`;

  const insights = recs.length
    ? recs.slice(0, 4).map((t) => `
        <article class="int-acq-alert int-acq-alert--warning">
          <span class="material-symbols-outlined int-acq-alert__icon">analytics</span>
          <div>
            <p class="int-acq-alert__title">Recomendación</p>
            <p class="int-acq-alert__meta">${escHtml(t)}</p>
          </div>
        </article>`).join('')
    : items.slice(0, 3).map((item) => {
      const resolved = resolveSummaryMetric(item.id, ctx);
      return `<article class="int-acq-alert int-acq-alert--ok">
        <span class="material-symbols-outlined int-acq-alert__icon">verified</span>
        <div>
          <p class="int-acq-alert__title">${escHtml(item.label)}</p>
          <p class="int-acq-alert__meta">${escHtml(resolved.value)}${resolved.sub ? ` · ${escHtml(resolved.sub)}` : ''}</p>
        </div>
      </article>`;
    }).join('');

  const chartPanels = chartItems.map((item) => `
    <div class="section-panel" style="margin:0">
      <h4 class="section-title" style="font-size:0.95rem;margin-bottom:8px">${escHtml(item.label)}</h4>
      <div class="chart-card"><div class="chart-wrap" style="height:220px">
        <canvas data-profile-chart="${escHtml(item.id)}" aria-label="Gráfico de ${escHtml(item.label)}"></canvas>
      </div></div>
    </div>`).join('');

  return `<div class="kpi-group summary-profile-strip summary-exec-fixed">
    <h4 class="kpi-group-title">Resumen fijo · ${escHtml(label)}</h4>
    <div class="int-acq-banner int-acq-banner--ok">${escHtml(bannerText)}</div>
    <div class="kpi-grid summary-exec-kpi-row" style="margin-top:14px;--exec-kpi-count:${items.length}">
      ${items.map((item) => renderLockedProfileCard(item, ctx)).join('')}
    </div>
    <div class="chart-grid" style="margin-top:14px">
      <div class="section-panel" style="margin:0">
        <h4 class="section-title" style="font-size:0.95rem;margin-bottom:8px">Insights</h4>
        <div class="int-acq-alerts custom-scrollbar">${insights}</div>
      </div>
      ${chartPanels || '<div class="section-panel" style="margin:0"><p class="kpi-subtitle">Sin gráfica para los indicadores de este perfil.</p></div>'}
    </div>
  </div>`;
}

function renderPersonalizedKpis(ctx) {
  const locked = lockedProfileIds();
  const slots = (summaryState.prefs?.slots || Array(SUMMARY_SLOT_COUNT).fill(null))
    .map((id) => (id && locked.has(id) ? null : id));
  const sizes = normalizeSizes(summaryState.prefs?.sizes);
  const heights = normalizeHeights(summaryState.prefs?.heights);
  const views = normalizeViews(summaryState.prefs?.views);
  const byId = new Map(summaryState.catalog.map((item) => [item.id, item]));
  const filled = slots.filter(Boolean).length;
  const cards = slots.map((id, index) => {
    const size = sizes[index];
    const height = heights[index];
    const meta = id ? byId.get(id) : null;
    if (meta) {
      const spec = summaryChartSpec(id, ctx);
      const canChart = !!spec;
      const view = canChart && views[index] === 'chart' ? 'chart' : 'number';
      const tone = meta.tone || 'blue';
      const idAttr = meta.kpiId ? ` id="${escHtml(meta.kpiId)}"` : '';
      return `<article class="summary-slot summary-slot--filled" data-summary-card="${index}" data-summary-index="${index}" data-summary-size="${size}" data-summary-height="${height}" data-summary-view="${view}">
        <div class="kpi-card kpi-card--${tone} summary-kpi"${idAttr}>
          <button type="button" class="summary-kpi__trigger" data-summary-expand="${index}"
            aria-expanded="false" aria-haspopup="dialog" aria-controls="summaryKpiDrawer"
            title="Abrir detalle de ${escHtml(meta.label)}">
            <span class="summary-kpi__head">
              <span class="summary-kpi__icon summary-kpi__icon--${tone} material-symbols-outlined" aria-hidden="true">${escHtml(resolveSummaryMetric(id, ctx).icon)}</span>
              <span class="kpi-title">${escHtml(meta.label)}</span>
            </span>
            ${renderSummaryValueBody(id, meta, ctx, view, index)}
          </button>
        </div>
        ${summaryState.editMode ? `<div class="summary-slot__tools">
          ${canChart ? `<button type="button" class="summary-slot__view" data-summary-view-toggle="${index}"
            aria-label="${view === 'chart' ? 'Ver número' : 'Ver gráfico'}"
            title="${view === 'chart' ? 'Cambiar a número' : 'Cambiar a gráfico'}">
            <span class="material-symbols-outlined">${view === 'chart' ? 'pin' : 'pie_chart'}</span>
          </button>` : ''}
          <button type="button" class="summary-slot__edit" data-summary-slot="${index}" aria-label="Cambiar ${escHtml(meta.label)}" title="Cambiar KPI">
            <span class="material-symbols-outlined">tune</span>
          </button>
        </div>
        ${renderResizeChrome(index, size, height)}` : ''}
      </article>`;
    }
    if (!summaryState.editMode) return '';
    return `<article class="summary-slot summary-slot--vacant" data-summary-index="${index}" data-summary-size="${size}" data-summary-height="${height}">
      <button type="button" class="summary-slot__empty-btn" data-summary-slot="${index}" aria-label="Elegir KPI para el espacio ${index + 1}">
        <span class="summary-slot__plus material-symbols-outlined">add</span>
        <strong>Espacio ${index + 1}</strong>
        <small>Otra área para monitorear</small>
      </button>
      ${renderResizeChrome(index, size, height)}
    </article>`;
  });

  const monitorEmpty = !filled && !summaryState.editMode
    ? `<div class="summary-empty-board">
        <span class="material-symbols-outlined" aria-hidden="true">monitoring</span>
        <strong>Sin monitoreo extra</strong>
        <p>Pulsa <em>Configurar</em> para agregar KPIs de otras áreas. Los de tu perfil ya están fijos arriba.</p>
      </div>`
    : `<div class="summary-slot-grid">${cards.join('')}</div>`;

  const note = summaryState.editMode
    ? `${filled} de ${SUMMARY_SLOT_COUNT} espacios de monitoreo · arrastra para el tamaño`
    : filled
      ? `${filled} indicador${filled === 1 ? '' : 'es'} de monitoreo · abre el detalle con un clic`
      : 'Agrega KPIs de otras áreas cuando quieras dar seguimiento';

  return `${renderProfileStrip(ctx)}
    <div class="kpi-group summary-personalized${summaryState.editMode ? ' is-editing' : ''}">
      <h4 class="kpi-group-title">Monitoreo · ${note}</h4>
      ${monitorEmpty}
    </div>`;
}

function renderFinancialSummary(f, salesAnalytics, operaciones = {}, puntoEquilibrio = null) {
  const ctx = {
    financial: f,
    operaciones,
    salesAnalytics,
    puntoEquilibrio,
  };
  summaryState.lastPayload = ctx;

  destroySummaryCardCharts();
  document.getElementById('financialSummary').innerHTML = renderPersonalizedKpis(ctx);
  applySummaryEditUi();
  mountSummaryCardCharts(ctx);
}

function renderSummaryPrefsBody() {
  const body = document.getElementById('summaryPrefsBody');
  if (!body) return;
  const locked = lockedProfileIds();
  const groups = (summaryState.groups || [])
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => !locked.has(item.id)),
    }))
    .filter((group) => group.items.length);
  if (!groups.length) {
    body.innerHTML = '<p class="kpi-subtitle">No hay más indicadores para monitorear. Los de tu perfil ya están fijos en el tablero.</p>';
    return;
  }
  const activeId = locked.has(summaryState.draftSlots[summaryState.activeSlot])
    ? ''
    : (summaryState.draftSlots[summaryState.activeSlot] || '');
  const byId = new Map(summaryState.catalog.map((item) => [item.id, item]));
  const profileLabel = summaryState.profile?.label || summaryState.roleLabel || 'tu perfil';
  body.innerHTML = `
    <div class="summary-slot-picker" role="tablist" aria-label="Espacios de monitoreo">
      ${summaryState.draftSlots.map((id, index) => `
        <button type="button" class="summary-slot-picker__item${index === summaryState.activeSlot ? ' is-active' : ''}"
          data-summary-draft-slot="${index}" role="tab" aria-selected="${index === summaryState.activeSlot}">
          <span>${index + 1}</span>
          <small>${escHtml(locked.has(id) ? 'Vacío' : (byId.get(id)?.label || 'Vacío'))}</small>
        </button>`).join('')}
    </div>
    <section class="summary-prefs-group summary-profile-group">
      <h3>Monitoreo de otras áreas</h3>
      <p>Los indicadores de ${escHtml(profileLabel)} ya están fijos arriba. Aquí eliges KPIs adicionales para dar seguimiento.</p>
    </section>
    <label class="summary-prefs-item summary-prefs-item--empty">
      <input type="radio" name="summaryKpi" value="" ${activeId ? '' : 'checked'}>
      <span><strong>Dejar este espacio vacío</strong><small>No se mostrará ningún indicador aquí.</small></span>
    </label>
    ${groups.map((group) => `
    <section class="summary-prefs-group">
      <h3>${escHtml(group.areaLabel)}</h3>
      <div class="summary-prefs-grid">
        ${group.items.map((item) => {
          const checked = activeId === item.id ? 'checked' : '';
          return `<label class="summary-prefs-item">
            <input type="radio" name="summaryKpi" value="${escHtml(item.id)}" ${checked}>
            <span>
              <strong>${escHtml(item.label)}</strong>
              <small>${escHtml(item.description || '')}</small>
            </span>
          </label>`;
        }).join('')}
      </div>
    </section>
  `).join('')}`;

  body.querySelectorAll('[data-summary-draft-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      summaryState.activeSlot = Number(button.dataset.summaryDraftSlot) || 0;
      renderSummaryPrefsBody();
    });
  });
  body.querySelectorAll('input[name="summaryKpi"]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.value || null;
      if (id && locked.has(id)) return;
      if (id) {
        summaryState.draftSlots = summaryState.draftSlots.map((current, index) =>
          current === id && index !== summaryState.activeSlot ? null : current);
      }
      summaryState.draftSlots[summaryState.activeSlot] = id;
      renderSummaryPrefsBody();
    });
  });
}

function openSummaryPrefs(slotIndex = null) {
  const dialog = document.getElementById('summaryPrefsDialog');
  if (!dialog) return;
  summaryState.draftSlots = [...(summaryState.prefs?.slots || Array(SUMMARY_SLOT_COUNT).fill(null))];
  summaryState.draftSizes = normalizeSizes(summaryState.prefs?.sizes);
  summaryState.draftHeights = normalizeHeights(summaryState.prefs?.heights);
  summaryState.draftViews = normalizeViews(summaryState.prefs?.views);
  summaryState.activeSlot = Number.isInteger(slotIndex)
    ? slotIndex
    : Math.max(0, summaryState.draftSlots.findIndex((id) => !id));
  renderSummaryPrefsBody();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'open');
}

function closeSummaryPrefs() {
  const dialog = document.getElementById('summaryPrefsDialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function loadSummaryPrefs() {
  try {
    const data = await Dashboard.api('/auth/summary-kpi-prefs');
    summaryState.prefs = {
      slots: data.slots || Array(SUMMARY_SLOT_COUNT).fill(null),
      sizes: normalizeSizes(data.sizes),
      heights: normalizeHeights(data.heights),
      views: normalizeViews(data.views),
      kpiIds: data.kpiIds || [],
      isCustom: !!data.isCustom,
      updatedAt: data.updatedAt || null,
    };
    summaryState.catalog = data.catalog || [];
    summaryState.groups = data.groups || [];
    summaryState.profile = data.profile || { roleId: '', label: '', hint: '', items: [] };
    summaryState.roleLabel = data.roleLabel || '';
    const locked = new Set((summaryState.profile.items || []).map((item) => item.id));
    summaryState.prefs.slots = (summaryState.prefs.slots || []).map((id) => (id && locked.has(id) ? null : id));
  } catch (err) {
    console.warn('[overview] No se pudieron cargar preferencias de resumen:', err.message);
    summaryState.prefs = {
      slots: Array(SUMMARY_SLOT_COUNT).fill(null),
      sizes: normalizeSizes([]),
      heights: normalizeHeights([]),
      views: normalizeViews([]),
      kpiIds: [],
      isCustom: false,
    };
    summaryState.catalog = [];
    summaryState.groups = [];
    summaryState.profile = { roleId: '', label: '', hint: '', items: [] };
    summaryState.roleLabel = '';
  }
}

async function saveSummaryPrefs(slots, sizes, heights, views) {
  const cleanSizes = normalizeSizes(sizes);
  const cleanHeights = normalizeHeights(heights);
  const cleanViews = normalizeViews(views);
  const data = await Dashboard.api('/auth/summary-kpi-prefs', {
    method: 'PUT',
    body: JSON.stringify({ slots, sizes: cleanSizes, heights: cleanHeights, views: cleanViews }),
  });
  summaryState.prefs = {
    slots: data.slots || slots,
    sizes: normalizeSizes(data.sizes || cleanSizes),
    heights: normalizeHeights(data.heights || cleanHeights),
    views: normalizeViews(data.views || cleanViews),
    kpiIds: data.kpiIds || slots.filter(Boolean),
    isCustom: true,
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

async function resetSummaryPrefs() {
  const data = await Dashboard.api('/auth/summary-kpi-prefs', { method: 'DELETE' });
  summaryState.prefs = {
    slots: data.slots || Array(SUMMARY_SLOT_COUNT).fill(null),
    sizes: normalizeSizes(data.sizes),
    heights: normalizeHeights(data.heights),
    views: normalizeViews(data.views),
    kpiIds: data.kpiIds || [],
    isCustom: false,
    updatedAt: null,
  };
  summaryState.draftSlots = [...summaryState.prefs.slots];
  summaryState.draftSizes = normalizeSizes(summaryState.prefs.sizes);
  summaryState.draftHeights = normalizeHeights(summaryState.prefs.heights);
  summaryState.draftViews = normalizeViews(summaryState.prefs.views);
  renderSummaryPrefsBody();
}

function repaintSummary() {
  const payload = summaryState.lastPayload;
  if (!payload) return;
  renderFinancialSummary(
    payload.financial,
    payload.salesAnalytics,
    payload.operaciones,
    payload.puntoEquilibrio,
  );
  if (window.KpiInsights?.apply) {
    window.KpiInsights.apply('overview', {
      operaciones: payload.operaciones || {},
      financial: payload.financial || {},
      salesAnalytics: payload.salesAnalytics || null,
      puntoEquilibrio: payload.puntoEquilibrio || null,
    });
  }
}

function clearResizePreview(slot) {
  if (!slot) return;
  slot.style.width = '';
  slot.style.height = '';
  slot.style.transform = '';
  slot.style.minHeight = '';
}

function applySlotLayoutVisual(index, size, height) {
  const slot = document.querySelector(`#financialSummary [data-summary-index="${index}"]`);
  if (!slot) return;
  slot.dataset.summarySize = size;
  slot.dataset.summaryHeight = String(height);
  const hint = slot.querySelector('.summary-slot__size-hint');
  if (hint) hint.textContent = layoutHint(size, height);
}

function setSummaryLayout(index, size, height, { persist = true, repaint = true } = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= SUMMARY_SLOT_COUNT) return;
  if (!SUMMARY_SIZE_IDS.includes(size)) return;
  const nextHeight = SUMMARY_HEIGHTS.includes(height) ? height : DEFAULT_SUMMARY_HEIGHT;
  const slots = summaryState.prefs?.slots || Array(SUMMARY_SLOT_COUNT).fill(null);
  const sizes = normalizeSizes(summaryState.prefs?.sizes);
  const heights = normalizeHeights(summaryState.prefs?.heights);
  sizes[index] = size;
  heights[index] = nextHeight;
  summaryState.prefs = { ...summaryState.prefs, sizes, heights };
  if (repaint) repaintSummary();
  else applySlotLayoutVisual(index, size, nextHeight);
  if (!persist) return;
  void saveSummaryPrefs(slots, sizes, heights, summaryState.prefs?.views)
    .catch((err) => console.warn('[overview] No se pudo guardar el tamaño del KPI:', err.message));
}

function spacesFromPointer(session, clientX) {
  if (!/[ew]/.test(session.corner)) return sizeMeta(session.lastSize).spaces;
  const width = session.corner.includes('e')
    ? clientX - session.originLeft
    : session.originRight - clientX;
  const fraction = width / Math.max(session.gridWidth, 1);
  if (fraction < 0.375) return 1;
  if (fraction < 0.625) return 2;
  if (fraction < 0.875) return 3;
  return 4;
}

function rowsFromPointer(session, clientY) {
  if (!/[ns]/.test(session.corner)) return session.lastHeight;
  const height = session.corner.includes('s')
    ? clientY - session.originTop
    : session.originBottom - clientY;
  return Math.min(3, Math.max(1, Math.round(height / session.rowUnit)));
}

function applyLivePreview(session, clientX, clientY) {
  const minW = Math.max(120, session.gridWidth * 0.18);
  const minH = Math.max(120, session.rowUnit * 0.7);
  let left = session.originLeft;
  let right = session.originRight;
  let top = session.originTop;
  let bottom = session.originBottom;
  if (session.corner.includes('e')) right = clientX;
  if (session.corner.includes('w')) left = clientX;
  if (session.corner.includes('s')) bottom = clientY;
  if (session.corner.includes('n')) top = clientY;
  if (right - left < minW) {
    if (session.corner.includes('w')) left = right - minW;
    else right = left + minW;
  }
  if (bottom - top < minH) {
    if (session.corner.includes('n')) top = bottom - minH;
    else bottom = top + minH;
  }
  session.slot.style.width = `${right - left}px`;
  session.slot.style.height = `${bottom - top}px`;
  session.slot.style.minHeight = `${bottom - top}px`;
  session.slot.style.transform = `translate(${left - session.originLeft}px, ${top - session.originTop}px)`;
}

function endSummaryResize(persist) {
  if (!summaryResizeSession) return;
  const { index, slot, startSize, startHeight, lastSize, lastHeight } = summaryResizeSession;
  clearResizePreview(slot);
  slot.classList.remove('is-resizing');
  document.body.classList.remove('is-summary-resizing');
  document.body.style.cursor = '';
  window.removeEventListener('pointermove', onSummaryResizeMove);
  window.removeEventListener('pointerup', onSummaryResizeUp);
  window.removeEventListener('pointercancel', onSummaryResizeCancel);
  summaryResizeSession = null;
  summaryIgnoreClick = true;
  window.setTimeout(() => { summaryIgnoreClick = false; }, 0);
  const changed = lastSize !== startSize || lastHeight !== startHeight;
  if (persist && changed) {
    setSummaryLayout(index, lastSize, lastHeight, { persist: true, repaint: true });
  } else {
    applySlotLayoutVisual(index, startSize, startHeight);
    const sizes = normalizeSizes(summaryState.prefs?.sizes);
    const heights = normalizeHeights(summaryState.prefs?.heights);
    sizes[index] = startSize;
    heights[index] = startHeight;
    summaryState.prefs = { ...summaryState.prefs, sizes, heights };
  }
}

function onSummaryResizeMove(event) {
  if (!summaryResizeSession) return;
  applyLivePreview(summaryResizeSession, event.clientX, event.clientY);
  const size = sizeFromSpaces(spacesFromPointer(summaryResizeSession, event.clientX));
  const height = rowsFromPointer(summaryResizeSession, event.clientY);
  summaryResizeSession.lastSize = size;
  summaryResizeSession.lastHeight = height;
  const hint = summaryResizeSession.slot.querySelector('.summary-slot__size-hint');
  if (hint) hint.textContent = layoutHint(size, height);
  const chart = summaryCardCharts.get(summaryResizeSession.index);
  if (chart) {
    try { chart.resize(); } catch { /* ignore */ }
  }
}

function onSummaryResizeUp() {
  endSummaryResize(true);
}

function onSummaryResizeCancel() {
  endSummaryResize(false);
}

function startSummaryResize(event, index, corner) {
  if (!summaryState.editMode) return;
  const handle = event.target.closest('[data-summary-resize]');
  const slot = handle?.closest('[data-summary-index]');
  const grid = slot?.closest('.summary-slot-grid');
  if (!slot || !grid) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = slot.getBoundingClientRect();
  const gridStyles = getComputedStyle(grid);
  const row = parseFloat(gridStyles.gridAutoRows) || 156;
  const gap = parseFloat(gridStyles.rowGap || gridStyles.gap) || 14;
  const current = slot.dataset.summarySize || DEFAULT_SUMMARY_SIZE;
  const currentHeight = Number(slot.dataset.summaryHeight) || DEFAULT_SUMMARY_HEIGHT;
  summaryResizeSession = {
    index,
    corner,
    slot,
    grid,
    gridWidth: grid.getBoundingClientRect().width,
    rowUnit: row + gap,
    originLeft: rect.left,
    originRight: rect.right,
    originTop: rect.top,
    originBottom: rect.bottom,
    startSize: current,
    startHeight: currentHeight,
    lastSize: current,
    lastHeight: currentHeight,
  };
  slot.classList.add('is-resizing');
  document.body.classList.add('is-summary-resizing');
  document.body.style.cursor = SUMMARY_RESIZE_CURSOR[corner] || 'nwse-resize';
  if (handle.setPointerCapture) {
    try { handle.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  }
  window.addEventListener('pointermove', onSummaryResizeMove);
  window.addEventListener('pointerup', onSummaryResizeUp);
  window.addEventListener('pointercancel', onSummaryResizeCancel);
}

function setSummaryView(index, view) {
  if (!Number.isInteger(index) || index < 0 || index >= SUMMARY_SLOT_COUNT) return;
  const next = view === 'chart' ? 'chart' : 'number';
  const slots = summaryState.prefs?.slots || Array(SUMMARY_SLOT_COUNT).fill(null);
  const sizes = normalizeSizes(summaryState.prefs?.sizes);
  const heights = normalizeHeights(summaryState.prefs?.heights);
  const views = normalizeViews(summaryState.prefs?.views);
  views[index] = next;
  if (next === 'chart' && heights[index] < 2) heights[index] = 2;
  summaryState.prefs = { ...summaryState.prefs, views, heights };
  repaintSummary();
  void saveSummaryPrefs(slots, sizes, heights, views)
    .catch((err) => console.warn('[overview] No se pudo guardar la vista del KPI:', err.message));
}

function wireSummaryPrefsUi() {
  document.getElementById('btnCustomizeSummary')?.addEventListener('click', () => {
    setSummaryEditMode(!summaryState.editMode);
  });
  document.getElementById('financialSummary')?.addEventListener('pointerdown', (event) => {
    if (!summaryState.editMode) return;
    const handle = event.target.closest('[data-summary-resize]');
    if (!handle) return;
    startSummaryResize(event, Number(handle.dataset.summaryResize), handle.dataset.resizeCorner);
  });
  document.getElementById('financialSummary')?.addEventListener('click', (event) => {
    if (summaryIgnoreClick || event.target.closest('[data-summary-resize]')) return;
    const viewToggle = event.target.closest('[data-summary-view-toggle]');
    if (viewToggle) {
      if (!summaryState.editMode) return;
      const index = Number(viewToggle.dataset.summaryViewToggle);
      const current = normalizeViews(summaryState.prefs?.views)[index];
      setSummaryView(index, current === 'chart' ? 'number' : 'chart');
      return;
    }
    const profileExpand = event.target.closest('[data-profile-expand]');
    if (profileExpand) {
      openSummaryDrawerById(
        profileExpand.dataset.profileExpand,
        profileExpand.closest('.summary-slot'),
        `profile:${profileExpand.dataset.profileExpand}`,
      );
      return;
    }
    const expand = event.target.closest('[data-summary-expand]');
    if (expand) {
      openSummaryDrawer(Number(expand.dataset.summaryExpand));
      return;
    }
    const button = event.target.closest('[data-summary-slot]');
    if (!button || !summaryState.editMode) return;
    openSummaryPrefs(Number(button.dataset.summarySlot));
  });
  document.getElementById('btnCloseSummaryPrefs')?.addEventListener('click', closeSummaryPrefs);
  document.getElementById('btnCancelSummaryPrefs')?.addEventListener('click', closeSummaryPrefs);
  document.getElementById('btnResetSummaryPrefs')?.addEventListener('click', () => {
    summaryState.draftSlots = Array(SUMMARY_SLOT_COUNT).fill(null);
    summaryState.draftSizes = normalizeSizes([]);
    summaryState.draftHeights = normalizeHeights([]);
    summaryState.draftViews = normalizeViews([]);
    summaryState.activeSlot = 0;
    renderSummaryPrefsBody();
  });
  document.getElementById('summaryPrefsForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveSummaryPrefs(summaryState.draftSlots, summaryState.draftSizes, summaryState.draftHeights, summaryState.draftViews)
      .then(() => {
        closeSummaryPrefs();
        repaintSummary();
      })
      .catch((err) => {
        window.alert(err.message || 'No se pudo guardar el resumen');
      });
  });
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

async function renderOverview(fechaInicio, fechaFin) {
  const { api, setText, showLoading } = Dashboard;
  showLoading(true);
  try {
    const [data] = await Promise.all([
      api(`/overview?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`),
      summaryState.prefs ? Promise.resolve() : loadSummaryPrefs(),
    ]);
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

wireSummaryPrefsUi();
Dashboard.initDateFilter({ onConsult: renderOverview });
