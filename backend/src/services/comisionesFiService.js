/**
 * Comisiones F&I — liquidación tipo "Comisiones FI" (Excel gerencia de negocios).
 *
 * Lógica del Summary del Excel:
 * - Por concepto: BASE = monto − comisión asesor; COMISIÓN F&I = % de la BASE
 * - MAF: el “monto” del Summary es la comisión GMF; se estima como
 *   maf_comision (base CRM) × tasa GMF configurable (~4.14% observada).
 * - GAP / Garantía: montos CRM.
 * - Split: F&I Serdan 80% / pool AFI 20%; Fernando (Zacatelco) 100%.
 * - AFI: el 20% se reparte por % de contratos.
 */
const path = require('path');
const Database = require('better-sqlite3');

const RULES = {
  maf: {
    gmfRateOnMaf: 0.0414,
    vendorShareOfGmf: 0.4543,
    fiShareOfBase: 0.10,
  },
  gap: {
    vendorShareOfMonto: 0.25,
    fiShareOfBase: 0.10,
  },
  garantia: {
    vendorShareOfMonto: 0.2285,
    fiShareOfBase: 0.10,
    preferCxAsVendor: true,
  },
  split: {
    fiKeep: 0.8,
    afiPool: 0.2,
    fullKeepKeys: ['FERNANDO'],
  },
};

const FI_META = {
  CECILIA: { label: 'CECILIA CARDENAS', sucursal: 'SERDAN' },
  MAX: { label: 'MAX JALIL', sucursal: 'SERDAN' },
  ROCIO: { label: 'ROCIO MARTINEZ', sucursal: 'SERDAN' },
  FERNANDO: { label: 'FERNANDO DOMINGUEZ', sucursal: 'ZACATELCO' },
};

function roundMoney(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((Number(num || 0) / Number(den)) * 1000) / 10;
}

function normalizeKey(name) {
  const u = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!u) return 'SIN ASIGNAR';
  if (u.includes('CECILIA') || u.includes('CARDENAS')) return 'CECILIA';
  if (u.includes('MAX') || u.includes('JUNCO') || u.includes('JALIL')) return 'MAX';
  if (u.includes('ROCIO') || u.includes('MARTINEZ ZITLAL')) return 'ROCIO';
  if (u.includes('FERNANDO') || u.includes('DOMINGUEZ')) return 'FERNANDO';
  if (u.includes('MIRIAM')) return 'MIRIAM';
  if (u.includes('ANGELICA')) return 'ANGELICA';
  if (u.includes('DIANA')) return 'DIANA';
  return u;
}

function isAfiKey(key) {
  return ['MIRIAM', 'ANGELICA', 'DIANA'].includes(key);
}

function rowDate(row) {
  return row.fecha_compra || row.fecha || row.fecha_timbrado || null;
}

function inPeriod(fecha, fi, ff) {
  if (!fecha) return false;
  const f = String(fecha).slice(0, 10);
  if (fi && f < String(fi)) return false;
  if (ff && f > String(ff)) return false;
  return true;
}

function loadContracts(fechaInicio, fechaFin) {
  const dbPath = path.join(__dirname, '../../data/crm-ciclos.db');
  const db = new Database(dbPath, { readonly: true });
  try {
    const has = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'",
    ).get();
    if (!has) throw new Error('Tabla crm_financiamiento no encontrada.');
    return db.prepare(`
      SELECT *
      FROM crm_financiamiento
      WHERE COALESCE(fecha_compra, fecha, fecha_timbrado) IS NOT NULL
    `).all().filter((r) => inPeriod(rowDate(r), fechaInicio, fechaFin));
  } finally {
    db.close();
  }
}

function calcConcept({ monto, vendorShareOfMonto, fiShareOfBase, vendorOverride = null }) {
  const m = Number(monto || 0);
  if (m <= 0) {
    return { monto: 0, comisionAsesor: 0, base: 0, comisionFi: 0 };
  }
  const vendor = vendorOverride != null && Number.isFinite(Number(vendorOverride))
    ? Math.max(0, Number(vendorOverride))
    : roundMoney(m * vendorShareOfMonto);
  const base = roundMoney(Math.max(0, m - vendor));
  const comisionFi = roundMoney(base * fiShareOfBase);
  return { monto: roundMoney(m), comisionAsesor: vendor, base, comisionFi };
}

function calcContract(row, rules = RULES) {
  const mafBase = Number(row.maf_comision || row.monto_financiar || 0);
  const gmfComision = roundMoney(mafBase * rules.maf.gmfRateOnMaf);
  const maf = calcConcept({
    monto: gmfComision,
    vendorShareOfMonto: rules.maf.vendorShareOfGmf,
    fiShareOfBase: rules.maf.fiShareOfBase,
  });

  const gap = calcConcept({
    monto: Number(row.gap_monto || 0),
    vendorShareOfMonto: rules.gap.vendorShareOfMonto,
    fiShareOfBase: rules.gap.fiShareOfBase,
  });

  const gtiaMonto = Number(row.garantia_extendida_monto || 0);
  const cxGtia = Number(row.cx_garantia);
  const garantia = calcConcept({
    monto: gtiaMonto,
    vendorShareOfMonto: rules.garantia.vendorShareOfMonto,
    fiShareOfBase: rules.garantia.fiShareOfBase,
    vendorOverride: rules.garantia.preferCxAsVendor && Number.isFinite(cxGtia) && cxGtia > 0
      ? cxGtia
      : null,
  });

  return {
    fecha: rowDate(row),
    cliente: row.cliente || null,
    asesor: row.asesor || null,
    unidad: row.unidad || null,
    vin: row.vin || null,
    contrato: row.no_contrato || row.contrato || null,
    factura: row.factura || null,
    tipoCompra: row.tipo_compra || null,
    fi: row.fi || null,
    fiKey: normalizeKey(row.fi),
    afi: row.afi || null,
    afiKey: normalizeKey(row.afi),
    mafBase: roundMoney(mafBase),
    gmfComisionEstimada: gmfComision,
    maf,
    gap,
    garantia,
    totalFi: roundMoney(maf.comisionFi + gap.comisionFi + garantia.comisionFi),
  };
}

function emptyBucket(key, kind) {
  const meta = FI_META[key];
  return {
    key,
    kind,
    nombre: meta?.label || key,
    sucursal: meta?.sucursal || (isAfiKey(key) ? 'AFI' : '—'),
    contratos: 0,
    mafMonto: 0,
    mafAsesor: 0,
    mafBase: 0,
    mafFi: 0,
    gapMonto: 0,
    gapAsesor: 0,
    gapBase: 0,
    gapFi: 0,
    garantiaMonto: 0,
    garantiaAsesor: 0,
    garantiaBase: 0,
    garantiaFi: 0,
    totalFi: 0,
    retenido80: 0,
    aporteAfi20: 0,
    poolAfi: 0,
    totalDepositar: 0,
    participacionPct: null,
  };
}

function accumulate(bucket, c) {
  bucket.contratos += 1;
  bucket.mafMonto = roundMoney(bucket.mafMonto + c.maf.monto);
  bucket.mafAsesor = roundMoney(bucket.mafAsesor + c.maf.comisionAsesor);
  bucket.mafBase = roundMoney(bucket.mafBase + c.maf.base);
  bucket.mafFi = roundMoney(bucket.mafFi + c.maf.comisionFi);
  bucket.gapMonto = roundMoney(bucket.gapMonto + c.gap.monto);
  bucket.gapAsesor = roundMoney(bucket.gapAsesor + c.gap.comisionAsesor);
  bucket.gapBase = roundMoney(bucket.gapBase + c.gap.base);
  bucket.gapFi = roundMoney(bucket.gapFi + c.gap.comisionFi);
  bucket.garantiaMonto = roundMoney(bucket.garantiaMonto + c.garantia.monto);
  bucket.garantiaAsesor = roundMoney(bucket.garantiaAsesor + c.garantia.comisionAsesor);
  bucket.garantiaBase = roundMoney(bucket.garantiaBase + c.garantia.base);
  bucket.garantiaFi = roundMoney(bucket.garantiaFi + c.garantia.comisionFi);
  bucket.totalFi = roundMoney(bucket.totalFi + c.totalFi);
}

function getComisionesFi({ fechaInicio, fechaFin } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw new Error('fechaInicio y fechaFin son requeridos.');
  }

  const rows = loadContracts(fechaInicio, fechaFin);
  const detalle = rows.map((r) => calcContract(r, RULES));

  const byFi = new Map();
  const byAfi = new Map();

  for (const c of detalle) {
    if (!byFi.has(c.fiKey)) byFi.set(c.fiKey, emptyBucket(c.fiKey, 'fi'));
    accumulate(byFi.get(c.fiKey), c);

    if (c.afiKey && c.afiKey !== 'SIN ASIGNAR') {
      if (!byAfi.has(c.afiKey)) {
        byAfi.set(c.afiKey, emptyBucket(c.afiKey, isAfiKey(c.afiKey) ? 'afi' : 'fi'));
      }
      byAfi.get(c.afiKey).contratos += 1;
    }
  }

  const fullKeep = new Set(RULES.split.fullKeepKeys);
  let poolAfi = 0;
  const fiList = [...byFi.values()].filter((b) => FI_META[b.key] || b.totalFi > 0);

  for (const b of fiList) {
    if (fullKeep.has(b.key)) {
      b.retenido80 = b.totalFi;
      b.aporteAfi20 = 0;
      b.totalDepositar = b.totalFi;
    } else {
      b.retenido80 = roundMoney(b.totalFi * RULES.split.fiKeep);
      b.aporteAfi20 = roundMoney(b.totalFi * RULES.split.afiPool);
      b.totalDepositar = b.retenido80;
      poolAfi = roundMoney(poolAfi + b.aporteAfi20);
    }
  }

  const afiList = [...byAfi.values()].filter((b) => isAfiKey(b.key));
  const totalAfiContratos = afiList.reduce((s, b) => s + b.contratos, 0);

  for (const b of afiList) {
    b.participacionPct = pct(b.contratos, totalAfiContratos);
    b.poolAfi = roundMoney(poolAfi * (totalAfiContratos ? b.contratos / totalAfiContratos : 0));
    b.totalDepositar = b.poolAfi;
    b.totalFi = b.poolAfi;
  }

  const depositos = [
    ...fiList
      .filter((b) => FI_META[b.key] || b.totalFi > 0)
      .map((b) => ({
        puesto: 'F&I',
        sucursal: b.sucursal,
        nombre: b.nombre,
        key: b.key,
        contratos: b.contratos,
        comision: b.retenido80 || b.totalDepositar,
        totalDepositar: b.totalDepositar,
      })),
    ...afiList.map((b) => ({
      puesto: b.key === 'MIRIAM' ? 'AFI' : 'AFI 3',
      sucursal: 'AFI',
      nombre: b.nombre,
      key: b.key,
      contratos: b.contratos,
      participacionPct: b.participacionPct,
      comision: b.poolAfi,
      totalDepositar: b.totalDepositar,
    })),
  ].sort((a, b) => b.totalDepositar - a.totalDepositar);

  const totales = {
    contratos: detalle.length,
    mafGmfEstimado: roundMoney(detalle.reduce((s, c) => s + c.maf.monto, 0)),
    mafFi: roundMoney(detalle.reduce((s, c) => s + c.maf.comisionFi, 0)),
    gapMonto: roundMoney(detalle.reduce((s, c) => s + c.gap.monto, 0)),
    gapFi: roundMoney(detalle.reduce((s, c) => s + c.gap.comisionFi, 0)),
    garantiaMonto: roundMoney(detalle.reduce((s, c) => s + c.garantia.monto, 0)),
    garantiaFi: roundMoney(detalle.reduce((s, c) => s + c.garantia.comisionFi, 0)),
    totalFi: roundMoney(detalle.reduce((s, c) => s + c.totalFi, 0)),
    poolAfi,
    totalDepositar: roundMoney(depositos.reduce((s, d) => s + d.totalDepositar, 0)),
  };

  const porConcepto = [
    {
      concepto: 'Monto a financiar (comisión GMF est.)',
      monto: totales.mafGmfEstimado,
      comisionAsesor: roundMoney(detalle.reduce((s, c) => s + c.maf.comisionAsesor, 0)),
      base: roundMoney(detalle.reduce((s, c) => s + c.maf.base, 0)),
      comisionFi: totales.mafFi,
      fiPct: RULES.maf.fiShareOfBase,
    },
    {
      concepto: 'GAP',
      monto: totales.gapMonto,
      comisionAsesor: roundMoney(detalle.reduce((s, c) => s + c.gap.comisionAsesor, 0)),
      base: roundMoney(detalle.reduce((s, c) => s + c.gap.base, 0)),
      comisionFi: totales.gapFi,
      fiPct: RULES.gap.fiShareOfBase,
    },
    {
      concepto: 'Garantías extendidas',
      monto: totales.garantiaMonto,
      comisionAsesor: roundMoney(detalle.reduce((s, c) => s + c.garantia.comisionAsesor, 0)),
      base: roundMoney(detalle.reduce((s, c) => s + c.garantia.base, 0)),
      comisionFi: totales.garantiaFi,
      fiPct: RULES.garantia.fiShareOfBase,
    },
  ];

  return {
    available: true,
    tipo: 'fi',
    label: 'Comisiones F&I',
    periodo: { fechaInicio, fechaFin },
    rules: RULES,
    notas: [
      'Lógica alineada al Summary del Excel de comisiones F&I (BASE − asesor, F&I = 10% de BASE).',
      'La comisión GMF sobre MAF se estima (CRM trae MAF para comisión, no el % GMF del Q).',
      'Renovaciones, UDIS bancos y bono triunfadores no están en CRM: quedan fuera de este cálculo.',
      'Depósito: F&I Serdan 80% + pool AFI 20% por participación de contratos; Fernando 100%.',
    ],
    totales,
    porConcepto,
    porFi: fiList.sort((a, b) => b.totalFi - a.totalFi),
    porAfi: afiList.sort((a, b) => b.contratos - a.contratos),
    depositos,
    detalle: detalle
      .slice()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .slice(0, 500),
    detalleTotal: detalle.length,
  };
}

function listComisionTypes() {
  return [
    {
      id: 'fi',
      label: 'Comisiones F&I',
      description: 'Liquidación gerencia F&I / AFI (MAF, GAP, garantía) según reglas del Excel.',
      available: true,
    },
  ];
}

module.exports = {
  getComisionesFi,
  listComisionTypes,
  RULES,
  normalizeKey,
};
