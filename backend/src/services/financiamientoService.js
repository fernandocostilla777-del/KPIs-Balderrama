/**
 * Dashboard de Financiamiento (F&I) para Ventas.
 * Fuente principal: crm_financiamiento / crm_solicitudes (SQLite CRM).
 * Complemento DMS: mix crédito/contado vía /api/ventas (porTipoVentaRetail en el cliente).
 */
const crm = require('./crmCiclosService');

const PVA_DEFS = [
  { key: 'gap', label: 'GAP', col: 'gap_monto' },
  { key: 'garantia', label: 'Garantía extendida', col: 'garantia_extendida_monto' },
  { key: 'accesorios', label: 'Accesorios', col: 'accesorios_monto' },
  { key: 'onstar', label: 'OnStar', col: 'onstar_monto' },
  { key: 'mantenimiento', label: 'Mantenimientos', col: 'mantenimiento_integrado_monto' },
];

const CONTADO_TIPOS = new Set(['CONTADO']);
const EXCLUDE_TIPOS = new Set(['FLOTILLA', 'PERDIDA']);

function avg(nums) {
  const list = (nums || []).filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function roundMoney(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((Number(num || 0) / Number(den)) * 1000) / 10;
}

function inPeriod(fecha, fi, ff) {
  if (!fecha) return !fi && !ff;
  const f = String(fecha).slice(0, 10);
  if (fi && f < String(fi)) return false;
  if (ff && f > String(ff)) return false;
  return true;
}

function rowDate(row) {
  return row.fecha_compra || row.fecha || row.fecha_timbrado || null;
}

function mapContract(row) {
  const pvas = PVA_DEFS
    .filter((def) => Number(row[def.col] || 0) > 0)
    .map((def) => ({
      key: def.key,
      label: def.label,
      monto: roundMoney(Number(row[def.col] || 0)),
    }));

  return {
    id: row.id ?? null,
    fecha: rowDate(row),
    cliente: row.cliente || null,
    asesor: row.asesor || null,
    unidad: row.unidad || null,
    vin: row.vin || null,
    contrato: row.no_contrato || row.contrato || null,
    factura: row.factura || null,
    plan: row.plan || row.plan_2 || null,
    tipoCompra: row.tipo_compra || null,
    plazoMeses: Number(row.plazo_meses) || null,
    enganchePct: Number.isFinite(Number(row.enganche_pct)) ? Number(row.enganche_pct) : null,
    engancheMonto: roundMoney(Number(row.enganche_monto)),
    montoFinanciar: roundMoney(Number(row.monto_financiar)),
    comision: roundMoney(Number(row.comision)),
    mafComision: roundMoney(Number(row.maf_comision)),
    fi: row.fi || null,
    afi: row.afi || null,
    pvas,
    cantidadPvas: pvas.length,
    montoPvas: roundMoney(pvas.reduce((s, p) => s + Number(p.monto || 0), 0)),
    seguroGratis: row.seguro_gratis || null,
    roboParcial: row.robo_parcial || null,
  };
}

function countMap(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const label = String(keyFn(item) || '(sin dato)').trim() || '(sin dato)';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count, pct: pct(count, items.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildRetailMix(porTipoVentaRetail = []) {
  const entries = (porTipoVentaRetail || [])
    .map((e) => ({
      label: String(e.label || e.key || '').trim().toUpperCase() || '(SIN DATO)',
      count: Number(e.count || e.value || 0),
    }))
    .filter((e) => e.count > 0 && !EXCLUDE_TIPOS.has(e.label));

  const total = entries.reduce((s, e) => s + e.count, 0);
  const contado = entries.filter((e) => CONTADO_TIPOS.has(e.label)).reduce((s, e) => s + e.count, 0);
  const credito = total - contado;
  const porFinanciera = entries
    .filter((e) => !CONTADO_TIPOS.has(e.label))
    .map((e) => ({ label: e.label, count: e.count, pct: pct(e.count, total) }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRetail: total,
    credito,
    contado,
    penetracionCreditoPct: pct(credito, total),
    penetracionContadoPct: pct(contado, total),
    porFinanciera,
    porTipo: entries.map((e) => ({ label: e.label, count: e.count, pct: pct(e.count, total) })),
  };
}

function loadCrmContracts(fechaInicio, fechaFin) {
  if (!crm.isAvailable()) {
    return { available: false, contracts: [], reason: 'Base CRM no encontrada' };
  }

  // Acceso interno: reutilizar getSeguimiento360Summary no trae detalle de filas.
  // Abrimos vía búsqueda liviana exportando con getCrmStats + query directa a través de enrich.
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
  if (!fs.existsSync(DB_PATH)) {
    return { available: false, contracts: [], reason: 'Base CRM no encontrada' };
  }

  const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const hasFin = !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'`).get();
    if (!hasFin) {
      return { available: false, contracts: [], reason: 'Tabla crm_financiamiento no disponible' };
    }

    const rows = d.prepare(`
      SELECT *
      FROM crm_financiamiento
      WHERE vin IS NOT NULL AND trim(vin) <> ''
    `).all();

    const contracts = rows
      .filter((row) => inPeriod(rowDate(row), fechaInicio, fechaFin))
      .map(mapContract)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    return { available: true, contracts, reason: null };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

function loadSolicitudes(fechaInicio, fechaFin) {
  if (!crm.isAvailable()) {
    return { total: 0, aprobadas: 0, conCompra: 0, tasaAprobacionPct: null, porEstatus: [], porFinanciera: [] };
  }

  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
  if (!fs.existsSync(DB_PATH)) {
    return { total: 0, aprobadas: 0, conCompra: 0, tasaAprobacionPct: null, porEstatus: [], porFinanciera: [] };
  }

  const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const hasSol = !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_solicitudes'`).get();
    if (!hasSol) {
      return { total: 0, aprobadas: 0, conCompra: 0, tasaAprobacionPct: null, porEstatus: [], porFinanciera: [] };
    }

    const rows = d.prepare(`
      SELECT estatus, financiera, fecha_solicitud, fecha_compra, nombre_cliente, num_contrato, enganche, fi, afi, asesor, unidad_paquete
      FROM crm_solicitudes
    `).all().filter((r) => inPeriod(r.fecha_solicitud, fechaInicio, fechaFin));

    const aprobadas = rows.filter((r) => String(r.estatus || '').toUpperCase().includes('APROBADA')).length;
    const conCompra = rows.filter((r) =>
      r.fecha_compra || String(r.estatus || '').toUpperCase().includes('FACT')
    ).length;

    return {
      total: rows.length,
      aprobadas,
      conCompra,
      tasaAprobacionPct: pct(aprobadas, rows.length),
      porEstatus: countMap(rows, (r) => r.estatus || '(sin estatus)'),
      porFinanciera: countMap(rows, (r) => r.financiera || '(sin financiera)').slice(0, 10),
      muestra: rows.slice(0, 50).map((r) => ({
        fecha: r.fecha_solicitud || null,
        cliente: r.nombre_cliente || null,
        vin: null,
        estatus: r.estatus || null,
        financiera: r.financiera || null,
        contrato: r.num_contrato || null,
        enganche: Number(r.enganche) || null,
        fi: r.fi || null,
        afi: r.afi || null,
        asesor: r.asesor || null,
        unidad: r.unidad_paquete || null,
      })),
    };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

function buildSummary(contracts, solicitudes) {
  const montos = contracts.map((c) => Number(c.montoFinanciar)).filter((n) => Number.isFinite(n) && n > 0);
  const enganches = contracts.map((c) => Number(c.engancheMonto)).filter((n) => Number.isFinite(n) && n > 0);
  const plazos = contracts.map((c) => Number(c.plazoMeses)).filter((n) => Number.isFinite(n) && n > 0);
  const vins = new Set(contracts.map((c) => String(c.vin || '').toUpperCase()).filter(Boolean));

  const conPva = contracts.filter((c) => c.cantidadPvas > 0);
  const montoTotalPvas = contracts.reduce((s, c) => s + Number(c.montoPvas || 0), 0);
  const totalCantidadPvas = contracts.reduce((s, c) => s + Number(c.cantidadPvas || 0), 0);

  const porTipoPva = PVA_DEFS.map((def) => {
    const con = contracts.filter((c) => c.pvas.some((p) => p.key === def.key));
    const monto = con.reduce((s, c) => {
      const hit = c.pvas.find((p) => p.key === def.key);
      return s + Number(hit?.monto || 0);
    }, 0);
    return {
      key: def.key,
      label: def.label,
      contratos: con.length,
      penetracionPct: pct(con.length, contracts.length),
      montoTotal: roundMoney(monto),
    };
  });

  return {
    contratos: contracts.length,
    unidades: vins.size,
    montoFinanciarTotal: roundMoney(montos.reduce((s, n) => s + n, 0)) || 0,
    montoFinanciarPromedio: roundMoney(avg(montos)),
    enganchePromedio: roundMoney(avg(enganches)),
    plazoPromedio: plazos.length ? Math.round(avg(plazos) * 10) / 10 : null,
    contratosConPva: conPva.length,
    penetracionPvaPct: pct(conPva.length, contracts.length),
    montoTotalPvas: roundMoney(montoTotalPvas) || 0,
    promedioCantidadPvas: contracts.length
      ? Math.round((totalCantidadPvas / contracts.length) * 10) / 10
      : null,
    porTipoPva,
    plazos: countMap(contracts.filter((c) => c.plazoMeses), (c) => `${c.plazoMeses} meses`),
    planes: countMap(contracts, (c) => c.plan || '(sin plan)').slice(0, 10),
    tiposCompra: countMap(contracts, (c) => c.tipoCompra || '(sin tipo)'),
    asesores: countMap(contracts, (c) => c.asesor || '(sin asesor)').slice(0, 12),
    solicitudes: {
      total: solicitudes.total,
      aprobadas: solicitudes.aprobadas,
      conCompra: solicitudes.conCompra,
      tasaAprobacionPct: solicitudes.tasaAprobacionPct,
    },
  };
}

/**
 * @param {{ fechaInicio: string, fechaFin: string, porTipoVentaRetail?: Array }} opts
 */
function getFinanciamientoDashboard({ fechaInicio, fechaFin, porTipoVentaRetail } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }

  const crmData = loadCrmContracts(fechaInicio, fechaFin);
  const solicitudes = loadSolicitudes(fechaInicio, fechaFin);
  const contracts = crmData.contracts || [];
  const summary = buildSummary(contracts, solicitudes);
  const retailMix = buildRetailMix(porTipoVentaRetail);

  return {
    periodo: { fechaInicio, fechaFin },
    fuente: {
      crm: crmData.available,
      reason: crmData.reason,
      tabla: 'crm_financiamiento',
    },
    summary,
    retailMix,
    contratos: contracts,
    solicitudes,
  };
}

module.exports = {
  getFinanciamientoDashboard,
  buildRetailMix,
  PVA_DEFS,
};
