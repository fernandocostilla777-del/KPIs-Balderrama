const { query } = require('../db');

/** Grupo de materiales Hojalatería y Pintura en PAR_PARTES */
const HYP_GRUPO = '32';
/** Almacén donde vive el stock HYP (coincide 100% con grupo 32) */
const HYP_ALMACEN = 'ALM8';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseDateInput(value, fallback) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

function toYmdCompact(iso) {
  return String(iso).replace(/-/g, '');
}

function defaultPeriodo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    fechaInicio: `${y}-${m}-01`,
    fechaFin: `${y}-${m}-${String(last).padStart(2, '0')}`,
  };
}

function fechaValidaMovSql(alias = 'm') {
  return `
    ${alias}.Mov_Fecha IS NOT NULL
    AND LEN(RTRIM(${alias}.Mov_Fecha)) = 10
    AND SUBSTRING(${alias}.Mov_Fecha, 3, 1) = '/'
    AND SUBSTRING(${alias}.Mov_Fecha, 6, 1) = '/'
    AND ISNUMERIC(SUBSTRING(${alias}.Mov_Fecha, 1, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.Mov_Fecha, 4, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.Mov_Fecha, 7, 4)) = 1
  `;
}

/** Traspasos DMS: cabeceras con observación "DE … A …" (pares 103/104, 101/102, etc.). */
function esTraspasoObsSql(alias = 'm') {
  return `UPPER(LTRIM(RTRIM(ISNULL(${alias}.Mov_Observa, '')))) LIKE 'DE % A %'`;
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
      LTRIM(RTRIM(ISNULL(a.ALM_CLASIFICA, ''))) AS clasifica,
      a.ALM_FECHULCOM AS fechaUltCom,
      a.ALM_FECHULTVEN AS fechaUltVen
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
      fechaUltCom: r.fechaUltCom || null,
      fechaUltVen: r.fechaUltVen || null,
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
      fechaUltCom: r.fechaUltCom || null,
      fechaUltVen: r.fechaUltVen || null,
    }));

  return { summary, byAlmacen, byGrupo, detalle, totalDetalle: rows.length };
}

/**
 * Piezas movidas entre almacenes (traspasos).
 * Detecta movimientos con observación "DE … A …" y empareja salida→entrada.
 */
async function getTraspasosEntreAlmacenes({ fechaInicio, fechaFin, limit = 80 } = {}) {
  const def = defaultPeriodo();
  const fi = parseDateInput(fechaInicio, def.fechaInicio);
  const ff = parseDateInput(fechaFin, def.fechaFin);
  const desde = toYmdCompact(fi);
  const hasta = toYmdCompact(ff);
  const top = Math.min(Math.max(Number(limit) || 80, 20), 200);

  const [summaryRows, rutas, topPartes, detalle] = await Promise.all([
    query(`
      SELECT
        COUNT(DISTINCT CAST(m.Mov_TipoMov AS varchar(20)) + '-' + CAST(m.Mov_Numero AS varchar(20))) AS documentos,
        COUNT(DISTINCT LTRIM(RTRIM(d.Mod_Idparte))) AS partes,
        COUNT(DISTINCT LTRIM(RTRIM(d.Mod_Idalmacen))) AS almacenesOrigen,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0))) AS piezas,
        SUM(ISNULL(d.Mod_Total, 0)) AS costo
      FROM PAR_MOVTOS m
      INNER JOIN PAR_MOVDET d
        ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
      WHERE ${fechaValidaMovSql('m')}
        AND CONVERT(datetime, m.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, m.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ${esTraspasoObsSql('m')}
        AND ISNULL(d.Mod_Cantidad, 0) < 0
    `, { desde, hasta }),

    query(`
      SELECT TOP 25
        LTRIM(RTRIM(sal.Mod_Idalmacen)) AS origen,
        LTRIM(RTRIM(ISNULL(ent.Mod_Idalmacen, ''))) AS destino,
        COUNT(*) AS lineas,
        SUM(ABS(ISNULL(sal.Mod_Cantidad, 0))) AS piezas,
        SUM(ISNULL(sal.Mod_Total, 0)) AS costo
      FROM PAR_MOVTOS mSal
      INNER JOIN PAR_MOVDET sal
        ON sal.Mod_TipoMov = mSal.Mov_TipoMov AND sal.Mod_Numero = mSal.Mov_Numero
      LEFT JOIN PAR_MOVTOS mEnt
        ON mEnt.Mov_Numero = mSal.Mov_Numero
        AND mEnt.Mov_Fecha = mSal.Mov_Fecha
        AND LTRIM(RTRIM(mEnt.Mov_TipoMov)) <> LTRIM(RTRIM(mSal.Mov_TipoMov))
        AND ${esTraspasoObsSql('mEnt')}
      LEFT JOIN PAR_MOVDET ent
        ON ent.Mod_TipoMov = mEnt.Mov_TipoMov
        AND ent.Mod_Numero = mEnt.Mov_Numero
        AND LTRIM(RTRIM(ent.Mod_Idparte)) = LTRIM(RTRIM(sal.Mod_Idparte))
        AND ISNULL(ent.Mod_Cantidad, 0) > 0
      WHERE ${fechaValidaMovSql('mSal')}
        AND CONVERT(datetime, mSal.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, mSal.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ${esTraspasoObsSql('mSal')}
        AND ISNULL(sal.Mod_Cantidad, 0) < 0
      GROUP BY LTRIM(RTRIM(sal.Mod_Idalmacen)), LTRIM(RTRIM(ISNULL(ent.Mod_Idalmacen, '')))
      ORDER BY SUM(ABS(ISNULL(sal.Mod_Cantidad, 0))) DESC
    `, { desde, hasta }),

    query(`
      SELECT TOP (${top})
        LTRIM(RTRIM(d.Mod_Idparte)) AS parte,
        MAX(LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, '')))) AS descripcion,
        COUNT(*) AS movimientos,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0))) AS piezas,
        SUM(ISNULL(d.Mod_Total, 0)) AS costo,
        COUNT(DISTINCT LTRIM(RTRIM(d.Mod_Idalmacen))) AS almacenes
      FROM PAR_MOVTOS m
      INNER JOIN PAR_MOVDET d
        ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
      LEFT JOIN PAR_PARTES p
        ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(d.Mod_Idparte))
      WHERE ${fechaValidaMovSql('m')}
        AND CONVERT(datetime, m.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, m.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ${esTraspasoObsSql('m')}
        AND ISNULL(d.Mod_Cantidad, 0) < 0
      GROUP BY LTRIM(RTRIM(d.Mod_Idparte))
      ORDER BY SUM(ABS(ISNULL(d.Mod_Cantidad, 0))) DESC
    `, { desde, hasta }),

    query(`
      SELECT TOP (${top})
        mSal.Mov_Fecha AS fecha,
        LTRIM(RTRIM(mSal.Mov_TipoMov)) AS tipoSalida,
        mSal.Mov_Numero AS numero,
        LTRIM(RTRIM(sal.Mod_Idparte)) AS parte,
        LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, ''))) AS descripcion,
        LTRIM(RTRIM(sal.Mod_Idalmacen)) AS origen,
        LTRIM(RTRIM(ISNULL(ent.Mod_Idalmacen, ''))) AS destino,
        ABS(ISNULL(sal.Mod_Cantidad, 0)) AS piezas,
        ISNULL(sal.Mod_Total, 0) AS costo,
        LTRIM(RTRIM(ISNULL(mSal.Mov_Observa, ''))) AS observa
      FROM PAR_MOVTOS mSal
      INNER JOIN PAR_MOVDET sal
        ON sal.Mod_TipoMov = mSal.Mov_TipoMov AND sal.Mod_Numero = mSal.Mov_Numero
      LEFT JOIN PAR_PARTES p
        ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(sal.Mod_Idparte))
      LEFT JOIN PAR_MOVTOS mEnt
        ON mEnt.Mov_Numero = mSal.Mov_Numero
        AND mEnt.Mov_Fecha = mSal.Mov_Fecha
        AND LTRIM(RTRIM(mEnt.Mov_TipoMov)) <> LTRIM(RTRIM(mSal.Mov_TipoMov))
        AND ${esTraspasoObsSql('mEnt')}
      LEFT JOIN PAR_MOVDET ent
        ON ent.Mod_TipoMov = mEnt.Mov_TipoMov
        AND ent.Mod_Numero = mEnt.Mov_Numero
        AND LTRIM(RTRIM(ent.Mod_Idparte)) = LTRIM(RTRIM(sal.Mod_Idparte))
        AND ISNULL(ent.Mod_Cantidad, 0) > 0
      WHERE ${fechaValidaMovSql('mSal')}
        AND CONVERT(datetime, mSal.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, mSal.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ${esTraspasoObsSql('mSal')}
        AND ISNULL(sal.Mod_Cantidad, 0) < 0
      ORDER BY CONVERT(datetime, mSal.Mov_Fecha, 103) DESC, mSal.Mov_Numero DESC
    `, { desde, hasta }),
  ]);

  const s = summaryRows[0] || {};
  return {
    fuente: 'PAR_MOVTOS / PAR_MOVDET · observación DE…A… (traspaso entre almacenes)',
    periodo: { fechaInicio: fi, fechaFin: ff },
    summary: {
      documentos: Number(s.documentos) || 0,
      partes: Number(s.partes) || 0,
      almacenesOrigen: Number(s.almacenesOrigen) || 0,
      piezas: round2(s.piezas),
      costo: round2(s.costo),
    },
    rutas: (rutas || []).map((r) => ({
      origen: String(r.origen || '').trim() || '—',
      destino: String(r.destino || '').trim() || 'Sin match',
      lineas: Number(r.lineas) || 0,
      piezas: round2(r.piezas),
      costo: round2(r.costo),
      ruta: `${String(r.origen || '').trim() || '?'} → ${String(r.destino || '').trim() || '?'}`,
    })),
    topPartes: (topPartes || []).map((r) => ({
      parte: String(r.parte || '').trim(),
      descripcion: String(r.descripcion || '').trim() || 'Sin descripción',
      movimientos: Number(r.movimientos) || 0,
      piezas: round2(r.piezas),
      costo: round2(r.costo),
      almacenes: Number(r.almacenes) || 0,
    })),
    detalle: (detalle || []).map((r) => ({
      fecha: r.fecha || null,
      tipoSalida: String(r.tipoSalida || '').trim(),
      numero: r.numero,
      parte: String(r.parte || '').trim(),
      descripcion: String(r.descripcion || '').trim() || 'Sin descripción',
      origen: String(r.origen || '').trim(),
      destino: String(r.destino || '').trim() || '—',
      piezas: round2(r.piezas),
      costo: round2(r.costo),
      observa: String(r.observa || '').trim(),
    })),
  };
}

function buildRefaccionesInsights({ refaccionesRows, traspasos, overview }) {
  const insights = [];
  const ref = overview?.refacciones || {};
  const tr = traspasos?.summary || {};
  const rutas = traspasos?.rutas || [];

  if (Number(tr.piezas) > 0) {
    const topRuta = rutas[0];
    insights.push({
      id: 'ref-traspasos-volumen',
      severity: Number(tr.piezas) >= 5000 ? 'warning' : 'info',
      icon: 'swap_horiz',
      title: 'Traspasos entre almacenes',
      summary: `${Number(tr.piezas).toLocaleString('es-MX')} pzas · ${Number(tr.partes)} partes · ${Number(tr.documentos)} docs`,
      detail: topRuta
        ? `Ruta principal: ${topRuta.ruta} (${Number(topRuta.piezas).toLocaleString('es-MX')} pzas)`
        : 'Hay movimiento interno de stock en el periodo.',
      action: 'Revisar si los traspasos cubren demanda real o generan doble stock.',
      metrics: { ...tr },
    });
  }

  // Partes con stock en 2+ almacenes
  const byParte = new Map();
  for (const r of refaccionesRows || []) {
    if (!(Number(r.existencia) > 0)) continue;
    if (!byParte.has(r.parte)) byParte.set(r.parte, { parte: r.parte, descripcion: r.descripcion, alms: new Set(), costo: 0, pzas: 0 });
    const g = byParte.get(r.parte);
    g.alms.add(r.almacen);
    g.costo += Number(r.costo) || 0;
    g.pzas += Number(r.existencia) || 0;
  }
  const multiAlm = [...byParte.values()].filter((g) => g.alms.size >= 2);
  multiAlm.sort((a, b) => b.costo - a.costo);
  if (multiAlm.length) {
    const top = multiAlm[0];
    insights.push({
      id: 'ref-multi-almacen',
      severity: multiAlm.length >= 50 ? 'warning' : 'info',
      icon: 'hub',
      title: 'Partes en varios almacenes',
      summary: `${multiAlm.length} partes con existencia en 2+ almacenes`,
      detail: top
        ? `Mayor valuación: ${top.parte} · ${[...top.alms].join(', ')} · $${round2(top.costo).toLocaleString('es-MX')}`
        : '',
      action: 'Consolidar o traspasar hacia el almacén de mayor rotación.',
      metrics: { partes: multiAlm.length, topParte: top?.parte, topAlmacenes: top ? [...top.alms] : [] },
    });
  }

  // Stock trabado proxy: sin venta o fechaUltVen vieja (si viene)
  let trabados = 0;
  let costoTrabado = 0;
  const now = Date.now();
  for (const r of refaccionesRows || []) {
    if (!(Number(r.existencia) > 0)) continue;
    const fv = String(r.fechaUltVen || '').trim();
    let dias = 9999;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fv)) {
      const [dd, mm, yyyy] = fv.split('/').map(Number);
      const t = new Date(yyyy, mm - 1, dd).getTime();
      if (!Number.isNaN(t)) dias = Math.floor((now - t) / 86400000);
    }
    if (dias >= 90) {
      trabados += 1;
      costoTrabado += Number(r.costo) || 0;
    }
  }
  if (trabados > 0) {
    insights.push({
      id: 'ref-stock-trabado',
      severity: costoTrabado >= 500000 ? 'critical' : 'warning',
      icon: 'hourglass_disabled',
      title: 'Stock trabado (≥90 días sin venta)',
      summary: `${trabados} líneas · $${round2(costoTrabado).toLocaleString('es-MX')}`,
      detail: 'Capital inmovilizado en refacciones sin rotación reciente.',
      action: 'Liquidar, devolver a planta o traspasar a sucursal con demanda.',
      metrics: { lineas: trabados, costo: round2(costoTrabado) },
    });
  }

  if (Number(ref.costo) > 0) {
    insights.push({
      id: 'ref-valuacion',
      severity: 'info',
      icon: 'warehouse',
      title: 'Valuación refacciones',
      summary: `${Number(ref.lineas || 0).toLocaleString('es-MX')} líneas · ${Number(ref.existencia || 0).toLocaleString('es-MX')} pzas · $${round2(ref.costo).toLocaleString('es-MX')}`,
      detail: 'Costo promedio × existencia en almacenes (excluye HYP).',
      action: 'Cruzar con traspasos y ventas del periodo para priorizar reorden.',
      metrics: { ...ref },
    });
  }

  return insights;
}

async function getInventoryPostventa(opts = {}) {
  const def = defaultPeriodo();
  const fechaInicio = parseDateInput(opts.fechaInicio, def.fechaInicio);
  const fechaFin = parseDateInput(opts.fechaFin, def.fechaFin);

  const [stock, traspasos] = await Promise.all([
    loadStockRows(),
    getTraspasosEntreAlmacenes({ fechaInicio, fechaFin, limit: 80 }),
  ]);

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

  const overview = {
    servicio: areas.servicio.summary,
    refacciones: areas.refacciones.summary,
    hyp: areas.hyp.summary,
    totalCosto:
      round2(areas.servicio.summary.costoProceso
        + areas.refacciones.summary.costo
        + areas.hyp.summary.costo),
  };

  const insights = buildRefaccionesInsights({
    refaccionesRows: refacciones,
    traspasos,
    overview,
  });

  return {
    fuente: 'PAR_ALMACEN · PAR_PARTES · PAR_MOVTOS/PAR_MOVDET (traspasos)',
    periodo: { fechaInicio, fechaFin },
    areas,
    overview,
    traspasos,
    insights,
  };
}

module.exports = {
  getInventoryPostventa,
  getTraspasosEntreAlmacenes,
  buildRefaccionesInsights,
  HYP_GRUPO,
  HYP_ALMACEN,
};
