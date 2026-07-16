require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { query, getPool } = require('../src/db');
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
const j = (v) => JSON.stringify(v, (_, x) => (x instanceof Date ? x.toISOString() : typeof x === 'bigint' ? x.toString() : x), 2);

(async () => {
  try {
    log('=== PAR_ALMACEN KPI live ===');
    log(j(await query(`
      SELECT COUNT(*) lineas,
        SUM(CASE WHEN ALM_EXISTEN > 0 THEN 1 ELSE 0 END) con_exist,
        SUM(ALM_EXISTEN) existencia,
        SUM(ALM_EXISTEN * ISNULL(ALM_CTOPROM,0)) costo_total,
        COUNT(DISTINCT ALM_IDALMA) almacenes,
        COUNT(DISTINCT ALM_IDPARTE) partes
      FROM dbo.PAR_ALMACEN
    `)));

    log(j(await query(`
      SELECT TOP 15 a.ALM_IDALMA, COUNT(*) lineas,
        SUM(a.ALM_EXISTEN) existencia,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) costo
      FROM dbo.PAR_ALMACEN a
      GROUP BY a.ALM_IDALMA
      ORDER BY SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) DESC
    `)));

    log('\n=== Join PAR_ALMACEN + PAR_PARTES por grupo (familia) ===');
    log(j(await query(`
      SELECT TOP 15 LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,''))) grupo, COUNT(*) lineas,
        SUM(a.ALM_EXISTEN) existencia,
        SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) costo
      FROM dbo.PAR_ALMACEN a
      LEFT JOIN dbo.PAR_PARTES p ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
      WHERE a.ALM_EXISTEN <> 0
      GROUP BY LTRIM(RTRIM(ISNULL(p.PTS_GRUPO,'')))
      ORDER BY SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) DESC
    `)));

    log('\n=== Sample 2 filas JOIN live ===');
    log(j(await query(`
      SELECT TOP 2
        LTRIM(RTRIM(a.ALM_IDPARTE)) parte,
        LTRIM(RTRIM(p.PTS_DESPARTE)) descr,
        a.ALM_IDALMA almacen,
        a.ALM_EXISTEN existencia,
        a.ALM_APARTADA apartadas,
        a.ALM_PROCESO proceso,
        a.ALM_CTOPROM costo_unit,
        (a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) costo_total,
        p.PTS_GRUPO grupo,
        p.PTS_LINEA linea,
        a.ALM_CLASIFICA clasif,
        a.ALM_STATUS status,
        a.ALM_FECHOPE
      FROM dbo.PAR_ALMACEN a
      LEFT JOIN dbo.PAR_PARTES p ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
      WHERE a.ALM_EXISTEN > 0
      ORDER BY (a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM,0)) DESC
    `)));

    log('\n=== vistaRefaccionesActual freshness ===');
    log(j(await query(`
      SELECT COUNT(*) cnt, SUM(existenciaActual) exist, MIN(fechaAlta) minf, MAX(fechaAlta) maxf,
        SUM(CASE WHEN existenciaActual>0 THEN 1 ELSE 0 END) con_exist
      FROM dbo.vistaRefaccionesActual
    `)));

    // Search HYP in post-sales related - maybe ADE tables or cost centers
    log('\n=== Tables with HOJA / TALLER PINT / BODY / COLISION inventory-ish ===');
    log(j(await query(`
      SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%HOJA%' OR TABLE_NAME LIKE '%BODY%' OR TABLE_NAME LIKE '%COLIS%'
         OR TABLE_NAME LIKE '%TALLER%' OR TABLE_NAME LIKE '%ADE_%' OR TABLE_NAME LIKE '%HIPER%'
      ORDER BY TABLE_NAME
    `)));

    // Check catalog groups that might be paint/hyp
    log('\n=== Catalogs grupos partes ===');
    try {
      const g = await query(`SELECT TOP 5 * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%GRUPO%PART%' OR TABLE_NAME LIKE 'PAR_GRUPO%' OR TABLE_NAME LIKE '%CAT%PART%'`);
      log(j(g));
      const grpTables = await query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'PAR_G%' OR TABLE_NAME LIKE '%GRUPOPART%' OR TABLE_NAME = 'INV_GRUPOPARTES'`);
      log(j(grpTables));
      for (const t of grpTables) {
        const cols = await query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=@n`, { n: t.TABLE_NAME });
        log(t.TABLE_NAME + ': ' + cols.map(c=>c.COLUMN_NAME).join(','));
        try {
          log(j(await query(`SELECT TOP 5 * FROM dbo.[${t.TABLE_NAME}]`)));
        } catch(e){ log(e.message); }
      }
    } catch(e){ log(e.message); }

    // How does postSales distinguish areas?
    const path = require('path');
    // Search for HYP in service files via sql
    log('\n=== Distinct ALM_IDALMA with names if any catalog ===');
    // look for warehouse catalog
    const almCat = await query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%ALMACEN%' AND TABLE_NAME NOT LIKE '%TMP%' AND TABLE_NAME NOT LIKE '%LOTE%' AND TABLE_NAME NOT LIKE '%PEDIMENTO%'
      ORDER BY TABLE_NAME
    `);
    log(j(almCat));

    fs.appendFileSync('scripts/_inv-postventa-discovery.txt', '\n\n======== LIVE KPIs ========\n' + lines.join('\n'), 'utf8');
    await (await getPool()).close();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
