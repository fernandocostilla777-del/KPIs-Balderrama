/**
 * Consulta de pagos F&I (hoja PAGOS GMF → crm_pagos_gmf).
 * Match por VIN o contrato (con prefijo/truncado vía crmContratoNorm).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  digitsOnly,
  buildContratoHistoricoIndex,
  resolveHistoricoByContrato,
} = require('../../scripts/lib/crmContratoNorm');

const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');

function openDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function hasPagosTable(d) {
  return !!d.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_pagos_gmf'`
  ).get();
}

function hasFinanciamientoTable(d) {
  return !!d.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'`
  ).get();
}

function mapPagoRow(row) {
  return {
    id: row.id,
    concepto: row.concepto,
    mes: row.mes,
    quincena: row.quincena,
    anio: row.anio,
    contratoRaw: row.contrato_raw,
    contratoNorm: row.contrato_norm,
    contratoHistorico: row.contrato_historico,
    vin: row.vin,
    vinRaw: row.vin_raw,
    matchBy: row.match_by,
    monto: row.monto == null ? null : Math.round(Number(row.monto) * 100) / 100,
    notaCargo: row.nota_cargo,
    asesor: row.asesor,
    excelRow: row.excel_row,
    excelCol: row.excel_col,
  };
}

function summarize(pagos) {
  const montoTotal = Math.round(
    (pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100
  ) / 100;
  const byConcepto = {};
  for (const p of pagos || []) {
    const key = p.concepto || 'PAGO GMF';
    if (!byConcepto[key]) byConcepto[key] = { concepto: key, count: 0, monto: 0 };
    byConcepto[key].count += 1;
    byConcepto[key].monto = Math.round((byConcepto[key].monto + (Number(p.monto) || 0)) * 100) / 100;
  }
  return {
    count: (pagos || []).length,
    montoTotal,
    byConcepto: Object.values(byConcepto).sort((a, b) => b.monto - a.monto),
  };
}

function queryPagosByVin(d, vin) {
  const v = String(vin || '').trim().toUpperCase();
  if (!v) return [];
  return d.prepare(`
    SELECT * FROM crm_pagos_gmf
    WHERE vin = ?
    ORDER BY anio DESC, mes, quincena, id
  `).all(v).map(mapPagoRow);
}

function queryPagosByContratoNorm(d, contratoNorm) {
  const norm = digitsOnly(contratoNorm);
  if (!norm) return [];
  return d.prepare(`
    SELECT * FROM crm_pagos_gmf
    WHERE contrato_norm = ?
       OR contrato_historico = ?
       OR contrato_raw = ?
    ORDER BY anio DESC, mes, quincena, id
  `).all(norm, norm, norm).map(mapPagoRow);
}

/**
 * Lookup por VIN y/o contrato: une ambos criterios (dedupe por id).
 * Si solo hay contrato, resuelve VIN vía histórico y también trae pagos por serie.
 */
function getPagosGmf({ vin, contrato } = {}) {
  const d = openDb();
  if (!d) {
    return { available: false, reason: 'Base CRM no disponible', pagos: [], summary: summarize([]) };
  }
  try {
    if (!hasPagosTable(d)) {
      return {
        available: false,
        reason: 'Tabla crm_pagos_gmf no disponible. Ejecute etl-crm-pagos-gmf.js',
        pagos: [],
        summary: summarize([]),
      };
    }

    const vinNorm = vin ? String(vin).trim().toUpperCase() : null;
    const pagoNorm = digitsOnly(contrato);
    let resolved = {
      vin: vinNorm || null,
      contratoHistorico: null,
      matchMode: null,
    };

    // Resolver contrato → VIN / contrato histórico (para unir pagos por serie).
    if (pagoNorm && hasFinanciamientoTable(d)) {
      const histRows = d.prepare(`SELECT vin, contrato, no_contrato FROM crm_financiamiento`).all();
      const index = buildContratoHistoricoIndex(histRows);
      const hit = resolveHistoricoByContrato(pagoNorm, index);
      if (hit) {
        resolved.contratoHistorico = hit.contrato || hit.noContrato || hit.contratoNorm;
        if (!resolved.vin && hit.vin) resolved.vin = hit.vin;
        if (!resolved.matchMode) resolved.matchMode = hit.matchMode;
      }
    }

    const vinKeys = [...new Set([vinNorm, resolved.vin].filter(Boolean))];
    const contratoKeys = [...new Set(
      [pagoNorm, resolved.contratoHistorico, digitsOnly(resolved.contratoHistorico)].filter(Boolean)
    )];

    let pagos = [];
    for (const v of vinKeys) {
      pagos = pagos.concat(queryPagosByVin(d, v));
    }
    for (const c of contratoKeys) {
      pagos = pagos.concat(queryPagosByContratoNorm(d, c));
    }

    // Prefijos truncados en contrato_norm (pago más corto que histórico).
    if (pagoNorm && pagoNorm.length >= 10) {
      const prefixRows = d.prepare(`
        SELECT * FROM crm_pagos_gmf
        WHERE contrato_norm LIKE ?
           OR contrato_historico LIKE ?
           OR contrato_raw LIKE ?
      `).all(`${pagoNorm}%`, `${pagoNorm}%`, `${pagoNorm}%`).map(mapPagoRow);
      pagos = pagos.concat(prefixRows);
    }

    const seen = new Set();
    pagos = pagos.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (!resolved.vin && pagos[0]?.vin) resolved.vin = pagos[0].vin;
    if (!resolved.contratoHistorico && pagos[0]?.contratoHistorico) {
      resolved.contratoHistorico = pagos[0].contratoHistorico;
    }
    if (pagos.length) {
      const modes = new Set(pagos.map((p) => p.matchBy).filter(Boolean));
      if (vinKeys.length && contratoKeys.length) resolved.matchMode = 'vin_y_contrato';
      else if (modes.has('vin')) resolved.matchMode = 'vin';
      else resolved.matchMode = resolved.matchMode || 'contrato';
    }

    return {
      available: true,
      query: { vin: vinNorm || null, contrato: pagoNorm },
      resolved,
      pagos,
      summary: summarize(pagos),
    };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

/** Mapa VIN → pagos (para enriquecer contratos 360). */
function getPagosGmfByVins(vins = []) {
  const map = new Map();
  const d = openDb();
  if (!d) return map;
  try {
    if (!hasPagosTable(d)) return map;

    const normalized = [...new Set(
      (vins || []).map((v) => String(v || '').trim().toUpperCase()).filter((v) => v.length >= 5)
    )];
    if (!normalized.length) return map;

    const placeholders = normalized.map(() => '?').join(',');
    const rows = d.prepare(`
      SELECT * FROM crm_pagos_gmf
      WHERE vin IN (${placeholders})
      ORDER BY anio DESC, mes, quincena, id
    `).all(...normalized);

    for (const row of rows) {
      const vin = String(row.vin || '').toUpperCase();
      if (!map.has(vin)) map.set(vin, []);
      map.get(vin).push(mapPagoRow(row));
    }
    return map;
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

module.exports = {
  getPagosGmf,
  getPagosGmfByVins,
  hasPagosTable,
  summarize,
};
