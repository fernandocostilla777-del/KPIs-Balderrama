require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const rows = await query(`
    SELECT
      vd.VHD_COSTO,
      vd.VHD_APLICAIVA,
      vd.VHD_DESCRIPCION,
      vd.VHD_TRASPLANPISO
    FROM UNI_VEHDETA vd
    WHERE vd.VHD_NOSERIE = 'LSGEN5304TD050997'
      AND ISNULL(vd.VHD_TRASPLANPISO, '') = 'S'
      AND vd.VHD_COSTO > 0
  `);

  let base = 0;
  let withIva = 0;
  for (const r of rows) {
    const costo = Number(r.VHD_COSTO) || 0;
    base += costo;
    const iva = String(r.VHD_APLICAIVA || '').trim().toUpperCase() === 'S' ? costo * 0.16 : 0;
    withIva += costo + iva;
  }

  const veh = await query(`
    SELECT VEH_VENTA FROM SER_VEHICULO WHERE VEH_NUMSERIE = 'LSGEN5304TD050997'
  `);

  console.log({ rows, base, withIva, vehVenta: veh[0]?.VEH_VENTA });

  const agg = await query(`
    SELECT
      vd.VHD_NOSERIE,
      SUM(CASE WHEN ISNULL(vd.VHD_TRASPLANPISO,'')='S' THEN ISNULL(vd.VHD_COSTO,0) ELSE 0 END) AS base,
      SUM(CASE WHEN ISNULL(vd.VHD_TRASPLANPISO,'')='S' THEN
        ISNULL(vd.VHD_COSTO,0) + CASE WHEN ISNULL(vd.VHD_APLICAIVA,'')='S' THEN ISNULL(vd.VHD_COSTO,0)*0.16 ELSE 0 END
      ELSE 0 END) AS withIva
    FROM UNI_VEHDETA vd
    WHERE vd.VHD_NOSERIE IN ('LSGEN5304TD050997','LZWLLNGL5PB033170')
    GROUP BY vd.VHD_NOSERIE
  `);
  console.log('\nAgg:', JSON.stringify(agg, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
