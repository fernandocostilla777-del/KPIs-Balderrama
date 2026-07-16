const { query, getPool } = require("../src/db");

async function main() {
  const cols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PER_PERSONAS'
      AND (COLUMN_NAME LIKE '%ID%' OR COLUMN_NAME LIKE '%NOM%' OR COLUMN_NAME LIKE '%RAZ%'
        OR COLUMN_NAME LIKE '%CVE%' OR COLUMN_NAME LIKE '%APELL%' OR COLUMN_NAME LIKE '%PER_%')
    ORDER BY ORDINAL_POSITION
  `);
  console.log("PER_PERSONAS key cols:", JSON.stringify(cols, null, 2));

  // try common id cols
  const idCandidates = cols.filter(c => /ID|CVE|NUM/i.test(c.COLUMN_NAME)).map(c => c.COLUMN_NAME);
  console.log("id candidates", idCandidates);

  const nameCandidates = cols.filter(c => /NOM|RAZ|APELL/i.test(c.COLUMN_NAME)).map(c => c.COLUMN_NAME);
  console.log("name candidates", nameCandidates);

  // get column list briefly
  const all = await query(`SELECT TOP 1 * FROM PER_PERSONAS`);
  console.log("sample keys", all[0] ? Object.keys(all[0]).slice(0, 40) : "empty");

  // resolve PERAPAR values from SEP sample
  const resolved = await query(`
    SELECT TOP 10
      v.VEH_NUMSERIE,
      v.VEH_SITUACION,
      v.VEH_FECHSEP,
      v.VEH_PERAPAR,
      v.VEH_CVEUSU,
      v.VEH_IDCLIENT,
      p.PER_IDPERSONA,
      p.PER_NOMBRE,
      p.PER_PATERNO,
      p.PER_MATERNO,
      p.PER_RAZONSOCIAL
    FROM SER_VEHICULO v
    LEFT JOIN PER_PERSONAS p ON CAST(p.PER_IDPERSONA AS VARCHAR(20)) = LTRIM(RTRIM(v.VEH_PERAPAR))
    WHERE v.VEH_SITUACION = 'SEP'
    ORDER BY v.VEH_FECHSEP DESC
  `);
  console.log("\nresolved:", JSON.stringify(resolved, null, 2));

  // also try if PERAPAR is salesman catalog
  const vendTables = await query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%VEND%' OR TABLE_NAME LIKE 'SER_ASE%' OR TABLE_NAME LIKE '%ASESOR%'
    ORDER BY TABLE_NAME
  `);
  console.log("\nvend tables", JSON.stringify(vendTables, null, 2));

  const pool = await getPool();
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
