const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { forecastSales } = require('./forecastModel');

/**
 * Mapeo de campos del spreadsheet / Colab vs SQL Server (GMOFARRIL).
 * Fuente spreadsheet: hoja de ventas detalladas.
 * Fuentes SQL: ADE_VTAFI + SER_VEHICULO + PER_PERSONAS + BI_AN_VENTAS.
 */
const FIELD_MAPPING = [
  { sheet: 'FECHA DE VENTA', sql: 'ADE_VTAFI.VTE_FECHDOCTO / BI_AN_VENTAS.fecha_factura', source: 'sql', usedInModel: true },
  { sheet: 'CARLINE', sql: 'BI_AN_VENTAS.Carline / SER_VEHICULO.VEH_TIPOAUTO', source: 'sql', usedInModel: true },
  { sheet: 'TIPO DE VENTA / TIPO VENTA', sql: 'ADE_VTAFI.VTE_FORMAPAGO / BI_AN_VENTAS.Est_Tipo_venta', source: 'sql', usedInModel: true },
  { sheet: 'NUMERO DE PEDIDO', sql: 'BI_AN_VENTAS.pedido', source: 'sql', usedInModel: false },
  { sheet: 'CATALOGO', sql: 'SER_VEHICULO.VEH_CATALOGO / BI_AN_VENTAS.Catalogo', source: 'sql', usedInModel: false },
  { sheet: 'MODELO / AÑO', sql: 'SER_VEHICULO.VEH_ANMODELO / BI_AN_VENTAS.Año_modelo', source: 'sql', usedInModel: true },
  { sheet: 'COLOR EXTERIOR', sql: 'UNI_CATACOLOR.COL_DESCRIPCION', source: 'sql', usedInModel: false },
  { sheet: 'NUMERO DE SERIE', sql: 'ADE_VTAFI.VTE_SERIE / BI_AN_VENTAS.Num_serie', source: 'sql', usedInModel: false },
  { sheet: 'NUMERO DE FACTURA', sql: 'ADE_VTAFI.VTE_DOCTO / BI_AN_VENTAS.factura', source: 'sql', usedInModel: false },
  { sheet: 'NOMBRE DEL CLIENTE', sql: 'PER_PERSONAS (cliente) / BI_AN_VENTAS.Cliente', source: 'sql', usedInModel: false },
  { sheet: 'ESTADO', sql: 'PNC_PARAMETR / BI_AN_VENTAS.Estado', source: 'sql', usedInModel: true },
  { sheet: 'NOMBRE DEL VENDEDOR', sql: 'PER_PERSONAS (vendedor) / BI_AN_VENTAS.Ejecutivo_cuenta', source: 'sql', usedInModel: false },
  { sheet: 'VENTA TOTAL / VENTA SUBTOTAL', sql: 'BI_AN_VENTAS.Venta', source: 'sql', usedInModel: false },
  { sheet: 'COSTO / COSTO NETO', sql: 'BI_AN_VENTAS.Costo / CostoBPRO', source: 'sql', usedInModel: false },
  { sheet: 'BONIFICACIONES', sql: 'BI_AN_VENTAS.Bonificaciones', source: 'sql', usedInModel: false },
  { sheet: 'DIAS INVENTARIO', sql: 'BI_AN_VENTAS.Dias_en_inventario', source: 'sql', usedInModel: false },
  { sheet: 'MARCA', sql: 'BI_AN_VENTAS.Marca', source: 'sql', usedInModel: true },
  { sheet: 'DESCRIPCION UNIDAD', sql: 'SER_VEHICULO.VEH_TIPOAUTO / BI_AN_VENTAS.Modelo', source: 'sql', usedInModel: true },
  { sheet: 'REPUVE', sql: 'SER_VEHICULO.VEH_REPUVE', source: 'sql', usedInModel: false },
  { sheet: 'SEXO', sql: 'PER_PERSONAS.PER_SEXO', source: 'sql', usedInModel: false },
  { sheet: 'CORREO / TELÉFONO / DIRECCIÓN', sql: 'PER_PERSONAS (parcial)', source: 'sql', usedInModel: false },
  { sheet: 'MONTO_FINANCIAR / ENGANCHE / TASA / PLAZO / MENSUALIDAD', sql: 'No disponible en tablas operativas actuales', source: 'sheet-only', usedInModel: false },
  { sheet: 'GAP / GTIA EXT / ON STAR / PAQUETE', sql: 'No disponible en tablas operativas actuales', source: 'sheet-only', usedInModel: false },
  { sheet: 'ID SOFIA', sql: 'Tablas SOFIA (entregas)', source: 'sql-partial', usedInModel: false },
];

const SHEET_PATH = path.join(__dirname, '../../data/forecast-source.csv');

function parseSheetMonthly() {
  if (!fs.existsSync(SHEET_PATH)) return [];
  const text = fs.readFileSync(SHEET_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const map = new Map();

  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^"?(\d{1,2}\/\d{1,2}\/\d{4})"?/);
    if (!match) continue;
    const [day, month, year] = match[1].split('/').map(Number);
    if (!year || !month) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  }

  return [...map.entries()]
    .map(([key, units]) => {
      const [yr, mo] = key.split('-').map(Number);
      return { yr, mo, units, key };
    })
    .sort((a, b) => (a.yr - b.yr) || (a.mo - b.mo));
}

async function loadMonthlyFromSql() {
  const rows = await query(`
    SELECT
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS yr,
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS mo,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
    GROUP BY
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)),
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103))
    ORDER BY yr, mo
  `);

  return rows.map((r) => ({
    yr: Number(r.yr),
    mo: Number(r.mo),
    units: Number(r.units) || 0,
    key: `${r.yr}-${String(r.mo).padStart(2, '0')}`,
  }));
}

async function loadBreakdownFromSql() {
  const byTipo = await query(`
    SELECT TOP 8
      CASE ADE_VTAFI.VTE_FORMAPAGO
        WHEN 'CRE' THEN 'GMF'
        WHEN 'ZACCRE' THEN 'GMF'
        WHEN 'CHCRE' THEN 'GMF'
        WHEN 'FORCRE' THEN 'GMF'
        WHEN 'CASACRE' THEN 'GMF'
        WHEN 'SUAGMF' THEN 'GMF'
        WHEN 'PLNCON' THEN 'CONTADO'
        WHEN 'CON' THEN 'CONTADO'
        WHEN 'CASACON' THEN 'CONTADO'
        WHEN 'CHCON' THEN 'CONTADO'
        WHEN 'FORCON' THEN 'CONTADO'
        WHEN 'ZACCON' THEN 'CONTADO'
        WHEN 'FLOT' THEN 'FLOTILLA'
        WHEN 'FLOTGMF' THEN 'FLOTILLA'
        ELSE ADE_VTAFI.VTE_FORMAPAGO
      END AS label,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103) >= DATEADD(month, -12, GETDATE())
    GROUP BY
      CASE ADE_VTAFI.VTE_FORMAPAGO
        WHEN 'CRE' THEN 'GMF'
        WHEN 'ZACCRE' THEN 'GMF'
        WHEN 'CHCRE' THEN 'GMF'
        WHEN 'FORCRE' THEN 'GMF'
        WHEN 'CASACRE' THEN 'GMF'
        WHEN 'SUAGMF' THEN 'GMF'
        WHEN 'PLNCON' THEN 'CONTADO'
        WHEN 'CON' THEN 'CONTADO'
        WHEN 'CASACON' THEN 'CONTADO'
        WHEN 'CHCON' THEN 'CONTADO'
        WHEN 'FORCON' THEN 'CONTADO'
        WHEN 'ZACCON' THEN 'CONTADO'
        WHEN 'FLOT' THEN 'FLOTILLA'
        WHEN 'FLOTGMF' THEN 'FLOTILLA'
        ELSE ADE_VTAFI.VTE_FORMAPAGO
      END
    ORDER BY units DESC
  `);

  const byModelo = await query(`
    SELECT TOP 8
      ISNULL(SER_VEHICULO.VEH_TIPOAUTO, 'Sin modelo') AS label,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103) >= DATEADD(month, -12, GETDATE())
    GROUP BY SER_VEHICULO.VEH_TIPOAUTO
    ORDER BY units DESC
  `);

  return {
    byTipo: byTipo.map((r) => ({ label: String(r.label || '').trim(), units: Number(r.units) || 0 })),
    byModelo: byModelo.map((r) => ({ label: String(r.label || '').trim().slice(0, 28), units: Number(r.units) || 0 })),
  };
}

async function getForecast({ horizon = 6 } = {}) {
  const months = Math.min(12, Math.max(3, parseInt(horizon, 10) || 6));
  let history = [];
  let dataSource = 'sql';
  let breakdown = { byTipo: [], byModelo: [] };
  let sqlError = null;

  try {
    history = await loadMonthlyFromSql();
    breakdown = await loadBreakdownFromSql();
  } catch (err) {
    sqlError = err.message;
  }

  if (!history.length) {
    history = parseSheetMonthly();
    dataSource = history.length ? 'spreadsheet' : 'none';
  }

  if (!history.length) {
    throw new Error(
      sqlError
        ? `Sin historial de ventas. SQL: ${sqlError}`
        : 'Sin historial de ventas en SQL ni en spreadsheet local.'
    );
  }

  const result = forecastSales(history, months);
  const lastActual = result.lastCompleteMonth || history[history.length - 1];
  const nextForecast = result.forecast[0];
  const totalForecast = result.forecast.reduce((s, r) => s + r.units, 0);
  const completeHistory = result.incompleteMonth
    ? history.slice(0, -1)
    : history;
  const avgHistory = completeHistory.slice(-12).reduce((s, r) => s + r.units, 0)
    / Math.min(12, completeHistory.length || 1);
  const variation = avgHistory > 0 && nextForecast
    ? Math.round(((nextForecast.units - avgHistory) / avgHistory) * 1000) / 10
    : null;

  return {
    dataSource,
    sqlError,
    fieldMapping: FIELD_MAPPING,
    kpis: {
      lastMonthUnits: lastActual?.units ?? 0,
      lastMonthLabel: lastActual?.label || result.lastCompleteMonth?.label || '',
      nextMonthUnits: nextForecast?.units ?? 0,
      nextMonthLabel: nextForecast?.label || '',
      horizonTotal: totalForecast,
      horizonMonths: months,
      avgLast12: Math.round(avgHistory),
      variationPct: variation,
      mape: result.metrics.mape,
      incompleteMonth: result.incompleteMonth
        ? `${result.incompleteMonth.label} (${result.incompleteMonth.units} uds parciales)`
        : null,
    },
    ...result,
    breakdown,
    notes: [
      'El modelo se entrena con unidades mensuales reales de SQL (ADE_VTAFI + SER_VEHICULO).',
      'Campos financieros de enganche/tasa/plazo del spreadsheet no están en SQL operativo; no se usan en el modelo actual.',
      'BI_AN_VENTAS aporta campos equivalentes (Carline, Estado, Venta, Costo, Días inventario) pero su extracto histórico está desactualizado; se prioriza ADE_VTAFI.',
      sqlError ? `Fallback spreadsheet activado por error SQL: ${sqlError}` : null,
    ].filter(Boolean),
  };
}

module.exports = { getForecast, FIELD_MAPPING };
