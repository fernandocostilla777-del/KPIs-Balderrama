require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const cols = await query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME LIKE '%REM%'
       OR COLUMN_NAME LIKE '%ImpRem%'
       OR COLUMN_NAME LIKE '%IMPCOST%'
       OR COLUMN_NAME LIKE '%MONTOPAGO%'
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  console.log('Columnas REM/MONTOPAGO:', cols);

  const bi = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'BI_INVENTARIO_NUEVOS'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('\nBI_INVENTARIO_NUEVOS:', bi.map((c) => c.COLUMN_NAME).join(', '));

  const sample = await query(`
    SELECT TOP 5
      veh.VEH_NUMSERIE,
      veh.VEH_TIPOAUTO,
      veh.VEH_SITUACION,
      cat.UNC_PRECLISTA,
      veh.VEH_COSTO1,
      veh.VEH_COSTO2,
      veh.VEH_COSTO3,
      veh.VEH_MONTOPAGOPROV,
      veh.VEH_IMPAYOC,
      veh.VEH_PREFACORIG,
      veh.VEH_SIMPPVTA,
      veh.VEH_IMPFACT,
      veh.VEH_VENTA
    FROM SER_VEHICULO veh
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO
      AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE veh.VEH_SITUACION = 'FIS'
      AND veh.VEH_FECREMISION IS NOT NULL
    ORDER BY veh.VEH_FECREMISION DESC
  `);
  console.log('\nMuestra FIS:', JSON.stringify(sample, null, 2));

  const calpisoCols = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tmp_calpiso' ORDER BY ORDINAL_POSITION
  `);
  console.log('\ntmp_calpiso cols:', calpisoCols.map((c) => c.COLUMN_NAME).join(', '));

  const calpiso = await query(`SELECT TOP 3 * FROM tmp_calpiso`);
  console.log('\ntmp_calpiso sample:', JSON.stringify(calpiso, null, 2));

  const biSample = await query(`
    SELECT TOP 5 Vin, importeCompra, CostoCatalogo, ImporteVenta, Modelo
    FROM BI_INVENTARIO_NUEVOS
    WHERE Vendida = 0 AND Existencia = 1
    ORDER BY importeCompra DESC
  `);
  console.log('\nBI importeCompra:', JSON.stringify(biSample, null, 2));

  const join = await query(`
    SELECT TOP 5
      veh.VEH_NUMSERIE,
      cat.UNC_PRECLISTA,
      veh.VEH_VENTA,
      bi.importeCompra,
      bi.CostoCatalogo
    FROM SER_VEHICULO veh
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    LEFT JOIN BI_INVENTARIO_NUEVOS bi ON bi.Vin = veh.VEH_NUMSERIE
    WHERE veh.VEH_SITUACION = 'FIS'
    ORDER BY veh.VEH_FECREMISION DESC
  `);
  console.log('\nJoin FIS:', JSON.stringify(join, null, 2));

  const vhd = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UNI_ESTADODETA' ORDER BY ORDINAL_POSITION
  `);
  console.log('\nUNI_ESTADODETA cols:', vhd.map((c) => c.COLUMN_NAME).join(', '));

  const com = await query(`
    SELECT TOP 5
      veh.VEH_NUMSERIE,
      cat.UNC_PRECLISTA,
      veh.VEH_VENTA,
      com.CostoRemision
    FROM SER_VEHICULO veh
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    LEFT JOIN UNI_COMISIONESUNIDADES com ON com.veh_numserie = veh.VEH_NUMSERIE
    WHERE veh.VEH_SITUACION = 'FIS'
    ORDER BY veh.VEH_FECREMISION DESC
  `);
  console.log('\nCostoRemision:', JSON.stringify(com, null, 2));

  const withCosto = await query(`
    SELECT TOP 8
      veh.VEH_NUMSERIE,
      veh.VEH_SITUACION,
      cat.UNC_PRECLISTA,
      veh.VEH_VENTA,
      ed.VHD_COSTO,
      ed.VHD_TIPO,
      ed.VHD_DESCRIPCION
    FROM SER_VEHICULO veh
    INNER JOIN UNI_ESTADODETA ed ON ed.VHD_NOSERIE = veh.VEH_NUMSERIE
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE ed.VHD_COSTO IS NOT NULL AND ed.VHD_COSTO > 0
      AND veh.VEH_SITUACION IN ('FIS', 'DIS')
    ORDER BY ed.VHD_COSTO DESC
  `);
  console.log('\nWith VHD_COSTO:', JSON.stringify(withCosto, null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
