let activeCategoria = 'estadoFinanciero';
let eeffData = null;
let activeEeffKpi = null;
let expandedDrillNodes = new Set();

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

function buildEdoFinKpiItems(data) {
  const s = data.estadoFinanciero?.summary || {};

  return [
    {
      id: 'ventasTotales',
      label: 'Ventas totales',
      value: s.ventasTotales,
      icon: 'receipt_long',
      color: 'blue',
      drilldown: buildVentasTotalesDrill(data),
    },
    {
      id: 'costosTotales',
      label: 'Costos totales',
      value: s.costoTotal,
      icon: 'shopping_cart',
      color: 'rose',
      sub: s.ventasTotales
        ? `${Number(((Number(s.costoTotal || 0) / Number(s.ventasTotales)) * 100).toFixed(1))}% de ventas`
        : 'Costo de ventas',
      drilldown: buildCostoDrill(data),
    },
    {
      id: 'utilidadBruta',
      label: 'Utilidad bruta',
      value: s.utilidadBruta,
      icon: 'savings',
      color: 'green',
      sub: `${s.margenBrutoPct ?? 0}% margen`,
      drilldown: buildUtilidadBrutaDrill(data),
    },
    {
      id: 'gastosTotales',
      label: 'Gastos totales',
      value: s.sumaGastos,
      icon: 'payments',
      color: 'amber',
      sub: s.ventasTotales
        ? `${Number(((Number(s.sumaGastos || 0) / Number(s.ventasTotales)) * 100).toFixed(1))}% de ventas`
        : 'Operación + administración',
      drilldown: buildGastosDrill(data),
    },
    {
      id: 'utilidadOperacion',
      label: 'Utilidad operación',
      value: s.utilidadOperacion,
      icon: 'query_stats',
      color: 'violet',
      sub: `${s.margenOperacionPct ?? 0}% margen`,
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
      id: 'perdidaFinanciera',
      label: 'Pérdida financiera',
      value: s.perdidaFinanciera,
      icon: 'account_balance',
      color: Number(s.perdidaFinanciera || 0) < 0 ? 'rose' : 'green',
      sub: 'Productos − gastos e intereses',
      drilldown: buildPerdidaFinancieraDrill(data),
    },
    {
      id: 'utilidad',
      label: 'Utilidad',
      value: s.utilidad,
      icon: 'flag',
      color: 'amber',
      drilldown: [
        drillRow('Utilidad operación', s.utilidadOperacion, { id: 'u-uo', highlight: true }),
        drillRow('Productos financieros', s.productosFinancieros, { id: 'u-pf' }),
        drillRow('Gastos financieros', s.gastosFinancieros, { id: 'u-gf' }),
        drillRow('Utilidad financiera', s.utilidadFinanciera, { id: 'u-uf', highlight: true }),
        drillRow('Utilidad', s.utilidad, { id: 'u-total', highlight: true }),
      ],
    },
  ];
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
  const n = Number(value) || 0;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}%`;
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
    return `<tr class="eeff-kpi-detail__section"><td colspan="${hasCompare ? 4 : 2}">${row.label}</td></tr>`;
  }
  if (row.type === 'text') {
    return `<tr class="eeff-kpi-detail__text"><td>${row.label}</td><td colspan="${hasCompare ? 3 : 1}">${row.value}</td></tr>`;
  }

  const toggle = row.hasChildren
    ? `<button type="button" class="eeff-drill-toggle" data-eeff-drill-toggle="${row.nodeKey}" aria-expanded="${row.isExpanded}" aria-label="Expandir ${row.label}">
         <span class="material-symbols-outlined">${row.isExpanded ? 'expand_more' : 'chevron_right'}</span>
       </button>`
    : '<span class="eeff-drill-toggle eeff-drill-toggle--spacer" aria-hidden="true"></span>';
  const indent = 8 + row.depth * 18;
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

function renderEeffKpiDetail(detailPanelId, gridId, items, fmt) {
  const panel = document.getElementById(detailPanelId);
  if (!panel) return;

  const kpiKey = activeEeffKpi;
  if (!kpiKey || !kpiKey.startsWith(`${gridId}:`)) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const kpiId = kpiKey.slice(gridId.length + 1);
  const kpi = items.find((i) => i.id === kpiId);
  if (!kpi?.drilldown?.length) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const flatRows = flattenDrillTree(kpi.drilldown, kpiKey);
  const hasCompare = treeHasCompare(kpi.drilldown);

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="eeff-kpi-detail">
      <div class="eeff-kpi-detail__head">
        <div>
          <p class="eeff-kpi-detail__eyebrow">Desglose</p>
          <h4 class="eeff-kpi-detail__title">${kpi.label}</h4>
          <p class="eeff-kpi-detail__hint">Clic en una partida para ver su desglose</p>
        </div>
        <button type="button" class="eeff-kpi-detail__close" data-eeff-close-detail aria-label="Cerrar desglose">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="table-scroll eeff-kpi-detail__table-wrap">
        <table class="data-table eeff-kpi-detail__table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th class="cell-money">${hasCompare ? 'Real' : 'Importe'}</th>
              ${hasCompare ? '<th class="cell-money">Presupuesto</th><th class="cell-money">Variación</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${flatRows.map((row) => renderDrillRowHtml(row, fmt, hasCompare)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
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
  renderKpiGrid('kpiEdoFin', buildEdoFinKpiItems(data), fmt);
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
  expandedDrillNodes.clear();
  renderAll(data);
  return data;
}

document.getElementById('eeffTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.eeff-tab');
  if (!tab) return;
  switchCategoria(tab.dataset.categoria);
});

document.addEventListener('click', (e) => {
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
    activeEeffKpi = opening ? key : null;
    if (opening) expandedDrillNodes.clear();
    if (eeffData) renderAll(eeffData);
    if (opening) {
      document.getElementById(kpiBtn.dataset.eeffDetail)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }

  if (e.target.closest('[data-eeff-close-detail]')) {
    activeEeffKpi = null;
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

window.EeffSummary = {
  load: loadEeffSummary,
  switchCategoria,
  getActiveCategoria: () => activeCategoria,
  isComparativaYearRange,
  getComparativa2026DefaultRange,
};
