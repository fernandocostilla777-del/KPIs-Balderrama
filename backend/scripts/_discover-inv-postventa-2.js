require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { query, getPool } = require('../src/db');

const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
const jsonSafe = (v) => JSON.stringify(v, (_, x) => {
  if (typeof x === 'bigint') return x.toString();
  if (x instanceof Date) return x.toISOString();
  return x;
}, 2);

(async () => {
  try {
    log('=== Frescura BI_REF_INVENT ===');
    log(jsonSafe(await query(`
      SELECT COUNT(*) cnt,
        MIN(Fech_Inv) min_fech, MAX(Fech_Inv) max_fech,
        MIN(FECEXTRCC) min_ext, MAX(FECEXTRCC) max_ext,
        SUM(Existencia) sum_exist, SUM(Total_Costo) sum_costo,
        COUNT(DISTINCT NumeroPartes) partes,
        COUNT(DISTINCT Idalmacen) almacenes
      FROM dbo.BI_REF_INVENT
    `)));

    log('\n=== KPI sugerido sample por Almacen/Grupo ===');
    log(jsonSafe(await query(`
      SELECT TOP 10 Almacen, Est_Grupo_Inv, COUNT(*) lineas,
        SUM(Existencia) existencia, SUM(Total_Costo) costo
      FROM dbo.BI_REF_INVENT
      GROUP BY Almacen, Est_Grupo_Inv
      ORDER BY SUM(Total_Costo) DESC
    `)));

    // HYP search broader
    log('\n=== Tablas con HYP en nombre ===');
    const hyps = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%HYP%' OR TABLE_NAME LIKE '%HIP%' OR TABLE_NAME LIKE '%PINT%'
      ORDER BY TABLE_NAME
    `);
    log(jsonSafe(hyps));

    for (const t of hyps.slice(0, 15)) {
      log(`\n--- ${t.TABLE_SCHEMA}.${t.TABLE_NAME} ---`);
      const cols = await query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@n ORDER BY ORDINAL_POSITION
      `, { s: t.TABLE_SCHEMA, n: t.TABLE_NAME });
      log(cols.map(c => c.COLUMN_NAME + ':' + c.DATA_TYPE).join(', '));
      try {
        const rows = await query(`SELECT TOP 2 * FROM [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`);
        log(jsonSafe(rows));
        const cnt = await query(`SELECT COUNT(*) cnt FROM [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`);
        log('ROW_COUNT ' + cnt[0].cnt);
      } catch (e) { log('err ' + e.message); }
    }

    // PAR inventory stack
    const extras = ['PAR_INVENTARIO','PAR_PARTES','par_existencias','PAR_ALMACEN','vistaRefaccionesActual','SER_INVENTARIO','INV_INVENTARIO','GWM_Refacciones','PAR_PARTESLINEA','PAR_PARTESCATEGORIA'];
    for (const name of extras) {
      log(`\n=== EXTRA ${name} ===`);
      try {
        const meta = await query(`
          SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @n
        `, { n: name });
        if (!meta.length) { log('NOT FOUND'); continue; }
        const t = meta[0];
        const cols = await query(`
          SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@n ORDER BY ORDINAL_POSITION
        `, { s: t.TABLE_SCHEMA, n: t.TABLE_NAME });
        log(cols.map(c => c.COLUMN_NAME + ':' + c.DATA_TYPE).join(', '));
        const rows = await query(`SELECT TOP 2 * FROM [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`);
        log(jsonSafe(rows));
        const cnt = await query(`SELECT COUNT(*) cnt FROM [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`);
        log('ROW_COUNT ' + cnt[0].cnt);
      } catch (e) { log('err ' + e.message); }
    }

    // Columns mentioning HYP or pintura across inventory-like
    log('\n=== Columnas con HYP/PINT/TIPOREF en tablas INV/REF/PAR ===');
    const hypCols = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE (COLUMN_NAME LIKE '%HYP%' OR COLUMN_NAME LIKE '%PINT%' OR COLUMN_NAME LIKE '%TIPO%REF%' OR COLUMN_NAME LIKE '%TIPINV%' OR COLUMN_NAME LIKE '%FAMIL%')
        AND (TABLE_NAME LIKE '%REF%' OR TABLE_NAME LIKE '%INV%' OR TABLE_NAME LIKE '%PAR%' OR TABLE_NAME LIKE '%PART%' OR TABLE_NAME LIKE '%ALMAC%')
      ORDER BY TABLE_NAME, COLUMN_NAME
    `);
    log(jsonSafe(hypCols));

    // Check if BI_REF_INVENT has recent data by id_dis or if there's a newer view
    log('\n=== id_dis distinct in BI_REF_INVENT ===');
    log(jsonSafe(await query(`SELECT id_dis, COUNT(*) cnt, MAX(Fech_Inv) maxf FROM dbo.BI_REF_INVENT GROUP BY id_dis ORDER BY COUNT(*) DESC`)));

    // Search views with refacciones + exist
    log('\n=== Views *refacc* / *exist* ===');
    log(jsonSafe(await query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_NAME LIKE '%refacc%' OR TABLE_NAME LIKE '%exist%' OR TABLE_NAME LIKE '%invent%'
      ORDER BY TABLE_NAME
    `)));

    const out = '\n\n======== FOLLOW-UP ========\n' + lines.join('\n');
    fs.appendFileSync('scripts/_inv-postventa-discovery.txt', out, 'utf8');
    console.log('appended follow-up');
    await (await getPool()).close();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
