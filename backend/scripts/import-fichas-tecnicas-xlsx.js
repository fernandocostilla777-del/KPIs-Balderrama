/**
 * Importa Fichas_tecnicas_Chevrolet_Mexico_2026_por_version.xlsx → JSON
 * Uso: node scripts/import-fichas-tecnicas-xlsx.js [ruta.xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DEFAULT_XLSX = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'Fichas_tecnicas_Chevrolet_Mexico_2026_por_version.xlsx'
);
const OUT_JSON = path.join(__dirname, '../data/fichas-tecnicas-chevrolet.json');
const OUT_XLSX = path.join(__dirname, '../data/fichas-tecnicas-chevrolet-2026.xlsx');
const PLANS_JSON = path.join(__dirname, '../data/planes-chevrolet-ago-my26.json');

/** Excel "Modelo" → clave de catálogo de planes */
const EXCEL_MODELO_TO_CATALOG = {
  'AVEO HATCHBACK': 'AVEO HB',
  'AVEO SEDAN': 'AVEO NB',
  ONIX: 'ONIX',
  GROOVE: 'GROOVE NG',
  TRACKER: 'TRACKER',
  TRAX: 'TRAX',
  CAPTIVA: 'CAPTIVA',
  TRAVERSE: 'TRAVERSE',
  SUBURBAN: 'SUBURBAN',
  TAHOE: 'TAHOE',
  'CAPTIVA HIBRIDA PHEV': 'CAPTIVA HIBRIDA',
  'SPARK EUV': 'SPARK EUV',
  'EQUINOX EV': 'EQUINOX EV',
  'BLAZER EV': 'BLAZER EV',
  'S10 MAX': 'S10 MAX',
  MONTANA: 'MONTANA',
  SILVERADO: 'SILVERADO',
  COLORADO: 'COLORADO',
  CHEYENNE: 'SILVERADO',
  'TORNADO VAN': 'TORNADO VAN',
  'EXPRESS MAX': 'EXPRESS',
  'EXPRESS MAX EV': 'EXPRESS MAX EV',
};

const CARROCERIA_FROM_EXCEL = {
  'AVEO HB': 'Hatchback',
  'AVEO NB': 'Sedán',
  ONIX: 'Sedán',
  'GROOVE NG': 'SUV',
  TRACKER: 'SUV',
  TRAX: 'SUV',
  CAPTIVA: 'SUV',
  TRAVERSE: 'SUV',
  SUBURBAN: 'SUV',
  TAHOE: 'SUV',
  'CAPTIVA HIBRIDA': 'SUV',
  'SPARK EUV': 'Crossover',
  'EQUINOX EV': 'SUV',
  'BLAZER EV': 'SUV',
  'S10 MAX': 'Pick up',
  MONTANA: 'Pick up',
  SILVERADO: 'Pick up',
  COLORADO: 'Pick up',
  'TORNADO VAN': 'Van',
  EXPRESS: 'Van',
  'EXPRESS MAX EV': 'Van',
};

function normalizeKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function item(label, value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return { label, value: v };
}

function buildVersionPayload(row) {
  const seguridad = [
    item('Frenos / ABS', row['Frenos / ABS']),
    item('Bolsas de aire', row['Bolsas de aire']),
    item('Seguridad / ADAS', row['Seguridad / ADAS']),
  ].filter(Boolean);

  const confort = [
    item('Tecnología / pantalla', row['Tecnología / pantalla']),
    item('Pasajeros', row['Pasajeros']),
    item('Capacidad / carga / cajuela', row['Capacidad / carga / cajuela']),
  ].filter(Boolean);

  const diferencial = [
    item('Equipamiento de la versión', row['Equipamiento diferencial de la versión']),
  ].filter(Boolean);

  let transmision = String(row['Transmisión'] || '').trim();
  if (/^CVT$/i.test(transmision)) transmision = 'CVT (automática)';

  const payload = {
    excelModelo: String(row['Modelo'] || '').trim(),
    excelVersion: String(row['Versión'] || '').trim(),
    anio: row['Año'] || 2026,
    categoria: String(row['Categoría'] || '').trim(),
    fuente: String(row['Fuente oficial'] || '').trim().replace(/espacificaciones/gi, 'especificaciones') || null,
    desempeno: [
      item('Motor / propulsión', row['Motor / propulsión']),
      item('Potencia', row['Potencia (HP)'] ? `${row['Potencia (HP)']} HP` : ''),
      item('Torque', row['Torque (lb-pie)'] ? `${row['Torque (lb-pie)']} lb-pie` : ''),
      item('Transmisión', transmision),
      item('Tracción', row['Tracción']),
      item('Rendimiento / autonomía', row['Rendimiento / autonomía']),
    ].filter(Boolean),
    seguridad,
    confort,
    diferencial,
  };
  return enrichPayload(payload);
}

/** Complemento oficial cuando el Excel trae poco detalle (p. ej. Equinox EV). */
const SPECS_ENRICHMENT = {
  'EQUINOX EV|RS': {
    fuente: 'https://www.chevrolet.com.mx/vehiculos-electricos/equinox-ev-suv-electrica-deportiva/especificaciones-automotriz',
    desempeno: [
      { label: 'Motor / propulsión', value: 'Motor eléctrico 180 kW · plataforma EV de GM · batería 10 módulos' },
      { label: 'Potencia', value: '241 HP' },
      { label: 'Torque', value: '236 lb-pie' },
      { label: 'Transmisión', value: 'Una velocidad / selector electrónico' },
      { label: 'Tracción', value: 'Delantera (FWD)' },
      { label: 'Autonomía', value: 'Hasta 513 km EPA por carga completa' },
      { label: 'Modos de manejo', value: 'Normal, Sport, Nieve y Mi Modo' },
      { label: 'Suspensión', value: 'Soft Ride' },
      { label: 'Dirección', value: 'Electroasistida (EPS)' },
    ],
    seguridad: [
      { label: 'Frenos', value: 'Frenos e-Boost / regeneración' },
      { label: 'Bolsas de aire', value: '8' },
      { label: 'Chevy Safety Assist', value: 'Frenado de emergencia automático, colisión frontal, abandono de carril, IntelliBeam' },
      { label: 'Cámaras / alertas', value: 'Cámara 360°, punto ciego, cruce trasero, peatones frente/atras, Teen Driver' },
      { label: 'Asiento conductor', value: 'Vibración con alertas de seguridad · lumbar 2 vías' },
    ],
    confort: [
      { label: 'Pantalla', value: 'Infoentretenimiento 17.7” HD · clúster 11” HD' },
      { label: 'Conectividad', value: 'Google integrado · OnStar 4G LTE con hotspot Wi-Fi' },
      { label: 'Carga', value: 'Cargador dual portátil 110 V / 220 V · carga inalámbrica smartphone' },
      { label: 'Pasajeros', value: '5' },
      { label: 'Cajuela', value: 'Hasta 1,620 L' },
      { label: 'Conducción', value: 'One-Pedal Driving · Regen On Demand · Auto-Hold' },
    ],
    diferencial: [
      { label: 'Equipamiento RS', value: 'Techo panorámico 2 paneles · rines aluminio 21” · iluminación full LED · volante deportivo 3 brazos · guía/asistencia de remolque' },
    ],
  },
};

function enrichPayload(payload) {
  const key = `${normalizeKey(payload.excelModelo)}|${normalizeKey(payload.excelVersion)}`;
  // También por clave de catálogo
  const catalogKey = EXCEL_MODELO_TO_CATALOG[normalizeKey(payload.excelModelo)];
  const enrich = SPECS_ENRICHMENT[`${catalogKey}|${normalizeKey(payload.excelVersion)}`]
    || SPECS_ENRICHMENT[key]
    || SPECS_ENRICHMENT[`${catalogKey}|RS`];
  if (!enrich) return payload;
  return {
    ...payload,
    fuente: enrich.fuente || payload.fuente,
    desempeno: enrich.desempeno || payload.desempeno,
    seguridad: enrich.seguridad || payload.seguridad,
    confort: enrich.confort || payload.confort,
    diferencial: enrich.diferencial || payload.diferencial,
  };
}

function versionScore(planVer, excelVer) {
  const a = normalizeKey(planVer);
  const b = normalizeKey(excelVer);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 88;

  // Aliases frecuentes planes ↔ ficha oficial
  const aliases = [
    ['LS MT', 'LS MANUAL'],
    ['LS AT', 'LS AUTOMATICA'],
    ['LT MT', 'LT MANUAL'],
    ['LT AT', 'LT AUTOMATICA'],
    ['LT AT', 'LT AUTOMATICA'],
    ['BLACK EDITION', 'LT TM BLACK EDITION'],
    ['LT 5', 'LT 5 PASAJEROS'],
    ['LT 7', 'LT 7 PASAJEROS'],
    ['ACTIV BI TONO', 'ACTIV BITONO'],
    ['CARGO LS', 'LS MANUAL'],
    ['SWB LT', 'VERSION CORTA'],
    ['LWB LT', 'VERSION LARGA'],
    ['CREW CAB', 'DOBLE CABINA'],
    ['CHASIS CABINA', 'CHASIS CABINA'],
    ['PREMIER REDLINE', 'PREMIER REDLINE'],
    ['WT V8 4X2 RC', 'CABINA REGULAR 4X2'],
    ['WT V8 4X4 RC', 'CABINA REGULAR 4X4'],
    ['CUSTOM 4X4 CC', 'CUSTOM'],
    ['LT 4X4', 'LT 4X4'],
    ['HIGH COUNTRY 6 2L', 'HIGH COUNTRY'],
    ['ZR2 BISON 4X4', 'ZR2 BISON'],
    ['ZR2 4X4', 'ZR2'],
    ['Z71 4X4', 'Z71'],
  ];
  for (const [x, y] of aliases) {
    if ((a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))) return 86;
    if ((a === x && b.includes(y)) || (b === y && a.includes(x))) return 90;
  }

  // Tokens sueltos útiles (Premier≈LT, etc.) se resuelven con overrides por modelo
  const aTok = a.split(' ').filter((t) => t.length > 1);
  const bTok = b.split(' ').filter((t) => t.length > 1);
  if (!aTok.length || !bTok.length) return 0;
  const hits = aTok.filter((t) => bTok.includes(t)).length;
  const ratio = hits / Math.max(aTok.length, bTok.length);
  if (ratio >= 0.75) return 70;
  if (ratio >= 0.5) return 50;
  return 0;
}

/** Forzar cruce plan → versión Excel cuando el nombre comercial no coincide 1:1 */
const PLAN_TO_EXCEL_VERSION = {
  TRAX: {
    LS: 'LT',
    Premier: 'LT',
    'Premier Black Edition': 'LT',
  },
  TAHOE: {
    LT: 'RST',
  },
  TRACKER: {
    'LT MT 4 cil.': 'LT MT',
    'LT AT CVT 4 cil.': 'LT AT',
    'RS AT CVT 4 cil.': 'RS',
    'LT AT 3 cil.': 'LT Automática',
    'PREMIER AT 3 cil.': 'Premier',
  },
  'GROOVE NG': {
    'LT MT 4 cil.': 'LT MT',
    'LT AT CVT 4 cil.': 'LT AT',
    'RS AT CVT 4 cil.': 'RS',
  },
  SILVERADO: {
    'WT V8 4x2 RC': 'Cabina Regular 4X2',
    'WT V8 4x4 RC': 'Cabina Regular 4X4',
    'Custom 4x4 CC': 'Custom',
    'LT 4x4': 'LT 4x4',
    'RST 4x4': 'RST',
    'High Country': 'High Country 6.2L',
    'ZR2 4x4': 'ZR2',
    'ZR2 Bison 4x4': 'ZR2 Bison',
  },
  COLORADO: {
    'Z71 4X4': 'Z71',
    'ZR2 4X4': 'ZR2',
  },
};

/** Cuando el plan está en TRACKER pero la ficha vive en Groove (mismo MSRP histórico) */
const CROSS_MODELO_EXCEL = {
  TRACKER: {
    'LT MT 4 cil.': { excelModelo: 'Groove', excelVersion: 'LT MT' },
    'LT AT CVT 4 cil.': { excelModelo: 'Groove', excelVersion: 'LT AT' },
    'RS AT CVT 4 cil.': { excelModelo: 'Groove', excelVersion: 'RS' },
  },
};

function loadPlanVersionsByModelo() {
  if (!fs.existsSync(PLANS_JSON)) return {};
  const catalog = JSON.parse(fs.readFileSync(PLANS_JSON, 'utf8'));
  const by = {};
  for (const section of Object.values(catalog.sections || {})) {
    for (const r of section.rows || []) {
      if (!r.modelo || !r.version) continue;
      if (!by[r.modelo]) by[r.modelo] = new Set();
      by[r.modelo].add(r.version);
    }
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, [...v]]));
}

function main() {
  const src = path.resolve(process.argv[2] || DEFAULT_XLSX);
  if (!fs.existsSync(src)) {
    console.error('No se encontró el Excel:', src);
    process.exit(1);
  }

  fs.copyFileSync(src, OUT_XLSX);

  const wb = XLSX.readFile(src);
  const sheetName = wb.SheetNames.find((n) => /versi/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  const planVersions = loadPlanVersionsByModelo();

  const out = {
    _meta: {
      sourceFile: path.basename(src),
      sheet: sheetName,
      importedAt: new Date().toISOString(),
      rows: rows.length,
    },
  };

  let mapped = 0;
  let skipped = 0;

  for (const row of rows) {
    const excelModelo = String(row['Modelo'] || '').trim();
    const excelVersion = String(row['Versión'] || '').trim();
    if (!excelModelo || !excelVersion) {
      skipped += 1;
      continue;
    }

    const catalogKey = EXCEL_MODELO_TO_CATALOG[normalizeKey(excelModelo)];
    if (!catalogKey) {
      // Modelos fuera del catálogo de planes (Corvette, BrightDrop, Blazer gas, etc.)
      const orphanKey = `_EXCEL_${normalizeKey(excelModelo).replace(/\s+/g, '_')}`;
      if (!out[orphanKey]) {
        out[orphanKey] = {
          carroceria: String(row['Categoría'] || '').trim() || null,
          excelModelo,
          inCatalog: false,
          byVersion: {},
        };
      }
      out[orphanKey].byVersion[excelVersion] = buildVersionPayload(row);
      skipped += 1;
      continue;
    }

    if (!out[catalogKey]) {
      out[catalogKey] = {
        carroceria: CARROCERIA_FROM_EXCEL[catalogKey] || String(row['Categoría'] || '').trim() || null,
        excelModelo,
        inCatalog: true,
        byVersion: {},
      };
    }

    const payload = buildVersionPayload(row);
    // Clave canónica = nombre Excel
    out[catalogKey].byVersion[excelVersion] = payload;

    // También indexar bajo versiones del catálogo de planes que coincidan
    const planVers = planVersions[catalogKey] || [];
    for (const pv of planVers) {
      const score = versionScore(pv, excelVersion);
      if (score < 70) continue;
      const existing = out[catalogKey].byVersion[pv];
      if (!existing || (existing._matchScore || 0) < score) {
        out[catalogKey].byVersion[pv] = { ...payload, _matchScore: score, _matchedFrom: excelVersion };
      }
    }
    mapped += 1;
  }

  // Overrides explícitos plan → Excel (todos los carlines, no solo Aveo)
  const excelIndex = new Map();
  for (const row of rows) {
    const em = String(row['Modelo'] || '').trim();
    const ev = String(row['Versión'] || '').trim();
    if (!em || !ev) continue;
    excelIndex.set(`${normalizeKey(em)}|${normalizeKey(ev)}`, buildVersionPayload(row));
  }

  for (const [catalogKey, map] of Object.entries(PLAN_TO_EXCEL_VERSION)) {
    if (!out[catalogKey]) continue;
    const excelModeloName = out[catalogKey].excelModelo || catalogKey;
    for (const [planVer, excelVer] of Object.entries(map)) {
      const payload = excelIndex.get(`${normalizeKey(excelModeloName)}|${normalizeKey(excelVer)}`)
        || out[catalogKey].byVersion[excelVer];
      if (!payload) continue;
      out[catalogKey].byVersion[planVer] = {
        ...payload,
        _matchScore: 95,
        _matchedFrom: excelVer,
      };
    }
  }

  for (const [catalogKey, map] of Object.entries(CROSS_MODELO_EXCEL)) {
    if (!out[catalogKey]) {
      out[catalogKey] = {
        carroceria: CARROCERIA_FROM_EXCEL[catalogKey] || null,
        excelModelo: catalogKey,
        inCatalog: true,
        byVersion: {},
      };
    }
    for (const [planVer, ref] of Object.entries(map)) {
      const payload = excelIndex.get(`${normalizeKey(ref.excelModelo)}|${normalizeKey(ref.excelVersion)}`);
      if (!payload) continue;
      out[catalogKey].byVersion[planVer] = {
        ...payload,
        _matchScore: 96,
        _matchedFrom: `${ref.excelModelo} / ${ref.excelVersion}`,
      };
    }
  }

  // default = primera versión de cada modelo
  for (const [key, entry] of Object.entries(out)) {
    if (key === '_meta' || !entry.byVersion) continue;
    const firstKey = Object.keys(entry.byVersion).find((k) => !entry.byVersion[k]._matchedFrom)
      || Object.keys(entry.byVersion)[0];
    if (firstKey) {
      const base = { ...entry.byVersion[firstKey] };
      delete base._matchScore;
      delete base._matchedFrom;
      entry.default = {
        desempeno: base.desempeno,
        seguridad: base.seguridad,
        confort: base.confort,
        diferencial: base.diferencial,
        fuente: base.fuente,
      };
    }
  }

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`OK → ${OUT_JSON}`);
  console.log(`Excel copiado → ${OUT_XLSX}`);
  console.log(`Filas Excel: ${rows.length} · mapeadas a catálogo: ${mapped} · fuera/omitidas: ${skipped}`);
  console.log('Modelos en JSON:', Object.keys(out).filter((k) => k !== '_meta').length);
}

main();
