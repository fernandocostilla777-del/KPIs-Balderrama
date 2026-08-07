/**
 * Parser de PDF "Planes Chevrolet" → catálogo JSON (Administración + Bono Toma a Cuenta).
 */
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const DATA_DIR = path.join(__dirname, '../../data');
const ACTIVE_JSON = path.join(DATA_DIR, 'planes-chevrolet-ago-my26.json');
const ACTIVE_PDF = path.join(DATA_DIR, 'planes-chevrolet-vigente.pdf');
const UPLOADS_DIR = path.join(DATA_DIR, 'planes-uploads');

const PLAN_TYPE_RE = /(CONTADO CON SEGURO|CONTADO|GMF TASA SUBSIDIADA CON SEGURO|GMF TASA SUBSIDIADA|GMF TASA TRADICIONAL|LEASING CON SEGURO|LEASING)/i;

/** Mapa Precio de Venta GMMX|versión → modelo (semilla; se refuerza con catálogo previo). */
const MSRP_VERSION_MODEL = [
  [319100, 'LS MANUAL', 'AVEO HB'],
  [346500, 'LT MANUAL', 'AVEO HB'],
  [378900, 'LT PLUS', 'AVEO HB'],
  [352600, 'BLACK EDITION', 'AVEO HB'],
  [332800, 'LS MANUAL', 'AVEO NB'],
  [358600, 'LT MANUAL', 'AVEO NB'],
  [390000, 'LT PLUS', 'AVEO NB'],
  [464200, 'ACTIV', 'SPARK EUV'],
  [464200, 'ACTIV BI-TONO', 'SPARK EUV'],
  [353100, 'LS / MT', 'ONIX'],
  [385500, 'LS / AT', 'ONIX'],
  [406800, 'LT / MT', 'ONIX'],
  [436100, 'LT / AT', 'ONIX'],
  [452300, 'PREMIER', 'ONIX'],
  [577500, 'LT', 'CAPTIVA HIBRIDA'],
  [608000, 'PREMIER', 'CAPTIVA HIBRIDA'],
  [421500, 'LT MT 4 CIL.', 'GROOVE/TRACKER'],
  [469300, 'LT AT CVT 4 CIL.', 'GROOVE/TRACKER'],
  [501400, 'RS AT CVT 4 CIL.', 'GROOVE/TRACKER'],
  [537500, 'LT AT 3 CIL.', 'TRACKER'],
  [582500, 'PREMIER AT 3 CIL.', 'TRACKER'],
  [530800, 'LT / 5', 'CAPTIVA'],
  [557800, 'LT / 7', 'CAPTIVA'],
  [553200, 'LS', 'TRAX'],
  [599300, 'LT', 'TRAX'],
  [601900, 'PREMIER', 'TRAX'],
  [614000, 'PREMIER BLACK EDITION', 'TRAX'],
  [635800, 'RS', 'TRAX'],
  [900000, 'RS', 'EQUINOX EV'],
  [900000, 'RS BITONO', 'EQUINOX EV'],
  [1226500, 'RS', 'BLAZER EV'],
  [1208600, 'LT', 'TRAVERSE'],
  [2056500, 'LT', 'TAHOE'],
  [2058500, 'RST', 'TAHOE'],
  [2130500, 'Z71', 'TAHOE'],
  [2139600, 'HIGH COUNTRY', 'TAHOE'],
  [2181100, 'RST', 'SUBURBAN'],
  [2260100, 'HIGH COUNTRY', 'SUBURBAN'],
  [468400, 'CHASIS CABINA 2.4 4X2', 'S10 MAX'],
  [490300, 'CREW CAB 2.4 4X2', 'S10 MAX'],
  [571700, 'LT 4X2 TA 1.2L TURBO', 'MONTANA'],
  [640900, 'RS 4X2 TA 1.2L TURBO', 'MONTANA'],
  [999500, 'WT V8 4X2 RC', 'SILVERADO'],
  [1058200, 'WT V8 4X4 RC', 'SILVERADO'],
  [1122000, 'Z71 4X4', 'COLORADO'],
  [1255700, 'ZR2 4X4', 'COLORADO'],
  [356200, 'CARGO LS', 'TORNADO VAN'],
  [787700, 'CARGO VAN', 'EXPRESS'],
  [1221300, 'CUSTOM 4X4 CC', 'SILVERADO'],
  [1240100, 'LT 4X4', 'SILVERADO'],
  [1453300, 'RST 4X4', 'SILVERADO'],
  [1772900, 'HIGH COUNTRY', 'SILVERADO'],
  [1836700, 'ZR2 4X4', 'SILVERADO'],
  [2006900, 'ZR2 BISON 4X4', 'SILVERADO'],
  [1079000, 'SWB LT', 'EXPRESS MAX EV'],
  [1158500, 'LWB LT', 'EXPRESS MAX EV'],
];

function normalizeSpace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(s) {
  return normalizeSpace(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function loadPreviousRows() {
  try {
    if (!fs.existsSync(ACTIVE_JSON)) return [];
    const catalog = JSON.parse(fs.readFileSync(ACTIVE_JSON, 'utf8'));
    const rows = [];
    for (const section of Object.values(catalog.sections || {})) {
      for (const r of section.rows || []) {
        if (r?.modelo && r?.version) rows.push(r);
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function resolveModeloFromPrevious(version, paquete, previousRows) {
  const v = normalizeKey(version);
  const sameVer = (previousRows || []).filter((r) => normalizeKey(r.version) === v && r.modelo);
  if (!sameVer.length) return null;
  const samePaq = sameVer.filter((r) => String(r.paquete || '') === String(paquete || ''));
  if (samePaq.length) return samePaq[0].modelo;
  const models = [...new Set(sameVer.map((r) => r.modelo))];
  if (models.length === 1) return models[0];
  return null;
}

function resolveModelo(version, msrp, paquete, previousRows = []) {
  const v = normalizeKey(version);
  const m = Number(msrp) || 0;

  if (v.includes('4 CIL') || v.includes('CVT 4')) {
    if ('ABC'.includes(paquete)) return 'GROOVE NG';
    if ('DEF'.includes(paquete)) return 'TRACKER';
  }

  for (const [price, ver, modelo] of MSRP_VERSION_MODEL) {
    if (price === m && normalizeKey(ver) === v) {
      if (modelo === 'GROOVE/TRACKER') {
        return 'ABC'.includes(paquete) ? 'GROOVE NG' : 'TRACKER';
      }
      return modelo;
    }
  }

  const fromPrev = resolveModeloFromPrevious(version, paquete, previousRows);
  if (fromPrev) return fromPrev;

  if (v.includes('ACTIV')) return 'SPARK EUV';
  if (v.includes('BLACK EDITION') && m > 0 && m < 400000) return 'AVEO HB';
  if (['LS MANUAL', 'LT MANUAL', 'LT PLUS'].includes(v)) {
    return 'DEF'.includes(paquete) ? 'AVEO NB' : 'AVEO HB';
  }
  if (v.includes('SWB') || v.includes('LWB')) return 'EXPRESS MAX EV';
  if (v.includes('CHASIS') || v.includes('CREW CAB 2.4')) return 'S10 MAX';
  if (v.includes('1.2L')) return 'MONTANA';
  if (v.includes('CARGO LS')) return 'TORNADO VAN';
  if (v.includes('CARGO VAN')) return 'EXPRESS';
  if (v.includes('WT V8')) return 'SILVERADO';
  if (v.includes('EQUINOX')) return 'EQUINOX EV';
  if (v.includes('BLAZER') && v.includes('EV')) return 'BLAZER EV';
  return null;
}

function parsePlanRow(line, { section, previousRows }) {
  const raw = normalizeSpace(line);
  if (!raw || raw.length < 20) return null;
  if (/^(Modelo|GUIA|APLICABLES|DESCUENTO|Dealer|Disfruta|Instalacion|Código|GMM|GMF MSRP)/i.test(raw)) return null;
  if (!PLAN_TYPE_RE.test(raw) || !/^[A-Z]\s+/.test(raw)) return null;

  const amounts = [];
  const amountRe = /\$([\d,]+)/g;
  let am;
  while ((am = amountRe.exec(raw))) amounts.push(Number(am[1].replace(/,/g, '')));
  const parenAmounts = [];
  const parenRe = /\(\$?([\d,]+)\)/g;
  while ((am = parenRe.exec(raw))) parenAmounts.push(Number(am[1].replace(/,/g, '')));

  if (amounts.length < 2) return null;

  const msrp = amounts[0];
  const precioFinal = amounts[amounts.length - 1];
  let bonificacion = 0;
  let descuento = 0;

  if (section === 'bono-toma-cuenta') {
    if (parenAmounts.length >= 2) {
      bonificacion = parenAmounts[0];
      descuento = parenAmounts[1];
    } else if (parenAmounts.length === 1) {
      descuento = parenAmounts[0];
    }
  } else if (parenAmounts.length >= 1) {
    bonificacion = parenAmounts[0];
  }

  const paquete = raw[0];
  const afterPaq = raw.slice(2);
  const tipoMatch = afterPaq.match(PLAN_TYPE_RE);
  if (!tipoMatch) return null;
  const tipoPago = normalizeSpace(tipoMatch[1]).toUpperCase();
  const beforeTipo = normalizeSpace(afterPaq.slice(0, tipoMatch.index));

  let letraPago = null;
  let version = beforeTipo;
  const letraMatch = beforeTipo.match(/\s+([LNUAEIG])$/i);
  if (letraMatch) {
    letraPago = letraMatch[1].toUpperCase();
    version = normalizeSpace(beforeTipo.slice(0, letraMatch.index));
  }

  const afterTipo = normalizeSpace(afterPaq.slice(tipoMatch.index + tipoMatch[0].length));
  const codeMatch = afterTipo.match(/^([A-Z]{2,4})\s+([A-Z0-9]{3,5})\b/);
  const codigoGmm = codeMatch ? codeMatch[1] : null;
  const codigoGmf = codeMatch ? codeMatch[2] : null;

  let extras = (codeMatch ? afterTipo.slice(codeMatch[0].length) : afterTipo)
    .replace(/\$[\d,]+/g, ' ')
    .replace(/\(\$?[\d,]+\)/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const seguroMatch = extras.match(/(\d+)\s*AÑO\s+([A-Z]+)/i);
  const tasaMatch = extras.match(/Tasa Especial desde\s+([\d.]+%)/i);
  const factorMatch = extras.match(/Factor de Arrendamiento:\s*([\d.]+%)/i);
  const engancheMatch = extras.match(/(\d+\/0%\s*-?\s*Enganche\s*>?\s*\d+%)/i);

  const modelo = resolveModelo(version, msrp, paquete, previousRows);

  return {
    section,
    modelo,
    anio: '2026',
    paquete,
    version,
    letraPago,
    tipoPago,
    codigoGmm,
    codigoGmf,
    msrp,
    bonificacion,
    descuento,
    precioFinal,
    ceroCxaGmf: /\bP\b/.test(extras),
    seguroGratis: seguroMatch ? `${seguroMatch[1]} AÑO ${seguroMatch[2].toUpperCase()}` : null,
    tasaGmf: tasaMatch ? tasaMatch[1] : (factorMatch ? `Factor ${factorMatch[1]}` : null),
    enganche: engancheMatch ? engancheMatch[1] : null,
    otros: extras || null,
    matchKey: `${normalizeKey(version)}|${msrp}`,
    raw,
  };
}

function parseTocRanges(pages) {
  const tocText = String(pages?.[0]?.text || pages?.find((p) => /Contenido/i.test(p.text || ''))?.text || '');
  const ranges = {
    vendedores: null,
    administracion: null,
    bonoTomaCuenta: null,
    preciosDistribuidor: null,
    preciosPublico: null,
    notas: null,
  };

  const patterns = [
    ['vendedores', /Gu[ií]a de planes para Vendedores\s*:?\s*(\d+)/i],
    ['administracion', /Gu[ií]a de planes para Administraci[oó]n\s*:?\s*(\d+)/i],
    ['bonoTomaCuenta', /Bono\s+Toma a Cuenta\s*:?\s*(\d+)/i],
    ['preciosDistribuidor', /Precios\s+Distribuidor\s*:?\s*(\d+)/i],
    ['preciosPublico', /Precios\s+al\s+P[uú]blico\s*:?\s*(\d+)/i],
    ['notas', /Notas\s+Aclaratorias\s*:?\s*(\d+)/i],
  ];

  for (const [key, re] of patterns) {
    const m = tocText.match(re);
    if (m) ranges[key] = Number(m[1]);
  }

  // Fallback clásico del formato mensual Chevrolet MY26
  if (!ranges.administracion) ranges.administracion = 10;
  if (!ranges.bonoTomaCuenta) ranges.bonoTomaCuenta = 18;
  if (!ranges.preciosDistribuidor) ranges.preciosDistribuidor = 22;

  const sectionRange = (start, endExclusive) => {
    if (!start) return null;
    const end = (endExclusive || start + 8) - 1;
    return { start, end: Math.max(start, end) };
  };

  return {
    toc: ranges,
    administracion: sectionRange(ranges.administracion, ranges.bonoTomaCuenta),
    bonoTomaCuenta: sectionRange(ranges.bonoTomaCuenta, ranges.preciosDistribuidor || ranges.preciosPublico || ranges.notas),
    ignored: {
      vendedores: sectionRange(ranges.vendedores, ranges.administracion),
      preciosDistribuidor: sectionRange(ranges.preciosDistribuidor, ranges.preciosPublico || ranges.notas),
      preciosPublico: sectionRange(ranges.preciosPublico, ranges.notas),
      notas: ranges.notas ? { start: ranges.notas, end: ranges.notas } : null,
    },
  };
}

function pageInRange(pageNum, range) {
  return Boolean(range && pageNum >= range.start && pageNum <= range.end);
}

function detectSection(pageNum, pageText, tocRanges) {
  const t = normalizeKey(pageText);

  // Señales fuertes de contenido (por si el TOC corre páginas)
  const isBonoContent = t.includes('DESCUENTO SOBRE PRECIO DE LISTA')
    || t.includes('PRECIO CON TOMA A CUENTA')
    || (t.includes('BONIFICACION') && t.includes('DESCUENTO') && t.includes('PRECIO FINAL'));
  const isVendedorContent = t.includes('GUIA RAPIDA PARA VENDEDOR')
    || t.includes('PARA VENDEDOR');
  const isAdminContent = t.includes('GUIA RAPIDA PARA ADMINISTRACION')
    || t.includes('PARA ADMINISTRACION DE VENTAS');

  if (isBonoContent) return 'bono-toma-cuenta';
  if (isVendedorContent) return null; // se ignora a propósito
  if (isAdminContent) return 'administracion';

  // Rangos del índice (fuente de verdad del PDF completo)
  if (tocRanges) {
    if (pageInRange(pageNum, tocRanges.bonoTomaCuenta)) return 'bono-toma-cuenta';
    if (pageInRange(pageNum, tocRanges.administracion)) return 'administracion';
    return null;
  }

  // Fallback fijo
  if (pageNum >= 10 && pageNum <= 17) return 'administracion';
  if (pageNum >= 18 && pageNum <= 21) return 'bono-toma-cuenta';
  return null;
}

function parsePage(pageNum, pageText, previousRows, tocRanges) {
  const section = detectSection(pageNum, pageText, tocRanges);
  if (!section) return [];
  const lines = pageText.split(/\r?\n/).map(normalizeSpace).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const parsed = parsePlanRow(line, { section, previousRows });
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => {
    const k = [
      r.section, r.modelo, r.paquete, r.version, r.tipoPago,
      r.codigoGmf, r.msrp, r.bonificacion, r.descuento, r.precioFinal, r.letraPago,
    ].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildCatalogPayload({ sourceFile, vigencia, admin, bonoTac, tocRanges }) {
  const unmatched = [...admin, ...bonoTac].filter((r) => !r.modelo);
  const modelos = [...new Set([...admin, ...bonoTac].map((r) => r.modelo).filter(Boolean))].sort();
  const tiposPago = [...new Set([...admin, ...bonoTac].map((r) => r.tipoPago).filter(Boolean))].sort();
  const adminRange = tocRanges?.administracion || { start: 10, end: 17 };
  const bonoRange = tocRanges?.bonoTomaCuenta || { start: 18, end: 21 };

  return {
    sourceFile,
    vigencia,
    parsedAt: new Date().toISOString(),
    toc: tocRanges?.toc || null,
    sections: {
      administracion: {
        label: 'Guía de planes para Administración',
        pageStart: adminRange.start,
        pageEnd: adminRange.end,
        columns: ['Precio de Venta GMMX', 'Bonificación', 'Precio Final', 'Seguro', 'Tasa', 'Otros'],
        rows: admin,
      },
      'bono-toma-cuenta': {
        label: 'Bono Toma a Cuenta',
        pageStart: bonoRange.start,
        pageEnd: bonoRange.end,
        columns: ['Precio de Venta GMMX', 'Bonificación', 'Descuento', 'Precio Final', 'Seguro', 'Tasa', 'Otros'],
        note: 'DESCUENTO SOBRE PRECIO DE LISTA (PRECIO CON TOMA A CUENTA)',
        rows: bonoTac,
      },
    },
    catalog: { modelos, tiposPago },
    stats: {
      administracion: admin.length,
      bonoTomaCuenta: bonoTac.length,
      sinModelo: unmatched.length,
      modelos: modelos.length,
      paginasAdministracion: `${adminRange.start}-${adminRange.end}`,
      paginasBonoTomaCuenta: `${bonoRange.start}-${bonoRange.end}`,
      ignoradas: 'Vendedores, Precios Distribuidor, Precios al Público, Notas',
    },
  };
}

/**
 * @param {Buffer} pdfBuffer
 * @param {{ sourceFile?: string, previousRows?: object[] }} [opts]
 */
async function parsePlanesPdfBuffer(pdfBuffer, opts = {}) {
  const previousRows = opts.previousRows || loadPreviousRows();
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  const vigenciaMatch = String(result.text || '').match(/APLICABLES A PARTIR DEL\s+([^\n]+)/i);
  const vigencia = vigenciaMatch ? normalizeSpace(vigenciaMatch[1]) : null;
  const tocRanges = parseTocRanges(result.pages || []);

  let admin = [];
  let bonoTac = [];
  for (const p of result.pages || []) {
    const num = Number(p.num || p.pageNumber || p.page || 0);
    const rows = parsePage(num, p.text || '', previousRows, tocRanges);
    for (const r of rows) {
      if (r.section === 'bono-toma-cuenta') bonoTac.push(r);
      else admin.push(r);
    }
  }

  admin = dedupe(admin);
  bonoTac = dedupe(bonoTac);

  if (!admin.length && !bonoTac.length) {
    const err = new Error('No se encontraron renglones de Administración ni Bono Toma a Cuenta. Suba el PDF completo de Planes Chevrolet del mes.');
    err.status = 400;
    throw err;
  }

  return buildCatalogPayload({
    sourceFile: opts.sourceFile || 'upload.pdf',
    vigencia,
    admin,
    bonoTac,
    tocRanges,
  });
}

async function parsePlanesPdfFile(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  return parsePlanesPdfBuffer(buf, { sourceFile: path.basename(pdfPath) });
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Publica un PDF como catálogo vigente de lista de precios.
 * @param {Buffer} pdfBuffer
 * @param {{ originalName?: string, uploadedBy?: string }} meta
 */
async function publishPlanesPdf(pdfBuffer, meta = {}) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = String(meta.originalName || 'planes-chevrolet.pdf')
    .replace(/[^\w.\-() áéíóúÁÉÍÓÚñÑ]+/g, '_')
    .slice(0, 120);
  const archivePdf = path.join(UPLOADS_DIR, `${stamp}_${safeName}`);
  const archiveJson = path.join(UPLOADS_DIR, `${stamp}_catalog.json`);

  fs.writeFileSync(archivePdf, pdfBuffer);

  const payload = await parsePlanesPdfBuffer(pdfBuffer, { sourceFile: safeName });
  payload.uploadedBy = meta.uploadedBy || null;
  payload.uploadedAt = new Date().toISOString();

  fs.writeFileSync(archiveJson, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(ACTIVE_PDF, pdfBuffer);
  fs.writeFileSync(ACTIVE_JSON, JSON.stringify(payload, null, 2), 'utf8');

  try {
    const listaPrecios = require('./listaPreciosService');
    if (typeof listaPrecios.invalidatePlansCache === 'function') {
      listaPrecios.invalidatePlansCache();
    }
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    vigencia: payload.vigencia,
    parsedAt: payload.parsedAt,
    sourceFile: payload.sourceFile,
    stats: payload.stats,
    catalog: payload.catalog,
    archive: path.basename(archivePdf),
  };
}

function getActivePlansMeta() {
  if (!fs.existsSync(ACTIVE_JSON)) {
    return {
      exists: false,
      vigencia: null,
      parsedAt: null,
      sourceFile: null,
      stats: null,
      uploadedAt: null,
      uploadedBy: null,
    };
  }
  try {
    const catalog = JSON.parse(fs.readFileSync(ACTIVE_JSON, 'utf8'));
    const st = fs.statSync(ACTIVE_JSON);
    return {
      exists: true,
      vigencia: catalog.vigencia || null,
      parsedAt: catalog.parsedAt || null,
      sourceFile: catalog.sourceFile || null,
      stats: catalog.stats || null,
      uploadedAt: catalog.uploadedAt || null,
      uploadedBy: catalog.uploadedBy || null,
      fileUpdatedAt: st.mtime.toISOString(),
      modelos: catalog.catalog?.modelos || [],
    };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

module.exports = {
  ACTIVE_JSON,
  ACTIVE_PDF,
  UPLOADS_DIR,
  parsePlanesPdfBuffer,
  parsePlanesPdfFile,
  publishPlanesPdf,
  getActivePlansMeta,
  loadPreviousRows,
};
