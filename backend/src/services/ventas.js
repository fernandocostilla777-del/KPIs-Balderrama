const { getPool, sql } = require('../db');
const { enrichVentasRows, countByCanal, CANALES_ORDEN, getCanalLabel } = require('./canales-venta');
const { getNotificacionesEntrega, computeCoberturaSofia } = require('./sofia-entregas');
const { getComparativoYtd } = require('./ytd-comparativo');

const TIPO_VENTA_CASE = `
  CASE VTE_FORMAPAGO
    WHEN 'CRE' THEN 'GMF'
    WHEN 'ZACCRE' THEN 'GMF'
    WHEN 'CHCRE' THEN 'GMF'
    WHEN 'CASACON' THEN 'CONTADO'
    WHEN 'PLNCON' THEN 'CONTADO'
    WHEN 'PISOBBVA' THEN 'BBVA'
    WHEN 'FORBBVA' THEN 'BBVA'
    WHEN 'CHCON' THEN 'CONTADO'
    WHEN 'FORCON' THEN 'CONTADO'
    WHEN 'FORCRE' THEN 'GMF'
    WHEN 'ZACCON' THEN 'CONTADO'
    WHEN 'CASACRE' THEN 'GMF'
    WHEN 'CON' THEN 'CONTADO'
    WHEN 'FLOT' THEN 'FLOTILLA'
    WHEN 'FLOTGMF' THEN 'FLOTILLA'
    WHEN 'PERDIDA' THEN 'PERDIDA'
    WHEN 'CHBBVA' THEN 'BBVA'
    WHEN 'ZACBBVA' THEN 'BBVA'
    WHEN 'PISOHSBC' THEN 'HSBC'
    WHEN 'FORHSBC' THEN 'HSBC'
    WHEN 'CHHSBC' THEN 'HSBC'
    WHEN 'ZACHSBC' THEN 'HSBC'
    WHEN 'PISOSANT' THEN 'SANTANDER'
    WHEN 'FORSANT' THEN 'SANTANDER'
    WHEN 'CHSANT' THEN 'SANTANDER'
    WHEN 'ZACSANT' THEN 'SANTANDER'
    WHEN 'PISOBNTE' THEN 'BANORTE'
    WHEN 'FORBNTE' THEN 'BANORTE'
    WHEN 'CHBNTE' THEN 'BANORTE'
    WHEN 'ZACBNTE' THEN 'BANORTE'
    WHEN 'FORSCOT' THEN 'SCOTIANBANK'
    WHEN 'PISOSCOT' THEN 'SCOTIANBANK'
    WHEN 'SUAGMF' THEN 'GMF'
    WHEN 'CXCSUAU' THEN 'SUAUTO'
    WHEN 'CXCSUAUC' THEN 'SUAUTO'
    WHEN 'SNPSUA' THEN 'SUAUTO'
    WHEN 'SUA' THEN 'SUAUTO'
    WHEN 'CHOSCOT' THEN 'SCOTIANBANK'
    WHEN 'ZACSCOT' THEN 'SCOTIANBANK'
    WHEN 'CASASCOT' THEN 'SCOTIANBANK'
    WHEN 'CHHSBC' THEN 'HSBC'
    ELSE VTE_FORMAPAGO
  END
`;

function buildVentasQuery() {
  return `
    SELECT
      ADE_VTAFI.VTE_FECHDOCTO,
      ADE_VTAFI.VTE_DOCTO,
      B.PER_PATERNO + ' ' + B.PER_MATERNO + ' ' + B.PER_NOMRAZON AS VENDEDOR,
      SER_VEHICULO.VEH_ANMODELO,
      UNI_CATACOLOR.COL_DESCRIPCION,
      SER_VEHICULO.VEH_FECHSALIDA,
      ADE_VTAFI.VTE_SERIE,
      SER_VEHICULO.VEH_TIPOAUTO,
      SER_VEHICULO.VEH_REPUVE,
      ADE_VTAFI.VTE_IDCLIENTE,
      A.PER_NOMRAZON + ' ' + A.PER_PATERNO + ' ' + A.PER_MATERNO AS CLIENTE,
      A.PER_SEXO,
      ${TIPO_VENTA_CASE} AS TIPOVENTA,
      ADE_VTAFI.VTE_FORMAPAGO AS FORMAPAGO_ORIGINAL
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
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)
        BETWEEN @fechaInicio AND @fechaFin
      AND ADE_VTAFI.VTE_FORMAPAGO <> 'VENTAMRS'
      AND ADE_VTAFI.VTE_FORMAPAGO <> 'VTACON'
      AND SER_VEHICULO.VEH_SITUACION IN ('VEN')
      AND ADE_VTAFI.VTE_STATUS = 'I'
    GROUP BY
      ADE_VTAFI.VTE_DOCTO,
      B.PER_PATERNO + ' ' + B.PER_MATERNO + ' ' + B.PER_NOMRAZON,
      A.PER_SEXO,
      SER_VEHICULO.VEH_FECHSALIDA,
      ADE_VTAFI.VTE_FECHDOCTO,
      ADE_VTAFI.VTE_SERIE,
      SER_VEHICULO.VEH_TIPOAUTO,
      ADE_VTAFI.VTE_STATUS,
      ADE_VTAFI.VTE_IDCLIENTE,
      A.PER_NOMRAZON + ' ' + A.PER_PATERNO + ' ' + A.PER_MATERNO,
      SER_VEHICULO.VEH_CATALOGO,
      SER_VEHICULO.VEH_ANMODELO,
      A.PER_EMAIL,
      A.PER_TELCELULAR,
      A.PER_TELEFONO1,
      A.PER_CODPOS,
      A.PER_COLONIA,
      A.PER_ESTADO,
      C.PAR_DESCRIP1,
      UNI_CATACOLOR.COL_DESCRIPCION,
      SER_VEHICULO.VEH_REPUVE,
      ADE_VTAFI.VTE_FORMAPAGO
    ORDER BY
      VENDEDOR,
      CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103),
      ADE_VTAFI.VTE_SERIE
  `;
}

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

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FLOTILLA_LABEL = 'FLOTILLA';

function isFlotilla(row) {
  return row.TIPOVENTA === FLOTILLA_LABEL;
}

function splitFlotilla(rows) {
  const flotillas = rows.filter(isFlotilla);
  const retail = rows.filter((row) => !isFlotilla(row));
  return { flotillas, retail };
}

function parseFechaDoc(value) {
  if (!value) return null;
  const parts = String(value).trim().split('/');
  if (parts.length !== 3) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!day || !month || !year) return null;

  return {
    day,
    month,
    year,
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
  };
}

function buildMonthRange(inicio, fin) {
  const months = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const end = new Date(fin.getFullYear(), fin.getMonth(), 1);

  while (cursor <= end) {
    const month = cursor.getMonth() + 1;
    const year = cursor.getFullYear();
    months.push({
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${MESES[month - 1]} ${year}`,
      month,
      year,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function isAcumuladoAnual(inicio, fin) {
  const sameYear = inicio.getFullYear() === fin.getFullYear();
  const startsOnJanuary = inicio.getMonth() === 0 && inicio.getDate() === 1;
  const monthsSpan =
    (fin.getFullYear() - inicio.getFullYear()) * 12 +
    (fin.getMonth() - inicio.getMonth()) +
    1;

  return sameYear && startsOnJanuary && monthsSpan >= 2;
}

function countBy(rows, key) {
  const map = {};
  for (const row of rows) {
    const val = row[key] || '(Sin dato)';
    map[val] = (map[val] || 0) + 1;
  }
  return Object.entries(map)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function buildComparativoMensual(rows, inicio, fin, entregasPorMes = []) {
  const monthRange = buildMonthRange(inicio, fin);
  const monthKeys = monthRange.map((m) => m.key);
  const totals = Object.fromEntries(monthKeys.map((key) => [key, 0]));
  const tipos = new Set();
  const vendedores = new Set();
  const tipoPorMes = {};
  const vendedorPorMes = {};
  const retailPorMes = Object.fromEntries(monthKeys.map((key) => [key, 0]));
  const flotillaPorMes = Object.fromEntries(monthKeys.map((key) => [key, 0]));
  const canalPorMes = Object.fromEntries(
    CANALES_ORDEN.map((c) => [c, Object.fromEntries(monthKeys.map((key) => [key, 0]))])
  );

  for (const row of rows) {
    const fecha = parseFechaDoc(row.VTE_FECHDOCTO);
    if (!fecha || !totals.hasOwnProperty(fecha.monthKey)) continue;

    totals[fecha.monthKey] += 1;

    if (isFlotilla(row)) {
      flotillaPorMes[fecha.monthKey] += 1;
    } else {
      retailPorMes[fecha.monthKey] += 1;
    }

    const tipo = row.TIPOVENTA || '(Sin dato)';
    if (tipo !== FLOTILLA_LABEL) {
      tipos.add(tipo);
      if (!tipoPorMes[tipo]) tipoPorMes[tipo] = Object.fromEntries(monthKeys.map((key) => [key, 0]));
      tipoPorMes[tipo][fecha.monthKey] += 1;
    }

    const vendedor = row.VENDEDOR || '(Sin dato)';
    vendedores.add(vendedor);
    if (!vendedorPorMes[vendedor]) {
      vendedorPorMes[vendedor] = Object.fromEntries(monthKeys.map((key) => [key, 0]));
    }
    vendedorPorMes[vendedor][fecha.monthKey] += 1;

    const canal = row.CANAL_VENTA || 'OTROS';
    if (canalPorMes[canal]) {
      canalPorMes[canal][fecha.monthKey] += 1;
    }
  }

  const porMes = monthRange.map((m) => ({
    key: m.key,
    label: m.label,
    count: totals[m.key] || 0,
  }));

  const totalPorMes = porMes.map((m) => m.count);
  const maxCount = Math.max(...totalPorMes, 0);
  const minCount = totalPorMes.filter((n) => n > 0).length
    ? Math.min(...totalPorMes.filter((n) => n > 0))
    : 0;
  const mesMaximo = porMes.find((m) => m.count === maxCount && maxCount > 0) || null;
  const mesMinimo = porMes.find((m) => m.count === minCount && minCount > 0) || null;
  const promedioMensual = porMes.length
    ? Number((totalPorMes.reduce((a, b) => a + b, 0) / porMes.length).toFixed(1))
    : 0;

  const topVendedores = Object.entries(
    Object.fromEntries([...vendedores].map((v) => [v, Object.values(vendedorPorMes[v]).reduce((a, b) => a + b, 0)]))
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label]) => label);

  return {
    activo: true,
    anio: inicio.getFullYear(),
    porMes,
    promedioMensual,
    mesMaximo,
    mesMinimo,
    porMesPorTipo: {
      labels: monthRange.map((m) => m.label),
      series: [...tipos]
        .sort()
        .map((tipo) => ({
          label: tipo,
          data: monthKeys.map((key) => tipoPorMes[tipo][key] || 0),
        })),
    },
    porMesTopVendedores: {
      labels: monthRange.map((m) => m.label),
      series: topVendedores.map((vendedor) => ({
        label: vendedor,
        data: monthKeys.map((key) => vendedorPorMes[vendedor][key] || 0),
      })),
    },
    porMesFlotillaRetail: {
      labels: monthRange.map((m) => m.label),
      retail: monthKeys.map((key) => retailPorMes[key] || 0),
      flotilla: monthKeys.map((key) => flotillaPorMes[key] || 0),
    },
    porMesPorCanal: {
      labels: monthRange.map((m) => m.label),
      series: CANALES_ORDEN.filter((c) => c !== 'OTROS' && c !== 'PERDIDA')
        .map((canal) => ({
          label: getCanalLabel(canal),
          data: monthKeys.map((key) => (canalPorMes[canal] ? canalPorMes[canal][key] : 0)),
        }))
        .filter((serie) => serie.data.some((n) => n > 0)),
    },
    porMesEntregasSofia: {
      labels: (entregasPorMes.length ? entregasPorMes : monthRange.map((m) => ({ label: m.label, count: 0 })))
        .map((m) => m.label),
      data: (entregasPorMes.length ? entregasPorMes : monthRange.map(() => ({ count: 0 })))
        .map((m) => m.count),
    },
  };
}

function compareFechaDoc(a, b) {
  const [da, ma, ya] = String(a).split('/').map(Number);
  const [db, mb, yb] = String(b).split('/').map(Number);
  return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
}

function buildRetailDrilldown(retailRows) {
  const porDia = {};
  const porSucursalPorDia = {};

  for (const row of retailRows) {
    const canal = row.CANAL_VENTA || 'OTROS';
    if (canal === 'FLOTILLAS' || canal === 'PERDIDA') continue;

    const fecha = String(row.VTE_FECHDOCTO || 'Sin fecha').trim();
    const sucursal = row.CANAL_LABEL || getCanalLabel(canal);

    porDia[fecha] = (porDia[fecha] || 0) + 1;
    if (!porSucursalPorDia[fecha]) porSucursalPorDia[fecha] = {};
    porSucursalPorDia[fecha][sucursal] = (porSucursalPorDia[fecha][sucursal] || 0) + 1;
  }

  const fechas = Object.entries(porDia)
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => compareFechaDoc(b.label, a.label));

  const byFecha = {};
  for (const [fecha, map] of Object.entries(porSucursalPorDia)) {
    byFecha[fecha] = Object.entries(map)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  const periodo = countByCanal(retailRows)
    .filter((c) => !['FLOTILLAS', 'PERDIDA'].includes(c.canal))
    .map((c) => ({ label: c.label, count: c.count }))
    .sort((a, b) => b.count - a.count);

  return { fechas, byFecha, periodo };
}

function summarizeVentas(rows, inicio, fin, sofiaEntregas = {}) {
  const { flotillas, retail } = splitFlotilla(rows);
  const vendedores = new Set(rows.map((r) => r.VENDEDOR));
  const clientes = new Set(rows.map((r) => r.VTE_IDCLIENTE));
  const modelos = new Set(rows.map((r) => r.VEH_TIPOAUTO));
  const entregasRows = sofiaEntregas.registrosEntrega ?? [];
  const cobertura = computeCoberturaSofia(rows, entregasRows);
  const comparativoMensual = isAcumuladoAnual(inicio, fin)
    ? buildComparativoMensual(rows, inicio, fin, sofiaEntregas.entregasPorMes)
    : null;

  return {
    totalVentas: rows.length,
    totalFlotillas: flotillas.length,
    totalRetail: retail.length,
    totalVendedores: vendedores.size,
    totalClientes: clientes.size,
    totalModelos: modelos.size,
    totalNotificacionesEntrega: cobertura.totalNotificacionesEntrega,
    totalUnidadesFacturadas: cobertura.totalUnidadesFacturadas,
    totalUnidadesFacturadasNoTimbradas: cobertura.totalUnidadesFacturadasNoTimbradas,
    numeradorCobertura: cobertura.numeradorCobertura,
    porTipoVenta: countBy(rows, 'TIPOVENTA'),
    porTipoVentaRetail: countBy(retail, 'TIPOVENTA'),
    porVendedor: countBy(rows, 'VENDEDOR'),
    porVendedorRetail: countBy(retail, 'VENDEDOR'),
    porVendedorFlotilla: countBy(flotillas, 'VENDEDOR'),
    porCanal: countByCanal(rows),
    porSucursal: countByCanal(rows).filter((c) => c.canal !== 'PERDIDA'),
    porSucursalRetail: countByCanal(retail).filter((c) => !['FLOTILLAS', 'PERDIDA'].includes(c.canal)),
    porSucursalFlotilla: countByCanal(flotillas),
    retailDrilldown: buildRetailDrilldown(retail),
    porModelo: countBy(rows, 'VEH_TIPOAUTO').slice(0, 10),
    porDia: countBy(rows, 'VTE_FECHDOCTO').sort((a, b) => {
      const [da, ma, ya] = a.label.split('/').map(Number);
      const [db, mb, yb] = b.label.split('/').map(Number);
      return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
    }),
    mostrarComparativoMensual: isAcumuladoAnual(inicio, fin),
    comparativoMensual,
  };
}

async function getVentas({ fechaInicio, fechaFin }) {
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);

  if (inicio > fin) {
    throw new Error('La fecha inicial no puede ser mayor que la fecha final.');
  }

  const pool = await getPool();
  pool.config.requestTimeout = 120000;

  const request = pool.request();
  request.input('fechaInicio', sql.Date, inicio);
  request.input('fechaFin', sql.Date, fin);

  const incluirPorMes = isAcumuladoAnual(inicio, fin);
  const [result, sofiaEntregas, comparativoYtd] = await Promise.all([
    request.query(buildVentasQuery()),
    getNotificacionesEntrega({ fechaInicio, fechaFin, incluirPorMes }),
    getComparativoYtd(fechaFin),
  ]);

  const rows = enrichVentasRows(result.recordset);

  return {
    filtros: { fechaInicio, fechaFin },
    resumen: summarizeVentas(rows, inicio, fin, sofiaEntregas),
    comparativoYtd,
    registros: rows,
    entregasSofia: sofiaEntregas.registrosEntrega ?? [],
  };
}

module.exports = {
  getVentas,
  parseDateInput,
};
