require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const rows = await query(`
    WITH rem AS (
      SELECT
        vd.VHD_NOSERIE,
        SUM(CASE WHEN ISNULL(vd.VHD_TRASPLANPISO, '') = 'S' THEN ISNULL(vd.VHD_COSTO, 0) ELSE 0 END) AS importeRemision
      FROM UNI_VEHDETA vd
      GROUP BY vd.VHD_NOSERIE
    )
    SELECT TOP 10
      veh.VEH_NUMSERIE,
      rem.importeRemision,
      ROUND(rem.importeRemision * 1.16, 2) AS remConIva,
      veh.VEH_VENTA,
      cat.UNC_PRECLISTA
    FROM SER_VEHICULO veh
    INNER JOIN rem ON rem.VHD_NOSERIE = veh.VEH_NUMSERIE
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE veh.VEH_SITUACION = 'FIS'
      AND rem.importeRemision > 0
    ORDER BY veh.VEH_FECREMISION DESC
  `);
  for (const r of rows) {
    r.matchVenta = Math.abs(Number(r.VEH_VENTA) - Number(r.importeRemision)) < 1 ? 'exactRem'
      : Math.abs(Number(r.VEH_VENTA) - Number(r.remConIva)) < 500 ? 'ivaRem'
      : 'other';
  }
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
