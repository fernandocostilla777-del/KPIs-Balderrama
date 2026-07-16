require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../src/db');
const j = (v) => JSON.stringify(v, (_, x) => (x instanceof Date ? x.toISOString() : typeof x === 'bigint' ? Number(x) : typeof x === 'number' ? Math.round(x * 100) / 100 : x), 2);

(async () => {
  try {
    console.log('=== 1) ALM8: top 10 PTS_GRUPO con exist>0 ===');
    // Probar ALM_IDALMA = '8' y 'ALM8'
    const almForms = await query(`
      SELECT DISTINCT LTRIM(RTRIM(ALM_IDALMA)) alm
      FROM dbo.PAR_ALMACEN
      WHERE LTRIM(RTRIM(ALM_IDALMA)) IN ('8','ALM8','08')
         OR LTRIM(RTRIM(ALM_IDALMA)) LIKE 'ALM%8%'
      ORDER BY 1
    `);
    console.log('Formas ALM8 candidatas:', j(almForms));

    const q1 = await query(`
      SELECT TOP 10
        LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,''))) AS grupo,
        COUNT(*) AS lineas,
        SUM(a.ALM_EXISTEN) AS existencia,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) AS costo
      FROM dbo.PAR_ALMACEN a
      LEFT JOIN dbo.PAR_PARTES p
        ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
      WHERE LTRIM(RTRIM(a.ALM_IDALMA)) IN ('8','ALM8','08')
        AND a.ALM_EXISTEN > 0
      GROUP BY LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,'')))
      ORDER BY SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) DESC
    `);
    console.log(j(q1));

    const q1tot = await query(`
      SELECT
        LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
        COUNT(*) AS lineas,
        SUM(a.ALM_EXISTEN) AS existencia,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) AS costo
      FROM dbo.PAR_ALMACEN a
      WHERE LTRIM(RTRIM(a.ALM_IDALMA)) IN ('8','ALM8','08')
        AND a.ALM_EXISTEN > 0
      GROUP BY LTRIM(RTRIM(a.ALM_IDALMA))
    `);
    console.log('ALM8 totales exist>0:', j(q1tot));

    console.log('\n=== 2) Totales ALM_PROCESO > 0 ===');
    const q2 = await query(`
      SELECT
        COUNT(*) AS lineas,
        SUM(a.ALM_PROCESO) AS existencia_proceso,
        SUM(a.ALM_PROCESO * ISNULL(a.ALM_CTOPROM,0)) AS costo_proceso
      FROM dbo.PAR_ALMACEN a
      WHERE a.ALM_PROCESO > 0
    `);
    console.log(j(q2));

    const q2top = await query(`
      SELECT TOP 10
        LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
        COUNT(*) AS lineas,
        SUM(a.ALM_PROCESO) AS existencia_proceso,
        SUM(a.ALM_PROCESO * ISNULL(a.ALM_CTOPROM,0)) AS costo_proceso
      FROM dbo.PAR_ALMACEN a
      WHERE a.ALM_PROCESO > 0
      GROUP BY LTRIM(RTRIM(a.ALM_IDALMA))
      ORDER BY SUM(a.ALM_PROCESO * ISNULL(a.ALM_CTOPROM,0)) DESC
    `);
    console.log('Top almacenes proceso:', j(q2top));

    console.log('\n=== 3) SER_INVENTARIO / ser_existencias ===');
    const exists = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('SER_INVENTARIO','ser_existencias','SER_EXISTENCIAS')
      ORDER BY TABLE_NAME
    `);
    console.log('Existencia tablas:', j(exists));

    for (const t of ['SER_INVENTARIO', 'ser_existencias']) {
      try {
        const cols = await query(`
          SELECT COLUMN_NAME, DATA_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @n
          ORDER BY ORDINAL_POSITION
        `, { n: t });
        console.log('\nColumnas ' + t + ' (' + cols.length + '):');
        console.log(cols.map((c) => c.COLUMN_NAME + ':' + c.DATA_TYPE).join(', '));
        const sample = await query('SELECT TOP 5 * FROM dbo.[' + t + ']');
        console.log('Sample TOP 5 ' + t + ':');
        console.log(j(sample));
      } catch (e) {
        console.log('Error ' + t + ':', e.message);
      }
    }

    console.log('\n=== 4) Grupo 32: distribución por almacén (exist>0) ===');
    const q4 = await query(`
      SELECT
        LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
        COUNT(*) AS lineas,
        SUM(a.ALM_EXISTEN) AS existencia,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) AS costo
      FROM dbo.PAR_ALMACEN a
      INNER JOIN dbo.PAR_PARTES p
        ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
      WHERE LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,''))) = '32'
        AND a.ALM_EXISTEN > 0
      GROUP BY LTRIM(RTRIM(a.ALM_IDALMA))
      ORDER BY SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) DESC
    `);
    console.log(j(q4));

    const q4tot = await query(`
      SELECT
        COUNT(*) AS lineas,
        SUM(a.ALM_EXISTEN) AS existencia,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) AS costo
      FROM dbo.PAR_ALMACEN a
      INNER JOIN dbo.PAR_PARTES p
        ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
      WHERE LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,''))) = '32'
        AND a.ALM_EXISTEN > 0
    `);
    console.log('Grupo 32 total:', j(q4tot));

    // Share in ALM 8
    const q4alm8 = await query(`
      SELECT
        SUM(CASE WHEN LTRIM(RTRIM(a.ALM_IDALMA)) IN ('8','ALM8','08') THEN a.ALM_EXISTEN ELSE 0 END) AS exist_alm8,
        SUM(a.ALM_EXISTEN) AS exist_total,
        SUM(CASE WHEN LTRIM(RTRIM(a.ALM_IDALMA)) IN ('8','ALM8','08') THEN a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0) ELSE 0 END) AS costo_alm8,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) AS costo_total,
        SUM(CASE WHEN LTRIM(RTRIM(a.ALM_IDALMA)) IN ('8','ALM8','08') THEN 1 ELSE 0 END) AS lineas_alm8,
        COUNT(*) AS lineas_total
      FROM dbo.PAR_ALMACEN a
      INNER JOIN dbo.PAR_PARTES p
        ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
      WHERE LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,''))) = '32'
        AND a.ALM_EXISTEN > 0
    `);
    console.log('Grupo 32 share ALM8:', j(q4alm8));

    await (await getPool()).close();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

