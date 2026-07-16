const { query, getPool } = require("../src/db");
(async () => {
  const resolved = await query(`
    SELECT TOP 5
      v.VEH_NUMSERIE,
      v.VEH_TIPOAUTO,
      v.VEH_SITUACION,
      v.VEH_FECREMISION,
      v.VEH_FECHSEP,
      v.VEH_PERAPAR,
      v.VEH_CVEUSU,
      v.VEH_IDCLIENT,
      p.PER_IDPERSONA,
      LTRIM(RTRIM(ISNULL(p.PER_PATERNO,''))) + ' ' + LTRIM(RTRIM(ISNULL(p.PER_MATERNO,''))) + ' ' + LTRIM(RTRIM(ISNULL(p.PER_NOMRAZON,''))) AS QUIEN_APARTO,
      LTRIM(RTRIM(ISNULL(c.PER_PATERNO,''))) + ' ' + LTRIM(RTRIM(ISNULL(c.PER_MATERNO,''))) + ' ' + LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON,''))) AS CLIENTE
    FROM SER_VEHICULO v
    LEFT JOIN PER_PERSONAS p ON CAST(p.PER_IDPERSONA AS VARCHAR(20)) = LTRIM(RTRIM(v.VEH_PERAPAR))
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = v.VEH_IDCLIENT AND v.VEH_IDCLIENT <> 0
    WHERE v.VEH_SITUACION = 'SEP'
    ORDER BY v.VEH_FECHSEP DESC
  `);
  console.log(JSON.stringify(resolved, null, 2));
  const pool = await getPool();
  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
