const { query } = require('../db');

/** Grupo de materiales Hojalatería y Pintura en PAR_PARTES */
const HYP_GRUPO = '32';
/** Almacén donde vive el stock HYP (coincide 100% con grupo 32) */
const HYP_ALMACEN = 'ALM8';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function summarizeRows(rows) {
  const lineas = rows.length;
  const existencia = rows.reduce((s, r) => s + (Number(r.existencia) || 0), 0);
  const proceso = rows.reduce((s, r) => s + (Number(r.proceso) || 0), 0);
  const costo = rows.reduce((s, r) => s + (Number(r.costo) || 0), 0);
  const costoProceso = rows.reduce((s, r) => s + (Number(r.costoProceso) || 0), 0);
  return {
    lineas,
    existencia: round2(existencia),
    proceso: round2(proceso),
    costo: round2(costo),
    costoProceso: round2(costoProceso),
  };
}

function groupBy(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r) || 'Sin dato';
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        label: labelFn(r, key),
        lineas: 0,
        existencia: 0,
        proceso: 0,
        costo: 0,
        costoProceso: 0,
      });
    }
    const g = map.get(key);
    g.lineas += 1;
    g.existencia += Number(r.existencia) || 0;
    g.proceso += Number(r.proceso) || 0;
    g.costo += Number(r.costo) || 0;
    g.costoProceso += Number(r.costoProceso) || 0;
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      existencia: round2(g.existencia),
      proceso: round2(g.proceso),
      costo: round2(g.costo),
      costoProceso: round2(g.costoProceso),
    }))
    .sort((a, b) => b.costo - a.costo || b.existencia - a.existencia);
}

async function loadStockRows() {
  const rows = await query(`
    SELECT
      LTRIM(RTRIM(a.ALM_IDPARTE)) AS parte,
      LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, ''))) AS descripcion,
      LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
      LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, ''))) AS grupo,
      LTRIM(RTRIM(ISNULL(g.PAR_DESCRIP1, ''))) AS grupoLabel,
      ISNULL(a.ALM_EXISTEN, 0) AS existencia,
      ISNULL(a.ALM_APARTADA, 0) AS apartada,
      ISNULL(a.ALM_PROCESO, 0) AS proceso,
      ISNULL(a.ALM_CTOPROM, 0) AS costoPromedio,
      ISNULL(a.ALM_EXISTEN, 0) * ISNULL(a.ALM_CTOPROM, 0) AS costo,
      ISNULL(a.ALM_PROCESO, 0) * ISNULL(a.ALM_CTOPROM, 0) AS costoProceso,
      LTRIM(RTRIM(ISNULL(a.ALM_STATUS, 'A'))) AS status,
      LTRIM(RTRIM(ISNULL(a.ALM_CLASIFICA, ''))) AS clasifica
    FROM PAR_ALMACEN a
    LEFT JOIN PAR_PARTES p ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(a.ALM_IDPARTE))
    LEFT JOIN PNC_PARAMETR g
      ON g.PAR_TIPOPARA IN ('GP', 'GS')
      AND LTRIM(RTRIM(g.PAR_IDENPARA)) = LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, '')))
    WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
      AND (
        ISNULL(a.ALM_EXISTEN, 0) > 0
        OR ISNULL(a.ALM_PROCESO, 0) > 0
        OR ISNULL(a.ALM_APARTADA, 0) > 0
      )
  `);

  return rows.map((r) => {
    const grupo = String(r.grupo || '').trim();
    const almacen = String(r.almacen || '').trim().toUpperCase();
    const isHyp = grupo === HYP_GRUPO || almacen === HYP_ALMACEN;
    return {
      parte: String(r.parte || '').trim(),
      descripcion: String(r.descripcion || '').trim() || 'Sin descripción',
      almacen,
      grupo,
      grupoLabel: String(r.grupoLabel || '').trim() || (grupo ? `Grupo ${grupo}` : 'Sin grupo'),
      existencia: Number(r.existencia) || 0,
      apartada: Number(r.apartada) || 0,
      proceso: Number(r.proceso) || 0,
      costoPromedio: Number(r.costoPromedio) || 0,
      costo: Number(r.costo) || 0,
      costoProceso: Number(r.costoProceso) || 0,
      status: String(r.status || 'A').trim(),
      clasifica: String(r.clasifica || '').trim(),
      isHyp,
      area: isHyp ? 'hyp' : 'refacciones',
    };
  });
}

function buildAreaPayload(rows, limit = 400) {
  const summary = summarizeRows(rows);
  const byAlmacen = groupBy(rows, (r) => r.almacen, (_, k) => k);
  const byGrupo = groupBy(rows, (r) => r.grupo || '—', (r, k) => r.grupoLabel || k).slice(0, 25);
  const detalle = rows
    .slice()
    .sort((a, b) => (b.costo || b.costoProceso) - (a.costo || a.costoProceso))
    .slice(0, limit)
    .map((r) => ({
      parte: r.parte,
      descripcion: r.descripcion,
      almacen: r.almacen,
      grupo: r.grupo,
      grupoLabel: r.grupoLabel,
      existencia: round2(r.existencia),
      apartada: round2(r.apartada),
      proceso: round2(r.proceso),
      costoPromedio: round2(r.costoPromedio),
      costo: round2(r.costo),
      costoProceso: round2(r.costoProceso),
    }));

  return { summary, byAlmacen, byGrupo, detalle, totalDetalle: rows.length };
}

async function getInventoryPostventa() {
  const stock = await loadStockRows();

  const hyp = stock.filter((r) => r.isHyp && r.existencia > 0);
  const refacciones = stock.filter((r) => !r.isHyp && r.existencia > 0);
  const servicio = stock.filter((r) => r.proceso > 0);

  const areas = {
    servicio: {
      id: 'servicio',
      label: 'Servicio',
      description: 'Piezas en proceso de taller (ALM_PROCESO > 0) · consumo operativo de servicio',
      ...buildAreaPayload(servicio),
    },
    refacciones: {
      id: 'refacciones',
      label: 'Refacciones',
      description: 'Stock en almacén de partes y accesorios (excluye materiales HYP)',
      ...buildAreaPayload(refacciones),
    },
    hyp: {
      id: 'hyp',
      label: 'HYP',
      description: 'Materiales Hojalatería y Pintura · grupo 32 / almacén ALM8',
      ...buildAreaPayload(hyp),
    },
  };

  return {
    fuente: 'PAR_ALMACEN · PAR_PARTES',
    areas,
    overview: {
      servicio: areas.servicio.summary,
      refacciones: areas.refacciones.summary,
      hyp: areas.hyp.summary,
      totalCosto:
        round2(areas.servicio.summary.costoProceso
          + areas.refacciones.summary.costo
          + areas.hyp.summary.costo),
    },
  };
}

module.exports = {
  getInventoryPostventa,
  HYP_GRUPO,
  HYP_ALMACEN,
};
