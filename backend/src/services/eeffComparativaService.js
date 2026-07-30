const { getBudgetForPeriod } = require('./budget2026Service');

function pctVariacion(real, presupuesto) {
  if (!presupuesto) return real ? 100 : 0;
  return Number((((real - presupuesto) / Math.abs(presupuesto)) * 100).toFixed(1));
}

function cmpLine(key, label, real, presupuesto, extra = {}) {
  const variacion = real - presupuesto;
  return {
    key,
    label,
    real,
    presupuesto,
    variacion,
    variacionPct: pctVariacion(real, presupuesto),
    ...extra,
  };
}

function compareLines(realLines, budgetLines) {
  const budgetMap = new Map((budgetLines || []).map((l) => [l.key, l]));
  const keys = new Set([
    ...(realLines || []).map((l) => l.key),
    ...(budgetLines || []).map((l) => l.key),
  ]);

  return [...keys].map((key) => {
    const real = (realLines || []).find((l) => l.key === key);
    const budget = budgetMap.get(key);
    return cmpLine(
      key,
      real?.label || budget?.label || key,
      Number(real?.value || 0),
      Number(budget?.value || 0),
      { highlight: real?.highlight || budget?.highlight, level: real?.level },
    );
  });
}

function compareBranchRows(realRows, budgetRows) {
  const budgetMap = new Map((budgetRows || []).map((r) => [r.id, r]));
  return (realRows || []).map((real) => {
    const budget = budgetMap.get(real.id) || {};
    return {
      id: real.id,
      label: real.label,
      ventas: cmpLine(`${real.id}_ventas`, 'Ventas', real.ventas, budget.ventas || 0),
      utilidadBruta: cmpLine(`${real.id}_ub`, 'Util. bruta', real.utilidadBruta, budget.utilidadBruta || 0),
      utilidadOperacion: cmpLine(`${real.id}_uo`, 'Util. operación', real.utilidadOperacion, budget.utilidadOperacion || 0),
    };
  });
}

function comparePostventaSections(realSections, budgetSections) {
  const budgetMap = new Map((budgetSections || []).map((s) => [s.id, s]));
  return (realSections || []).map((real) => {
    const budget = budgetMap.get(real.id) || {};
    return {
      id: real.id,
      label: real.label,
      ventas: cmpLine(`${real.id}_ventas`, 'Ventas', real.ventas, budget.ventas || 0),
      utilidadBruta: cmpLine(`${real.id}_ub`, 'Util. bruta', real.utilidadBruta, budget.utilidadBruta || 0),
      utilidadOperacion: cmpLine(`${real.id}_uo`, 'Util. operación', real.utilidadOperacion, budget.utilidadOperacion || 0),
    };
  });
}

function compareSummary(realSummary, budgetSummary, fields) {
  const out = {};
  for (const field of fields) {
    out[field] = cmpLine(field, field, Number(realSummary?.[field] || 0), Number(budgetSummary?.[field] || 0));
  }
  return out;
}

function buildEeffComparativa(eeff, fechaInicio, fechaFin) {
  const budget = getBudgetForPeriod({ fechaInicio, fechaFin });
  if (!budget.available) {
    return { available: false, reason: budget.reason, year: budget.year };
  }

  const realEdo = eeff.estadoFinanciero || {};
  const realVentas = eeff.ventas || {};
  const realPostventa = eeff.postventa || {};

  return {
    available: true,
    template: budget.template,
    source: budget.source,
    year: budget.year,
    mesesIncluidos: budget.mesesIncluidos,
    factorPeriodo: budget.factorPeriodo,
    estadoFinanciero: {
      summary: compareSummary(realEdo.summary, budget.estadoFinanciero.summary, [
        'ventasTotales',
        'costoTotal',
        'utilidadBruta',
        'gastosOperacion',
        'gastosAdministracion',
        'sumaGastos',
        'utilidadOperacion',
      ]),
      lines: compareLines(realEdo.lines, budget.estadoFinanciero.lines),
    },
    ventas: {
      menudeo: compareBranchRows(
        realVentas.menudeo?.branches,
        budget.ventas.menudeo?.branches,
      ),
      flotillas: cmpLine(
        'flotillas_ventas',
        'Flotillas · ventas',
        realVentas.flotillas?.summary?.ventas || 0,
        budget.ventas.flotillas?.summary?.ventas || 0,
      ),
      intercambios: cmpLine(
        'intercambios_ventas',
        'Intercambios · ventas',
        realVentas.intercambios?.summary?.ventas || 0,
        budget.ventas.intercambios?.summary?.ventas || 0,
      ),
      totalAutosNuevos: cmpLine(
        'total_autos_nuevos',
        'Total autos nuevos · ventas',
        realVentas.totalVentasAutos?.summary?.ventas || 0,
        budget.ventas.totalVentasAutos?.summary?.ventas || 0,
      ),
    },
    postventa: {
      summary: compareSummary(realPostventa.summary, budget.postventa.summary, [
        'ventas',
        'utilidadBruta',
        'utilidadOperacion',
      ]),
      sections: comparePostventaSections(realPostventa.sections, budget.postventa.sections),
    },
  };
}

module.exports = { buildEeffComparativa };
