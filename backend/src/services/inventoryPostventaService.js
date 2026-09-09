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

const QUADRANT_META = {
  estrella: {
    id: 'estrella',
    label: 'Estrellas',
    hint: 'Se mueven rápido y dejan buena utilidad',
    icon: 'star',
  },
  regalo: {
    id: 'regalo',
    label: 'Rápidas · baja utilidad',
    hint: 'Alta rotación, poco margen: revisar precio o costo',
    icon: 'trending_down',
  },
  pregunta: {
    id: 'pregunta',
    label: 'Alto margen · poca venta',
    hint: 'Buenas en utilidad unitaria; empujar volumen',
    icon: 'help',
  },
  desarrollo: {
    id: 'desarrollo',
    label: 'Baja rotación · bajo margen',
    hint: 'Candidatas a despriorizar o liquidar',
    icon: 'low_priority',
  },
};

function median(nums) {
  const arr = (nums || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function classifyPiezaQuadrant(pieza, medCantidad, medMargen) {
  const altaVenta = Number(pieza.cantidad) >= medCantidad;
  const altoMargen = Number(pieza.margenPct) >= medMargen;
  if (altaVenta && altoMargen) return 'estrella';
  if (altaVenta && !altoMargen) return 'regalo';
  if (!altaVenta && altoMargen) return 'pregunta';
  return 'desarrollo';
}

/**
 * Cruza top ventas + utilidad + stock trabado para la matriz rotación × margen.
 */
function buildRotacionUtilidad(alertas = {}) {
  const byParte = new Map();
  for (const row of [...(alertas.topVendidos || []), ...(alertas.topUtilidad || [])]) {
    const parte = String(row.parte || '').trim();
    if (!parte) continue;
    const prev = byParte.get(parte);
    if (!prev || Number(row.cantidad) > Number(prev.cantidad)) {
      byParte.set(parte, {
        parte,
        descripcion: row.descripcion || 'Sin descripción',
        cantidad: round2(row.cantidad),
        venta: round2(row.venta),
        costo: round2(row.costo),
        utilidad: round2(row.utilidad),
        margenPct: round2(row.margenPct),
      });
    }
  }

  const piezas = [...byParte.values()];
  const medCantidad = median(piezas.map((p) => p.cantidad)) || 1;
  const medMargen = median(piezas.map((p) => p.margenPct));

  const cuadrantes = {
    estrella: [],
    regalo: [],
    pregunta: [],
    desarrollo: [],
  };

  for (const p of piezas) {
    const q = classifyPiezaQuadrant(p, medCantidad, medMargen);
    cuadrantes[q].push({ ...p, quadrant: q, quadrantLabel: QUADRANT_META[q].label });
  }

  for (const key of Object.keys(cuadrantes)) {
    cuadrantes[key].sort((a, b) => {
      if (key === 'regalo') return (b.cantidad - a.cantidad) || (a.margenPct - b.margenPct);
      if (key === 'estrella' || key === 'pregunta') return (b.utilidad - a.utilidad) || (b.cantidad - a.cantidad);
      return (a.margenPct - b.margenPct) || (a.cantidad - b.cantidad);
    });
  }

  const obsoleto = (alertas.stockTrabado || []).map((r) => ({
    parte: r.parte,
    descripcion: r.descripcion,
    almacen: r.almacen || null,
    existencia: round2(r.existencia),
    costo: round2(r.costo),
    diasSinVenta: Number(r.diasSinVenta || 0),
    ultimaVenta: r.ultimaVenta || null,
  }));

  const sum = alertas.summary || {};
  return {
    fuente: alertas.fuente || 'PAR_MOVTOS/PAR_MOVDET · PAR_ALMACEN',
    nota: 'Matriz por mediana de piezas vendidas y margen % del periodo. Obsoleto = ≥90 días sin venta (o sin fecha).',
    umbrales: {
      medianaCantidad: round2(medCantidad),
      medianaMargenPct: round2(medMargen),
    },
    summary: {
      partesAnalizadas: piezas.length,
      ventaPeriodo: round2(sum.ventaPeriodo),
      utilidadPeriodo: round2(sum.utilidadPeriodo),
      cantidadVendida: round2(sum.cantidadVendida),
      trabados90: Number(sum.trabados90 || 0),
      costoTrabado90: round2(sum.costoTrabado90),
      estrellas: cuadrantes.estrella.length,
      regalos: cuadrantes.regalo.length,
      preguntas: cuadrantes.pregunta.length,
      desarrollo: cuadrantes.desarrollo.length,
    },
    meta: QUADRANT_META,
    cuadrantes,
    topVendidos: alertas.topVendidos || [],
    topUtilidad: alertas.topUtilidad || [],
    obsoleto,
    alerts: alertas.alerts || [],
  };
}

function buildRefaccionesInsights({ refaccionesRows, traspasos, overview, rotacionUtilidad }) {
  const insights = [];
  const ref = overview?.refacciones || {};
  const tr = traspasos?.summary || {};
  const rutas = traspasos?.rutas || [];
  const ru = rotacionUtilidad || {};
  const qs = ru.cuadrantes || {};
  const sumRu = ru.summary || {};

  const regalos = qs.regalo || [];
  if (regalos.length) {
    const top = regalos[0];
    insights.push({
      id: 'ref-rapidas-baja-utilidad',
      severity: 'warning',
      icon: 'speed',
      title: 'Piezas rápidas con poca utilidad',
      summary: `${regalos.length} parte(s) venden por encima de la mediana pero con margen bajo`,
      detail: top
        ? `Ejemplo: ${top.parte} · ${top.descripcion} · ${Number(top.cantidad).toLocaleString('es-MX')} pzas · margen ${top.margenPct}%`
        : '',
      action: 'Revisar precio de lista, descuentos o costo promedio; no reponer a ciegas por volumen.',
      metrics: { partes: regalos.length, topParte: top?.parte, margenPct: top?.margenPct },
    });
  }

  const estrellas = qs.estrella || [];
  if (estrellas.length) {
    const top = estrellas[0];
    insights.push({
      id: 'ref-estrellas',
      severity: 'success',
      icon: 'star',
      title: 'Estrellas: rotan y dejan utilidad',
      summary: `${estrellas.length} parte(s) con alta venta y buen margen`,
      detail: top
        ? `Líder: ${top.parte} · utilidad $${round2(top.utilidad).toLocaleString('es-MX')} · margen ${top.margenPct}%`
        : '',
      action: 'Proteger existencia y priorizar surtido / pedidos de compra.',
      metrics: { partes: estrellas.length, topParte: top?.parte, utilidad: top?.utilidad },
    });
  }

  const preguntas = qs.pregunta || [];
  if (preguntas.length) {
    const top = preguntas[0];
    insights.push({
      id: 'ref-alto-margen-poca-venta',
      severity: 'info',
      icon: 'trending_up',
      title: 'Alto margen, poca rotación',
      summary: `${preguntas.length} parte(s) con buen margen pero venta bajo la mediana`,
      detail: top
        ? `${top.parte} · margen ${top.margenPct}% · solo ${Number(top.cantidad).toLocaleString('es-MX')} pzas`
        : '',
      action: 'Empujar en mostrador/taller o vincular a campañas / kits.',
      metrics: { partes: preguntas.length, topParte: top?.parte },
    });
  }

  if (Number(sumRu.trabados90) > 0 || (ru.obsoleto || []).length) {
    const top = (ru.obsoleto || [])[0];
    insights.push({
      id: 'ref-obsoleto',
      severity: Number(sumRu.costoTrabado90) >= 500000 ? 'critical' : 'warning',
      icon: 'hourglass_disabled',
      title: 'Obsolescencia (≥90 días sin venta)',
      summary: `${Number(sumRu.trabados90 || 0).toLocaleString('es-MX')} líneas · $${round2(sumRu.costoTrabado90).toLocaleString('es-MX')}`,
      detail: top
        ? `Mayor inmovilizado: ${top.parte} · ${top.descripcion} · ${top.diasSinVenta >= 9999 ? 'sin venta' : `${top.diasSinVenta} días`} · $${round2(top.costo).toLocaleString('es-MX')}`
        : 'Capital trabado sin rotación reciente.',
      action: 'Liquidar, devolver a planta o traspasar antes de recomprar.',
      metrics: { lineas: sumRu.trabados90, costo: round2(sumRu.costoTrabado90) },
    });
  }

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
  const { getInventarioAlertas } = require('./refaccionesPedidosService');

  const [stock, traspasos, alertasInv] = await Promise.all([
    loadStockRows(),
    getTraspasosEntreAlmacenes({ fechaInicio, fechaFin, limit: 80 }),
    getInventarioAlertas({ fechaInicio, fechaFin, limit: 12 }).catch((err) => {
      console.warn('[inventoryPostventa] alertas rotación/utilidad:', err.message);
      return { summary: {}, topVendidos: [], topUtilidad: [], stockTrabado: [], alerts: [] };
    }),
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

  const rotacionUtilidad = buildRotacionUtilidad(alertasInv);

  const insights = buildRefaccionesInsights({
    refaccionesRows: refacciones,
    traspasos,
    overview,
    rotacionUtilidad,
  });

  return {
    fuente: 'PAR_ALMACEN · PAR_PARTES · PAR_MOVTOS/PAR_MOVDET (ventas, utilidad, traspasos)',
    periodo: { fechaInicio, fechaFin },
    areas,
    overview,
    rotacionUtilidad,
    traspasos,
    insights,
  };
}

module.exports = {
  getInventoryPostventa,
  getTraspasosEntreAlmacenes,
  buildRefaccionesInsights,
  buildRotacionUtilidad,
  HYP_GRUPO,
  HYP_ALMACEN,
};
