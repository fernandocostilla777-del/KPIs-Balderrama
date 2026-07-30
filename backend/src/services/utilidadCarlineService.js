const { query } = require('../db');
const { VENTAS_BASE_CTE, buildVentasDateClause, pct } = require('./ventasNuevosFinanciero');
const { resolveCrmPeriod } = require('./crmCiclosService');

const PERIOD_LABELS = {
  mes_actual: 'Mes en curso',
  mes_pasado: 'Mes pasado',
  trimestre_actual: 'Trimestre actual',
  semestre_actual: 'Semestre actual',
  acumulado_anio: 'Año acumulado',
  anio_actual: 'Año actual',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

/**
 * Por carline (UNC_FAMILIA): versión (TIPOAUTO) con mayor utilidad promedio
 * y su margen bruto %. Default periodo = mes_actual.
 */
async function getUtilidadPorCarlineAiAnalysis({
  periodo = null,
  fechaInicio = null,
  fechaFin = null,
  carline = null,
  metric = 'utilidad_promedio',
  minUnidades = 1,
  includePeriodPreviews = true,
} = {}) {
  const hasExplicitDates = Boolean(fechaInicio || fechaFin);
  const periodoKey = hasExplicitDates
    ? (periodo || 'personalizado')
    : (periodo || 'mes_actual');

  let rango = resolveCrmPeriod({
    periodo: hasExplicitDates ? null : periodoKey,
    desde: fechaInicio || null,
    hasta: fechaFin || null,
  });

  if (!rango.desde || !rango.hasta) {
    rango = resolveCrmPeriod({ periodo: 'mes_actual' });
  }

  const fi = rango.desde;
  const ff = rango.hasta;
  const { clause, params } = buildVentasDateClause(fi, ff);
  const minU = Math.min(20, Math.max(1, Number(minUnidades) || 1));
  const carlineFilter = carline
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(cat.UNC_FAMILIA, '')))) LIKE @carline`
    : '';
  const queryParams = {
    ...params,
    ...(carline ? { carline: `%${normalizeText(carline).toUpperCase()}%` } : {}),
  };

  const rows = await query(`
    ${VENTAS_BASE_CTE}
    SELECT
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))) AS carline,
      LTRIM(RTRIM(v.modelo)) AS version,
      LTRIM(RTRIM(ISNULL(veh.VEH_CATALOGO, ''))) AS catalogo,
      COUNT(*) AS unidades,
      SUM(CASE WHEN v.utilidad IS NOT NULL THEN 1 ELSE 0 END) AS conUtilidad,
      SUM(ISNULL(v.ventaSubtotal, 0)) AS ventaSubtotal,
      SUM(ISNULL(v.costoNeto, 0)) AS costoNeto,
      SUM(ISNULL(v.utilidad, 0)) AS utilidadTotal,
      AVG(CASE WHEN v.utilidad IS NOT NULL THEN v.utilidad END) AS utilidadPromedio
    FROM ventas v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    LEFT JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO
      AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE 1 = 1 ${clause} ${carlineFilter}
      AND v.utilidad IS NOT NULL
    GROUP BY
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))),
      LTRIM(RTRIM(v.modelo)),
      LTRIM(RTRIM(ISNULL(veh.VEH_CATALOGO, '')))
    HAVING COUNT(*) >= ${minU}
    ORDER BY carline, utilidadPromedio DESC
  `, queryParams);

  const byCarline = new Map();
  for (const row of rows) {
    const cl = normalizeText(row.carline) || 'SIN FAMILIA';
    const version = normalizeText(row.version) || 'Sin versión';
    const unidades = Number(row.unidades || 0);
    const ventaSubtotal = Number(row.ventaSubtotal || 0);
    const utilidadTotal = Number(row.utilidadTotal || 0);
    const utilidadPromedio = Number(row.utilidadPromedio || 0);
    const margenBrutoPct = pct(utilidadTotal, ventaSubtotal);
    const entry = {
      carline: cl,
      version,
      catalogo: normalizeText(row.catalogo) || null,
      unidades,
      ventaSubtotal: roundMoney(ventaSubtotal),
      costoNeto: roundMoney(row.costoNeto),
      utilidadTotal: roundMoney(utilidadTotal),
      utilidadPromedio: roundMoney(utilidadPromedio),
      margenBrutoPct,
    };

    if (!byCarline.has(cl)) byCarline.set(cl, []);
    byCarline.get(cl).push(entry);
  }

  const sortKey = String(metric || 'utilidad_promedio').toLowerCase() === 'margen'
    ? (a, b) => (b.margenBrutoPct - a.margenBrutoPct)
      || (b.utilidadPromedio - a.utilidadPromedio)
    : String(metric || '').toLowerCase() === 'utilidad_total'
      ? (a, b) => (b.utilidadTotal - a.utilidadTotal)
        || (b.utilidadPromedio - a.utilidadPromedio)
      : (a, b) => (b.utilidadPromedio - a.utilidadPromedio)
        || (b.margenBrutoPct - a.margenBrutoPct);

  const porCarline = [...byCarline.entries()]
    .map(([cl, versiones]) => {
      const sorted = [...versiones].sort(sortKey);
      const mejor = sorted[0];
      const carlineTotales = versiones.reduce((acc, v) => ({
        unidades: acc.unidades + v.unidades,
        ventaSubtotal: acc.ventaSubtotal + (v.ventaSubtotal || 0),
        utilidadTotal: acc.utilidadTotal + (v.utilidadTotal || 0),
      }), { unidades: 0, ventaSubtotal: 0, utilidadTotal: 0 });

      return {
        carline: cl,
        unidadesCarline: carlineTotales.unidades,
        utilidadCarline: roundMoney(carlineTotales.utilidadTotal),
        margenBrutoCarlinePct: pct(carlineTotales.utilidadTotal, carlineTotales.ventaSubtotal),
        mejorVersion: mejor
          ? {
            version: mejor.version,
            catalogo: mejor.catalogo,
            unidades: mejor.unidades,
            utilidadPromedio: mejor.utilidadPromedio,
            utilidadTotal: mejor.utilidadTotal,
            margenBrutoPct: mejor.margenBrutoPct,
            ventaSubtotal: mejor.ventaSubtotal,
          }
          : null,
        topVersiones: sorted.slice(0, 5).map((v) => ({
          version: v.version,
          catalogo: v.catalogo,
          unidades: v.unidades,
          utilidadPromedio: v.utilidadPromedio,
          utilidadTotal: v.utilidadTotal,
          margenBrutoPct: v.margenBrutoPct,
        })),
      };
    })
    .filter((c) => c.mejorVersion)
    .sort((a, b) => (b.mejorVersion.utilidadPromedio - a.mejorVersion.utilidadPromedio)
      || (b.mejorVersion.margenBrutoPct - a.mejorVersion.margenBrutoPct));

  const periodosSugeridos = [];
  if (includePeriodPreviews) {
    for (const key of ['trimestre_actual', 'semestre_actual', 'acumulado_anio']) {
      if (key === rango.periodo) continue;
      try {
        const preview = await previewPeriodBest(key, carline, minU);
        if (preview) periodosSugeridos.push(preview);
      } catch {
        // preview opcional
      }
    }
  }

  return {
    available: true,
    fuente: 'ADE_VTAFI + UNI_TEMLIBROVENTAS + UNI_CATALOGO.UNC_FAMILIA (carline)',
    definicion: {
      carline: 'UNC_FAMILIA del catálogo (AVEO, ONIX, CAPTIVA…)',
      version: 'TIPOAUTO / descripción comercial completa (paquete / trim)',
      utilidad: 'SUBTOTAL − COSTO NETO − GASTOS (libro de ventas)',
      margenBrutoPct: 'utilidad / venta subtotal × 100',
      ranking: metric === 'margen'
        ? 'mejor versión por margen bruto %'
        : metric === 'utilidad_total'
          ? 'mejor versión por utilidad total'
          : 'mejor versión por utilidad promedio por unidad',
    },
    periodo: {
      key: rango.periodo || periodoKey,
      fechaInicio: fi,
      fechaFin: ff,
      label: PERIOD_LABELS[rango.periodo] || rango.periodo || periodoKey,
      defaultAplicado: !hasExplicitDates && !periodo,
    },
    filtros: {
      carline: carline || null,
      metric: metric || 'utilidad_promedio',
      minUnidades: minU,
    },
    resumen: {
      carlines: porCarline.length,
      versionesEvaluadas: rows.length,
      unidades: porCarline.reduce((s, c) => s + c.unidadesCarline, 0),
      utilidadTotal: roundMoney(porCarline.reduce((s, c) => s + (c.utilidadCarline || 0), 0)),
    },
    porCarline,
    lider: porCarline[0]
      ? {
        carline: porCarline[0].carline,
        version: porCarline[0].mejorVersion.version,
        utilidadPromedio: porCarline[0].mejorVersion.utilidadPromedio,
        margenBrutoPct: porCarline[0].mejorVersion.margenBrutoPct,
      }
      : null,
    periodosSugeridos,
    instruccionesRespuesta: [
      'Responde por carline: el auto CON SU VERSIÓN que mejor deja utilidad y el margen bruto %.',
      'Formato sugerido: «CARLINE → Versión … · utilidad prom. $X · margen bruto Y%».',
      'Carline = familia UNC_FAMILIA; versión = descripción completa (paquete/trim), no solo el nombre corto.',
      `Periodo consultado: ${fi} → ${ff} (${PERIOD_LABELS[rango.periodo] || rango.periodo}).`,
      'Si el usuario no pidió periodo, era mes en curso; ofrece trimestre, semestre o año acumulado.',
    ],
  };
}

async function previewPeriodBest(periodoKey, carline, minUnidades) {
  const rango = resolveCrmPeriod({ periodo: periodoKey });
  if (!rango.desde || !rango.hasta) return null;

  const { clause, params } = buildVentasDateClause(rango.desde, rango.hasta);
  const carlineFilter = carline
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(cat.UNC_FAMILIA, '')))) LIKE @carline`
    : '';
  const queryParams = {
    ...params,
    ...(carline ? { carline: `%${normalizeText(carline).toUpperCase()}%` } : {}),
  };

  const rows = await query(`
    ${VENTAS_BASE_CTE}
    SELECT TOP 1
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))) AS carline,
      LTRIM(RTRIM(v.modelo)) AS version,
      COUNT(*) AS unidades,
      SUM(ISNULL(v.ventaSubtotal, 0)) AS ventaSubtotal,
      SUM(ISNULL(v.utilidad, 0)) AS utilidadTotal,
      AVG(v.utilidad) AS utilidadPromedio
    FROM ventas v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    LEFT JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO
      AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE 1 = 1 ${clause} ${carlineFilter}
      AND v.utilidad IS NOT NULL
    GROUP BY
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))),
      LTRIM(RTRIM(v.modelo))
    HAVING COUNT(*) >= ${Math.min(20, Math.max(1, Number(minUnidades) || 1))}
    ORDER BY AVG(v.utilidad) DESC
  `, queryParams);

  const top = rows[0];
  if (!top) {
    return {
      key: periodoKey,
      label: PERIOD_LABELS[periodoKey] || periodoKey,
      fechaInicio: rango.desde,
      fechaFin: rango.hasta,
      carlines: 0,
    };
  }

  return {
    key: periodoKey,
    label: PERIOD_LABELS[periodoKey] || periodoKey,
    fechaInicio: rango.desde,
    fechaFin: rango.hasta,
    topVersion: {
      carline: normalizeText(top.carline),
      version: normalizeText(top.version),
      unidades: Number(top.unidades || 0),
      utilidadPromedio: roundMoney(top.utilidadPromedio),
      margenBrutoPct: pct(Number(top.utilidadTotal || 0), Number(top.ventaSubtotal || 0)),
    },
  };
}

/**
 * Versión liviana para el dashboard de ventas (sin previews de periodos).
 */
async function getMejorUtilidadPorCarline({
  fechaInicio = null,
  fechaFin = null,
  metric = 'utilidad_promedio',
  minUnidades = 1,
} = {}) {
  const data = await getUtilidadPorCarlineAiAnalysis({
    fechaInicio,
    fechaFin,
    metric,
    minUnidades,
    includePeriodPreviews: false,
  });

  return {
    available: Boolean(data?.available),
    reason: data?.reason || null,
    periodo: data?.periodo || null,
    definicion: data?.definicion || null,
    resumen: data?.resumen || null,
    lider: data?.lider || null,
    porCarline: (data?.porCarline || []).map((c) => ({
      carline: c.carline,
      unidadesCarline: c.unidadesCarline,
      utilidadCarline: c.utilidadCarline,
      margenBrutoCarlinePct: c.margenBrutoCarlinePct,
      mejorVersion: c.mejorVersion,
    })),
  };
}

module.exports = {
  getUtilidadPorCarlineAiAnalysis,
  getMejorUtilidadPorCarline,
};
