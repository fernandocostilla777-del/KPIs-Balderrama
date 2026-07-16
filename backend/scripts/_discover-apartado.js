const { query, getPool } = require("../src/db");

async function main() {
  console.log("=== 1) COLUMNAS SER_VEHICULO (patrones) ===");
  const cols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'SER_VEHICULO'
      AND (
        COLUMN_NAME LIKE '%APART%' OR COLUMN_NAME LIKE '%SEP%' OR COLUMN_NAME LIKE '%RESERV%'
        OR COLUMN_NAME LIKE '%BLOQ%' OR COLUMN_NAME LIKE '%ASIGN%' OR COLUMN_NAME LIKE '%HOLD%'
        OR COLUMN_NAME LIKE '%CLIENTE%' OR COLUMN_NAME LIKE '%PERSONA%' OR COLUMN_NAME LIKE '%VENDEDOR%'
        OR COLUMN_NAME LIKE '%ASESOR%' OR COLUMN_NAME LIKE '%SITUACION%' OR COLUMN_NAME LIKE '%TIPOAUTO%'
        OR COLUMN_NAME LIKE '%SERIE%' OR COLUMN_NAME LIKE '%FECREM%' OR COLUMN_NAME LIKE '%FECHA%'
        OR COLUMN_NAME LIKE '%STAT%' OR COLUMN_NAME LIKE '%STATUS%' OR COLUMN_NAME LIKE '%DISP%'
        OR COLUMN_NAME LIKE '%COMPRA%' OR COLUMN_NAME LIKE '%PEDIDO%' OR COLUMN_NAME LIKE '%ORDEN%'
        OR COLUMN_NAME LIKE '%USUARIO%' OR COLUMN_NAME LIKE '%USER%' OR COLUMN_NAME LIKE '%NOMCLI%'
      )
    ORDER BY COLUMN_NAME
  `);
  console.log(JSON.stringify(cols, null, 2));

  console.log("\n=== ALL COLUMNS SER_VEHICULO ===");
  const allCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'SER_VEHICULO'
    ORDER BY ORDINAL_POSITION
  `);
  console.log(allCols.map(c => c.COLUMN_NAME + " (" + c.DATA_TYPE + ")").join("\n"));

  console.log("\n=== 3) TABLAS UNI_*/SER_* APART/SEP ===");
  const tables = await query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (
        TABLE_NAME LIKE '%APART%' OR TABLE_NAME LIKE '%SEP%'
        OR TABLE_NAME LIKE '%RESERV%' OR TABLE_NAME LIKE '%BLOQ%'
      )
      AND (TABLE_NAME LIKE 'UNI_%' OR TABLE_NAME LIKE 'SER_%' OR TABLE_NAME LIKE '%VEH%' OR TABLE_NAME LIKE '%AUTO%')
    ORDER BY TABLE_NAME
  `);
  console.log(JSON.stringify(tables, null, 2));

  console.log("\n=== TABLAS mas amplias APART/SEP/RESERV ===");
  const tables2 = await query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (TABLE_NAME LIKE '%APART%' OR TABLE_NAME LIKE '%SEP%' OR TABLE_NAME LIKE '%RESERV%' OR TABLE_NAME LIKE '%HOLD%')
    ORDER BY TABLE_NAME
  `);
  console.log(JSON.stringify(tables2, null, 2));

  console.log("\n=== 4) COUNT por VEH_SITUACION ===");
  const counts = await query(`
    SELECT VEH_SITUACION, COUNT(*) AS cnt
    FROM SER_VEHICULO
    GROUP BY VEH_SITUACION
    ORDER BY cnt DESC
  `);
  console.log(JSON.stringify(counts, null, 2));

  const matchNames = cols.map(c => c.COLUMN_NAME);
  const baseWanted = ["VEH_SITUACION", "VEH_TIPOAUTO", "VEH_SERIE", "VEH_FECREMISION", "VEH_NUMERO", "VEH_CLAVE"];
  const pick = [...new Set([...baseWanted, ...matchNames])].filter(n =>
    allCols.some(c => c.COLUMN_NAME === n)
  );

  console.log("\n=== Columnas a muestrear SEP ===");
  console.log(pick.join(", "));

  if (pick.length) {
    console.log("\n=== 2) TOP 5 SEP ===");
    const sample = await query(`
      SELECT TOP 5 ${pick.map(c => "[" + c + "]").join(", ")}
      FROM SER_VEHICULO
      WHERE VEH_SITUACION = 'SEP'
    `);
    console.log(JSON.stringify(sample, null, 2));
  }

  console.log("\n=== Columnas potenciales quien/fecha ===");
  const whoWhen = allCols.filter(c =>
    /APART|SEP|RESERV|BLOQ|ASIGN|HOLD|CLIENTE|PERSONA|VENDEDOR|ASESOR|FECHA|FEC|USUARIO|USER|NOM/i.test(c.COLUMN_NAME)
  );
  console.log(whoWhen.map(c => c.COLUMN_NAME + " (" + c.DATA_TYPE + ")").join("\n"));

  const interest = whoWhen.map(c => c.COLUMN_NAME);
  if (interest.length) {
    const nullStats = [];
    for (const col of interest) {
      try {
        const r = await query(`
          SELECT
            COUNT(*) AS total_sep,
            SUM(CASE WHEN [${col}] IS NULL OR LTRIM(RTRIM(CAST([${col}] AS NVARCHAR(100)))) = '' THEN 1 ELSE 0 END) AS null_or_empty,
            COUNT(DISTINCT [${col}]) AS distinct_vals
          FROM SER_VEHICULO
          WHERE VEH_SITUACION = 'SEP'
        `);
        nullStats.push({ col, ...r[0] });
      } catch (e) {
        nullStats.push({ col, error: e.message });
      }
    }
    console.log("\n=== Fill rate en SEP ===");
    console.log(JSON.stringify(nullStats, null, 2));
  }

  for (const t of tables2) {
    const tc = await query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tn
      ORDER BY ORDINAL_POSITION
    `, { tn: t.TABLE_NAME });
    console.log("\n=== Columns " + t.TABLE_NAME + " ===");
    console.log(tc.map(c => c.COLUMN_NAME + " (" + c.DATA_TYPE + ")").join(", "));
    try {
      const n = await query(`SELECT TOP 3 * FROM [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`);
      console.log("sample:", JSON.stringify(n, null, 2).slice(0, 2000));
    } catch (e) {
      console.log("sample error:", e.message);
    }
  }

  const pool = await getPool();
  await pool.close();
  console.log("\nDONE");
}

main().catch(e => { console.error(e); process.exit(1); });
