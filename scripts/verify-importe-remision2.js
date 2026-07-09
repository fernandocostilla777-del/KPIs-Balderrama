require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const vins = ['LSGEN5304TD050997', 'LZWLLNGL5PB033170', 'KL77L6E22TC119316'];

  const vehdeta = await query(`
    SELECT VHD_NOSERIE, VHD_COSTO, VHD_PRECIO, VHD_DESCRIPCION, VHD_TIPO, VHD_REMISION
    FROM UNI_VEHDETA
    WHERE VHD_NOSERIE IN (@v1, @v2, @v3)
  `, { v1: vins[0], v2: vins[1], v3: vins[2] });
  console.log('UNI_VEHDETA:', JSON.stringify(vehdeta, null, 2));

  const exist = await query(`
    SELECT VHD_NOSERIE, VHD_COSTO, VHD_PRECIO, VHD_DESCRIPCION, VHD_TIPO
    FROM UNI_VEHDETA_EXISTENCIAS
    WHERE VHD_NOSERIE IN (@v1, @v2, @v3)
  `, { v1: vins[0], v2: vins[1], v3: vins[2] });
  console.log('\nUNI_VEHDETA_EXISTENCIAS:', JSON.stringify(exist, null, 2));

  const plan = await query(`
    SELECT PSO_NUMSERIE, VHD_COSTO, PSO_IMPFACTPLAN, PSO_INTERES, PSO_DIASPISO, VEH_FECREMISION
    FROM UNI_TEMPLANPISO
    WHERE PSO_NUMSERIE IN (@v1, @v2, @v3)
  `, { v1: vins[0], v2: vins[1], v3: vins[2] });
  console.log('\nUNI_TEMPLANPISO:', JSON.stringify(plan, null, 2));

  const planFis = await query(`
    SELECT TOP 5
      tp.PSO_NUMSERIE,
      tp.VHD_COSTO,
      tp.PSO_IMPFACTPLAN,
      tp.PSO_INTERES,
      cat.UNC_PRECLISTA,
      veh.VEH_VENTA
    FROM UNI_TEMPLANPISO tp
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = tp.PSO_NUMSERIE
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE veh.VEH_SITUACION = 'FIS'
    ORDER BY tp.PSO_INTERES DESC
  `);
  console.log('\nTEMPLANPISO FIS sample:', JSON.stringify(planFis, null, 2));

  const libro = await query(`
    SELECT VTE_SERIE, CostoRemision, pen_costo1, COSTO, COSTOIVA
    FROM UNI_TEMLIBROVENTAS
    WHERE VTE_SERIE = @v2
  `, { v2: vins[1] });
  console.log('\nTEMLIBRO CostoRemision sold:', JSON.stringify(libro, null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
