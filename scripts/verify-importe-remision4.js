require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const rows = await query(`
    SELECT
      vd.VHD_NOSERIE,
      vd.VHD_DESCRIPCION,
      vd.VHD_TIPO,
      vd.VHD_COSTO,
      vd.VHD_COSTOMONORI,
      vd.VHD_TRASPLANPISO,
      vd.VHD_REMISION
    FROM UNI_VEHDETA vd
    WHERE vd.VHD_NOSERIE = 'LSGEN5304TD050997'
      AND vd.VHD_COSTO > 0
    ORDER BY vd.VHD_COSTO DESC
  `);
  console.log(JSON.stringify(rows, null, 2));

  const planSum = await query(`
    SELECT
      vd.VHD_NOSERIE,
      SUM(CASE WHEN ISNULL(vd.VHD_TRASPLANPISO, '') = 'S' THEN vd.VHD_COSTO ELSE 0 END) AS planPisoCosto,
      SUM(vd.VHD_COSTO) AS totalCosto
    FROM UNI_VEHDETA vd
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = vd.VHD_NOSERIE
    WHERE veh.VEH_SITUACION = 'FIS'
    GROUP BY vd.VHD_NOSERIE
    HAVING SUM(CASE WHEN ISNULL(vd.VHD_TRASPLANPISO, '') = 'S' THEN vd.VHD_COSTO ELSE 0 END) > 0
  `);
  console.log('\nTRASPLANPISO=S count:', planSum.length);
  console.log('Sample:', JSON.stringify(planSum.slice(0, 3), null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
