require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { query, getPool } = require('../src/db');

const lines = [];
const log = (s) => {
  const text = typeof s === 'string' ? s : String(s);
  console.log(text);
  lines.push(text);
};

function jsonSafe(v) {
  return JSON.stringify(
    v,
    (_, x) => {
      if (typeof x === 'bigint') return x.toString();
      if (x instanceof Date) return x.toISOString();
      if (Buffer.isBuffer(x)) return x.toString('hex').slice(0, 40) + '...';
      return x;
    },
    2
  );
}

(async () => {
  try {
    log('=== 1) Tablas/vistas matching REF|HYP|PINT|EXIST|INV|PART|ALMAC|ARTIC ===');
    const tables = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%REF%'
         OR TABLE_NAME LIKE '%HYP%'
         OR TABLE_NAME LIKE '%PINT%'
         OR TABLE_NAME LIKE '%EXIST%'
         OR TABLE_NAME LIKE '%INV%'
         OR TABLE_NAME LIKE '%PART%'
         OR TABLE_NAME LIKE '%ALMAC%'
         OR TABLE_NAME LIKE '%ARTIC%'
      ORDER BY TABLE_TYPE, TABLE_NAME
    `);
    log('Count: ' + tables.length);
    for (const t of tables) {
      log(`  [${t.TABLE_TYPE}] ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`);
    }

    const scored = tables
      .map((t) => {
        let score = 0;
        const n = t.TABLE_NAME.toUpperCase();
        if (n.includes('BI_REF_INVENT')) score += 100;
        if (n.includes('REF_INVENT')) score += 80;
        if (n.includes('INVENT') && !n.includes('INVOICE')) score += 50;
        if (n.includes('EXIST')) score += 40;
        if (n.includes('ALMAC')) score += 30;
        if (n.includes('HYP') && (n.includes('INV') || n.includes('EXIST') || n.includes('PART'))) score += 45;
        if (n.includes('PART') && !n.includes('DEPART')) score += 25;
        if (n.includes('ARTIC')) score += 25;
        if (n.includes('BI_')) score += 10;
        if (n.includes('REFACC') || n.includes('REF_')) score += 20;
        if (t.TABLE_TYPE === 'VIEW') score += 5;
        if (n.includes('INVOICE') || n.includes('INVOICE')) score -= 40;
        return { ...t, score };
      })
      .filter((t) => t.score >= 25)
      .sort((a, b) => b.score - a.score);

    log('\n=== Candidatas priorizadas (score>=25) ===');
    for (const t of scored) {
      log(`  score=${t.score} [${t.TABLE_TYPE}] ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`);
    }

    const sampleTargets = scored.slice(0, 15);

    log('\n=== 2) COLUMNAS + TOP 2 por candidata ===');
    for (const t of sampleTargets) {
      const full = `[${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`;
      log('\n--- ' + full + ' ---');
      try {
        const cols = await query(
          `
          SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name
          ORDER BY ORDINAL_POSITION
        `,
          { schema: t.TABLE_SCHEMA, name: t.TABLE_NAME }
        );
        for (const c of cols) {
          const len = c.CHARACTER_MAXIMUM_LENGTH != null ? `(${c.CHARACTER_MAXIMUM_LENGTH})` : '';
          log(`  ${c.COLUMN_NAME} | ${c.DATA_TYPE}${len} | null=${c.IS_NULLABLE}`);
        }
        const rows = await query(`SELECT TOP 2 * FROM ${full}`);
        log('TOP 2 rows: ' + jsonSafe(rows));
        try {
          const cnt = await query(`SELECT COUNT(*) AS cnt FROM ${full}`);
          log('ROW_COUNT: ' + cnt[0].cnt);
        } catch (e) {
          log('ROW_COUNT err: ' + e.message);
        }
      } catch (e) {
        log('ERROR: ' + e.message);
      }
    }

    log('\n=== 3) Columnas existencia|piezas|stock|cantidad|costo en tablas inventario ===');
    const stockCols = await query(`
      SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS c
      JOIN INFORMATION_SCHEMA.TABLES t
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE (
        LOWER(c.COLUMN_NAME) LIKE '%existencia%'
        OR LOWER(c.COLUMN_NAME) LIKE '%piezas%'
        OR LOWER(c.COLUMN_NAME) LIKE '%stock%'
        OR LOWER(c.COLUMN_NAME) LIKE '%cantidad%'
        OR LOWER(c.COLUMN_NAME) LIKE '%costo%'
      )
      AND (
        c.TABLE_NAME LIKE '%REF%' OR c.TABLE_NAME LIKE '%HYP%'
        OR c.TABLE_NAME LIKE '%PINT%' OR c.TABLE_NAME LIKE '%EXIST%'
        OR c.TABLE_NAME LIKE '%INV%' OR c.TABLE_NAME LIKE '%PART%'
        OR c.TABLE_NAME LIKE '%ALMAC%' OR c.TABLE_NAME LIKE '%ARTIC%'
        OR c.TABLE_NAME LIKE '%STOCK%' OR c.TABLE_NAME LIKE '%WARE%'
      )
      ORDER BY c.TABLE_NAME, c.COLUMN_NAME
    `);
    log('Count: ' + stockCols.length);
    for (const c of stockCols) {
      log(`  [${c.TABLE_TYPE}] ${c.TABLE_SCHEMA}.${c.TABLE_NAME}.${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    }

    log('\n=== 4) Distincion HYP vs REF / familia / almacen ===');
    for (const t of scored.slice(0, 10)) {
      try {
        const cols = await query(
          `
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name
        `,
          { schema: t.TABLE_SCHEMA, name: t.TABLE_NAME }
        );
        const names = cols.map((c) => c.COLUMN_NAME);
        const interesting = names.filter((n) =>
          /HYP|REF|FAMIL|ALMAC|TIPO|LINEA|RUBRO|CLASIF|AREA|DEPT|GRUPO|CATEG|SUCURS|MARCA|SERIE|PINT/i.test(n)
        );
        if (interesting.length) {
          log(`  Dist columns in ${t.TABLE_NAME}: ${interesting.join(', ')}`);
          for (const col of interesting.slice(0, 6)) {
            try {
              const dist = await query(
                `SELECT TOP 20 [${col}] AS v, COUNT(*) AS cnt FROM [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}] GROUP BY [${col}] ORDER BY COUNT(*) DESC`
              );
              log(`    DISTINCT ${col}: ${jsonSafe(dist)}`);
            } catch (e) {
              log(`    DISTINCT ${col} err: ${e.message}`);
            }
          }
        } else {
          log(`  ${t.TABLE_NAME}: sin columnas tipo/familia/almacen obvias`);
        }
      } catch (e) {
        log('dist err: ' + e.message);
      }
    }

    const outPath = 'scripts/_inv-postventa-discovery.txt';
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log('\nSaved: ' + outPath);

    const pool = await getPool();
    await pool.close();
  } catch (e) {
    console.error('FATAL', e);
    try {
      fs.writeFileSync('scripts/_inv-postventa-discovery.txt', lines.join('\n') + '\nFATAL: ' + e.stack, 'utf8');
    } catch (_) {}
    process.exit(1);
  }
})();

