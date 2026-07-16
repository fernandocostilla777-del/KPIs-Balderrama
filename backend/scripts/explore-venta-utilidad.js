require('dotenv').config();
const { query } = require('../src/db');

async function main() {
  const agg = await query(`
    SELECT
      COUNT(*) AS units,
      SUM(lv.SUBTOTAL) AS subtotal,
      SUM(COALESCE(NULLIF(lv.COSTO, 0), lv.pen_costo1 - ISNULL(lv.BONIFICACION, 0) - ISNULL(lv.PARTICIPACION, 0))) AS costoNeto,
      SUM(lv.SUBTOTAL - COALESCE(NULLIF(lv.COSTO, 0), lv.pen_costo1 - ISNULL(lv.BONIFICACION, 0) - ISNULL(lv.PARTICIPACION, 0)) - ISNULL(lv.VEH_MISELANEOS, 0)) AS utilidad
    FROM UNI_TEMLIBROVENTAS lv
    INNER JOIN ADE_VTAFI v ON v.VTE_DOCTO = lv.VTE_DOCTO AND v.VTE_TIPODOCTO = 'A'
    WHERE lv.VTE_ORGSTATUS = 'I'
      AND v.VTE_STATUS = 'I'
      AND v.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
      AND CONVERT(DATE, lv.VTE_FECHDOCTO, 103) >= '2026-07-01'
      AND CONVERT(DATE, lv.VTE_FECHDOCTO, 103) <= '2026-07-31'
  `);
  console.log('Joined agg:', agg[0]);

  const adeOnly = await query(`
    SELECT COUNT(*) n FROM ADE_VTAFI v
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = v.VTE_SERIE AND veh.VEH_NOINVENTA > 0
    WHERE v.VTE_TIPODOCTO='A' AND v.VTE_STATUS='I' AND veh.VEH_SITUACION='VEN'
      AND v.VTE_FORMAPAGO NOT IN ('VENTAMRS','VTACON')
      AND CONVERT(DATE,v.VTE_FECHDOCTO,103) BETWEEN '2026-07-01' AND '2026-07-31'
  `);
  console.log('ADE count:', adeOnly[0]);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
