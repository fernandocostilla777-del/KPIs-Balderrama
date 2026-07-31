const { getPool, sql } = require('../db');

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function parseDateInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Fecha invalida. Use formato YYYY-MM-DD.');
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Fecha invalida.');
  }
  return date;
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getYtdEndDate(fechaFin) {
  const fin = parseDateInput(fechaFin);
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (fin.getFullYear() < today.getFullYear()) {
    return { end: fin, mesEnCursoExcluido: false };
  }

  const year = today.getFullYear();
  const month = today.getMonth();
  const lastDayCurrentMonth = new Date(year, month + 1, 0);
  const currentMonthComplete = today.getTime() >= lastDayCurrentMonth.getTime();

  if (currentMonthComplete) {
    return { end: fin, mesEnCursoExcluido: false };
  }

  const lastCompleteMonthEnd = new Date(year, month, 0);
  const end = fin.getTime() <= lastCompleteMonthEnd.getTime() ? fin : lastCompleteMonthEnd;
  const mesEnCursoExcluido = end.getTime() < fin.getTime()
    || (fin.getFullYear() === year && fin.getMonth() === month);

  return { end, mesEnCursoExcluido };
}

function buildYtdRanges(fechaFin) {
  const { end: fin, mesEnCursoExcluido } = getYtdEndDate(fechaFin);
  const year = fin.getFullYear();
  const inicioActual = new Date(year, 0, 1);
  const inicioAnterior = new Date(year - 1, 0, 1);
  const finAnterior = new Date(year - 1, fin.getMonth(), fin.getDate());

  return {
    anioActual: year,
    anioAnterior: year - 1,
    corte: formatDateInput(fin),
    mesEnCursoExcluido,
    inicioActual: formatDateInput(inicioActual),
    finActual: formatDateInput(fin),
    inicioAnterior: formatDateInput(inicioAnterior),
    finAnterior: formatDateInput(finAnterior),
    mesCorte: fin.getMonth() + 1,
  };
}

function buildYtdQuery() {
  return `
    SELECT
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS anio,
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS mes,
      COUNT(DISTINCT ADE_VTAFI.VTE_DOCTO) AS cnt
    FROM ADE_VTAFI
    INNER JOIN PER_PERSONAS AS A ON A.PER_IDPERSONA = ADE_VTAFI.VTE_IDCLIENTE
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    INNER JOIN UNI_CATACOLOR
      ON UNI_CATACOLOR.COL_CLAVE = SER_VEHICULO.VEH_COLOEXTE
      AND UNI_CATACOLOR.COL_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND UNI_CATACOLOR.COL_CATALOGO = SER_VEHICULO.VEH_CATALOGO
    INNER JOIN PER_PERSONAS AS B ON B.PER_IDPERSONA = SER_VEHICULO.VEH_VENDEDOR
    INNER JOIN PNC_PARAMETR AS C ON C.PAR_TIPOPARA = 'EO' AND C.PAR_IDENPARA = A.PER_ESTADO
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_FORMAPAGO <> 'VENTAMRS'
      AND ADE_VTAFI.VTE_FORMAPAGO <> 'VTACON'
      AND SER_VEHICULO.VEH_SITUACION IN ('VEN')
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND (
        CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)
          BETWEEN @ytdInicioActual AND @ytdFinActual
        OR CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)
          BETWEEN @ytdInicioAnterior AND @ytdFinAnterior
      )
    GROUP BY
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)),
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103))
    ORDER BY anio, mes
  `;
}

function buildComparativoYtd(rows, ranges) {
  const { anioActual, anioAnterior, mesCorte, corte } = ranges;
  const maxMonth = Math.min(12, Math.max(1, Number(mesCorte) || 12));
  const maxQ = Math.ceil(maxMonth / 3);

  const actualPorMes = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i + 1, 0])
  );
  const anteriorPorMes = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i + 1, 0])
  );

  for (const row of rows) {
    const mes = Number(row.mes);
    const anio = Number(row.anio);
    const cnt = Number(row.cnt) || 0;
    if (mes < 1 || mes > 12 || mes > maxMonth) continue;
    if (anio === anioActual) actualPorMes[mes] = cnt;
    if (anio === anioAnterior) anteriorPorMes[mes] = cnt;
  }

  // Serie plana (compatibilidad con clientes/IA existentes)
  const labels = Array.from({ length: maxMonth }, (_, i) => MESES[i]);
  const actual = Array.from({ length: maxMonth }, (_, i) => actualPorMes[i + 1] || 0);
  const anterior = Array.from({ length: maxMonth }, (_, i) => anteriorPorMes[i + 1] || 0);
  const totalActual = actual.reduce((sum, n) => sum + n, 0);
  const totalAnterior = anterior.reduce((sum, n) => sum + n, 0);
  const variacion = totalAnterior
    ? Number((((totalActual - totalAnterior) / totalAnterior) * 100).toFixed(1))
    : null;

  const monthsOfQuarter = (q) => {
    const start = (q - 1) * 3 + 1;
    return [start, start + 1, start + 2];
  };

  const trimestres = [1, 2, 3, 4]
    .filter((q) => q <= maxQ)
    .map((q) => {
      const monthNums = monthsOfQuarter(q);
      const meses = monthNums.map((m) => ({
        month: m,
        label: MESES[m - 1],
        quarter: q,
        withinYtd: m <= maxMonth,
        actual: actualPorMes[m] || 0,
        anterior: anteriorPorMes[m] || 0,
      }));
      const sum = (key) => meses.reduce((s, x) => s + Number(x[key] || 0), 0);
      return {
        quarter: q,
        label: `T${q}`,
        actual: sum('actual'),
        anterior: sum('anterior'),
        meses,
      };
    });

  return {
    anioActual,
    anioAnterior,
    corte,
    maxMonth,
    mesEnCursoExcluido: ranges.mesEnCursoExcluido,
    totalActual,
    totalAnterior,
    variacion,
    labels,
    series: {
      actual,
      anterior,
    },
    trimestres,
  };
}

async function getComparativoYtd(fechaFin) {
  const ranges = buildYtdRanges(fechaFin);
  const pool = await getPool();

  const result = await pool.request()
    .input('ytdInicioActual', sql.Date, parseDateInput(ranges.inicioActual))
    .input('ytdFinActual', sql.Date, parseDateInput(ranges.finActual))
    .input('ytdInicioAnterior', sql.Date, parseDateInput(ranges.inicioAnterior))
    .input('ytdFinAnterior', sql.Date, parseDateInput(ranges.finAnterior))
    .query(buildYtdQuery());

  return buildComparativoYtd(result.recordset, ranges);
}

module.exports = {
  getComparativoYtd,
  getYtdEndDate,
  buildYtdRanges,
};
