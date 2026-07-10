const { query } = require('../db');
const { VENTAS_BASE_CTE, buildVentasDateClause, mapUnitRow, pct } = require('./ventasNuevosFinanciero');
const { parseDateInput } = require('./ventas');

function normalizeText(value) {
  return String(value || '').trim();
}

function mapDetalleRow(row) {
  const base = mapUnitRow({
    factura: row.factura,
    serie: row.serie,
    modelo: row.modelo,
    anioModelo: row.anioModelo,
    cliente: row.cliente,
    estado: row.estado,
    formaPago: row.formaPago,
    isFlotilla: row.isFlotilla,
    ventaSubtotal: row.ventaSubtotal,
    costoNeto: row.costoNeto,
    gastos: row.gastos,
    utilidad: row.utilidad,
  });

  return {
    ...base,
    fecha: row.fecha instanceof Date
      ? row.fecha.toISOString().slice(0, 10)
      : String(row.fecha || '').slice(0, 10),
    color: normalizeText(row.color) || '—',
    vendedor: normalizeText(row.vendedor) || '—',
  };
}

function aggregatePorModelo(unidades) {
  const map = new Map();

  for (const u of unidades) {
    const key = u.modelo || 'Sin modelo';
    if (!map.has(key)) {
      map.set(key, {
        modelo: key,
        unidades: 0,
        ventaSubtotal: 0,
        utilidad: 0,
        conUtilidad: 0,
        retail: 0,
        flotilla: 0,
      });
    }
    const entry = map.get(key);
    entry.unidades += 1;
    entry.ventaSubtotal += u.ventaSubtotal || 0;
    if (u.utilidad != null) {
      entry.utilidad += u.utilidad;
      entry.conUtilidad += 1;
    }
    if (u.flotilla) entry.flotilla += 1;
    else entry.retail += 1;
  }

  return [...map.values()]
    .map((m) => ({
      ...m,
      margenPct: m.ventaSubtotal > 0 ? pct(m.utilidad, m.ventaSubtotal) : null,
      ticketPromedio: m.unidades ? Math.round(m.ventaSubtotal / m.unidades) : 0,
    }))
    .sort((a, b) => b.unidades - a.unidades || b.ventaSubtotal - a.ventaSubtotal);
}

async function getVentasPorAuto({
  fechaInicio,
  fechaFin,
  modelo,
  serie,
  vendedor,
  limite = 50,
} = {}) {
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);
  if (inicio > fin) {
    throw new Error('La fecha inicial no puede ser mayor que la fecha final.');
  }

  const maxRows = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 100);
  const { clause, params } = buildVentasDateClause(fechaInicio, fechaFin);

  const filters = [];
  const queryParams = { ...params };

  if (modelo) {
    filters.push(`v.modelo LIKE @modelo`);
    queryParams.modelo = `%${normalizeText(modelo)}%`;
  }
  if (serie) {
    filters.push(`v.VTE_SERIE LIKE @serie`);
    queryParams.serie = `%${normalizeText(serie)}%`;
  }
  if (vendedor) {
    filters.push(`(
      RTRIM(LTRIM(ISNULL(ven.PER_NOMRAZON, '') + ' ' + ISNULL(ven.PER_PATERNO, '') + ' ' + ISNULL(ven.PER_MATERNO, '')))
      LIKE @vendedor
    )`);
    queryParams.vendedor = `%${normalizeText(vendedor)}%`;
  }

  const filterClause = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const rows = await query(`
    ${VENTAS_BASE_CTE}
    SELECT TOP ${maxRows}
      v.VTE_DOCTO AS factura,
      v.VTE_SERIE AS serie,
      CONVERT(DATE, v.VTE_FECHDOCTO, 103) AS fecha,
      v.modelo,
      v.anioModelo,
      v.cliente,
      v.estado,
      v.VTE_FORMAPAGO AS formaPago,
      v.isFlotilla,
      v.ventaSubtotal,
      v.costoNeto,
      v.gastos,
      v.utilidad,
      ISNULL(col.COL_DESCRIPCION, veh.VEH_COLOEXTE) AS color,
      RTRIM(LTRIM(
        ISNULL(ven.PER_NOMRAZON, '') + ' ' + ISNULL(ven.PER_PATERNO, '') + ' ' + ISNULL(ven.PER_MATERNO, '')
      )) AS vendedor
    FROM ventas v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    LEFT JOIN PER_PERSONAS ven ON ven.PER_IDPERSONA = veh.VEH_VENDEDOR
    LEFT JOIN UNI_CATACOLOR col
      ON col.COL_CLAVE = veh.VEH_COLOEXTE
      AND col.COL_MODELO = veh.VEH_ANMODELO
      AND col.COL_CATALOGO = veh.VEH_CATALOGO
    WHERE 1 = 1 ${clause} ${filterClause}
    ORDER BY v.VTE_FECHDOCTO DESC, v.ventaSubtotal DESC
  `, queryParams);

  const unidades = rows.map(mapDetalleRow);
  const porModelo = aggregatePorModelo(unidades);

  const summary = unidades.reduce((acc, u) => ({
    totalUnidades: acc.totalUnidades + 1,
    ventaSubtotal: acc.ventaSubtotal + (u.ventaSubtotal || 0),
    utilidad: acc.utilidad + (u.utilidad ?? 0),
    retail: acc.retail + (u.flotilla ? 0 : 1),
    flotilla: acc.flotilla + (u.flotilla ? 1 : 0),
  }), { totalUnidades: 0, ventaSubtotal: 0, utilidad: 0, retail: 0, flotilla: 0 });

  return {
    filtros: {
      fechaInicio,
      fechaFin,
      modelo: modelo || null,
      serie: serie || null,
      vendedor: vendedor || null,
      limite: maxRows,
    },
    resumen: {
      ...summary,
      modelosDistintos: porModelo.length,
      margenPct: pct(summary.utilidad, summary.ventaSubtotal),
    },
    porModelo,
    unidades,
    nota: unidades.length >= maxRows
      ? `Mostrando las primeras ${maxRows} unidades. Usa filtros de modelo, serie o vendedor para acotar.`
      : null,
  };
}

module.exports = { getVentasPorAuto };
