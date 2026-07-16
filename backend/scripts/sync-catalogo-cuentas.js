/**
 * Sincroniza el catálogo de cuentas desde GMOFARRIL (CON_CTAS) hacia kpi.cuentas.
 * Requiere que el esquema kpi ya exista (01_schema.sql + 02_seed.sql).
 *
 * Uso:
 *   node scripts/sync-catalogo-cuentas.js
 *   node scripts/sync-catalogo-cuentas.js 2026
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const { query } = require('../src/db');

const SEGMENT_TO_CC = {
  '0001': 'piso', '0002': 'foraneos', '0004': 'cholula', '0005': 'zacatelco',
  '0006': 'flotillas', '0007': 'casa', '0008': 'suauto', '0010': 'intercambios',
};

function tipoCuentaId(rubro) {
  const p = parseInt(rubro, 10);
  if (p >= 200 && p < 300) return 1;
  if (p >= 300 && p < 400) return 2;
  if (p >= 400 && p < 500) return 3;
  if (p >= 600 && p < 700) return 4;
  if (p >= 700 && p < 800) return 5;
  return 6;
}

function parseCuenta(num) {
  const parts = String(num || '').split('-');
  return {
    rubro: parts[0] || null,
    subrubro: parts[1] || null,
    segmento: parts[2] || null,
    detalle: parts[3] || null,
    subcuentaGasto: parts[0] === '0700' ? parts[1] : null,
    centroCostoId: SEGMENT_TO_CC[parts[2]] || null,
  };
}

async function schemaExists() {
  const rows = await query(
    "SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'kpi' AND TABLE_NAME = 'cuentas'",
  );
  return rows.length > 0;
}

async function syncFromGmo(year) {
  const source = `CON_CTAS01${year}`;
  const exists = await query(
    'SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @name',
    { name: source },
  );
  if (!exists.length) throw new Error(`No existe ${source}`);

  const rows = await query(`
    SELECT CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT, CTA_NATURALEZA, CTA_ACUMDET
    FROM [${source}]
    WHERE CTA_NUMCTA LIKE '____-____-____-____'
    ORDER BY CTA_NUMCTA
  `);

  console.log(`Origen: ${source} — ${rows.length} cuentas`);

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const parsed = parseCuenta(row.CTA_NUMCTA);
    const params = {
      numero: row.CTA_NUMCTA,
      desc: row.CTA_DESCRIPCION || '',
      tipo: tipoCuentaId(parsed.rubro),
      gpo: row.CTA_GPOCONT || null,
      cc: parsed.centroCostoId,
      subg: parsed.subcuentaGasto,
      nat: row.CTA_NATURALEZA || null,
      nivel: row.CTA_ACUMDET || 'DETA',
      rubro: parsed.rubro,
      subrubro: parsed.subrubro,
      segmento: parsed.segmento,
      detalle: parsed.detalle,
    };

    const existing = await query(
      'SELECT id FROM kpi.cuentas WHERE numero_cuenta = @numero',
      { numero: params.numero },
    );

    if (existing.length) {
      await query(`
        UPDATE kpi.cuentas SET
          descripcion = @desc, tipo_cuenta_id = @tipo, grupo_contable = @gpo,
          centro_costo_id = @cc, subcuenta_gasto = @subg, naturaleza = @nat,
          nivel = @nivel, rubro = @rubro, subrubro = @subrubro,
          segmento = @segmento, detalle = @detalle, actualizado_en = SYSDATETIME()
        WHERE numero_cuenta = @numero
      `, params);
      updated++;
    } else {
      await query(`
        INSERT INTO kpi.cuentas (
          numero_cuenta, descripcion, tipo_cuenta_id, grupo_contable,
          centro_costo_id, subcuenta_gasto, naturaleza, nivel,
          rubro, subrubro, segmento, detalle, origen
        ) VALUES (
          @numero, @desc, @tipo, @gpo, @cc, @subg, @nat, @nivel,
          @rubro, @subrubro, @segmento, @detalle, @origen
        )
      `, { ...params, origen: source });
      inserted++;
    }
  }

  console.log(`Sync completado: ${inserted} nuevas, ${updated} actualizadas`);
}

async function syncFromExcel() {
  const XLSX = require('xlsx');
  const path = 'C:\\Users\\ABP-SDN-SI-221\\Documents\\JULIO 26\\Total de cuentas.xlsx';
  const wb = XLSX.readFile(path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  console.log(`Excel: ${path}`);

  let count = 0;
  for (const row of rows) {
    const numero = String(row[0] || '').trim();
    const desc = String(row[1] || '').trim();
    if (!/^\d{4}-/.test(numero)) continue;

    const parsed = parseCuenta(numero);
    const params = {
      numero,
      desc,
      tipo: tipoCuentaId(parsed.rubro),
      gpo: null,
      cc: parsed.centroCostoId,
      subg: parsed.subcuentaGasto,
      nat: null,
      nivel: 'DETA',
      rubro: parsed.rubro,
      subrubro: parsed.subrubro,
      segmento: parsed.segmento,
      detalle: parsed.detalle,
      origen: 'EXCEL',
    };

    const existing = await query(
      'SELECT id FROM kpi.cuentas WHERE numero_cuenta = @numero',
      { numero },
    );
    if (existing.length) {
      await query('UPDATE kpi.cuentas SET descripcion = @desc, actualizado_en = SYSDATETIME() WHERE numero_cuenta = @numero', { numero, desc });
    } else {
      await query(`
        INSERT INTO kpi.cuentas (numero_cuenta, descripcion, tipo_cuenta_id, centro_costo_id,
          subcuenta_gasto, nivel, rubro, subrubro, segmento, detalle, origen)
        VALUES (@numero, @desc, @tipo, @cc, @subg, @nivel, @rubro, @subrubro, @segmento, @detalle, @origen)
      `, params);
    }
    count++;
  }
  console.log(`Excel sync: ${count} cuentas procesadas`);
}

async function main() {
  const year = process.argv[2] || new Date().getFullYear();
  const mode = process.argv[3] || 'gmo';

  if (!(await schemaExists())) {
    console.error('El esquema kpi no existe. Ejecute database/01_schema.sql y 02_seed.sql primero.');
    process.exit(1);
  }

  if (mode === 'excel') {
    await syncFromExcel();
  } else {
    await syncFromGmo(year);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
