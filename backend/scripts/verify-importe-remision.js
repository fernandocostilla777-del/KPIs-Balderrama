require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const vins = ['LZWLLNGL8TB009780', 'LZWLLNGL5PB033170', 'LSGEN5304TD050997'];
  for (const vin of vins) {
    const rows = await query(`
      SELECT
        veh.VEH_NUMSERIE,
        veh.VEH_SITUACION,
        cat.UNC_PRECLISTA,
        veh.VEH_VENTA,
        veh.VEH_COSTO1,
        veh.VEH_COSTO2,
        veh.VEH_MONTOPAGOPROV,
        veh.VEH_IMPAYOC,
        veh.VEH_PREFACORIG,
        veh.VEH_IMPFACT,
        veh.VEH_SSUBTOTAL,
        bi.importeCompra,
        bi.CostoCatalogo
      FROM SER_VEHICULO veh
      LEFT JOIN UNI_CATALOGO cat
        ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
      LEFT JOIN BI_INVENTARIO_NUEVOS bi ON bi.Vin = veh.VEH_NUMSERIE
      WHERE veh.VEH_NUMSERIE = @vin
    `, { vin });
    console.log(`\n${vin}:`, JSON.stringify(rows[0], null, 2));
  }
  const cols = await query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME LIKE 'UNI_%'
      AND (COLUMN_NAME LIKE '%COSTO%' OR COLUMN_NAME LIKE '%IMPORT%' OR COLUMN_NAME LIKE '%REM%')
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  console.log('\nUNI cols:', cols.filter((x) =>
    /VEH|CAR|COM|ESTADO|REM|TEM|RECEP/i.test(x.TABLE_NAME)
  ));

  const tem = await query(`
    SELECT TOP 5 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'SER_TEMCOMPRAS' ORDER BY ORDINAL_POSITION
  `);
  console.log('\nSER_TEMCOMPRAS cols sample:', tem);

  const compra = await query(`
    SELECT TOP 3 *
    FROM SER_TEMCOMPRAS
    WHERE COM_NUMSERIE = 'LSGEN5304TD050997'
       OR COM_NUMSERIE = 'LZWLLNGL5PB033170'
  `);
  console.log('\nSER_TEMCOMPRAS:', JSON.stringify(compra, null, 2));

  const exist = await query(`
    SELECT TOP 5 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UNI_VEHDETA_EXISTENCIAS' ORDER BY ORDINAL_POSITION
  `);
  console.log('\nUNI_VEHDETA_EXISTENCIAS cols:', exist);

  const exRows = await query(`
    SELECT TOP 5 *
    FROM UNI_VEHDETA_EXISTENCIAS
    WHERE VHD_NOSERIE IN ('LSGEN5304TD050997', 'LZWLLNGL5PB033170', 'KL77L6E22TC119316')
  `);
  console.log('\nUNI_VEHDETA_EXISTENCIAS:', JSON.stringify(exRows, null, 2));

  const plan = await query(`
    SELECT TOP 5 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UNI_TEMPLANPISO' ORDER BY ORDINAL_POSITION
  `);
  console.log('\nUNI_TEMPLANPISO cols:', plan);

  const planRows = await query(`SELECT TOP 3 * FROM UNI_TEMPLANPISO`);
  console.log('\nUNI_TEMPLANPISO sample:', JSON.stringify(planRows, null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
