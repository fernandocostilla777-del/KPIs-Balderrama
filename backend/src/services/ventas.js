const { getPool, sql } = require('../db');
const { enrichVentasRows, countByCanal, CANALES_ORDEN, getCanalLabel } = require('./canales-venta');
const { getNotificacionesEntrega, computeCoberturaSofia } = require('./sofia-entregas');
const { getComparativoYtd, buildYtdRanges } = require('./ytd-comparativo');
const { getMejorUtilidadPorCarline } = require('./utilidadCarlineService');
const { getInventory } = require('./inventoryService');

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

function isDemoVentaRow(row = {}) {
  const hay = [
    row.VEH_OBSERVACION,
    row.VEH_OBSERVS,
    row.observacion,
    row.observs,
    row.VEH_UBICACION,
    row.ubicacion,
    row.VEH_TIPOAUTO,
  ].map((v) => String(v || '').toUpperCase()).join(' ');
  return /\bDEMO\b|\bDVIN\b/.test(hay);
}

function markDemoVentasRows(rows = []) {
  return (rows || []).map((row) => {
    const isDemo = Boolean(row.IS_DEMO) || isDemoVentaRow(row);
    const hint = String(row.VEH_OBSERVACION || row.VEH_OBSERVS || row.VEH_UBICACION || '')
      .trim() || (isDemo ? 'Marcada como demo' : null);
    return {
      ...row,
      IS_DEMO: isDemo,
      DEMO_HINT: isDemo ? hint : null,
    };
  });
}

/**
 * Unidades que pasaron por inventario demo (SOF_DEMO), aunque ya estén VEN.
 * Adjunta DEMO_TIMBRADO_SALIDA = última fecha FIS con EXITO/OK (timbrado de salida).
 */
async function annotateDemosFromSofDemo(rows = []) {
  const list = rows || [];
  const vins = [...new Set(list.map((r) => normalizeVinKey(r.VTE_SERIE)).filter(Boolean))];
  if (!vins.length) return list;

  const pool = await getPool();
  const req = pool.request();
  const params = vins.map((vin, i) => {
    const name = `vin${i}`;
    req.input(name, sql.VarChar(32), vin);
    return `@${name}`;
  });
  const result = await req.query(`
    SELECT
      UPPER(REPLACE(LTRIM(RTRIM(DEMO_VIN)), ' ', '')) AS vin,
      DEMO_Estatus AS estatus,
      DEMO_Resultado AS resultado,
      DEMO_ResDescrip AS descripcion,
      DEMO_FechAct AS fecha
    FROM SOF_DEMO
    WHERE UPPER(REPLACE(LTRIM(RTRIM(DEMO_VIN)), ' ', '')) IN (${params.join(',')})
  `);

  /** vin → fecha dd/mm/yyyy del último FIS EXITO/OK (timbrado de salida demo). */
  const timbradoSalidaByVin = new Map();
  for (const row of result.recordset || []) {
    const vin = normalizeVinKey(row.vin);
    if (!vin) continue;
    const estatus = String(row.estatus || '').trim().toUpperCase();
    const resultado = String(row.resultado || '').trim().toUpperCase();
    const descripcion = String(row.descripcion || '').trim().toUpperCase();
    const esSalida = estatus === 'FIS' && (resultado === 'OK' || descripcion === 'EXITO' || descripcion.includes('EXITO'));
    if (!esSalida) continue;
    const fecha = String(row.fecha || '').trim();
    if (!fecha) continue;
    const prev = timbradoSalidaByVin.get(vin);
    const currParts = parseFechaDoc(fecha);
    const prevParts = prev ? parseFechaDoc(prev) : null;
    if (!currParts) continue;
    if (!prevParts) {
      timbradoSalidaByVin.set(vin, fecha);
      continue;
    }
    const currT = new Date(currParts.year, currParts.month - 1, currParts.day).getTime();
    const prevT = new Date(prevParts.year, prevParts.month - 1, prevParts.day).getTime();
    if (currT >= prevT) timbradoSalidaByVin.set(vin, fecha);
  }

  if (!timbradoSalidaByVin.size && !(result.recordset || []).length) return list;

  const demoSet = new Set(
    (result.recordset || []).map((r) => normalizeVinKey(r.vin)).filter(Boolean),
  );

  return list.map((row) => {
    const vin = normalizeVinKey(row.VTE_SERIE);
    if (!vin || !demoSet.has(vin)) return row;
    const timbradoSalida = timbradoSalidaByVin.get(vin) || null;
    return {
      ...row,
      IS_DEMO: true,
      DEMO_HINT: row.DEMO_HINT || 'Registrada en SOF_DEMO',
      DEMO_TIMBRADO_SALIDA: timbradoSalida,
    };
  });
}

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
      LTRIM(RTRIM(ISNULL(SER_VEHICULO.VEH_OBSERVACION, ''))) AS VEH_OBSERVACION,
      LTRIM(RTRIM(ISNULL(SER_VEHICULO.veh_observs, ''))) AS VEH_OBSERVS,
      LTRIM(RTRIM(ISNULL(SER_VEHICULO.VEH_UBICACION, ''))) AS VEH_UBICACION,
      ADE_VTAFI.VTE_IDCLIENTE,
      A.PER_NOMRAZON + ' ' + A.PER_PATERNO + ' ' + A.PER_MATERNO AS CLIENTE,
      A.PER_SEXO,
      ${TIPO_VENTA_CASE} AS TIPOVENTA,
      ADE_VTAFI.VTE_FORMAPAGO AS FORMAPAGO_ORIGINAL,
      ISNULL(prev.PREVIAS, 0) AS PREVIAS
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
    LEFT JOIN (
      SELECT
        UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS SERIE,
        COUNT(*) AS PREVIAS
      FROM SER_ORDEN o
      WHERE LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1) = 'S'
        AND o.ORE_STATUS <> 'C'
        AND o.ORE_NUMSERIE IS NOT NULL
        AND LTRIM(RTRIM(o.ORE_NUMSERIE)) <> ''
      GROUP BY UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE)))
    ) prev ON prev.SERIE = UPPER(LTRIM(RTRIM(ADE_VTAFI.VTE_SERIE)))
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
      LTRIM(RTRIM(ISNULL(SER_VEHICULO.VEH_OBSERVACION, ''))),
      LTRIM(RTRIM(ISNULL(SER_VEHICULO.veh_observs, ''))),
      LTRIM(RTRIM(ISNULL(SER_VEHICULO.VEH_UBICACION, ''))),
      ADE_VTAFI.VTE_FORMAPAGO,
      ISNULL(prev.PREVIAS, 0)
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

function isDemoRow(row) {
  return Boolean(row.IS_DEMO) || isDemoVentaRow(row);
}

function splitFlotilla(rows) {
  const flotillas = rows.filter(isFlotilla);
  const retail = rows.filter((row) => !isFlotilla(row));
  return { flotillas, retail };
}

function splitDemos(rows) {
  const demos = [];
  const sinDemo = [];
  for (const row of rows || []) {
    if (isDemoRow(row)) demos.push(row);
    else sinDemo.push(row);
  }
  return { demos, sinDemo };
}

function normalizeVinKey(value) {
  const vin = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return vin.length >= 5 ? vin : '';
}

function fechaEnPeriodo(value, inicio, fin) {
  const fecha = parseFechaDoc(value);
  if (!fecha) return false;
  const day = new Date(fecha.year, fecha.month - 1, fecha.day, 12, 0, 0);
  const from = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), 0, 0, 0);
  const to = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 23, 59, 59, 999);
  return day >= from && day <= to;
}

/**
 * SOFIA volumen: ENTREGA del periodo + demos con timbrado de salida (SOF_DEMO · FIS EXITO)
 * en ESTE periodo. Si el timbrado fue en otro mes, ese demo NO suma a SOFIA.
 *
 * Factura: independiente. Si se facturó en el periodo DMS, cuenta en factura
 * aunque la entrega / timbrado de salida sea de otro mes.
 */
function mergeDemosTimbradoSalidaEnSofia({ demos = [], entregasRows = [], inicio, fin } = {}) {
  const demosTimbradosPeriodo = (demos || []).filter((d) => (
    fechaEnPeriodo(d.DEMO_TIMBRADO_SALIDA, inicio, fin)
  ));
  // Facturados este mes, pero sin timbrado de salida en este periodo → solo factura.
  const demosFacturaSinSofiaMes = (demos || []).filter((d) => (
    !fechaEnPeriodo(d.DEMO_TIMBRADO_SALIDA, inicio, fin)
  ));

  const vinSet = new Set();
  const factSet = new Set();
  for (const e of entregasRows || []) {
    const vin = normalizeVinKey(e.SOF_VIN || e.VTE_SERIE || e.vin || e.SERIE);
    if (vin) vinSet.add(vin);
    const fact = String(e.SOF_Factura || e.VTE_DOCTO || '').trim();
    if (fact) factSet.add(fact);
  }

  const demosYaEnSofia = [];
  for (const e of entregasRows || []) {
    const vin = normalizeVinKey(e.SOF_VIN || e.VTE_SERIE);
    const match = (demos || []).find((d) => normalizeVinKey(d.VTE_SERIE) === vin);
    if (match) demosYaEnSofia.push(match);
  }

  const demosAgregar = [];
  for (const d of demosTimbradosPeriodo) {
    const vin = normalizeVinKey(d.VTE_SERIE);
    const fact = String(d.VTE_DOCTO || '').trim();
    const ya = (vin && vinSet.has(vin)) || (fact && factSet.has(fact));
    if (!ya) demosAgregar.push(d);
  }

  const sinteticas = demosAgregar.map((d) => ({
    SOF_FechAct: d.DEMO_TIMBRADO_SALIDA || null,
    SOF_HoraAct: null,
    SOF_Factura: d.VTE_DOCTO || null,
    SOF_VIN: d.VTE_SERIE || null,
    SOF_Pedido: null,
    SOF_NoTransaccion: null,
    SOF_Estatus: 'DEMO',
    SOF_OrigenOpe: 'DEMO',
    SOF_Resultado: 'EXITO',
    SOF_CveUSu: null,
    CLIENTE: d.CLIENTE || null,
    VEH_TIPOAUTO: d.VEH_TIPOAUTO || null,
    FORMAPAGO_ORIGINAL: d.FORMAPAGO_ORIGINAL || d.VTE_FORMAPAGO || null,
    TIPOVENTA: d.TIPOVENTA || null,
    PREVIAS: Number(d.PREVIAS || 0) || 0,
    FECHA_PERIODO: d.DEMO_TIMBRADO_SALIDA || null,
    IS_DEMO: true,
    DEMO_HINT: d.DEMO_HINT || 'Demo · timbrado de salida SOF_DEMO',
    DEMO_TIMBRADO_SALIDA: d.DEMO_TIMBRADO_SALIDA || null,
    FUENTE_CONTEO: 'demo_timbrado_salida',
  }));

  const entregas = [...(entregasRows || []), ...sinteticas];
  const demosEnSofiaVins = new Set([
    ...demosYaEnSofia.map((d) => normalizeVinKey(d.VTE_SERIE)),
    ...demosAgregar.map((d) => normalizeVinKey(d.VTE_SERIE)),
  ].filter(Boolean));
  const demosEnSofia = demosEnSofiaVins.size;
  const totalSofia = entregas.length;
  const notaParts = [];
  if (demosEnSofia > 0) {
    notaParts.push(
      `Del total SOFIA (${totalSofia}), ${demosEnSofia} demo${demosEnSofia === 1 ? '' : 's'}`
      + (demosAgregar.length ? ' con timbrado de salida en el periodo' : '')
    );
  }
  if (demosFacturaSinSofiaMes.length > 0) {
    notaParts.push(
      `${demosFacturaSinSofiaMes.length} demo${demosFacturaSinSofiaMes.length === 1 ? '' : 's'}`
      + ' facturado(s) este mes sin timbrado de salida del periodo (no SOFIA)'
    );
  }
  const nota = notaParts.length ? `${notaParts.join(' · ')}.` : null;

  return {
    entregas,
    demosAgregados: sinteticas,
    demosEnSofia,
    demosTimbradosPeriodo: demosTimbradosPeriodo.length,
    demosFacturaSinSofiaMes: demosFacturaSinSofiaMes.length,
    demosOtrosMeses: demosFacturaSinSofiaMes.length,
    totalSofia,
    nota,
  };
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
  const marked = markDemoVentasRows(rows);
  const { demos, sinDemo } = splitDemos(marked);
  const { flotillas, retail } = splitFlotilla(sinDemo);
  const vendedores = new Set(sinDemo.map((r) => r.VENDEDOR));
  const clientes = new Set(sinDemo.map((r) => r.VTE_IDCLIENTE));
  const modelos = new Set(sinDemo.map((r) => r.VEH_TIPOAUTO));
  const entregasRows = sofiaEntregas.registrosEntrega ?? [];
  // Factura: si se facturó en el periodo DMS, cuenta (da igual entrega/timbrado de otro mes).
  // SOFIA: solo suma demos con timbrado de salida en ESTE periodo.
  const demosSofia = mergeDemosTimbradoSalidaEnSofia({
    demos,
    entregasRows,
    inicio,
    fin,
  });
  const entregasEfectivas = demosSofia.entregas;
  const ventasCobertura = [...sinDemo, ...demos];
  const cobertura = computeCoberturaSofia(ventasCobertura, entregasEfectivas);
  const comparativoMensual = isAcumuladoAnual(inicio, fin)
    ? buildComparativoMensual(sinDemo, inicio, fin, sofiaEntregas.entregasPorMes)
    : null;
  const demosRetail = demos.filter((r) => !isFlotilla(r)).length;
  const demosFlotilla = demos.filter((r) => isFlotilla(r)).length;
  const demosNotaSofia = demosSofia.nota;
  const demosNotaFactura = demos.length
    ? `${demos.length} demo${demos.length === 1 ? '' : 's'} en factura (por fecha de facturación)`
      + (demosSofia.demosTimbradosPeriodo
        ? ` · ${demosSofia.demosTimbradosPeriodo} con timbrado SOFIA este mes`
        : '')
      + (demosSofia.demosFacturaSinSofiaMes
        ? ` · ${demosSofia.demosFacturaSinSofiaMes} sin timbrado de este mes (igual cuentan en factura)`
        : '')
      + '.'
    : null;
  const totalFacturadas = cobertura.totalUnidadesFacturadas;
  const totalRetailConDemos = retail.length + demosRetail;
  const totalFlotillasConDemos = flotillas.length + demosFlotilla;

  return {
    totalVentas: totalFacturadas,
    totalVentasBrutas: marked.length,
    totalDemos: demos.length,
    totalDemosRetail: demosRetail,
    totalDemosFlotilla: demosFlotilla,
    totalDemosSofia: demosSofia.demosEnSofia,
    demosFacturaSinSofiaMes: demosSofia.demosFacturaSinSofiaMes,
    demosOtrosMeses: demosSofia.demosFacturaSinSofiaMes,
    demosSofiaIncluidosMesCurso: demosSofia.demosTimbradosPeriodo > 0,
    demosNota: demosNotaFactura || demosNotaSofia,
    sofiaDemosNota: demosNotaSofia,
    totalFlotillas: totalFlotillasConDemos,
    totalRetail: totalRetailConDemos,
    totalVendedores: vendedores.size,
    totalClientes: clientes.size,
    totalModelos: modelos.size,
    totalNotificacionesEntrega: cobertura.totalNotificacionesEntrega,
    totalEntregasSinPrevias: sofiaEntregas.totalEntregasSinPrevias
      ?? entregasEfectivas.filter((r) => Number(r.PREVIAS || 0) === 0).length,
    totalEntregasConPrevias: sofiaEntregas.totalEntregasConPrevias
      ?? entregasEfectivas.filter((r) => Number(r.PREVIAS || 0) > 0).length,
    totalFacturadoSinPrevias: ventasCobertura.filter((r) => Number(r.PREVIAS || 0) === 0).length,
    totalFacturadoConPrevias: ventasCobertura.filter((r) => Number(r.PREVIAS || 0) > 0).length,
    totalUnidadesFacturadas: cobertura.totalUnidadesFacturadas,
    totalUnidadesFacturadasNoTimbradas: cobertura.totalUnidadesFacturadasNoTimbradas,
    numeradorCobertura: cobertura.numeradorCobertura,
    entregasSofiaEfectivas: entregasEfectivas,
    porTipoVenta: countBy(sinDemo, 'TIPOVENTA'),
    porTipoVentaRetail: countBy(retail, 'TIPOVENTA'),
    porVendedor: countBy(sinDemo, 'VENDEDOR'),
    porVendedorRetail: countBy(retail, 'VENDEDOR'),
    porVendedorFlotilla: countBy(flotillas, 'VENDEDOR'),
    porCanal: countByCanal(sinDemo),
    porSucursal: countByCanal(sinDemo).filter((c) => c.canal !== 'PERDIDA'),
    porSucursalRetail: countByCanal(retail).filter((c) => !['FLOTILLAS', 'PERDIDA'].includes(c.canal)),
    porSucursalFlotilla: countByCanal(flotillas),
    retailDrilldown: buildRetailDrilldown(retail),
    porModelo: countBy(sinDemo, 'VEH_TIPOAUTO').slice(0, 10),
    porDia: countBy(sinDemo, 'VTE_FECHDOCTO').sort((a, b) => {
      const [da, ma, ya] = a.label.split('/').map(Number);
      const [db, mb, yb] = b.label.split('/').map(Number);
      return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
    }),
    mostrarComparativoMensual: isAcumuladoAnual(inicio, fin),
    comparativoMensual,
  };
}

async function getTomasACuenta({ fechaInicio, fechaFin }) {
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);
  const pool = await getPool();
  // Tomas por PET_FECHOPE. "Vendidas mismo mes" = el usado ya tiene pedido
  // USN_PEDIDO status I en el mismo mes calendario de la toma (no ventas de nuevos).
  const result = await pool.request()
    .input('fechaInicio', sql.Date, inicio)
    .input('fechaFin', sql.Date, fin)
    .query(`
      SELECT
        t.PET_IDPEDI AS idPedido,
        LTRIM(RTRIM(t.PET_VINTOMA)) AS vinToma,
        t.PET_FECHOPE AS fechaToma,
        LTRIM(RTRIM(ISNULL(t.PET_CVEUSU, ''))) AS usuarioToma,
        LTRIM(RTRIM(ISNULL(p.PEN_NUMSERIE, ''))) AS serieNuevo,
        LTRIM(RTRIM(ISNULL(p.PEN_MODELO, ''))) AS anModeloPedido,
        LTRIM(RTRIM(ISNULL(v.VTE_DOCTO, ''))) AS facturaNuevo,
        v.VTE_FECHDOCTO AS fechaFactura,
        LTRIM(RTRIM(
          ISNULL(cli.PER_NOMRAZON, '') + ' ' +
          ISNULL(cli.PER_PATERNO, '') + ' ' +
          ISNULL(cli.PER_MATERNO, '')
        )) AS cliente,
        LTRIM(RTRIM(
          ISNULL(vend.PER_PATERNO, '') + ' ' +
          ISNULL(vend.PER_MATERNO, '') + ' ' +
          ISNULL(vend.PER_NOMRAZON, '')
        )) AS vendedor,
        LTRIM(RTRIM(ISNULL(usn.VEH_TIPOAUTO, ''))) AS modeloToma,
        LTRIM(RTRIM(ISNULL(usn.VEH_ANMODELO, ''))) AS anModeloToma,
        usn.VEH_TOMAIMPADQUI AS importeAdquisicion,
        usn.VEH_TOMAIMPVEHICULO AS importeVehiculo,
        LTRIM(RTRIM(ISNULL(nuevo.VEH_TIPOAUTO, ''))) AS modeloNuevo,
        LTRIM(RTRIM(ISNULL(nuevo.VEH_ANMODELO, ''))) AS anModeloNuevo,
        ventaUsado.PMS_NUMPEDIDO AS pedidoUsn,
        ventaUsado.PMS_FECHOPE AS fechaVentaUsado,
        ventaUsado.PMS_TOTAL AS montoVentaUsado,
        LTRIM(RTRIM(
          ISNULL(cliUsado.PER_NOMRAZON, '') + ' ' +
          ISNULL(cliUsado.PER_PATERNO, '') + ' ' +
          ISNULL(cliUsado.PER_MATERNO, '')
        )) AS clienteUsado,
        LTRIM(RTRIM(
          ISNULL(vendUsado.PER_PATERNO, '') + ' ' +
          ISNULL(vendUsado.PER_MATERNO, '') + ' ' +
          ISNULL(vendUsado.PER_NOMRAZON, '')
        )) AS vendedorUsado
      FROM UNI_PEDITOMAUNI t
      LEFT JOIN UNI_PEDIUNI p
        ON p.PEN_IDPEDI = t.PET_IDPEDI
      OUTER APPLY (
        SELECT TOP 1
          fv.VTE_DOCTO,
          fv.VTE_FECHDOCTO,
          fv.VTE_IDCLIENTE
        FROM ADE_VTAFI fv
        WHERE p.PEN_NUMSERIE IS NOT NULL
          AND LTRIM(RTRIM(p.PEN_NUMSERIE)) <> ''
          AND UPPER(LTRIM(RTRIM(fv.VTE_SERIE))) = UPPER(LTRIM(RTRIM(p.PEN_NUMSERIE)))
          AND fv.VTE_TIPODOCTO = 'A'
          AND fv.VTE_STATUS = 'I'
        ORDER BY CONVERT(DATE, fv.VTE_FECHDOCTO, 103) DESC
      ) v
      LEFT JOIN PER_PERSONAS cli
        ON cli.PER_IDPERSONA = v.VTE_IDCLIENTE
      LEFT JOIN SER_VEHICULO nuevo
        ON p.PEN_NUMSERIE IS NOT NULL
        AND LTRIM(RTRIM(p.PEN_NUMSERIE)) <> ''
        AND UPPER(LTRIM(RTRIM(nuevo.VEH_NUMSERIE))) = UPPER(LTRIM(RTRIM(p.PEN_NUMSERIE)))
        AND nuevo.VEH_NOINVENTA > 0
      LEFT JOIN PER_PERSONAS vend
        ON vend.PER_IDPERSONA = nuevo.VEH_VENDEDOR
      LEFT JOIN SER_VEHICULO usn
        ON UPPER(LTRIM(RTRIM(usn.VEH_NUMSERIE))) = UPPER(LTRIM(RTRIM(t.PET_VINTOMA)))
      OUTER APPLY (
        SELECT TOP 1
          u.PMS_NUMPEDIDO,
          u.PMS_FECHOPE,
          u.PMS_TOTAL,
          u.PMS_IDPERSONA,
          u.PMS_VENDEDOR
        FROM USN_PEDIDO u
        WHERE UPPER(LTRIM(RTRIM(u.PMS_NUMSERIE))) = UPPER(LTRIM(RTRIM(t.PET_VINTOMA)))
          AND ISNULL(u.PMS_STATUS, '') = 'I'
          AND YEAR(CONVERT(DATE, u.PMS_FECHOPE, 103)) = YEAR(CONVERT(DATE, t.PET_FECHOPE, 103))
          AND MONTH(CONVERT(DATE, u.PMS_FECHOPE, 103)) = MONTH(CONVERT(DATE, t.PET_FECHOPE, 103))
        ORDER BY CONVERT(DATE, u.PMS_FECHOPE, 103) ASC, u.PMS_NUMPEDIDO ASC
      ) ventaUsado
      LEFT JOIN PER_PERSONAS cliUsado
        ON cliUsado.PER_IDPERSONA = ventaUsado.PMS_IDPERSONA
      LEFT JOIN PER_PERSONAS vendUsado
        ON LTRIM(RTRIM(CONVERT(VARCHAR(20), vendUsado.PER_IDPERSONA))) = LTRIM(RTRIM(ISNULL(ventaUsado.PMS_VENDEDOR, '')))
      WHERE LTRIM(RTRIM(ISNULL(t.PET_VINTOMA, ''))) <> ''
        AND CONVERT(DATE, t.PET_FECHOPE, 103) BETWEEN @fechaInicio AND @fechaFin
    `);

  const seen = new Set();
  const registros = [];
  for (const row of result.recordset || []) {
    const vinKey = String(row.vinToma || '').trim().toUpperCase();
    const key = `${row.idPedido}|${vinKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const vendidoMismoMes = row.pedidoUsn != null && row.pedidoUsn !== '';
    registros.push({
      idPedido: row.idPedido,
      vinToma: String(row.vinToma || '').trim(),
      fechaToma: row.fechaToma || null,
      usuarioToma: String(row.usuarioToma || '').trim() || null,
      serieNuevo: String(row.serieNuevo || '').trim(),
      facturaNuevo: String(row.facturaNuevo || '').trim() || null,
      fechaFactura: row.fechaFactura || null,
      cliente: String(row.cliente || '').replace(/\s+/g, ' ').trim() || null,
      vendedor: String(row.vendedor || '').replace(/\s+/g, ' ').trim() || null,
      modeloToma: String(row.modeloToma || '').trim() || null,
      anModeloToma: String(row.anModeloToma || '').trim() || null,
      modeloNuevo: String(row.modeloNuevo || '').trim() || null,
      anModeloNuevo: String(row.anModeloNuevo || row.anModeloPedido || '').trim() || null,
      importeAdquisicion: row.importeAdquisicion != null ? Number(row.importeAdquisicion) : null,
      importeVehiculo: row.importeVehiculo != null ? Number(row.importeVehiculo) : null,
      vendidoMismoMes,
      pedidoUsn: row.pedidoUsn != null ? Number(row.pedidoUsn) : null,
      fechaVentaUsado: row.fechaVentaUsado || null,
      montoVentaUsado: row.montoVentaUsado != null ? Number(row.montoVentaUsado) : null,
      clienteUsado: String(row.clienteUsado || '').replace(/\s+/g, ' ').trim() || null,
      vendedorUsado: String(row.vendedorUsado || '').replace(/\s+/g, ' ').trim() || null,
    });
  }

  registros.sort((a, b) => {
    if (Boolean(b.vendidoMismoMes) !== Boolean(a.vendidoMismoMes)) {
      return a.vendidoMismoMes ? -1 : 1;
    }
    const pa = parseFechaDoc(a.fechaToma) || parseFechaDoc(a.fechaFactura);
    const pb = parseFechaDoc(b.fechaToma) || parseFechaDoc(b.fechaFactura);
    const da = pa ? Date.UTC(pa.year, pa.month - 1, pa.day) : 0;
    const db = pb ? Date.UTC(pb.year, pb.month - 1, pb.day) : 0;
    if (db !== da) return db - da;
    return Number(b.idPedido || 0) - Number(a.idPedido || 0);
  });

  const montoTotal = registros.reduce((s, r) => s + (Number(r.importeVehiculo) || 0), 0);
  const montoAdquisicion = registros.reduce((s, r) => s + (Number(r.importeAdquisicion) || 0), 0);
  const montoVentasUsado = registros.reduce((s, r) => s + (Number(r.montoVentaUsado) || 0), 0);
  const totalVendidosMismoMes = registros.filter((r) => r.vendidoMismoMes).length;
  const porModeloToma = {};
  for (const r of registros) {
    const key = String(r.modeloToma || 'Sin modelo').trim() || 'Sin modelo';
    porModeloToma[key] = (porModeloToma[key] || 0) + 1;
  }

  const porMes = buildTomasPorMes(registros, inicio, fin);

  return {
    total: registros.length,
    totalVendidosMismoMes,
    pctVendidosMismoMes: registros.length > 0
      ? Math.round((totalVendidosMismoMes / registros.length) * 1000) / 10
      : 0,
    montoTotal: Math.round(montoTotal * 100) / 100,
    montoAdquisicion: Math.round(montoAdquisicion * 100) / 100,
    montoVentasUsado: Math.round(montoVentasUsado * 100) / 100,
    porModeloToma: Object.entries(porModeloToma)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    porMes,
    registros,
  };
}

function buildTomasPorMes(registros, inicio, fin) {
  const monthRange = buildMonthRange(inicio, fin);
  const buckets = Object.fromEntries(
    monthRange.map((m) => [m.key, { key: m.key, label: MESES[m.month - 1], month: m.month, year: m.year, tomados: 0, vendidos: 0 }])
  );

  for (const r of registros || []) {
    const parsed = parseFechaDoc(r.fechaToma);
    if (!parsed || !buckets[parsed.monthKey]) continue;
    buckets[parsed.monthKey].tomados += 1;
    if (r.vendidoMismoMes) buckets[parsed.monthKey].vendidos += 1;
  }

  const meses = monthRange.map((m) => buckets[m.key]);
  const totalTomados = meses.reduce((s, m) => s + m.tomados, 0);
  const totalVendidos = meses.reduce((s, m) => s + m.vendidos, 0);

  return {
    labels: meses.map((m) => m.label),
    series: {
      tomados: meses.map((m) => m.tomados),
      vendidos: meses.map((m) => m.vendidos),
    },
    meses,
    totalTomados,
    totalVendidos,
    pctVendidos: totalTomados > 0
      ? Math.round((totalVendidos / totalTomados) * 1000) / 10
      : 0,
  };
}

const VENTAS_SOFIA_CORE_TTL_MS = 5 * 60 * 1000;
const ventasSofiaCoreCache = new Map();
const ventasSofiaCoreInflight = new Map();

/**
 * Núcleo compartido: facturas DMS + entregas SOFIA del periodo.
 * Usado por /api/ventas y por el dashboard de financiamiento para pintar todo de una vez.
 */
async function getVentasSofiaCore({ fechaInicio, fechaFin, incluirPorMes = false, fresh = false } = {}) {
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);
  if (inicio > fin) {
    throw new Error('La fecha inicial no puede ser mayor que la fecha final.');
  }

  const cacheKey = `${fechaInicio}|${fechaFin}|${incluirPorMes ? 1 : 0}`;
  if (fresh) {
    ventasSofiaCoreCache.delete(cacheKey);
  } else {
    const hit = ventasSofiaCoreCache.get(cacheKey);
    if (hit && (Date.now() - hit.at) < VENTAS_SOFIA_CORE_TTL_MS) {
      return hit.data;
    }
  }
  if (ventasSofiaCoreInflight.has(cacheKey)) {
    return ventasSofiaCoreInflight.get(cacheKey);
  }

  const promise = (async () => {
    const pool = await getPool();
    pool.config.requestTimeout = 120000;
    const request = pool.request();
    request.input('fechaInicio', sql.Date, inicio);
    request.input('fechaFin', sql.Date, fin);

    const [result, sofiaEntregas] = await Promise.all([
      request.query(buildVentasQuery()),
      getNotificacionesEntrega({ fechaInicio, fechaFin, incluirPorMes, fresh }),
    ]);

    const data = {
      registros: await annotateDemosFromSofDemo(
        markDemoVentasRows(enrichVentasRows(result.recordset)),
      ),
      sofiaEntregas,
      entregasSofia: sofiaEntregas.registrosEntrega ?? [],
    };
    ventasSofiaCoreCache.set(cacheKey, { at: Date.now(), data });
    return data;
  })();

  ventasSofiaCoreInflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    ventasSofiaCoreInflight.delete(cacheKey);
  }
}

async function getVentas({ fechaInicio, fechaFin, fresh = false } = {}) {
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);

  if (inicio > fin) {
    throw new Error('La fecha inicial no puede ser mayor que la fecha final.');
  }

  const incluirPorMes = isAcumuladoAnual(inicio, fin);
  const ytdRanges = buildYtdRanges(fechaFin);
  const sameAsYtd = fechaInicio === ytdRanges.inicioActual && fechaFin === ytdRanges.finActual;

  const [core, comparativoYtd, inventorySnap, utilidadCarline, tomasACuenta, tomasYtdRaw] = await Promise.all([
    getVentasSofiaCore({ fechaInicio, fechaFin, incluirPorMes, fresh }),
    getComparativoYtd(fechaFin),
    getInventory({ planPisoPeriod: 'all' }).catch(() => null),
    getMejorUtilidadPorCarline({
      fechaInicio: ytdRanges.inicioActual,
      fechaFin: ytdRanges.finActual,
      metric: 'utilidad_promedio',
      minUnidades: 1,
    }).catch((err) => {
      console.warn('[ventas] utilidad carline:', err.message);
      return { available: false, reason: err.message, porCarline: [] };
    }),
    getTomasACuenta({ fechaInicio, fechaFin }).catch((err) => {
      console.warn('[ventas] tomas a cuenta:', err.message);
      return { total: 0, montoTotal: 0, registros: [], porMes: null, error: err.message };
    }),
    sameAsYtd
      ? Promise.resolve(null)
      : getTomasACuenta({
        fechaInicio: ytdRanges.inicioActual,
        fechaFin: ytdRanges.finActual,
      }).catch((err) => {
        console.warn('[ventas] tomas mensual YTD:', err.message);
        return { total: 0, registros: [], porMes: null, error: err.message };
      }),
  ]);

  const rows = core.registros;
  const sofiaEntregas = core.sofiaEntregas;
  const resumen = summarizeVentas(rows, inicio, fin, sofiaEntregas);
  resumen.unidadesApartadas = Number(inventorySnap?.summary?.availableApartadas ?? 0);
  resumen.totalTomasACuenta = Number(tomasACuenta.total || 0);
  resumen.montoTomasACuenta = Number(tomasACuenta.montoTotal || 0);
  resumen.montoAdquisicionTomas = Number(tomasACuenta.montoAdquisicion || 0);
  resumen.totalTomasVendidasMismoMes = Number(tomasACuenta.totalVendidosMismoMes || 0);
  resumen.montoTomasVendidasMismoMes = Number(tomasACuenta.montoVentasUsado || 0);
  resumen.pctTomasVendidasMismoMes = Number(tomasACuenta.pctVendidosMismoMes || 0);
  // Compat: ya no es % de ventas nuevas con toma, sino % de tomas revendidas el mismo mes.
  resumen.pctVentasConToma = resumen.pctTomasVendidasMismoMes;

  const tomasChartSource = sameAsYtd ? tomasACuenta : (tomasYtdRaw || tomasACuenta);
  const tomasMensual = tomasChartSource.porMes || buildTomasPorMes(
    tomasChartSource.registros || [],
    parseDateInput(ytdRanges.inicioActual),
    parseDateInput(ytdRanges.finActual)
  );

  return {
    filtros: { fechaInicio, fechaFin },
    resumen,
    comparativoYtd,
    utilidadCarline,
    registros: rows,
    entregasSofia: resumen.entregasSofiaEfectivas || sofiaEntregas.registrosEntrega || [],
    tomasACuenta: tomasACuenta.registros || [],
    tomasMensual: {
      anio: ytdRanges.anioActual,
      corte: ytdRanges.corte,
      mesEnCursoExcluido: ytdRanges.mesEnCursoExcluido,
      ...tomasMensual,
    },
    tomasACuentaMeta: {
      porModeloToma: tomasACuenta.porModeloToma || [],
      montoAdquisicion: tomasACuenta.montoAdquisicion || 0,
      totalVendidosMismoMes: tomasACuenta.totalVendidosMismoMes || 0,
      pctVendidosMismoMes: tomasACuenta.pctVendidosMismoMes || 0,
      montoVentasUsado: tomasACuenta.montoVentasUsado || 0,
    },
  };
}

module.exports = {
  getVentas,
  getVentasSofiaCore,
  getTomasACuenta,
  parseDateInput,
  clearVentasSofiaCaches() {
    ventasSofiaCoreCache.clear();
    ventasSofiaCoreInflight.clear();
    try {
      require('./sofia-entregas').clearEntregasCache();
    } catch {
      /* ignore */
    }
  },
};
