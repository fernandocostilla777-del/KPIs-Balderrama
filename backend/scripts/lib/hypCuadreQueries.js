/**
 * Plantillas SQL del Cuadre de Órdenes HyP (cuadreOrdenesHyp).
 * Cuentas 0470/0476/0477/0479 · POL_REFERENCIA1 = docto, POL_REFERENCIA2 = orden.
 */

function parsePeriodo(fechaInicio) {
  const d = new Date(`${fechaInicio}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${fechaInicio}`);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Movimientos Contpaq VS/DVS del mes por cuenta HyP. */
function sqlMovdetHyp(year, month) {
  const mov = `CON_MOVDET01${year}`;
  const pol = `CON_POL01${year}`;
  return `
SELECT
  LEFT(LTRIM(RTRIM(m.MOV_NUMCTA)), 4) AS cuenta,
  LTRIM(RTRIM(p.POL_REFERENCIA2)) AS orden,
  LTRIM(RTRIM(p.POL_REFERENCIA1)) AS docto,
  m.MOV_TIPOPOL AS tipo,
  (ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0)) AS neto
FROM [${mov}] m
INNER JOIN [${pol}] p
  ON p.POL_TIPO = m.MOV_TIPOPOL
  AND p.POL_CONSECUTIVO = m.MOV_CONSPOL
  AND p.POL_MES = m.MOV_MES
WHERE m.MOV_MES = ${month}
  AND m.MOV_TIPOPOL IN ('VS', 'DVS')
  AND (
    LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0470-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0476-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0477-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0479-0001%'
  )
  AND ABS(ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0)) > 0.001
ORDER BY cuenta, docto, orden, neto DESC;
`.trim();
}

/** Componentes DMS por docto (SRV/S000) referenciado en pólizas. */
function sqlDmsComponentes(doctos) {
  if (!doctos.length) return '-- sin doctos';
  const inList = doctos.map((d) => `'${String(d).replace(/'/g, "''")}'`).join(', ');
  return `
SELECT
  v.VTE_DOCTO AS docto,
  LTRIM(RTRIM(v.VTE_REFERENCIA1)) AS orden,
  v.VTE_STATUS AS st,
  v.VTE_FECHDOCTO AS facFecha,
  UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS vin,
  o.ORE_FECHACIE AS cierre,
  LEFT(LTRIM(RTRIM(v.VTE_REFERENCIA1)), 1) AS letra,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'HP' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS hp,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'PI' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS pi,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'VA' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS va,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'RE' THEN d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD ELSE 0 END) AS re,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'TTHP' THEN d.VTD_PRECIOUNITARIO ELSE 0 END) AS tthp,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'VA' AND d.VTD_CANTIDAD = 0
    THEN d.VTD_PRECIOUNITARIO ELSE 0 END) AS vaPu,
  SUM(CASE WHEN UPPER(LTRIM(RTRIM(d.VTD_CLASIFIC))) = 'MOI' THEN d.VTD_PRECIOUNITARIO ELSE 0 END) AS moi
FROM ADE_VTAFI v
INNER JOIN ADE_VTAFIDET d ON d.VTD_IDDOCTO = v.VTE_DOCTO
LEFT JOIN SER_ORDEN o ON LTRIM(RTRIM(v.VTE_REFERENCIA1)) = LTRIM(RTRIM(o.ORE_IDORDEN))
WHERE v.VTE_STATUS IN ('I', 'C')
  AND v.VTE_TIPODOCTO LIKE 'S%'
  AND v.VTE_DOCTO IN (${inList})
GROUP BY v.VTE_DOCTO, v.VTE_REFERENCIA1, v.VTE_STATUS, v.VTE_FECHDOCTO,
  o.ORE_NUMSERIE, o.ORE_FECHACIE, o.ORE_IDORDEN
ORDER BY v.VTE_DOCTO;
`.trim();
}

/** Matriz por factura — alineada al Excel (status DMS, filtros I/C, orden desde póliza). */
function sqlMatrizPorFactura(year, month) {
  const mov = `CON_MOVDET01${year}`;
  const pol = `CON_POL01${year}`;
  return `
SELECT
  LTRIM(RTRIM(p.POL_REFERENCIA2)) AS orden,
  LTRIM(RTRIM(p.POL_REFERENCIA1)) AS factura,
  v.VTE_STATUS AS status,
  v.VTE_FECHDOCTO AS facFecha,
  UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS vin,
  o.ORE_FECHACIE AS cierre,
  LEFT(LTRIM(RTRIM(p.POL_REFERENCIA2)), 1) AS letra,
  SUM(CASE WHEN LEFT(LTRIM(RTRIM(m.MOV_NUMCTA)), 4) = '0477' THEN ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0) ELSE 0 END) AS [0477],
  SUM(CASE WHEN LEFT(LTRIM(RTRIM(m.MOV_NUMCTA)), 4) = '0470' THEN ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0) ELSE 0 END) AS [0470],
  SUM(CASE WHEN LEFT(LTRIM(RTRIM(m.MOV_NUMCTA)), 4) = '0479' THEN ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0) ELSE 0 END) AS [0479],
  SUM(CASE WHEN LEFT(LTRIM(RTRIM(m.MOV_NUMCTA)), 4) = '0476' THEN ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0) ELSE 0 END) AS [0476],
  SUM(ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0)) AS neto
FROM [${mov}] m
INNER JOIN [${pol}] p
  ON p.POL_TIPO = m.MOV_TIPOPOL
  AND p.POL_CONSECUTIVO = m.MOV_CONSPOL
  AND p.POL_MES = m.MOV_MES
INNER JOIN ADE_VTAFI v
  ON v.VTE_DOCTO = LTRIM(RTRIM(p.POL_REFERENCIA1))
LEFT JOIN SER_ORDEN o
  ON LTRIM(RTRIM(v.VTE_REFERENCIA1)) = LTRIM(RTRIM(o.ORE_IDORDEN))
WHERE m.MOV_MES = ${month}
  AND m.MOV_TIPOPOL IN ('VS', 'DVS')
  AND (
    LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0470-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0476-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0477-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0479-0001%'
  )
  AND v.VTE_STATUS IN ('I', 'C')
  AND v.VTE_TIPODOCTO LIKE 'S%'
GROUP BY
  LTRIM(RTRIM(p.POL_REFERENCIA2)),
  LTRIM(RTRIM(p.POL_REFERENCIA1)),
  v.VTE_STATUS,
  v.VTE_FECHDOCTO,
  UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))),
  o.ORE_NUMSERIE,
  o.ORE_FECHACIE
HAVING ABS(SUM(ISNULL(m.MOV_HABER, 0) - ISNULL(m.MOV_DEBE, 0))) > 0.01
ORDER BY vin, orden, factura;
`.trim();
}

/** VINs únicos con movimiento Contpaq HyP en el mes. */
function sqlVinsUnicosMes(year, month) {
  const mov = `CON_MOVDET01${year}`;
  const pol = `CON_POL01${year}`;
  return `
SELECT DISTINCT UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS vin
FROM [${mov}] m
INNER JOIN [${pol}] p
  ON p.POL_TIPO = m.MOV_TIPOPOL
  AND p.POL_CONSECUTIVO = m.MOV_CONSPOL
  AND p.POL_MES = m.MOV_MES
INNER JOIN ADE_VTAFI v ON v.VTE_DOCTO = LTRIM(RTRIM(p.POL_REFERENCIA1))
INNER JOIN SER_ORDEN o ON LTRIM(RTRIM(v.VTE_REFERENCIA1)) = LTRIM(RTRIM(o.ORE_IDORDEN))
WHERE m.MOV_MES = ${month}
  AND m.MOV_TIPOPOL IN ('VS', 'DVS')
  AND (
    LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0470-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0476-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0477-0001%'
    OR LTRIM(RTRIM(m.MOV_NUMCTA)) LIKE '0479-0001%'
  )
  AND o.ORE_NUMSERIE IS NOT NULL
  AND LTRIM(RTRIM(o.ORE_NUMSERIE)) <> ''
ORDER BY vin;
`.trim();
}

function generarConsultas(fechaInicio, doctos = []) {
  const { year, month } = parsePeriodo(fechaInicio);
  return {
    periodo: { fechaInicio, year, month },
    movdetHyp: sqlMovdetHyp(year, month),
    dmsComponentes: sqlDmsComponentes(doctos),
    matrizPorFactura: sqlMatrizPorFactura(year, month),
    vinsUnicos: sqlVinsUnicosMes(year, month),
  };
}

module.exports = {
  parsePeriodo,
  sqlMovdetHyp,
  sqlDmsComponentes,
  sqlMatrizPorFactura,
  sqlVinsUnicosMes,
  generarConsultas,
};
