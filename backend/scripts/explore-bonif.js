require('dotenv').config({ override: true });
const { query } = require('../src/db');

(async () => {
  const cols = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UNI_TEMLIBROVENTAS'
      AND (COLUMN_NAME LIKE '%DESC%' OR COLUMN_NAME LIKE '%BON%' OR COLUMN_NAME LIKE '%REBA%')
  `);
  console.log('cols', cols.map((c) => c.COLUMN_NAME));

  const s = await query(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN ISNULL(lv.BONIFICACION, 0) > 0 THEN 1 ELSE 0 END) AS conBon,
      SUM(CASE WHEN ISNULL(veh.VEH_REBATE, 0) > 0 THEN 1 ELSE 0 END) AS conRebate,
      SUM(ISNULL(lv.BONIFICACION, ISNULL(veh.VEH_REBATE, 0))) AS totalBon
    FROM ADE_VTAFI v
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = v.VTE_SERIE AND veh.VEH_NOINVENTA > 0
    LEFT JOIN UNI_TEMLIBROVENTAS lv ON lv.VTE_DOCTO = v.VTE_DOCTO AND lv.VTE_ORGSTATUS = 'I'
    WHERE v.VTE_TIPODOCTO = 'A' AND v.VTE_STATUS = 'I' AND veh.VEH_SITUACION = 'VEN'
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) BETWEEN '2026-01-01' AND '2026-06-30'
  `);
  console.log('bon stats', s[0]);

  const cost0 = await query(`
    SELECT COUNT(*) AS n
    FROM ADE_VTAFI v
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = v.VTE_SERIE AND veh.VEH_NOINVENTA > 0
    LEFT JOIN UNI_TEMLIBROVENTAS lv ON lv.VTE_DOCTO = v.VTE_DOCTO AND lv.VTE_ORGSTATUS = 'I'
    WHERE v.VTE_TIPODOCTO = 'A' AND v.VTE_STATUS = 'I'
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) BETWEEN '2026-01-01' AND '2026-06-30'
      AND COALESCE(NULLIF(lv.COSTO, 0), NULLIF(veh.VEH_COSTO1, 0), 0) = 0
  `);
  console.log('sin costo', cost0[0]);

  const pen = await query(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN ISNULL(lv.pen_bonificacion, 0) > 0 THEN 1 ELSE 0 END) AS conPen,
      SUM(ISNULL(lv.pen_bonificacion, 0)) AS totalPen,
      SUM(ISNULL(lv.IMPNCRBON, 0)) AS totalImp
    FROM UNI_TEMLIBROVENTAS lv
    INNER JOIN ADE_VTAFI v ON v.VTE_DOCTO = lv.VTE_DOCTO
    WHERE lv.VTE_ORGSTATUS = 'I'
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) BETWEEN '2026-01-01' AND '2026-06-30'
  `);
  console.log('pen_bonificacion', pen[0]);

  const descProxy = await query(`
    SELECT TOP 5
      ISNULL(lv.pen_costo1, veh.VEH_COSTO1) AS miCosto,
      ISNULL(lv.COSTO, 0) AS costoNeto,
      ISNULL(lv.pen_bonificacion, 0) AS penBon,
      ISNULL(lv.BONIFICACION, 0) AS bon,
      ISNULL(lv.VEH_MISELANEOS, ISNULL(veh.VEH_MISELANEOS, 0)) AS gastos
    FROM ADE_VTAFI v
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = v.VTE_SERIE
    LEFT JOIN UNI_TEMLIBROVENTAS lv ON lv.VTE_DOCTO = v.VTE_DOCTO AND lv.VTE_ORGSTATUS = 'I'
    WHERE CONVERT(DATE, v.VTE_FECHDOCTO, 103) BETWEEN '2026-01-01' AND '2026-06-30'
      AND ISNULL(lv.pen_costo1, veh.VEH_COSTO1) > ISNULL(lv.COSTO, 0)
  `);
  console.log('desc proxy sample', descProxy);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
