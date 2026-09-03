/**
 * ETL: hoja "PAGOS GMF" del Google Sheet → SQLite crm_pagos_gmf.
 * Cruza CONTRATO/VIN con Histórico (crm_financiamiento) normalizando dígitos truncados.
 *
 * Uso:
 *   node backend/scripts/etl-crm-pagos-gmf.js [ruta.xlsx]
 *
 * Requiere que crm_financiamiento ya esté cargado (etl-crm-financiamiento.js).
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const {
  digitsOnly,
  contractStorageValue,
  buildContratoHistoricoIndex,
  resolveHistoricoByContrato,
} = require('./lib/crmContratoNorm');

const DEFAULT_XLSX = path.join(__dirname, '../data/leads-source.xlsx');
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

function clean(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function numberValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/[$,%\s]/g, '')
    .replace(/,/g, '')
    .replace(/[()]/g, (ch) => (ch === '(' ? '-' : ''));
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeVin(value) {
  const vin = clean(value)?.toUpperCase().replace(/\s+/g, '') || null;
  return vin && vin.length >= 5 ? vin : null;
}

/** VIN mal puesto en columna CONTRATO (p. ej. LSGEN5308TD050842). */
function looksLikeVin(value) {
  const vin = normalizeVin(value);
  if (!vin || vin.length < 11) return false;
  return /[A-Z]/.test(vin);
}

function yearFromNota(nota) {
  const text = clean(nota);
  if (!text) return null;
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function parsePagosSheet(workbook) {
  const sheetName = workbook.SheetNames.find((name) => {
    const n = name.toLowerCase();
    return n.includes('pagos') && n.includes('gmf');
  });
  if (!sheetName) throw new Error('No se encontró la hoja "PAGOS GMF"');

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });
  if (rows.length < 3) {
    return { sheetName, records: [], skipped: 0 };
  }

  const titles = rows[0] || [];
  const header = rows[1] || [];
  const mesCols = [];
  for (let c = 0; c < header.length; c += 1) {
    if (/^MES$/i.test(String(header[c] || '').trim())) mesCols.push(c);
  }

  function sectionTitle(col) {
    let title = null;
    for (let i = Math.max(0, col - 8); i <= col + 2; i += 1) {
      const t = titles[i];
      if (t == null) continue;
      const text = String(t).trim();
      if (!text || /^\d{4}$/.test(text) || /^x$/i.test(text)) continue;
      // Evitar montos / celdas solo numéricas de la fila de títulos.
      if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(text)) continue;
      if (/^[\d.,$%\s()-]+$/.test(text)) continue;
      title = text;
    }
    return title;
  }

  const records = [];
  let skipped = 0;

  for (let r = 2; r < rows.length; r += 1) {
    const row = rows[r] || [];
    for (const mesCol of mesCols) {
      const keyHeader = String(header[mesCol + 2] || '').trim().toUpperCase();
      if (keyHeader !== 'CONTRATO' && keyHeader !== 'VIN') continue;

      const keyRaw = row[mesCol + 2];
      const monto = numberValue(row[mesCol + 3]);
      const mes = clean(row[mesCol]);
      const quincena = clean(row[mesCol + 1]);
      if (!mes && keyRaw == null && monto == null) continue;

      // En PAGOS GMF a veces el VIN va en columna CONTRATO (y viceversa).
      let contratoRaw = null;
      let vinRaw = null;
      if (keyHeader === 'CONTRATO') {
        if (looksLikeVin(keyRaw)) vinRaw = normalizeVin(keyRaw);
        else contratoRaw = contractStorageValue(keyRaw);
      } else if (keyHeader === 'VIN') {
        if (looksLikeVin(keyRaw)) vinRaw = normalizeVin(keyRaw);
        else contratoRaw = contractStorageValue(keyRaw);
      }
      if (!contratoRaw && !vinRaw) {
        skipped += 1;
        continue;
      }
      if (monto == null && !contratoRaw && !vinRaw) {
        skipped += 1;
        continue;
      }

      const notaCargo = clean(row[mesCol + 4]);
      const asesor = clean(row[mesCol + 5]);
      records.push({
        concepto: sectionTitle(mesCol + 2) || 'PAGO GMF',
        mes,
        quincena,
        anio: yearFromNota(notaCargo),
        contrato_raw: contratoRaw,
        contrato_norm: digitsOnly(contratoRaw),
        vin_raw: vinRaw,
        vin: vinRaw,
        match_by: vinRaw ? 'vin' : 'contrato',
        contrato_historico: null,
        monto,
        nota_cargo: notaCargo,
        asesor,
        excel_row: r + 1,
        excel_col: mesCol + 2,
      });
    }
  }

  return { sheetName, records, skipped };
}

function resolveAgainstHistorico(db, records) {
  const hasFin = !!db.prepare(
    `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'`
  ).get();
  if (!hasFin) {
    console.warn('[pagos-gmf] crm_financiamiento no existe: pagos quedan sin cruce a histórico');
    return { resolvedContrato: 0, unresolved: records.filter((r) => r.match_by === 'contrato').length };
  }

  const histRows = db.prepare(`
    SELECT vin, contrato, no_contrato FROM crm_financiamiento
  `).all();
  const index = buildContratoHistoricoIndex(histRows);

  let resolvedContrato = 0;
  let unresolved = 0;
  for (const row of records) {
    if (row.vin) {
      row.match_by = 'vin';
      continue;
    }
    if (!row.contrato_norm) {
      unresolved += 1;
      row.match_by = 'sin_match';
      continue;
    }
    const hit = resolveHistoricoByContrato(row.contrato_norm, index);
    if (hit?.vin) {
      row.vin = hit.vin;
      row.contrato_historico = hit.contrato || hit.noContrato || hit.contratoNorm;
      row.match_by = hit.matchMode === 'exact' ? 'contrato_exact' : 'contrato_prefix';
      resolvedContrato += 1;
    } else {
      row.match_by = 'sin_match';
      unresolved += 1;
    }
  }
  return { resolvedContrato, unresolved };
}

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) throw new Error(`No existe el archivo: ${xlsxPath}`);

  console.log('Leyendo', xlsxPath, '...');
  const workbook = XLSX.readFile(xlsxPath);
  const { sheetName, records, skipped } = parsePagosSheet(workbook);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const resolveStats = resolveAgainstHistorico(db, records);

  db.exec(`
    DROP TABLE IF EXISTS crm_pagos_gmf;
    CREATE TABLE crm_pagos_gmf (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      concepto TEXT NOT NULL,
      mes TEXT,
      quincena TEXT,
      anio INTEGER,
      contrato_raw TEXT,
      contrato_norm TEXT,
      vin_raw TEXT,
      vin TEXT,
      match_by TEXT,
      contrato_historico TEXT,
      monto REAL,
      nota_cargo TEXT,
      asesor TEXT,
      excel_row INTEGER,
      excel_col INTEGER,
      source_sheet TEXT NOT NULL DEFAULT 'PAGOS GMF'
    );
    CREATE INDEX idx_pagos_gmf_vin ON crm_pagos_gmf (vin);
    CREATE INDEX idx_pagos_gmf_contrato_norm ON crm_pagos_gmf (contrato_norm);
    CREATE INDEX idx_pagos_gmf_contrato_hist ON crm_pagos_gmf (contrato_historico);
    CREATE INDEX idx_pagos_gmf_concepto ON crm_pagos_gmf (concepto);
  `);

  const insert = db.prepare(`
    INSERT INTO crm_pagos_gmf (
      concepto, mes, quincena, anio, contrato_raw, contrato_norm, vin_raw, vin,
      match_by, contrato_historico, monto, nota_cargo, asesor, excel_row, excel_col, source_sheet
    ) VALUES (
      @concepto, @mes, @quincena, @anio, @contrato_raw, @contrato_norm, @vin_raw, @vin,
      @match_by, @contrato_historico, @monto, @nota_cargo, @asesor, @excel_row, @excel_col, 'PAGOS GMF'
    )
  `);

  const tx = db.transaction((items) => {
    for (const item of items) insert.run(item);
  });
  tx(records);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS pagos,
      COUNT(DISTINCT vin) AS vins,
      COUNT(DISTINCT contrato_norm) AS contratos,
      SUM(CASE WHEN match_by = 'sin_match' THEN 1 ELSE 0 END) AS sin_match,
      ROUND(SUM(COALESCE(monto,0)), 2) AS monto_total
    FROM crm_pagos_gmf
  `).get();

  console.log(`Hoja "${sheetName}": ${records.length} pagos cargados; ${skipped} bloques vacíos omitidos`);
  console.log('Cruce histórico:', resolveStats);
  console.table([totals]);
  db.close();
}

run();
