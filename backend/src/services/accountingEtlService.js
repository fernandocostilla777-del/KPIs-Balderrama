const { query } = require('../db');
const {
  SEGMENT_TO_CC,
  AREA_CC,
  ADMIN_CC,
  ADMIN_GPOCONT,
  VTASMEN_BRANCHES,
  EXPENSE_SUBACCOUNTS,
  INCOME_PREFIX_TO_AREA,
  COST_PREFIX_TO_AREA,
  OPERATIONAL_CC_LIST,
  getOperationalCc,
} = require('../config/costCenterMapping');
const { getProrationFactors } = require('../config/prorationMatrix');

const ACUM_DET = 'DETA';
const AUTOS_SEGMENTS = new Set(VTASMEN_BRANCHES.map((b) => b.segment));

function parseDate(value) {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return d;
}

function ctasTable(year) {
  return `CON_CTAS01${year}`;
}

async function tableExists(name) {
  const rows = await query(
    'SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @name',
    { name },
  );
  return rows.length > 0;
}

function yearSegments(fechaInicio, fechaFin) {
  const start = parseDate(fechaInicio);
  const end = parseDate(fechaFin);
  if (start > end) throw new Error('fechaInicio no puede ser mayor que fechaFin');

  const segments = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const monthStart = cursor.getMonth() + 1;
    const yearEndDate = new Date(year, 11, 31, 12);
    const segEnd = end < yearEndDate ? end : yearEndDate;
    const monthEnd = segEnd.getMonth() + 1;
    segments.push({ year, monthStart, monthEnd });
    cursor = new Date(year + 1, 0, 1, 12);
  }
  return segments;
}

function movementExpr(startMonth, endMonth) {
  const parts = [];
  for (let m = startMonth; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  return parts.length ? parts.join(' + ') : '0';
}

function incomeBalanceExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${rawExpr}) ELSE (${rawExpr}) END`;
}

function expenseBalanceExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${rawExpr}) ELSE -(${rawExpr}) END`;
}

async function sumAcrossSegments(segments, fn) {
  let total = 0;
  for (const seg of segments) {
    const table = ctasTable(seg.year);
    if (!(await tableExists(table))) continue;
    total += await fn(table, seg.monthStart, seg.monthEnd);
  }
  return total;
}

async function sumByLikePatterns(table, startMonth, endMonth, prefixes, asIncome) {
  if (!prefixes?.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeBalanceExpr(mov) : expenseBalanceExpr(mov);
  const where = prefixes.map((_, i) => `(CTA_NUMCTA LIKE @lp${i})`).join(' OR ');
  const params = {};
  prefixes.forEach((p, i) => { params[`lp${i}`] = p; });
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND (${where})
  `, params);
  return Number(rows[0]?.total || 0);
}

async function sumByGroup(table, startMonth, endMonth, group) {
  const mov = movementExpr(startMonth, endMonth);
  const sign = expenseBalanceExpr(mov);
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_GPOCONT = @g
  `, { g: group });
  return Number(rows[0]?.total || 0);
}

function txRow({ fechaInicio, fechaFin, seg, mask, ccId, ccLabel, ccType, area, balance, source, id_cuenta, subcuentaLabel }) {
  return {
    year: seg.year,
    monthStart: seg.monthStart,
    monthEnd: seg.monthEnd,
    fechaInicio,
    fechaFin,
    id_cuenta: id_cuenta || `${source}:${ccId}:${mask}`,
    descripcion_cuenta: source,
    id_centro_costos: null,
    mask,
    subcuenta0700: null,
    subcuentaLabel: subcuentaLabel || null,
    balance_neto: balance,
    ccId,
    ccLabel,
    ccType,
    area,
    segment: null,
    source,
  };
}

/** Autos nuevos — VTASMEN: 0400/0600 por sucursal, gastos por grupo 711–718 */
async function extractAutosNuevosVtasmen(fechaInicio, fechaFin, segments) {
  const rows = [];
  for (const branch of VTASMEN_BRANCHES) {
    const ventas = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByLikePatterns(table, ms, me, branch.revenuePrefixes, true));
    const costo = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByLikePatterns(table, ms, me, branch.costPrefixes, false));

    let gastos = 0;
    if (branch.expenseGroup) {
      gastos = await sumAcrossSegments(segments, (table, ms, me) =>
        sumByGroup(table, ms, me, branch.expenseGroup));
    } else if (branch.expensePattern) {
      gastos = await sumAcrossSegments(segments, (table, ms, me) =>
        sumByLikePatterns(table, ms, me, [branch.expensePattern], false));
    }

    const seg = segments[0] || { year: parseDate(fechaInicio).getFullYear(), monthStart: 1, monthEnd: 12 };
    if (Math.abs(ventas) > 0.01) {
      rows.push(txRow({
        fechaInicio, fechaFin, seg, mask: 'ingreso',
        ccId: branch.id, ccLabel: branch.label, ccType: 'operativo', area: 'autosNuevos',
        balance: ventas, source: 'VTASMEN_0400', id_cuenta: branch.revenuePrefixes[0],
      }));
    }
    if (Math.abs(costo) > 0.01) {
      rows.push(txRow({
        fechaInicio, fechaFin, seg, mask: 'costo',
        ccId: branch.id, ccLabel: branch.label, ccType: 'operativo', area: 'autosNuevos',
        balance: costo, source: 'VTASMEN_0600', id_cuenta: branch.costPrefixes[0],
      }));
    }
    if (Math.abs(gastos) > 0.01) {
      rows.push(txRow({
        fechaInicio, fechaFin, seg, mask: 'gasto',
        ccId: branch.id, ccLabel: branch.label, ccType: 'operativo', area: 'autosNuevos',
        balance: gastos, source: branch.expenseGroup ? `VTASMEN_GPO${branch.expenseGroup}` : 'VTASMEN_0700',
        id_cuenta: branch.expenseGroup || branch.expensePattern,
      }));
    }
  }
  return rows;
}

function matchPostventaArea(cta) {
  for (const map of INCOME_PREFIX_TO_AREA) {
    if (map.area === 'autosNuevos') continue;
    for (const prefix of map.prefixes) {
      if (cta.startsWith(prefix)) return map.area;
    }
  }
  for (const map of COST_PREFIX_TO_AREA) {
    if (map.area === 'autosNuevos') continue;
    for (const prefix of map.prefixes) {
      if (cta.startsWith(prefix)) return map.area;
    }
  }
  return null;
}

function isAutosNuevosAccount(cta) {
  if (cta.startsWith('0400-') || cta.startsWith('0600-')) {
    const parts = cta.split('-');
    const seg = parts[1];
    if (AUTOS_SEGMENTS.has(seg)) return true;
    if (cta.startsWith('0600-0003-')) return true;
  }
  return false;
}

function extractSubaccount0700(parts) {
  if (parts[0] !== '0700' || !parts[1]) return null;
  return parts[1];
}

function resolvePostventa0700(cca) {
  const parts = cca.split('-');
  for (const map of INCOME_PREFIX_TO_AREA) {
    if (map.area === 'autosNuevos' || !map.useSegment) continue;
    for (const prefix of map.prefixes) {
      if (parts.some((p, i) => i > 0 && `${prefix}-${p}`.startsWith(prefix))) {
        return AREA_CC[map.area];
      }
    }
  }
  const seg = parts.find((p) => AUTOS_SEGMENTS.has(p));
  if (seg) return null;
  for (const map of INCOME_PREFIX_TO_AREA) {
    if (map.area === 'autosNuevos') continue;
    for (const prefix of map.prefixes) {
      if (cca.includes(prefix.replace(/-$/, ''))) return AREA_CC[map.area];
    }
  }
  return null;
}

/** Postventa — 04xx/06xx/0700 fuera de autos nuevos VTASMEN */
async function extractPostventaAccounts(fechaInicio, fechaFin, segments) {
  const rows = [];

  for (const seg of segments) {
    const table = ctasTable(seg.year);
    if (!(await tableExists(table))) continue;

    const mov = movementExpr(seg.monthStart, seg.monthEnd);
    const incomeBal = incomeBalanceExpr(mov);
    const expenseBal = expenseBalanceExpr(mov);

    const extracted = await query(`
      SELECT
        CTA_NUMCTA AS id_cuenta,
        CTA_DESCRIPCION AS descripcion_cuenta,
        LTRIM(RTRIM(ISNULL(CTA_GPOCONT4, ''))) AS id_centro_costos,
        CTA_GPOCONT AS gpo_cont,
        SUM(CASE
          WHEN (CTA_NUMCTA LIKE '04%' AND CTA_NUMCTA NOT LIKE '06%') THEN ${incomeBal}
          WHEN CTA_NUMCTA LIKE '06%' THEN ${expenseBal}
          WHEN CTA_NUMCTA LIKE '0700%' THEN ${expenseBal}
          ELSE 0
        END) AS balance_neto
      FROM [${table}]
      WHERE CTA_ACUMDET = '${ACUM_DET}'
        AND (
          (CTA_NUMCTA LIKE '04%' AND CTA_NUMCTA NOT LIKE '06%')
          OR CTA_NUMCTA LIKE '06%'
          OR CTA_NUMCTA LIKE '0700%'
        )
      GROUP BY CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT4, CTA_GPOCONT
      HAVING ABS(SUM(CASE
          WHEN (CTA_NUMCTA LIKE '04%' AND CTA_NUMCTA NOT LIKE '06%') THEN ${incomeBal}
          WHEN CTA_NUMCTA LIKE '06%' THEN ${expenseBal}
          WHEN CTA_NUMCTA LIKE '0700%' THEN ${expenseBal}
          ELSE 0
        END)) > 0.01
    `);

    for (const row of extracted) {
      const cta = String(row.id_cuenta || '').trim();
      if (isAutosNuevosAccount(cta)) continue;
      if (String(row.gpo_cont) === ADMIN_GPOCONT) continue;

      let mask;
      if (cta.startsWith('0700')) mask = 'gasto';
      else if (cta.startsWith('06')) mask = 'costo';
      else mask = 'ingreso';

      let areaCc;
      if (mask === 'gasto') {
        areaCc = resolvePostventa0700(cta);
        if (!areaCc) {
          const area = matchPostventaArea(cta);
          if (area) areaCc = AREA_CC[area];
        }
        if (!areaCc) continue;
      } else {
        const area = matchPostventaArea(cta);
        if (!area || !AREA_CC[area]) continue;
        areaCc = AREA_CC[area];
      }

      const parts = cta.split('-');
      const sub0700 = mask === 'gasto' ? extractSubaccount0700(parts) : null;

      rows.push({
        year: seg.year,
        monthStart: seg.monthStart,
        monthEnd: seg.monthEnd,
        fechaInicio,
        fechaFin,
        id_cuenta: cta,
        descripcion_cuenta: row.descripcion_cuenta,
        id_centro_costos: row.id_centro_costos || null,
        mask,
        subcuenta0700: sub0700,
        subcuentaLabel: sub0700 && EXPENSE_SUBACCOUNTS[sub0700] ? EXPENSE_SUBACCOUNTS[sub0700].label : null,
        balance_neto: Number(row.balance_neto || 0),
        ccId: areaCc.id,
        ccLabel: areaCc.label,
        ccType: 'operativo',
        area: areaCc.area,
        segment: null,
        source: mask === 'gasto' ? '0700_POSTVENTA' : '04xx_POSTVENTA',
      });
    }
  }
  return rows;
}

/** Admin — grupo 740 (bolsón a prorratear, alineado VTASMEN) */
async function extractAdmin740(fechaInicio, fechaFin, segments) {
  const rows = [];
  for (const seg of segments) {
    const table = ctasTable(seg.year);
    if (!(await tableExists(table))) continue;

    const mov = movementExpr(seg.monthStart, seg.monthEnd);
    const sign = expenseBalanceExpr(mov);

    const extracted = await query(`
      SELECT
        CTA_NUMCTA AS id_cuenta,
        CTA_DESCRIPCION AS descripcion_cuenta,
        SUM(${sign}) AS balance_neto
      FROM [${table}]
      WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_GPOCONT = @gpo
      GROUP BY CTA_NUMCTA, CTA_DESCRIPCION
      HAVING ABS(SUM(${sign})) > 0.01
    `, { gpo: ADMIN_GPOCONT });

    for (const row of extracted) {
      rows.push({
        year: seg.year,
        monthStart: seg.monthStart,
        monthEnd: seg.monthEnd,
        fechaInicio,
        fechaFin,
        id_cuenta: row.id_cuenta,
        descripcion_cuenta: row.descripcion_cuenta,
        id_centro_costos: null,
        mask: 'gasto',
        subcuenta0700: null,
        subcuentaLabel: null,
        balance_neto: Number(row.balance_neto || 0),
        ccId: 'admin_general',
        ccLabel: ADMIN_CC.admin_general.label,
        ccType: 'administrativo',
        area: null,
        segment: null,
        source: 'GPO740',
      });
    }
  }
  return rows;
}

/** Proceso A: Extracción base (VTASMEN + postventa + admin 740) */
async function extractBaseTransactions(fechaInicio, fechaFin) {
  const segments = yearSegments(fechaInicio, fechaFin);
  const [autos, postventa, admin] = await Promise.all([
    extractAutosNuevosVtasmen(fechaInicio, fechaFin, segments),
    extractPostventaAccounts(fechaInicio, fechaFin, segments),
    extractAdmin740(fechaInicio, fechaFin, segments),
  ]);
  return [...autos, ...postventa, ...admin];
}

function isolateAdminExpensePool(transactions) {
  const adminRows = transactions.filter((t) => t.ccType === 'administrativo');

  const byAdminCc = {};
  let totalBolson = 0;

  for (const row of adminRows) {
    byAdminCc[row.ccId] = (byAdminCc[row.ccId] || 0) + row.balance_neto;
    totalBolson += row.balance_neto;
  }

  return {
    totalBolson,
    byAdminCc: Object.entries(byAdminCc).map(([ccId, monto]) => ({
      ccId,
      ccLabel: ADMIN_CC[ccId]?.label || ccId,
      monto,
    })),
    subcuentasCriticas: {},
    rowCount: adminRows.length,
  };
}

function applyProration(adminPool, prorationMatrix = getProrationFactors()) {
  const assignments = [];
  const total = adminPool.totalBolson;

  for (const [ccId, factor] of Object.entries(prorationMatrix)) {
    const cc = getOperationalCc(ccId);
    if (!cc) continue;
    assignments.push({
      ccId,
      ccLabel: cc.label,
      area: cc.area,
      factor,
      factorPct: Number((factor * 100).toFixed(2)),
      gastoAsignado: total * factor,
    });
  }

  return { bolsonTotal: total, assignments, matrix: prorationMatrix };
}

function consolidateByCostCenter(transactions, prorationResult) {
  const ccMap = {};

  for (const cc of OPERATIONAL_CC_LIST) {
    ccMap[cc.id] = {
      ccId: cc.id,
      ccLabel: cc.label,
      area: cc.area,
      ingresos: 0,
      costos: 0,
      gastoDirecto: 0,
      gastoAsignado: 0,
      gastoDirectoDetalle: {},
    };
  }

  for (const row of transactions) {
    if (row.ccType !== 'operativo') continue;
    const bucket = ccMap[row.ccId];
    if (!bucket) continue;

    if (row.mask === 'ingreso') bucket.ingresos += row.balance_neto;
    else if (row.mask === 'costo') bucket.costos += row.balance_neto;
    else if (row.mask === 'gasto') {
      bucket.gastoDirecto += row.balance_neto;
      if (row.subcuentaLabel) {
        bucket.gastoDirectoDetalle[row.subcuentaLabel] =
          (bucket.gastoDirectoDetalle[row.subcuentaLabel] || 0) + row.balance_neto;
      }
    }
  }

  for (const assign of prorationResult.assignments) {
    if (ccMap[assign.ccId]) {
      ccMap[assign.ccId].gastoAsignado = assign.gastoAsignado;
    }
  }

  const consolidated = Object.values(ccMap)
    .filter((c) => Math.abs(c.ingresos) + Math.abs(c.costos) + Math.abs(c.gastoDirecto) > 0.01)
    .map((c) => {
      const utilidadBruta = c.ingresos - c.costos;
      const utilidadOperativa = utilidadBruta - c.gastoDirecto - c.gastoAsignado;
      return {
        ...c,
        ventasNetas: c.ingresos,
        costoVentas: c.costos,
        utilidadBruta,
        gastoDirecto: c.gastoDirecto,
        gastoAsignado: c.gastoAsignado,
        gastoTotal: c.gastoDirecto + c.gastoAsignado,
        utilidadOperativa,
        margenBrutoPct: c.ingresos ? Number(((utilidadBruta / c.ingresos) * 100).toFixed(1)) : 0,
        margenOperativoPct: c.ingresos ? Number(((utilidadOperativa / c.ingresos) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.utilidadOperativa - a.utilidadOperativa);

  const totals = consolidated.reduce(
    (acc, c) => ({
      ventasNetas: acc.ventasNetas + c.ventasNetas,
      costoVentas: acc.costoVentas + c.costoVentas,
      utilidadBruta: acc.utilidadBruta + c.utilidadBruta,
      gastoDirecto: acc.gastoDirecto + c.gastoDirecto,
      gastoAsignado: acc.gastoAsignado + c.gastoAsignado,
      utilidadOperativa: acc.utilidadOperativa + c.utilidadOperativa,
    }),
    { ventasNetas: 0, costoVentas: 0, utilidadBruta: 0, gastoDirecto: 0, gastoAsignado: 0, utilidadOperativa: 0 },
  );

  totals.margenBrutoPct = totals.ventasNetas
    ? Number(((totals.utilidadBruta / totals.ventasNetas) * 100).toFixed(1)) : 0;
  totals.margenOperativoPct = totals.ventasNetas
    ? Number(((totals.utilidadOperativa / totals.ventasNetas) * 100).toFixed(1)) : 0;

  return { rows: consolidated, totals };
}

function filterConsolidated(consolidated, { sucursal, area } = {}) {
  let rows = consolidated.rows;

  if (sucursal && sucursal !== 'todos') {
    rows = rows.filter((r) => r.ccId === sucursal);
  }

  if (area && area !== 'todos') {
    if (area === 'postventa') {
      rows = rows.filter((r) => ['servicio', 'refacciones', 'hyp'].includes(r.area));
    } else if (area === 'autosNuevos') {
      rows = rows.filter((r) => r.area === 'autosNuevos');
    } else {
      rows = rows.filter((r) => r.area === area);
    }
  }

  const totals = rows.reduce(
    (acc, c) => ({
      ventasNetas: acc.ventasNetas + c.ventasNetas,
      costoVentas: acc.costoVentas + c.costoVentas,
      utilidadBruta: acc.utilidadBruta + c.utilidadBruta,
      gastoDirecto: acc.gastoDirecto + c.gastoDirecto,
      gastoAsignado: acc.gastoAsignado + c.gastoAsignado,
      utilidadOperativa: acc.utilidadOperativa + c.utilidadOperativa,
    }),
    { ventasNetas: 0, costoVentas: 0, utilidadBruta: 0, gastoDirecto: 0, gastoAsignado: 0, utilidadOperativa: 0 },
  );

  totals.margenBrutoPct = totals.ventasNetas
    ? Number(((totals.utilidadBruta / totals.ventasNetas) * 100).toFixed(1)) : 0;
  totals.margenOperativoPct = totals.ventasNetas
    ? Number(((totals.utilidadOperativa / totals.ventasNetas) * 100).toFixed(1)) : 0;

  return { rows, totals };
}

async function runAccountingEtl({ fechaInicio, fechaFin, sucursal = 'todos', area = 'todos' } = {}) {
  const transactions = await extractBaseTransactions(fechaInicio, fechaFin);
  const adminPool = isolateAdminExpensePool(transactions);
  const proration = applyProration(adminPool, getProrationFactors({ fechaFin }));
  const consolidated = consolidateByCostCenter(transactions, proration);
  const filtered = filterConsolidated(consolidated, { sucursal, area });

  return {
    available: transactions.length > 0,
    source: 'CON_CTAS_ETL_VTASMEN',
    periodo: { fechaInicio, fechaFin },
    procesoA: {
      label: 'Extracción base (VTASMEN + postventa + admin 740)',
      transactionCount: transactions.length,
      autosNuevos: transactions.filter((t) => t.source?.startsWith('VTASMEN')).length,
      postventa: transactions.filter((t) => t.source?.includes('POSTVENTA')).length,
      admin: transactions.filter((t) => t.source === 'GPO740').length,
    },
    procesoB: { label: 'Bolsón administrativo (740)', ...adminPool },
    procesoC: { label: 'Prorrateo administrativo', ...proration },
    procesoD: { label: 'Consolidación por centro de costo', ...consolidated },
    filtered,
    summary: {
      ventasNetas: filtered.totals.ventasNetas,
      costoVentas: filtered.totals.costoVentas,
      utilidadBruta: filtered.totals.utilidadBruta,
      gastoDirecto: filtered.totals.gastoDirecto,
      gastoAsignado: filtered.totals.gastoAsignado,
      utilidadOperativa: filtered.totals.utilidadOperativa,
      margenBrutoPct: filtered.totals.margenBrutoPct,
      margenOperacionPct: filtered.totals.margenOperativoPct,
      bolsonAdministrativo: adminPool.totalBolson,
    },
  };
}

module.exports = {
  runAccountingEtl,
  extractBaseTransactions,
  isolateAdminExpensePool,
  applyProration,
  consolidateByCostCenter,
};
