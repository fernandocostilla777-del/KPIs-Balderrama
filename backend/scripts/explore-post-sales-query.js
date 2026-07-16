require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_HOST, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
};

async function main() {
  const pool = await sql.connect(config);

  const statusParams = await pool.request().query(`
    SELECT PAR_TIPOPARA, PAR_IDENPARA, PAR_DESCRIP1
    FROM PNC_PARAMETR
    WHERE PAR_TIPOPARA IN ('EO','ES','ST','SO','OS')
      OR (PAR_TIPOPARA = 'AS' AND PAR_IDENPARA IN ('0','1','2','3','4','5','6','7','8'))
    ORDER BY PAR_TIPOPARA, PAR_IDENPARA
  `);
  console.log('Params:', statusParams.recordset.slice(0, 30));

  const aseg = await pool.request().query(`
    SELECT TOP 10 PAR_IDENPARA, PAR_DESCRIP1 FROM PNC_PARAMETR WHERE PAR_TIPOPARA = 'AS'
  `);
  console.log('\nAseg AS:', aseg.recordset);

  const full = await pool.request().query(`
    SELECT TOP 8
      o.ORE_IDORDEN AS orden,
      LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON,'') + ' ' + ISNULL(c.PER_PATERNO,'') + ' ' + ISNULL(c.PER_MATERNO,''))) AS nombre,
      COALESCE(NULLIF(LTRIM(RTRIM(o.ORE_DOCTO)), ''), fac.factura) AS factura,
      LTRIM(RTRIM(c.PER_TELEFONO1)) AS telefono,
      LTRIM(RTRIM(c.PER_TELCELULAR)) AS celular,
      o.ORE_STATUS AS status,
      LTRIM(RTRIM(ISNULL(o.ORE_MARCA, ''))) AS auto,
      LTRIM(RTRIM(COALESCE(NULLIF(v.VEH_TIPOAUTO,''), fac.auto, ''))) AS modelo,
      LTRIM(RTRIM(o.ORE_NUMSERIE)) AS serie,
      o.ORE_FECHAORD AS ingreso,
      CASE
        WHEN o.ORE_FECHACIE IS NOT NULL AND LTRIM(RTRIM(o.ORE_FECHACIE)) <> ''
        THEN DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CONVERT(DATE, o.ORE_FECHACIE, 103))
        ELSE DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CAST(GETDATE() AS DATE))
      END AS dias,
      ISNULL(fac.importe, 0) AS importe,
      LTRIM(RTRIM(COALESCE(NULLIF(fac.aseguradora,''), aseg.nombre, ''))) AS aseguradora,
      LTRIM(RTRIM(c.PER_EMAIL)) AS correo
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
    LEFT JOIN SER_VEHICULO v ON v.VEH_NUMSERIE = o.ORE_NUMSERIE
    OUTER APPLY (
      SELECT
        MAX(f.fos_docto) AS factura,
        MAX(f.fos_qctipoauto) AS auto,
        SUM(f.fos_total) AS importe,
        MAX(f.fos_aseguradora) AS aseguradora
      FROM SER_FACORDEN f
      WHERE f.fos_idorden = o.ORE_IDORDEN
    ) fac
    OUTER APPLY (
      SELECT TOP 1 PAR_DESCRIP1 AS nombre
      FROM PNC_PARAMETR
      WHERE PAR_TIPOPARA = 'AS' AND PAR_IDENPARA = o.ORE_IDASEGURADORA
    ) aseg
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) BETWEEN '2026-06-01' AND '2026-07-06'
    ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC, o.ORE_IDORDEN DESC
  `);
  console.log('\nRows:', JSON.stringify(full.recordset, null, 2));

  const agg = await pool.request().query(`
    SELECT COUNT(*) ordenes,
      SUM(ISNULL(fac.importe,0)) ingresos,
      AVG(CASE WHEN o.ORE_FECHACIE IS NOT NULL AND LTRIM(RTRIM(o.ORE_FECHACIE)) <> ''
        THEN DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CONVERT(DATE, o.ORE_FECHACIE, 103)) END) avgDias
    FROM SER_ORDEN o
    OUTER APPLY (
      SELECT SUM(f.fos_total) AS importe FROM SER_FACORDEN f WHERE f.fos_idorden = o.ORE_IDORDEN
    ) fac
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) BETWEEN '2026-06-01' AND '2026-07-06'
  `);
  console.log('\nAgg Jun-Jul 2026:', agg.recordset[0]);

  await pool.close();
}

main().catch((e) => console.error(e.message));
