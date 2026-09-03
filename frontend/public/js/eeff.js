let activeCategoria = 'estadoFinanciero';
let eeffData = null;
let activeEeffKpi = null;
let expandedDrillNodes = new Set();
let eeffDrillNeedsSeed = false;

const COMPARATIVA_YEAR = 2026;

function drillRow(label, value, opts = {}) {
  const id = opts.id || `row-${String(label).replace(/\s+/g, '-').toLowerCase()}`;
  return { id, label, value: Number(value) || 0, ...opts };
}

function drillNode(id, label, value, opts = {}) {
  const { children = [], ...rest } = opts;
  return { id, label, value: Number(value) || 0, children, ...rest };
}

function drillHeader(label) {
  return { type: 'header', label };
}

function drillText(label, value) {
  return { type: 'text', label, value };
}

function shortCuenta(cuenta) {
  if (!cuenta) return '';
  return String(cuenta).split('-')[0];
}

function branchPnlChildren(entity, prefix) {
  if (!entity) return [];
  return [
    drillRow('Ventas', entity.ventas, { id: `${prefix}-ventas` }),
    drillRow('Costo de ventas', entity.costo, { id: `${prefix}-costo` }),
    drillRow('Utilidad bruta', entity.utilidadBruta, { id: `${prefix}-ub`, highlight: true }),
    drillRow('Gastos operación', entity.gastos, { id: `${prefix}-gop` }),
    drillRow('Gastos administración', entity.gastosAdministracion, { id: `${prefix}-gad` }),
    drillRow('Suma gastos', entity.sumaGastos, { id: `${prefix}-sg`, highlight: true }),
    drillRow('Utilidad operación', entity.utilidadOperacion, { id: `${prefix}-uo`, highlight: true }),
  ];
}

function linesToDrillTree(lines, enrichFn) {
  const result = [];
  const stack = [];

  for (const l of lines || []) {
    const level = l.level || 0;
    const node = {
      id: l.key || `line-${level}-${result.length}`,
      label: String(l.label || '').trim(),
      value: l.real ?? l.value,
      presupuesto: l.presupuesto,
      highlight: l.highlight,
      autoExpand: level === 0,
      children: [],
    };
    if (enrichFn) enrichFn(node, l);

    while (stack.length > level) stack.pop();
    if (level === 0) {
      result.push(node);
      stack.length = 0;
      stack.push(node);
    } else if (stack.length) {
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      result.push(node);
    }
  }
  return result;
}

function treeHasCompare(rows) {
  return (rows || []).some((row) => {
    if (row.presupuesto != null) return true;
    if (row.children?.length) return treeHasCompare(row.children);
    return false;
  });
}

function flattenDrillTree(rows, kpiKey, depth = 0) {
  const out = [];
  (rows || []).forEach((row, index) => {
    if (row.type === 'header' || row.type === 'text') {
      out.push({ ...row, depth });
      return;
    }
    const rowId = getDrillRowId(row, depth, index);
    const nodeKey = `${kpiKey}:${rowId}`;
    const children = row.children || [];
    const hasChildren = children.length > 0;
    const isExpanded = hasChildren && expandedDrillNodes.has(nodeKey);
    out.push({ ...row, depth, rowId, nodeKey, hasChildren, isExpanded });
    if (hasChildren && isExpanded) {
      out.push(...flattenDrillTree(children, kpiKey, depth + 1));
    }
  });
  return out;
}

function getDrillRowId(row, depth, index) {
  return row.id || `${depth}-${index}-${row.label}`;
}

function seedAutoExpandNodes(rows, kpiKey, depth = 0) {
  (rows || []).forEach((row, index) => {
    if (row.type === 'header' || row.type === 'text') return;
    const children = row.children || [];
    if (!children.length) return;
    const rowId = getDrillRowId(row, depth, index);
    const nodeKey = `${kpiKey}:${rowId}`;
    if (row.autoExpand) expandedDrillNodes.add(nodeKey);
    seedAutoExpandNodes(children, kpiKey, depth + 1);
  });
}

function closeEeffKpiFloatUi() {
  const panel = document.getElementById('eeffKpiFloat');
  const backdrop = document.getElementById('eeffKpiFloatBackdrop');
  panel?.classList.add('hidden');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.querySelectorAll('[data-eeff-kpi].is-open, [data-eeff-kpi].is-selected')
    .forEach((el) => {
      el.classList.remove('is-open', 'is-selected');
      if (el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', 'false');
    });
}

function closeEeffKpiFloat() {
  activeEeffKpi = null;
  eeffDrillNeedsSeed = false;
  expandedDrillNodes.clear();
  closeEeffKpiFloatUi();
}

function buildVentasTotalesDrill(data) {
  const v = data.ventas || {};
  const pv = data.postventa || {};
  const sem = data.seminuevos?.summary || data.seminuevos || {};

  return [
    drillNode('autosNuevos', 'Ventas autos nuevos', v.totalVentasAutos?.summary?.ventas, {
      highlight: true,
      autoExpand: true,
      children: [
        drillNode('menudeo', 'Menudeo', v.menudeo?.summary?.ventas, {
          autoExpand: true,
          children: (v.menudeo?.branches || []).map((b) => drillNode(`menudeo-${b.id}`, b.label, b.ventas, {
            children: branchPnlChildren(b, `menudeo-${b.id}`),
          })),
        }),
        drillNode('flotillas', 'Flotillas', v.flotillas?.summary?.ventas, {
          children: branchPnlChildren(v.flotillas?.summary || v.flotillas?.branch, 'flotillas'),
        }),
        drillNode('intercambios', 'Intercambios', v.intercambios?.summary?.ventas, {
          children: branchPnlChildren(v.intercambios?.summary || v.intercambios?.branch, 'intercambios'),
        }),
      ],
    }),
    drillNode('seminuevos', 'Ventas seminuevos', sem.ventas, {
      highlight: true,
      autoExpand: true,
      children: [
        ...(data.seminuevos?.branches || []).map((b) => drillNode(`sem-${b.id}`, b.label, b.ventas, {
          children: [
            drillRow('Costo de ventas', b.costo, { id: `sem-${b.id}-costo` }),
            drillRow('Utilidad bruta', b.utilidadBruta, { id: `sem-${b.id}-ub`, highlight: true }),
          ],
        })),
        drillRow('Costo total', sem.costo, { id: 'seminuevos-costo' }),
        drillRow('Utilidad bruta', sem.utilidadBruta, { id: 'seminuevos-ub', highlight: true }),
        drillRow('Gastos operación', sem.gastos, { id: 'seminuevos-gop' }),
        drillRow('Gastos administración', sem.gastosAdministracion, { id: 'seminuevos-gad' }),
        drillRow('Utilidad operación', sem.utilidadOperacion, { id: 'seminuevos-uo', highlight: true }),
      ],
    }),
    drillNode('postventa', 'Ventas PostVenta', pv.summary?.ventas, {
      autoExpand: true,
      children: (pv.sections || []).map((sec) => drillNode(`pv-${sec.id}`, sec.label, sec.ventas, {
        children: branchPnlChildren(sec, `pv-${sec.id}`),
      })),
    }),
  ];
}

function buildCostoDrill(data) {
  const v = data.ventas || {};
  const pv = data.postventa || {};
  const sem = data.seminuevos?.summary || data.seminuevos || {};

  return [
    drillNode('costoAutos', 'Costo autos nuevos', v.totalVentasAutos?.summary?.costo, {
      highlight: true,
      autoExpand: true,
      children: [
        drillNode('costoMenudeo', 'Menudeo', v.menudeo?.summary?.costo, {
          autoExpand: true,
          children: (v.menudeo?.branches || []).map((b) => drillRow(b.label, b.costo, {
            id: `costo-menudeo-${b.id}`,
          })),
        }),
        drillRow('Flotillas', v.flotillas?.summary?.costo, { id: 'costo-flotillas' }),
        drillRow('Intercambios', v.intercambios?.summary?.costo, { id: 'costo-intercambios' }),
      ],
    }),
    drillNode('costoSeminuevos', 'Costo seminuevos', sem.costo, {
      autoExpand: true,
      children: (data.seminuevos?.branches || []).map((b) => drillRow(b.label, b.costo, {
        id: `costo-sem-${b.id}`,
      })),
    }),
    drillNode('costoPostventa', 'Costo PostVenta', pv.summary?.costo, {
      autoExpand: true,
      children: (pv.sections || []).map((sec) => drillRow(sec.label, sec.costo, {
        id: `costo-pv-${sec.id}`,
      })),
    }),
  ];
}

function buildGastosDrill(data) {
  const s = data.estadoFinanciero?.summary || {};
  const v = data.ventas || {};
  const pv = data.postventa || {};
  const sem = data.seminuevos?.summary || data.seminuevos || {};
  const depts = data.estadoFinanciero?.gastosPorDepartamento || [];

  const shortLabel = {
    711: 'Piso',
    712: 'Foráneos',
    713: 'SuAuto',
    714: 'Cholula',
    715: 'Zacatelco',
    716: 'Flotillas',
    717: 'Intercambios',
    718: 'Casa',
    720: 'Seminuevos',
    730: 'PostVenta (genérico)',
    731: 'Servicio',
    732: 'HYP',
    733: 'Refacciones',
  };
  const deptLabel = (d) => shortLabel[String(d.gpoCont)] || d.label;

  const autosGpos = new Set(['711', '712', '713', '714', '715', '716', '717', '718']);
  const autosDepts = depts.filter((d) => autosGpos.has(String(d.gpoCont)));
  const semDept = depts.find((d) => String(d.gpoCont) === '720');
  const pvGen = depts.find((d) => String(d.gpoCont) === '730');
  const servicio = depts.find((d) => String(d.gpoCont) === '731');
  const hyp = depts.find((d) => String(d.gpoCont) === '732');
  const refacciones = depts.find((d) => String(d.gpoCont) === '733');

  const postventaChildren = [
    ...(pvGen ? [drillRow(deptLabel(pvGen), pvGen.value, { id: 'gop-pv-gen' })] : []),
    ...(servicio ? [drillRow(deptLabel(servicio), servicio.value, { id: 'gop-pv-serv' })] : []),
    ...(refacciones ? [drillRow(deptLabel(refacciones), refacciones.value, { id: 'gop-pv-ref' })] : []),
    ...(hyp ? [drillRow(deptLabel(hyp), hyp.value, { id: 'gop-pv-hyp' })] : []),
  ];
  if (!postventaChildren.length) {
    postventaChildren.push(
      ...(pv.sections || []).map((sec) => drillRow(sec.label, sec.gastos, {
        id: `gop-pv-${sec.id}`,
      })),
    );
  }

  const autosChildren = autosDepts.length
    ? autosDepts.map((d) => drillRow(deptLabel(d), d.value, { id: `gop-auto-${d.gpoCont}` }))
    : [drillRow('Autos nuevos', v.totalVentasAutos?.summary?.gastos, { id: 'gop-autos' })];

  const postventaTotal = postventaChildren.reduce((a, n) => a + (Number(n.value) || 0), 0)
    || pv.summary?.gastos
    || 0;

  return [
    drillNode('gastosOp', 'Gastos de operación', s.gastosOperacion, {
      highlight: true,
      autoExpand: true,
      children: [
        drillNode('gopAutos', 'Autos nuevos', autosChildren.reduce((a, n) => a + (Number(n.value) || 0), 0)
          || v.totalVentasAutos?.summary?.gastos, {
          autoExpand: true,
          children: autosChildren,
        }),
        drillRow(deptLabel(semDept || { gpoCont: '720', label: 'Seminuevos' }), semDept?.value ?? sem.gastos, { id: 'gop-sem' }),
        drillNode('gopPostventa', 'PostVenta', postventaTotal, {
          autoExpand: true,
          children: postventaChildren,
        }),
      ],
    }),
    drillRow('Gastos administración', s.gastosAdministracion, { id: 'gastos-admin' }),
  ];
}

function buildUtilidadBrutaDrill(data) {
  const s = data.estadoFinanciero?.summary || {};
  const autos = data.ventas?.totalVentasAutos?.summary || {};
  const sem = data.seminuevos?.summary || data.seminuevos || {};
  const pv = data.postventa || {};

  return [
    drillNode('ubAutos', 'Utilidad bruta autos nuevos', autos.utilidadBruta, {
      highlight: true,
      autoExpand: true,
      children: [
        drillRow('Ventas', autos.ventas, { id: 'ub-autos-v' }),
        drillRow('Costo', autos.costo, { id: 'ub-autos-c' }),
      ],
    }),
    drillNode('ubSeminuevos', 'Utilidad bruta seminuevos', sem.utilidadBruta, {
      highlight: true,
      autoExpand: true,
      children: [
        ...(data.seminuevos?.branches || []).map((b) => drillRow(b.label, b.utilidadBruta, {
          id: `ub-sem-${b.id}`,
        })),
        drillRow('Ventas', sem.ventas, { id: 'ub-sem-v' }),
        drillRow('Costo', sem.costo, { id: 'ub-sem-c' }),
      ],
    }),
    drillNode('ubPostventa', 'Utilidad bruta PostVenta', pv.summary?.utilidadBruta, {
      highlight: true,
      autoExpand: true,
      children: [
        ...(pv.sections || []).map((sec) => drillRow(sec.label, sec.utilidadBruta, {
          id: `ub-pv-${sec.id}`,
        })),
        drillRow('Ventas', pv.summary?.ventas, { id: 'ub-pv-v' }),
        drillRow('Costo', pv.summary?.costo, { id: 'ub-pv-c' }),
      ],
    }),
    drillRow('Utilidad bruta total', s.utilidadBruta, { id: 'utilidad-bruta', highlight: true }),
  ];
}

function buildPerdidaFinancieraDrill(data) {
  const s = data.estadoFinanciero?.summary || {};
  return [
    drillRow('Productos financieros', s.productosFinancieros, { id: 'pf-productos' }),
    drillRow('Gastos financieros', s.gastosFinancieros, { id: 'pf-gastos' }),
    drillRow('Intereses Plan Piso', s.interesesPlanPiso, { id: 'pf-plan-piso' }),
    drillRow('Intereses moratorios', s.interesesMoratorios, { id: 'pf-moratorios' }),
    drillRow('Pérdida financiera', s.perdidaFinanciera, { id: 'pf-total', highlight: true }),
  ];
}

function buildFinancieroDrill(data) {
  const s = data.estadoFinanciero?.summary || {};

  return [
    drillRow('Productos financieros', s.productosFinancieros, { id: 'fin-pf' }),
    drillRow('Gastos financieros', s.gastosFinancieros, { id: 'fin-gf' }),
    drillRow('Intereses Plan Piso', s.interesesPlanPiso, { id: 'fin-plan-piso' }),
    drillRow('Intereses moratorios', s.interesesMoratorios, { id: 'fin-moratorios' }),
    drillRow('Pérdida financiera', s.perdidaFinanciera, { id: 'fin-resultado', highlight: true }),
  ];
}

function pctOfSales(value, ventas) {
  const v = Number(value);
  const s = Number(ventas);
  if (!Number.isFinite(v) || !Number.isFinite(s) || !s) return null;
  return Number(((v / s) * 100).toFixed(1));
}

function eeffStatusBadge(tone, icon, label) {
  return {
    tone: tone || 'slate',
    icon: icon || 'info',
    label: label || '—',
  };
}

function buildEdoFinKpiItems(data) {
  const s = data.estadoFinanciero?.summary || {};
  const ventas = Number(s.ventasTotales) || 0;
  const margenBruto = Number(s.margenBrutoPct);
  const margenOp = Number(s.margenOperacionPct);
  const margenEbitda = Number(s.margenEbitdaPct ?? data.ebitMetrics?.margenEbitdaPct);
  const crecEbit = Number(s.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct);
  const utilidad = Number(s.utilidad);
  const utilidadPct = pctOfSales(utilidad, ventas);
  const costoPct = pctOfSales(s.costoTotal, ventas);
  const gastosPct = pctOfSales(s.sumaGastos, ventas);
  const perdida = Number(s.perdidaFinanciera);

  // Referencias de agencia de autos nuevos: margen bruto consolidado 13–16%,
  // costo de ventas ~85% y gastos totales 10–13% sobre ventas.
  const ubBadge = !Number.isFinite(margenBruto) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : margenBruto >= 13 ? eeffStatusBadge('green', 'trending_up', 'Saludable')
      : margenBruto >= 10 ? eeffStatusBadge('amber', 'warning', 'Atención')
        : eeffStatusBadge('rose', 'trending_down', 'Presión');

  const uoBadge = !Number.isFinite(margenOp) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : margenOp >= 2.5 ? eeffStatusBadge('violet', 'trending_up', 'Eficiente')
      : margenOp >= 0 ? eeffStatusBadge('amber', 'warning', 'Ajustado')
        : eeffStatusBadge('rose', 'trending_down', 'Negativo');

  const ebitdaBadge = !Number.isFinite(margenEbitda) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : margenEbitda >= 3.5 ? eeffStatusBadge('green', 'trending_up', 'Sobre objetivo')
      : margenEbitda >= 0 ? eeffStatusBadge('amber', 'warning', 'Bajo objetivo')
        : eeffStatusBadge('rose', 'trending_down', 'Negativo');

  const utilidadBadge = !Number.isFinite(utilidad) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : utilidad >= 0 ? eeffStatusBadge('green', 'trending_up', 'Resultado positivo')
      : eeffStatusBadge('rose', 'trending_down', 'Resultado negativo');

  const costoBadge = !Number.isFinite(costoPct) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : costoPct >= 90 ? eeffStatusBadge('rose', 'trending_up', 'Alta presión')
      : costoPct >= 87 ? eeffStatusBadge('amber', 'warning', 'Atención')
        : eeffStatusBadge('green', 'check_circle', 'Controlado');

  const gastosBadge = !Number.isFinite(gastosPct) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : gastosPct >= 13 ? eeffStatusBadge('rose', 'trending_up', 'Alta presión')
      : gastosPct >= 11 ? eeffStatusBadge('amber', 'warning', 'Atención')
        : eeffStatusBadge('green', 'check_circle', 'Controlado');

  const crecBadge = !Number.isFinite(crecEbit) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : crecEbit >= 20 ? eeffStatusBadge('green', 'trending_up', 'Crecimiento sólido')
      : crecEbit >= 5 ? eeffStatusBadge('green', 'trending_up', 'Crecimiento real')
        : crecEbit >= -5 ? eeffStatusBadge('amber', 'trending_flat', 'Bajo inflación')
          : eeffStatusBadge('rose', 'trending_down', 'Contracción');

  const perdidaBadge = !Number.isFinite(perdida) ? eeffStatusBadge('slate', 'info', 'Sin dato')
    : perdida >= 0 ? eeffStatusBadge('green', 'trending_up', 'Resultado positivo')
      : Math.abs(perdida) >= Math.abs(Number(s.utilidadOperacion) || 0)
        ? eeffStatusBadge('rose', 'trending_down', 'Impacto significativo')
        : eeffStatusBadge('amber', 'warning', 'Impacto moderado');

  return [
    {
      id: 'ventasTotales',
      label: 'Ventas totales',
      value: s.ventasTotales,
      icon: 'shopping_cart',
      color: 'blue',
      sub: '—',
      badge: eeffStatusBadge('blue', 'fiber_manual_record', 'Total'),
      row: 'primary',
      drilldown: buildVentasTotalesDrill(data),
    },
    {
      id: 'utilidadBruta',
      label: 'Utilidad bruta',
      value: s.utilidadBruta,
      icon: 'monetization_on',
      color: 'green',
      sub: Number.isFinite(margenBruto) ? `${margenBruto}% de ventas` : '—',
      badge: ubBadge,
      row: 'primary',
      drilldown: buildUtilidadBrutaDrill(data),
    },
    {
      id: 'utilidadOperacion',
      label: 'Utilidad de operación',
      value: s.utilidadOperacion,
      icon: 'show_chart',
      color: 'violet',
      sub: Number.isFinite(margenOp) ? `${margenOp}% margen` : '—',
      badge: uoBadge,
      row: 'primary',
      drilldown: [
        drillRow('Utilidad bruta', s.utilidadBruta, { id: 'uo-ub', highlight: true }),
        drillNode('gastos', 'Suma gastos', s.sumaGastos, {
          autoExpand: true,
          children: buildGastosDrill(data),
        }),
        drillRow('Utilidad operación', s.utilidadOperacion, { id: 'uo-total', highlight: true }),
      ],
    },
    {
      id: 'ebitda',
      label: 'EBITDA (UAFIDA)',
      value: s.ebitda ?? data.ebitMetrics?.ebitda,
      icon: 'trending_up',
      color: Number(s.ebitda ?? data.ebitMetrics?.ebitda ?? 0) < 0 ? 'rose' : 'green',
      sub: Number.isFinite(margenEbitda)
        ? `Margen ${margenEbitda}% · UO + depreciación`
        : 'Utilidad operación + depreciación',
      badge: ebitdaBadge,
      row: 'primary',
      drilldown: [
        drillRow('EBIT / UAFI (util. operación)', s.ebit ?? data.ebitMetrics?.ebit ?? s.utilidadOperacion, { id: 'ebitda-ebit', highlight: true }),
        drillRow('(+) Depreciación del periodo', s.depreciacionPeriodo ?? data.ebitMetrics?.depreciacionPeriodo, { id: 'ebitda-dep' }),
        drillRow('EBITDA / UAFIDA', s.ebitda ?? data.ebitMetrics?.ebitda, { id: 'ebitda-total', highlight: true }),
        drillRow('Ventas totales', s.ventasTotales, { id: 'ebitda-vtas' }),
      ],
    },
    {
      id: 'utilidad',
      label: 'Utilidad neta',
      value: s.utilidad,
      icon: 'flag',
      color: utilidad < 0 ? 'rose' : 'green',
      sub: utilidadPct != null ? `${utilidadPct}% de ventas` : '—',
      badge: utilidadBadge,
      row: 'primary',
      drilldown: [
        drillRow('Utilidad operación', s.utilidadOperacion, { id: 'u-uo', highlight: true }),
        drillRow('Productos financieros', s.productosFinancieros, { id: 'u-pf' }),
        drillRow('Gastos financieros', s.gastosFinancieros, { id: 'u-gf' }),
        drillRow('Utilidad financiera', s.utilidadFinanciera, { id: 'u-uf', highlight: true }),
        drillRow('Utilidad neta', s.utilidad, { id: 'u-total', highlight: true }),
      ],
    },
    {
      id: 'costosTotales',
      label: 'Costos totales',
      value: s.costoTotal,
      icon: 'shopping_cart',
      color: 'rose',
      sub: costoPct != null ? `${costoPct}% de ventas` : 'Costo de ventas',
      badge: costoBadge,
      row: 'secondary',
      drilldown: buildCostoDrill(data),
    },
    {
      id: 'gastosTotales',
      label: 'Gastos totales',
      value: s.sumaGastos,
      icon: 'work',
      color: 'amber',
      sub: gastosPct != null ? `${gastosPct}% de ventas` : 'Operación + administración',
      badge: gastosBadge,
      row: 'secondary',
      drilldown: buildGastosDrill(data),
    },
    {
      id: 'crecimientoEbit',
      label: 'Crecimiento EBIT',
      value: s.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct,
      displayOverride: formatPctLabel(s.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct),
      icon: 'trending_up',
      color: Number(s.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct ?? 0) < 0 ? 'rose'
        : Number(s.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct ?? 0) > 0 ? 'green' : 'slate',
      sub: 'vs mismo periodo año anterior',
      badge: crecBadge,
      row: 'secondary',
      drilldown: [
        drillRow('EBIT actual', s.ebit ?? data.ebitMetrics?.ebit ?? s.utilidadOperacion, { id: 'crec-ebit-act', highlight: true }),
        drillRow('EBIT año anterior', data.ebitMetrics?.utilidadOperacionAnterior, { id: 'crec-ebit-ant' }),
      ],
    },
    {
      id: 'perdidaFinanciera',
      label: 'Pérdida financiera',
      value: s.perdidaFinanciera,
      icon: 'account_balance',
      color: Number(s.perdidaFinanciera || 0) < 0 ? 'rose' : 'green',
      sub: 'Productos − gastos e intereses',
      badge: perdidaBadge,
      row: 'secondary',
      drilldown: buildPerdidaFinancieraDrill(data),
    },
  ];
}

function buildEdoFinPanorama(data) {
  const s = data.estadoFinanciero?.summary || {};
  const crecEbit = Number(s.crecimientoEbitPct ?? data.ebitMetrics?.crecimientoEbitPct);
  const utilidad = Number(s.utilidad);
  const perdida = Number(s.perdidaFinanciera);
  const margenBruto = Number(s.margenBrutoPct);
  const costoPct = pctOfSales(s.costoTotal, s.ventasTotales);
  const gastosPct = pctOfSales(s.sumaGastos, s.ventasTotales);

  const strengths = [];
  if (Number(s.ventasTotales) > 0) strengths.push('Ventas');
  if (Number.isFinite(margenBruto) && margenBruto >= 12) strengths.push('Utilidad bruta');
  if (Number.isFinite(crecEbit) && crecEbit > 0) strengths.push('crecimiento EBIT');

  const attention = [];
  if (Number.isFinite(costoPct) && costoPct >= 70) attention.push('Costos');
  if (Number.isFinite(gastosPct) && gastosPct >= 6) attention.push('gastos');

  const risks = [];
  if (Number.isFinite(perdida) && perdida < 0) risks.push('Pérdida financiera impacta utilidad neta');
  else if (Number.isFinite(utilidad) && utilidad < 0) risks.push('Utilidad neta en terreno negativo');

  let summary = 'Sin datos suficientes para interpretar el periodo.';
  if (Number(s.ventasTotales) > 0) {
    const parts = [];
    if (Number.isFinite(margenBruto) && margenBruto >= 12) {
      parts.push('Las ventas y la utilidad bruta muestran un desempeño sólido');
    } else {
      parts.push('Las ventas sostienen la operación, pero el margen bruto es ajustado');
    }
    if (Number.isFinite(crecEbit) && crecEbit > 0) {
      parts.push('con crecimiento de EBIT frente al año anterior');
    }
    if (Number.isFinite(perdida) && perdida < 0) {
      parts.push('sin embargo la pérdida financiera presiona el resultado final');
      if (utilidad < 0) parts.push('y arrastra la utilidad neta a terreno negativo');
    } else if (utilidad >= 0) {
      parts.push('y el resultado neto se mantiene positivo');
    }
    summary = `${parts.join(', ')}.`;
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  }

  return {
    summary,
    strengths: strengths.length ? strengths.join(', ') : 'Sin fortalezas destacadas',
    attention: attention.length ? `${attention.join(' y ')} presionan márgenes` : 'Sin focos de atención relevantes',
    risk: risks[0] || 'Sin riesgo clave identificado',
  };
}

function renderEdoFinStatusBadge(badge) {
  if (!badge) return '';
  return `
    <span class="eeff-edo-kpi__badge eeff-edo-kpi__badge--${badge.tone || 'slate'}">
      <span class="material-symbols-outlined" aria-hidden="true">${badge.icon || 'info'}</span>
      ${badge.label}
    </span>`;
}

function renderEdoFinKpiCard(k, fmt, gridId, detailPanelId) {
  const hasDrill = k.drilldown?.length;
  const kpiKey = `${gridId}:${k.id}`;
  const isOpen = activeEeffKpi === kpiKey;
  const display = k.displayOverride ?? fmt.money(k.value);
  const sub = k.sub != null ? k.sub : '';
  const tag = hasDrill ? 'button' : 'div';
  const typeAttr = hasDrill ? ' type="button"' : '';
  const dataAttrs = hasDrill
    ? ` data-eeff-kpi="${k.id}" data-eeff-grid="${gridId}" data-eeff-detail="${detailPanelId}" aria-expanded="${isOpen}" title="Clic para ver desglose"`
    : '';

  return `
    <${tag}${typeAttr}
      class="eeff-edo-kpi eeff-edo-kpi--${k.color || 'blue'}${hasDrill ? ' eeff-edo-kpi--interactive' : ''}${isOpen ? ' is-open' : ''}"
      ${dataAttrs}>
      <div class="eeff-edo-kpi__head">
        <span class="material-symbols-outlined eeff-edo-kpi__icon" aria-hidden="true">${k.icon || 'payments'}</span>
        <span class="eeff-edo-kpi__label">${k.label}</span>
      </div>
      <div class="eeff-edo-kpi__value">${display}</div>
      ${sub ? `<p class="eeff-edo-kpi__sub">${sub}</p>` : ''}
      ${renderEdoFinStatusBadge(k.badge)}
    </${tag}>`;
}

function renderEdoFinOverview(data, fmt) {
  const items = buildEdoFinKpiItems(data);
  const primary = items.filter((i) => i.row === 'primary');
  const secondary = items.filter((i) => i.row === 'secondary');
  const gridId = 'kpiEdoFin';
  const detailId = 'eeffKpiDetailEdoFin';

  const primaryEl = document.getElementById('kpiEdoFinPrimary');
  const secondaryEl = document.getElementById('kpiEdoFinSecondary');
  if (primaryEl) {
    primaryEl.innerHTML = primary.map((k) => renderEdoFinKpiCard(k, fmt, gridId, detailId)).join('');
  }
  if (secondaryEl) {
    secondaryEl.innerHTML = secondary.map((k) => renderEdoFinKpiCard(k, fmt, gridId, detailId)).join('');
  }

  renderEeffKpiDetail(detailId, gridId, items, fmt);

  const panorama = buildEdoFinPanorama(data);
  const panEl = document.getElementById('eeffEdoFinPanorama');
  if (panEl) {
    panEl.innerHTML = `
      <div class="eeff-panorama__main">
        <div class="eeff-panorama__title-wrap">
          <span class="material-symbols-outlined eeff-panorama__icon" aria-hidden="true">track_changes</span>
          <h3 class="eeff-panorama__title">Panorama general</h3>
        </div>
        <p class="eeff-panorama__summary">${panorama.summary}</p>
      </div>
      <div class="eeff-panorama__insights">
        <div class="eeff-panorama__insight eeff-panorama__insight--green">
          <span class="material-symbols-outlined" aria-hidden="true">trending_up</span>
          <div>
            <p class="eeff-panorama__insight-label">Fortalezas</p>
            <p class="eeff-panorama__insight-text">${panorama.strengths}</p>
          </div>
        </div>
        <div class="eeff-panorama__insight eeff-panorama__insight--amber">
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <div>
            <p class="eeff-panorama__insight-label">Atención</p>
            <p class="eeff-panorama__insight-text">${panorama.attention}</p>
          </div>
        </div>
        <div class="eeff-panorama__insight eeff-panorama__insight--rose">
          <span class="material-symbols-outlined" aria-hidden="true">bolt</span>
          <div>
            <p class="eeff-panorama__insight-label">Riesgo clave</p>
            <p class="eeff-panorama__insight-text">${panorama.risk}</p>
          </div>
        </div>
      </div>`;
  }
}

function buildVentasKpiItems(data) {
  const v = data.ventas || {};
  const total = v.totalVentasAutos?.summary || {};

  return [
    {
      id: 'menudeo',
      label: 'Menudeo',
      value: v.menudeo?.summary?.ventas,
      icon: 'storefront',
      color: 'blue',
      sub: '5 sucursales',
      drilldown: (v.menudeo?.branches || []).map((b) => drillNode(`menudeo-${b.id}`, b.label, b.ventas, {
        autoExpand: true,
        children: branchPnlChildren(b, `menudeo-${b.id}`),
      })),
    },
    {
      id: 'flotillas',
      label: 'Flotillas',
      value: v.flotillas?.summary?.ventas,
      icon: 'local_shipping',
      color: 'slate',
      drilldown: branchPnlChildren(v.flotillas?.summary || v.flotillas?.branch, 'flotillas'),
    },
    {
      id: 'intercambios',
      label: 'Intercambios',
      value: v.intercambios?.summary?.ventas,
      icon: 'swap_horiz',
      color: 'amber',
      drilldown: branchPnlChildren(v.intercambios?.summary || v.intercambios?.branch, 'intercambios'),
    },
    {
      id: 'totalAutos',
      label: 'Total autos nuevos',
      value: total.ventas,
      icon: 'directions_car',
      color: 'green',
      drilldown: [
        drillNode('menudeo-t', 'Menudeo', v.menudeo?.summary?.ventas, {
          autoExpand: true,
          children: (v.menudeo?.branches || []).map((b) => drillNode(`tb-${b.id}`, b.label, b.ventas, {
            children: branchPnlChildren(b, `tb-${b.id}`),
          })),
        }),
        drillNode('flotillas-t', 'Flotillas', v.flotillas?.summary?.ventas, {
          children: branchPnlChildren(v.flotillas?.summary || v.flotillas?.branch, 'flotillas-t'),
        }),
        drillNode('intercambios-t', 'Intercambios', v.intercambios?.summary?.ventas, {
          children: branchPnlChildren(v.intercambios?.summary || v.intercambios?.branch, 'intercambios-t'),
        }),
        drillRow('Total ventas', total.ventas, { id: 'total-ventas', highlight: true }),
        drillRow('Costo total', total.costo, { id: 'total-costo' }),
        drillRow('Utilidad operación', total.utilidadOperacion, { id: 'total-uo', highlight: true }),
      ],
    },
  ];
}

function buildPostventaKpiItems(data) {
  const pv = data.postventa || {};
  const s = pv.summary || {};
  const sections = pv.sections || [];

  function sectionNodes(metric) {
    return sections.map((sec) => drillNode(`pv-${sec.id}-${metric}`, sec.label, sec[metric], {
      autoExpand: true,
      children: branchPnlChildren(sec, `pv-${sec.id}-${metric}`),
    }));
  }

  return [
    {
      id: 'ventas',
      label: 'Ventas PostVenta',
      value: s.ventas,
      icon: 'handshake',
      color: 'blue',
      drilldown: sectionNodes('ventas'),
    },
    {
      id: 'utilidadBruta',
      label: 'Utilidad bruta',
      value: s.utilidadBruta,
      icon: 'savings',
      color: 'green',
      sub: `${s.margenBrutoPct ?? 0}%`,
      drilldown: sectionNodes('utilidadBruta'),
    },
    {
      id: 'utilidadOperacion',
      label: 'Utilidad operación',
      value: s.utilidadOperacion,
      icon: 'query_stats',
      color: 'violet',
      drilldown: sectionNodes('utilidadOperacion'),
    },
    {
      id: 'areas',
      label: 'Servicio + Ref. + HYP',
      value: sections.length,
      icon: 'build',
      color: 'slate',
      sub: pv.description,
      displayOverride: `${sections.length} áreas`,
      drilldown: sections.map((sec) => drillNode(`area-${sec.id}`, sec.label, sec.ventas, {
        autoExpand: true,
        children: branchPnlChildren(sec, `area-${sec.id}`),
      })),
    },
  ];
}

function enrichComparativaNode(node, line, cmp) {
  if (line.key === 'ventasMenudeo') {
    node.children = (cmp.ventas?.menudeo || []).map((b) => drillNode(`cmp-${b.id}`, b.label, b.ventas?.real, {
      presupuesto: b.ventas?.presupuesto,
      children: [
        drillRow('Utilidad bruta', b.utilidadBruta?.real, {
          id: `${b.id}-ub`, presupuesto: b.utilidadBruta?.presupuesto,
        }),
        drillRow('Utilidad operación', b.utilidadOperacion?.real, {
          id: `${b.id}-uo`, presupuesto: b.utilidadOperacion?.presupuesto,
        }),
      ],
    }));
  }
  if (line.key === 'ventasPostventa') {
    node.children = (cmp.postventa?.sections || []).map((sec) => drillNode(`cmp-pv-${sec.id}`, sec.label, sec.ventas?.real, {
      presupuesto: sec.ventas?.presupuesto,
      children: [
        drillRow('Utilidad bruta', sec.utilidadBruta?.real, {
          id: `cmp-pv-${sec.id}-ub`, presupuesto: sec.utilidadBruta?.presupuesto,
        }),
        drillRow('Utilidad operación', sec.utilidadOperacion?.real, {
          id: `cmp-pv-${sec.id}-uo`, presupuesto: sec.utilidadOperacion?.presupuesto,
        }),
      ],
    }));
  }
}

function buildComparativaKpiItems(cmp) {
  if (!cmp?.available) return [];
  const s = cmp.estadoFinanciero?.summary || {};
  const lines = cmp.estadoFinanciero?.lines || [];

  function cmpDrill(entries) {
    return entries
      .map(([key, label]) => {
        const item = s[key];
        if (!item) return null;
        return drillNode(key, label, item.real, {
          presupuesto: item.presupuesto,
          highlight: true,
        });
      })
      .filter(Boolean);
  }

  const ventasTree = linesToDrillTree(
    lines.filter((l) => l.real != null),
    (node, line) => enrichComparativaNode(node, line, cmp),
  );

  return [
    {
      id: 'ventasTotales',
      label: 'Ventas totales',
      value: s.ventasTotales?.real,
      icon: 'receipt_long',
      color: 'blue',
      sub: `PPTO · ${s.ventasTotales?.variacionPct ?? 0}%`,
      drilldown: ventasTree,
    },
    {
      id: 'costosTotales',
      label: 'Costos totales',
      value: s.costoTotal?.real,
      icon: 'shopping_cart',
      color: 'rose',
      sub: `PPTO · ${s.costoTotal?.variacionPct ?? 0}%`,
      drilldown: cmpDrill([
        ['costoTotal', 'Costo de ventas'],
      ]),
    },
    {
      id: 'utilidadBruta',
      label: 'Utilidad bruta',
      value: s.utilidadBruta?.real,
      icon: 'savings',
      color: 'green',
      sub: `Var. ${s.utilidadBruta?.variacion ?? 0}`,
      drilldown: cmpDrill([
        ['ventasTotales', 'Ventas totales'],
        ['costoTotal', 'Costo de ventas'],
        ['utilidadBruta', 'Utilidad bruta'],
      ]),
    },
    {
      id: 'gastosTotales',
      label: 'Gastos totales',
      value: s.sumaGastos?.real,
      icon: 'payments',
      color: 'amber',
      sub: `PPTO · ${s.sumaGastos?.variacionPct ?? 0}%`,
      drilldown: cmpDrill([
        ['gastosOperacion', 'Gastos de operación'],
        ['gastosAdministracion', 'Gastos administración'],
        ['sumaGastos', 'Suma gastos'],
      ]),
    },
    {
      id: 'utilidadOperacion',
      label: 'Utilidad operación',
      value: s.utilidadOperacion?.real,
      icon: 'query_stats',
      color: 'violet',
      sub: `PPTO ${s.utilidadOperacion?.presupuesto ?? 0}`,
      drilldown: cmpDrill([
        ['utilidadBruta', 'Utilidad bruta'],
        ['sumaGastos', 'Suma gastos'],
        ['utilidadOperacion', 'Utilidad operación'],
      ]),
    },
    {
      id: 'periodo',
      label: 'Periodo presupuesto',
      value: cmp.mesesIncluidos?.length,
      icon: 'calendar_month',
      color: 'slate',
      displayOverride: `${cmp.mesesIncluidos?.length || 0} meses`,
      sub: `${cmp.template} · ${(cmp.factorPeriodo * 100).toFixed(0)}% anual`,
      drilldown: [
        drillHeader(`${cmp.template}`),
        { type: 'text', label: 'Meses incluidos', value: (cmp.mesesIncluidos || []).join(', ') || '—' },
        { type: 'text', label: 'Factor del año', value: `${(cmp.factorPeriodo * 100).toFixed(0)}%` },
      ],
    },
  ];
}

function isComparativaYearRange(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return false;
  const y1 = new Date(`${fechaInicio}T12:00:00`).getFullYear();
  const y2 = new Date(`${fechaFin}T12:00:00`).getFullYear();
  return y1 === COMPARATIVA_YEAR && y2 === COMPARATIVA_YEAR;
}

function getComparativa2026DefaultRange() {
  const now = new Date();
  const end = now.getFullYear() >= COMPARATIVA_YEAR
    ? Dashboard.formatDateInput(now.getFullYear() === COMPARATIVA_YEAR ? now : new Date(COMPARATIVA_YEAR, 11, 31))
    : `${COMPARATIVA_YEAR}-12-31`;
  return { fechaInicio: `${COMPARATIVA_YEAR}-01-01`, fechaFin: end };
}

function moneyClass(value) {
  const n = Number(value) || 0;
  if (n < 0) return 'cell-negative';
  if (n > 0) return 'cell-positive';
  return '';
}

function variacionClass(value) {
  const n = Number(value) || 0;
  if (n > 0) return 'cell-positive';
  if (n < 0) return 'cell-negative';
  return '';
}

function formatComparativaPeriodLabel(fechaInicio, fechaFin, mesesIncluidos) {
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const list = Array.isArray(mesesIncluidos) ? mesesIncluidos.filter((m) => m >= 1 && m <= 12) : [];
  let rangeLabel = '';
  if (list.length) {
    const first = months[list[0] - 1];
    const last = months[list[list.length - 1] - 1];
    rangeLabel = list.length === 1 ? first : `${first}–${last}`;
  } else if (fechaInicio && fechaFin) {
    rangeLabel = `${fechaInicio} → ${fechaFin}`;
  }
  const ytd = list.length > 1 && list[0] === 1;
  const scope = ytd ? 'acumulado YTD' : 'periodo seleccionado';
  return `Real vs Presupuesto ${COMPARATIVA_YEAR} · ${rangeLabel || '—'} · ${scope}`;
}

function formatPctLabel(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}%`;
}

function formatEbitMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  try {
    return Dashboard.fmt.money(Number(value));
  } catch {
    return String(value);
  }
}

function downloadComparativaCsv(cmp, filtros) {
  if (!cmp?.available) return;
  const fi = filtros?.fechaInicio || '';
  const ff = filtros?.fechaFin || '';
  const rows = [
    ['Sección', 'Concepto', 'Real', 'Presupuesto', 'Variacion $', 'Variacion %'],
  ];

  function pushLine(section, label, real, ppto, variacion, variacionPct) {
    rows.push([
      section,
      label,
      Number(real) || 0,
      Number(ppto) || 0,
      Number(variacion) || 0,
      Number(variacionPct) || 0,
    ]);
  }

  for (const line of cmp.estadoFinanciero?.lines || []) {
    pushLine('Estado financiero', line.label, line.real, line.presupuesto, line.variacion, line.variacionPct);
  }
  for (const r of cmp.ventas?.menudeo || []) {
    pushLine('Ventas menudeo', r.label, r.ventas?.real, r.ventas?.presupuesto, r.ventas?.variacion, r.ventas?.variacionPct);
  }
  for (const r of cmp.postventa?.sections || []) {
    pushLine('Postventa', r.label, r.ventas?.real, r.ventas?.presupuesto, r.ventas?.variacion, r.ventas?.variacionPct);
  }

  const csv = rows.map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `comparativa-ppto-${COMPARATIVA_YEAR}_${fi}_${ff}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderDrillRowHtml(row, fmt, hasCompare) {
  if (row.type === 'header') {
    return `<tr class="bg-kpi-float__section-row"><td colspan="${hasCompare ? 4 : 2}">${row.label}</td></tr>`;
  }
  if (row.type === 'text') {
    return `<tr class="eeff-kpi-detail__text"><td>${row.label}</td><td colspan="${hasCompare ? 3 : 1}">${row.value}</td></tr>`;
  }

  const toggle = row.hasChildren
    ? `<button type="button" class="eeff-drill-toggle" data-eeff-drill-toggle="${row.nodeKey}" aria-expanded="${row.isExpanded}" aria-label="Expandir ${row.label}">
         <span class="material-symbols-outlined">${row.isExpanded ? 'expand_more' : 'chevron_right'}</span>
       </button>`
    : '<span class="eeff-drill-toggle eeff-drill-toggle--spacer" aria-hidden="true"></span>';
  const indent = 4 + row.depth * 16;
  const labelCell = `<div class="eeff-drill-label" style="padding-left:${indent}px">${toggle}<span>${row.label}</span></div>`;

  const parentAttrs = row.hasChildren
    ? ` data-eeff-drill-toggle="${row.nodeKey}" role="button" tabindex="0" aria-expanded="${row.isExpanded}"`
    : '';

  if (hasCompare) {
    const variacion = (row.value || 0) - (row.presupuesto || 0);
    return `
      <tr class="eeff-drill-row${row.highlight ? ' row-highlight' : ''}${row.hasChildren ? ' eeff-drill-row--parent' : ''}"${parentAttrs}>
        <td>${labelCell}</td>
        <td class="cell-money">${fmt.money(row.value)}</td>
        <td class="cell-money">${fmt.money(row.presupuesto)}</td>
        <td class="cell-money ${variacionClass(variacion)}">${fmt.money(variacion)}</td>
      </tr>`;
  }

  return `
    <tr class="eeff-drill-row${row.highlight ? ' row-highlight' : ''}${row.hasChildren ? ' eeff-drill-row--parent' : ''}"${parentAttrs}>
      <td>${labelCell}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>`;
}

function renderEeffKpiDetail(detailPanelId, gridId, items, fmt) {
  const legacy = document.getElementById(detailPanelId);
  if (legacy) {
    legacy.classList.add('hidden');
    legacy.innerHTML = '';
  }

  if (!activeEeffKpi) {
    closeEeffKpiFloatUi();
    return;
  }
  if (!activeEeffKpi.startsWith(`${gridId}:`)) return;

  const panel = document.getElementById('eeffKpiFloat');
  const backdrop = document.getElementById('eeffKpiFloatBackdrop');
  if (!panel || !backdrop) return;

  const kpiId = activeEeffKpi.slice(gridId.length + 1);
  const kpi = items.find((i) => i.id === kpiId);
  if (!kpi?.drilldown?.length) {
    closeEeffKpiFloat();
    return;
  }

  if (eeffDrillNeedsSeed) {
    seedAutoExpandNodes(kpi.drilldown, activeEeffKpi);
    eeffDrillNeedsSeed = false;
  }

  const flatRows = flattenDrillTree(kpi.drilldown, activeEeffKpi);
  const hasCompare = treeHasCompare(kpi.drilldown);
  const display = kpi.displayOverride ?? fmt.money(kpi.value);
  const accent = kpi.color || 'blue';
  const rowCount = flatRows.filter((r) => r.type !== 'header' && r.type !== 'text').length;

  document.querySelectorAll('[data-eeff-kpi]').forEach((el) => {
    const open = el.dataset.eeffGrid === gridId && el.dataset.eeffKpi === kpiId;
    el.classList.toggle('is-open', open);
    el.classList.toggle('is-selected', open);
    if (el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  panel.dataset.accent = accent;
  panel.innerHTML = `
    <div class="bg-kpi-float__head bg-kpi-float__head--${accent}">
      <div class="bg-kpi-float__head-main">
        <div class="bg-kpi-float__icon bg-kpi-float__icon--${accent}" aria-hidden="true">
          <span class="material-symbols-outlined">${kpi.icon || 'payments'}</span>
        </div>
        <div>
          <p class="bg-kpi-float__eyebrow">EEFF · desglose</p>
          <h3 class="bg-kpi-float__title" id="eeffKpiFloatTitle">${kpi.label}</h3>
          <p class="bg-kpi-float__value ${moneyClass(kpi.value)}">${display}</p>
          <p class="bg-kpi-float__hint">${kpi.sub || 'Clic en una partida para expandir su detalle'}</p>
          <span class="bg-kpi-float__meta">${rowCount} partida${rowCount === 1 ? '' : 's'} visibles</span>
        </div>
      </div>
      <button type="button" class="bg-kpi-float__close" data-eeff-close-detail aria-label="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="bg-kpi-float__body">
      <div class="bg-kpi-float__group">
        <p class="bg-kpi-float__section">Desglose · clic para expandir</p>
        <table class="bg-kpi-float__table${hasCompare ? ' bg-kpi-float__table--compare' : ''}">
          <thead>
            <tr>
              <th>Concepto</th>
              <th class="cell-money">${hasCompare ? 'Real' : 'Importe'}</th>
              ${hasCompare ? '<th class="cell-money">Presupuesto</th><th class="cell-money">Variación</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${flatRows.map((row) => renderDrillRowHtml(row, fmt, hasCompare)).join('')
              || '<tr><td colspan="2">Sin desglose disponible.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
}

function renderInteractiveKpiGrid(gridId, detailPanelId, items, fmt) {
  const el = document.getElementById(gridId);
  if (!el) return;

  el.innerHTML = items.map((k) => {
    const hasDrill = k.drilldown?.length;
    const kpiKey = `${gridId}:${k.id}`;
    const isOpen = activeEeffKpi === kpiKey;
    const display = k.displayOverride ?? fmt.money(k.value);
    const sub = k.sub != null ? k.sub : '';

    if (!hasDrill) {
      return `
    <div class="kpi-card kpi-card--eeff kpi-card--${k.color || 'blue'}">
      <div class="kpi-card-head">
        <span class="kpi-title">${k.label}</span>
        <span class="material-symbols-outlined kpi-icon">${k.icon || 'payments'}</span>
      </div>
      <div class="kpi-value money">${display}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
    </div>`;
    }

    return `
    <button type="button"
      class="kpi-card kpi-card--eeff kpi-card--interactive kpi-card--${k.color || 'blue'}${isOpen ? ' is-selected is-open' : ''}"
      data-eeff-kpi="${k.id}"
      data-eeff-grid="${gridId}"
      data-eeff-detail="${detailPanelId}"
      aria-expanded="${isOpen}"
      title="Clic para ver desglose">
      <div class="kpi-card-head">
        <span class="kpi-title">${k.label}</span>
        <span class="material-symbols-outlined kpi-icon">${k.icon || 'payments'}</span>
      </div>
      <div class="kpi-value money">${display}</div>
      ${sub ? `<p class="kpi-subtitle">${sub}</p>` : ''}
      <span class="material-symbols-outlined kpi-card-chevron" aria-hidden="true">expand_more</span>
    </button>`;
  }).join('');

  renderEeffKpiDetail(detailPanelId, gridId, items, fmt);
}

function renderKpiGrid(containerId, items, fmt) {
  const detailMap = {
    kpiEdoFin: 'eeffKpiDetailEdoFin',
    kpiVentas: 'eeffKpiDetailVentas',
    kpiPostventa: 'eeffKpiDetailPostventa',
    kpiComparativa: 'eeffKpiDetailComparativa',
  };
  const detailId = detailMap[containerId];
  if (detailId && fmt) {
    renderInteractiveKpiGrid(containerId, detailId, items, fmt);
    return;
  }
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map((k) => `
    <div class="kpi-card kpi-card--eeff kpi-card--${k.color || 'blue'}">
      <div class="kpi-card-head">
        <span class="kpi-title">${k.label}</span>
        <span class="material-symbols-outlined kpi-icon">${k.icon || 'payments'}</span>
      </div>
      <div class="kpi-value money">${k.display}</div>
      <p class="kpi-subtitle">${k.sub || ''}</p>
    </div>
  `).join('');
}

function renderLinesTable(tbodyId, lines, fmt) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">Sin datos en el periodo.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    const indent = row.level ? ` style="padding-left:${row.level * 16}px"` : '';
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td${indent}>${row.label}</td>
      <td class="cell-money ${moneyClass(row.value)}"><strong>${fmt.money(row.value)}</strong></td>
    </tr>`;
  }).join('');
}

function renderBranchTable(tbodyId, footId, rows, fmt, showMargin = true) {
  const body = document.getElementById(tbodyId);
  const foot = document.getElementById(footId);
  if (!body) return;
  if (!rows?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">Sin datos.</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${r.label}</strong></td>
      <td class="cell-money">${fmt.money(r.ventas)}</td>
      <td class="cell-money">${fmt.money(r.costo)}</td>
      <td class="cell-money ${moneyClass(r.utilidadBruta)}"><strong>${fmt.money(r.utilidadBruta)}</strong></td>
      <td class="cell-money">${fmt.money(r.sumaGastos)}</td>
      <td class="cell-money ${moneyClass(r.utilidadOperacion)}"><strong>${fmt.money(r.utilidadOperacion)}</strong></td>
      ${showMargin ? `<td class="cell-num ${moneyClass(r.margenOperacionPct)}">${r.margenOperacionPct}%</td>` : ''}
    </tr>
  `).join('');

  if (foot && rows.length > 1) {
    const t = rows.reduce((acc, r) => ({
      ventas: acc.ventas + r.ventas,
      costo: acc.costo + r.costo,
      utilidadBruta: acc.utilidadBruta + r.utilidadBruta,
      sumaGastos: acc.sumaGastos + r.sumaGastos,
      utilidadOperacion: acc.utilidadOperacion + r.utilidadOperacion,
    }), { ventas: 0, costo: 0, utilidadBruta: 0, sumaGastos: 0, utilidadOperacion: 0 });
    foot.innerHTML = `
      <tr class="row-highlight">
        <td><strong>Total</strong></td>
        <td class="cell-money"><strong>${fmt.money(t.ventas)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(t.costo)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(t.utilidadBruta)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(t.sumaGastos)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(t.utilidadOperacion)}</strong></td>
        ${showMargin ? '<td></td>' : ''}
      </tr>`;
  }
}

function renderPostventaTable(data, fmt) {
  const body = document.getElementById('postventaTable');
  const foot = document.getElementById('postventaFoot');
  if (!body || !data?.sections) return;

  body.innerHTML = data.sections.map((s) => `
    <tr>
      <td><strong>${s.label}</strong></td>
      <td class="cell-money">${fmt.money(s.ventas)}</td>
      <td class="cell-money">${fmt.money(s.costo)}</td>
      <td class="cell-money ${moneyClass(s.utilidadBruta)}">${fmt.money(s.utilidadBruta)}</td>
      <td class="cell-money">${fmt.money(s.gastos)}</td>
      <td class="cell-money">${fmt.money(s.gastosAdministracion)}</td>
      <td class="cell-money ${moneyClass(s.utilidadOperacion)}"><strong>${fmt.money(s.utilidadOperacion)}</strong></td>
      <td class="cell-num">${s.margenOperacionPct}%</td>
    </tr>
  `).join('');

  const s = data.summary;
  if (foot) {
    foot.innerHTML = `
      <tr class="row-highlight">
        <td><strong>Total PostVenta</strong></td>
        <td class="cell-money"><strong>${fmt.money(s.ventas)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(s.costo)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(s.utilidadBruta)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(s.gastos)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(s.gastosAdministracion)}</strong></td>
        <td class="cell-money"><strong>${fmt.money(s.utilidadOperacion)}</strong></td>
        <td class="cell-num"><strong>${s.margenOperacionPct}%</strong></td>
      </tr>`;
  }
}

function renderEdoFin(data, fmt) {
  renderEdoFinOverview(data, fmt);
  renderLinesTable('edoFinTable', data.estadoFinanciero?.lines, fmt);
}

function renderVentas(data, fmt) {
  const v = data.ventas || {};
  const total = v.totalVentasAutos?.summary || {};
  const items = buildVentasKpiItems(data);
  const totalItem = items.find((i) => i.id === 'totalAutos');
  if (totalItem) {
    totalItem.sub = `Util. op. ${fmt.money(total.utilidadOperacion)}`;
  }
  renderKpiGrid('kpiVentas', items, fmt);
  renderBranchTable('menudeoTable', 'menudeoFoot', v.menudeo?.branches, fmt);
  renderBranchTable(
    'otrasDivisionesTable',
    'otrasDivisionesFoot',
    [v.flotillas?.branch, v.intercambios?.branch].filter(Boolean),
    fmt,
    false,
  );
  renderLinesTable('totalVentasTable', v.totalVentasAutos?.lines, fmt);
}

function renderCompareRow(label, row, fmt, metric = 'ventas') {
  const item = row[metric] || row;
  if (!item || item.real == null) return '';
  return `
    <tr>
      <td><strong>${label}</strong></td>
      <td class="cell-money">${fmt.money(item.real)}</td>
      <td class="cell-money">${fmt.money(item.presupuesto)}</td>
      <td class="cell-money ${variacionClass(item.variacion)}"><strong>${fmt.money(item.variacion)}</strong></td>
      <td class="cell-num ${variacionClass(item.variacion)}">${item.variacionPct > 0 ? '+' : ''}${item.variacionPct}%</td>
    </tr>`;
}

function renderCompareLinesTable(tbodyId, lines, fmt) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  if (!lines?.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">Sin datos comparativos.</td></tr>';
    return;
  }
  body.innerHTML = lines.map((row) => {
    const indent = row.level ? ` style="padding-left:${row.level * 16}px"` : '';
    return `
    <tr${row.highlight ? ' class="row-highlight"' : ''}>
      <td${indent}>${row.label}</td>
      <td class="cell-money">${fmt.money(row.real)}</td>
      <td class="cell-money">${fmt.money(row.presupuesto)}</td>
      <td class="cell-money ${variacionClass(row.variacion)}"><strong>${fmt.money(row.variacion)}</strong></td>
      <td class="cell-num ${variacionClass(row.variacion)}">${row.variacionPct > 0 ? '+' : ''}${row.variacionPct}%</td>
    </tr>`;
  }).join('');
}

function renderComparativa(data, fmt) {
  const cmp = data.comparativaPresupuesto;
  const kpiEl = document.getElementById('kpiComparativa');
  const subtitle = document.getElementById('comparativaSubtitle');
  const alertEl = document.getElementById('comparativaAlert');
  const fi = data.filtros?.fechaInicio;
  const ff = data.filtros?.fechaFin;
  const in2026 = isComparativaYearRange(fi, ff);

  if (alertEl) {
    if (!in2026) {
      alertEl.classList.remove('hidden');
      alertEl.innerHTML = `
        <span class="material-symbols-outlined">info</span>
        <div>
          <strong>Comparativa solo disponible para ${COMPARATIVA_YEAR}</strong>
          <p>Periodo actual: ${fi || '—'} → ${ff || '—'}. Use fechas de ${COMPARATIVA_YEAR} para comparar contabilidad real vs presupuesto.</p>
          <button type="button" class="btn-glass btn-primary comparativa-alert__btn" id="btnComparativa2026">Usar acumulado ${COMPARATIVA_YEAR}</button>
        </div>`;
    } else {
      alertEl.classList.add('hidden');
      alertEl.innerHTML = '';
    }
  }

  if (!cmp?.available) {
    if (kpiEl) kpiEl.innerHTML = '';
    document.getElementById('eeffKpiDetailComparativa')?.classList.add('hidden');
    if (activeEeffKpi?.startsWith('kpiComparativa:')) activeEeffKpi = null;
    renderCompareLinesTable('comparativaEdoFinTable', [], fmt);
    const msg = !in2026
      ? `La comparativa PPTO aplica solo a ${COMPARATIVA_YEAR}. Ajuste el periodo o use “Usar acumulado ${COMPARATIVA_YEAR}”.`
      : (cmp?.reason || `No hay presupuesto cargado para el periodo. Verifique presupuesto-${COMPARATIVA_YEAR}.xlsx.`);
    document.getElementById('comparativaMenudeoTable').innerHTML = `<tr class="empty-row"><td colspan="5">${msg}</td></tr>`;
    document.getElementById('comparativaPostventaTable').innerHTML = `<tr class="empty-row"><td colspan="5">${msg}</td></tr>`;
    if (subtitle) subtitle.textContent = msg;
    const exportBtn = document.getElementById('btnExportComparativa');
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  const cmpItems = buildComparativaKpiItems(cmp);
  const s = cmp.estadoFinanciero?.summary || {};
  cmpItems.forEach((item) => {
    if (item.id === 'ventasTotales') {
      item.sub = `PPTO ${fmt.money(s.ventasTotales?.presupuesto)} · var. ${formatPctLabel(s.ventasTotales?.variacionPct)}`;
    }
    if (item.id === 'utilidadBruta') {
      item.sub = `PPTO ${fmt.money(s.utilidadBruta?.presupuesto)} · var. ${fmt.money(s.utilidadBruta?.variacion)}`;
    }
    if (item.id === 'utilidadOperacion') {
      item.sub = `PPTO ${fmt.money(s.utilidadOperacion?.presupuesto)} · var. ${formatPctLabel(s.utilidadOperacion?.variacionPct)}`;
    }
    if (item.id === 'periodo') {
      item.sub = `${(cmp.factorPeriodo * 100).toFixed(0)}% del presupuesto anual`;
    }
  });
  renderKpiGrid('kpiComparativa', cmpItems, fmt);

  if (subtitle) {
    subtitle.textContent = formatComparativaPeriodLabel(fi, ff, cmp.mesesIncluidos);
  }

  const exportBtn = document.getElementById('btnExportComparativa');
  if (exportBtn) exportBtn.disabled = false;

  renderCompareLinesTable('comparativaEdoFinTable', cmp.estadoFinanciero?.lines, fmt);

  const menudeoBody = document.getElementById('comparativaMenudeoTable');
  if (menudeoBody) {
    const rows = cmp.ventas?.menudeo || [];
    menudeoBody.innerHTML = rows.length
      ? rows.map((r) => renderCompareRow(r.label, r, fmt, 'ventas')).join('')
      : '<tr class="empty-row"><td colspan="5">Sin menudeo en este periodo. Pruebe otro rango de fechas.</td></tr>';
  }

  const pvBody = document.getElementById('comparativaPostventaTable');
  if (pvBody) {
    const rows = cmp.postventa?.sections || [];
    pvBody.innerHTML = rows.length
      ? rows.map((r) => renderCompareRow(r.label, r, fmt, 'ventas')).join('')
      : '<tr class="empty-row"><td colspan="5">Sin postventa en este periodo. Pruebe otro rango de fechas.</td></tr>';
  }
}

function renderPostventa(data, fmt) {
  const pv = data.postventa || {};
  renderKpiGrid('kpiPostventa', buildPostventaKpiItems(data), fmt);
  renderPostventaTable(pv, fmt);
}

function switchCategoria(categoria) {
  if (categoria === 'comparativa') {
    const fiEl = document.getElementById('fechaInicio');
    const ffEl = document.getElementById('fechaFin');
    if (fiEl && ffEl && !isComparativaYearRange(fiEl.value, ffEl.value)) {
      const range = getComparativa2026DefaultRange();
      fiEl.value = range.fechaInicio;
      ffEl.value = range.fechaFin;
      document.getElementById('btnConsultar')?.click();
    }
  }

  activeCategoria = categoria;
  document.querySelectorAll('.eeff-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.categoria === categoria);
  });
  document.querySelectorAll('.eeff-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== categoria);
  });
}

function renderAll(data) {
  const { fmt } = Dashboard;
  renderEdoFin(data, fmt);
  renderVentas(data, fmt);
  renderPostventa(data, fmt);
  renderComparativa(data, fmt);
  switchCategoria(activeCategoria);
}

async function loadEeffSummary(fechaInicio, fechaFin) {
  const { api } = Dashboard;
  const data = await api(`/eeff?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
  eeffData = data;
  closeEeffKpiFloat();
  renderAll(data);
  return data;
}

document.getElementById('eeffTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.eeff-tab');
  if (!tab) return;
  closeEeffKpiFloat();
  switchCategoria(tab.dataset.categoria);
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-eeff-close-detail]') || e.target.closest('#eeffKpiFloatBackdrop')) {
    closeEeffKpiFloat();
    return;
  }

  const drillToggle = e.target.closest('[data-eeff-drill-toggle]');
  if (drillToggle) {
    e.stopPropagation();
    e.preventDefault();
    const nodeKey = drillToggle.dataset.eeffDrillToggle;
    if (expandedDrillNodes.has(nodeKey)) expandedDrillNodes.delete(nodeKey);
    else expandedDrillNodes.add(nodeKey);
    if (eeffData) renderAll(eeffData);
    return;
  }

  const kpiBtn = e.target.closest('[data-eeff-kpi]');
  if (kpiBtn) {
    e.stopPropagation();
    e.preventDefault();
    const gridId = kpiBtn.dataset.eeffGrid;
    const kpiId = kpiBtn.dataset.eeffKpi;
    const key = `${gridId}:${kpiId}`;
    const opening = activeEeffKpi !== key;
    if (opening) {
      activeEeffKpi = key;
      expandedDrillNodes.clear();
      eeffDrillNeedsSeed = true;
    } else {
      closeEeffKpiFloat();
      return;
    }
    if (eeffData) renderAll(eeffData);
    return;
  }

  const exportBtn = e.target.closest?.('#btnExportComparativa');
  if (exportBtn) {
    if (eeffData?.comparativaPresupuesto?.available) {
      downloadComparativaCsv(eeffData.comparativaPresupuesto, eeffData.filtros);
    }
    return;
  }

  if (!e.target.closest?.('#btnComparativa2026')) return;
  const range = getComparativa2026DefaultRange();
  const fi = document.getElementById('fechaInicio');
  const ff = document.getElementById('fechaFin');
  if (fi) fi.value = range.fechaInicio;
  if (ff) ff.value = range.fechaFin;
  document.getElementById('btnConsultar')?.click();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeEeffKpi) closeEeffKpiFloat();
});

window.EeffSummary = {
  load: loadEeffSummary,
  switchCategoria,
  closeKpiFloat: closeEeffKpiFloat,
  getActiveCategoria: () => activeCategoria,
  isComparativaYearRange,
  getComparativa2026DefaultRange,
};
