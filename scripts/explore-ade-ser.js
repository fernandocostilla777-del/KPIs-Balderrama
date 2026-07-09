require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
};

async function cols(pool, table) {
  const r = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table}' ORDER BY ORDINAL_POSITION
  `);
  return r.recordset.map((x) => x.COLUMN_NAME);
}

async function main() {
  const pool = await sql.connect(config);

  for (const t of ['ADE_ORDSERENC', 'ADE_ORDSERDET', 'ADE_Servicios']) {
    const c = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.[${t}]`);
    console.log(`\n=== ${t} (${c.recordset[0].n}) ===`);
    console.log((await cols(pool, t)).join(', '));
    const s = await pool.request().query(`SELECT TOP 1 * FROM dbo.[${t}]`);
    if (s.recordset[0]) console.log('Sample:', JSON.stringify(s.recordset[0]).slice(0, 600));
  }

  const range = await pool.request().query(`
    SELECT MIN(CONVERT(DATE, OSE_FECHDOCTO, 103)) mn, MAX(CONVERT(DATE, OSE_FECHDOCTO, 103)) mx, COUNT(*) n
    FROM ADE_ORDSERENC WHERE OSE_FECHDOCTO IS NOT NULL
  `).catch(() => ({ recordset: [{}] }));

  if (range.recordset[0]?.n) console.log('\nADE_ORDSERENC range:', range.recordset[0]);

  const jun2026 = await pool.request().query(`
    SELECT TOP 5 * FROM ADE_ORDSERENC
    WHERE CONVERT(DATE, OSE_FECHDOCTO, 103) >= '2026-06-01'
    ORDER BY CONVERT(DATE, OSE_FECHDOCTO, 103) DESC
  `).catch((e) => ({ recordset: [], error: e.message }));
  console.log('\nADE_ORDSERENC Jun2026:', jun2026.recordset?.length, jun2026.error || '');

  // Try date columns dynamically
  const encCols = await cols(pool, 'ADE_ORDSERENC');
  const dateCols = encCols.filter((c) => /FECH|DATE/i.test(c));
  console.log('\nDate cols ADE_ORDSERENC:', dateCols);

  for (const dc of dateCols.slice(0, 5)) {
    try {
      const r = await pool.request().query(`
        SELECT MIN(CONVERT(DATE, ${dc}, 103)) mn, MAX(CONVERT(DATE, ${dc}, 103)) mx, COUNT(*) n
        FROM ADE_ORDSERENC WHERE ${dc} IS NOT NULL AND LTRIM(RTRIM(CAST(${dc} AS VARCHAR(30)))) <> ''
      `);
      console.log(dc, r.recordset[0]);
    } catch (e) {
      console.log(dc, 'err', e.message.split('\n')[0]);
    }
  }

  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
