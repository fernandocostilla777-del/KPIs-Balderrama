require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_HOST, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(config);
  const t = await pool.request().query(`
    SELECT DISTINCT PAR_TIPOPARA FROM PNC_PARAMETR
    WHERE PAR_DESCRIP1 LIKE '%SEGURO%' OR PAR_DESCRIP1 LIKE '%ASEGUR%'
  `);
  console.log('Tipos seguro:', t.recordset);

  const ins = await pool.request().query(`
    SELECT TOP 15 PAR_IDENPARA, PAR_DESCRIP1 FROM PNC_PARAMETR
    WHERE PAR_TIPOPARA = 'SA' OR PAR_TIPOPARA = 'SE' OR PAR_TIPOPARA = 'AI'
    ORDER BY PAR_DESCRIP1
  `);
  console.log('Insurers:', ins.recordset);

  const withIns = await pool.request().query(`
    SELECT TOP 5 o.ORE_IDASEGURADORA, p.PAR_DESCRIP1
    FROM SER_ORDEN o
    LEFT JOIN PNC_PARAMETR p ON p.PAR_IDENPARA = o.ORE_IDASEGURADORA AND p.PAR_TIPOPARA = 'SA'
    WHERE o.ORE_IDASEGURADORA NOT IN ('0','')
    ORDER BY o.ORE_FECHAORD DESC
  `);
  console.log('With insurer SA:', withIns.recordset);

  for (const tipo of ['SA','SE','AS','AI','AG']) {
    const r = await pool.request().query(`
      SELECT TOP 3 PAR_IDENPARA, PAR_DESCRIP1 FROM PNC_PARAMETR WHERE PAR_TIPOPARA='${tipo}'
    `);
    if (r.recordset.length) console.log(tipo, r.recordset);
  }

  const r = await pool.request().query(`
    SELECT TOP 10 o.ORE_IDASEGURADORA, per.PER_NOMRAZON
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS per ON per.PER_IDPERSONA = CAST(o.ORE_IDASEGURADORA AS INT)
    WHERE o.ORE_IDASEGURADORA NOT IN ('0','') AND ISNUMERIC(o.ORE_IDASEGURADORA)=1
    ORDER BY CONVERT(DATE,o.ORE_FECHAORD,103) DESC
  `);
  console.log('Persona aseg:', r.recordset);

  const sg = await pool.request().query(`SELECT TOP 10 PAR_IDENPARA, PAR_DESCRIP1 FROM PNC_PARAMETR WHERE PAR_TIPOPARA='SG'`);
  console.log('SG', sg.recordset);

  const sgJoin = await pool.request().query(`
    SELECT TOP 5 o.ORE_IDASEGURADORA, sg.PAR_DESCRIP1
    FROM SER_ORDEN o
    LEFT JOIN PNC_PARAMETR sg ON sg.PAR_TIPOPARA='SG' AND sg.PAR_IDENPARA = o.ORE_IDASEGURADORA
    WHERE o.ORE_IDASEGURADORA NOT IN ('0','')
  `);
  console.log('SG join', sgJoin.recordset);

  await pool.close();
}

main().catch(console.error);
