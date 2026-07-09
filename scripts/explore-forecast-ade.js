require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const monthly = await query(`
    SELECT TOP 48
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS yr,
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS mo,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
    GROUP BY
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)),
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103))
    ORDER BY yr DESC, mo DESC
  `);
  console.log(JSON.stringify(monthly, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
