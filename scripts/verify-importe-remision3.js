require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const sums = await query(`
    SELECT
      vd.VHD_NOSERIE,
      SUM(CASE WHEN vd.VHD_COSTO > 0 THEN vd.VHD_COSTO ELSE 0 END) AS sumCosto,
      SUM(CASE WHEN vd.VHD_DESCRIPCION = 'VALOR DE LA UNIDAD' THEN vd.VHD_COSTO ELSE 0 END) AS valorUnidad,
      SUM(CASE WHEN vd.VHD_DESCRIPCION = 'GASTOS' THEN vd.VHD_COSTO ELSE 0 END) AS gastos,
      MAX(veh.VEH_VENTA) AS vehVenta,
      MAX(cat.UNC_PRECLISTA) AS precioLista
    FROM UNI_VEHDETA vd
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = vd.VHD_NOSERIE
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE veh.VEH_SITUACION = 'FIS'
    GROUP BY vd.VHD_NOSERIE
    ORDER BY sumCosto DESC
  `);
  console.log('FIS sums TOP 5:', JSON.stringify(sums.slice(0, 5), null, 2));

  const known = sums.filter((r) =>
    ['LSGEN5304TD050997', 'KL77L6E22TC119316', 'LZWLLNGL5PB033170'].includes(r.VHD_NOSERIE)
  );
  console.log('\nKnown VINs:', JSON.stringify(known, null, 2));

  const costoRem = await query(`
    SELECT TOP 5 *
    FROM UNI_TEMLIBROVENTAS
    WHERE CostoRemision IS NOT NULL AND CostoRemision > 0
    ORDER BY CostoRemision DESC
  `);
  console.log('\nLibro CostoRemision cols sample:', costoRem.length ? Object.keys(costoRem[0]) : []);
  console.log('Libro sample:', JSON.stringify(costoRem.slice(0, 2), null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
