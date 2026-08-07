/**
 * Parsea Planes Chevrolet MY26 → JSON (Guía Administración + Bono Toma a Cuenta).
 * Uso: node scripts/parse-planes-pdf.js [ruta.pdf]
 */
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const DEFAULT_PDF = path.join(__dirname, '../data/planes-chevrolet-ago-my26.pdf');
const OUT_JSON = path.join(__dirname, '../data/planes-chevrolet-ago-my26.json');

const PLAN_TYPE_RE = /(CONTADO CON SEGURO|CONTADO|GMF TASA SUBSIDIADA CON SEGURO|GMF TASA SUBSIDIADA|GMF TASA TRADICIONAL|LEASING CON SEGURO|LEASING)/i;

function normalizeSpace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(s) {
  return normalizeSpace(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/** Mapa MSRP|versión normalizada → modelo de línea (catálogo ago/2026). */
const MSRP_VERSION_MODEL = [
  // AVEO HB
  [319100, 'LS MANUAL', 'AVEO HB'],
  [346500, 'LT MANUAL', 'AVEO HB'],
  [378900, 'LT PLUS', 'AVEO HB'],
  [352600, 'BLACK EDITION', 'AVEO HB'],
  // AVEO NB
  [332800, 'LS MANUAL', 'AVEO NB'],
  [358600, 'LT MANUAL', 'AVEO NB'],
  [390000, 'LT PLUS', 'AVEO NB'],
  // SPARK EUV
  [464200, 'ACTIV', 'SPARK EUV'],
  [464200, 'ACTIV BI-TONO', 'SPARK EUV'],
  // ONIX
  [353100, 'LS / MT', 'ONIX'],
  [385500, 'LS / AT', 'ONIX'],
  [406800, 'LT / MT', 'ONIX'],
  [436100, 'LT / AT', 'ONIX'],
  [452300, 'PREMIER', 'ONIX'],
  // CAPTIVA HIBRIDA
  [577500, 'LT', 'CAPTIVA HIBRIDA'],
  [608000, 'PREMIER', 'CAPTIVA HIBRIDA'],
  // GROOVE NG (paq A-C) / TRACKER (paq D-F) same MSRP+version
  [421500, 'LT MT 4 CIL.', 'GROOVE/TRACKER'],
  [469300, 'LT AT CVT 4 CIL.', 'GROOVE/TRACKER'],
  [501400, 'RS AT CVT 4 CIL.', 'GROOVE/TRACKER'],
  [537500, 'LT AT 3 CIL.', 'TRACKER'],
  [582500, 'PREMIER AT 3 CIL.', 'TRACKER'],
  // CAPTIVA gas
  [530800, 'LT / 5', 'CAPTIVA'],
  [557800, 'LT / 7', 'CAPTIVA'],
  // TRAX
  [553200, 'LS', 'TRAX'],
  [599300, 'LT', 'TRAX'],
  [601900, 'PREMIER', 'TRAX'],
  [614000, 'PREMIER BLACK EDITION', 'TRAX'],
  [635800, 'RS', 'TRAX'],
  // EQUINOX EV / BLAZER EV
  [900000, 'RS', 'EQUINOX EV'],
  [900000, 'RS BITONO', 'EQUINOX EV'],
  [1226500, 'RS', 'BLAZER EV'],
  // TRAVERSE / TAHOE / SUBURBAN
  [1208600, 'LT', 'TRAVERSE'],
  [2056500, 'LT', 'TAHOE'],
  [2058500, 'RST', 'TAHOE'],
  [2130500, 'Z71', 'TAHOE'],
  [2139600, 'HIGH COUNTRY', 'TAHOE'],
  [2181100, 'RST', 'SUBURBAN'],
  [2260100, 'HIGH COUNTRY', 'SUBURBAN'],
  // S10 / MONTANA / COLORADO / SILVERADO RC
  [468400, 'CHASIS CABINA 2.4 4X2', 'S10 MAX'],
  [490300, 'CREW CAB 2.4 4X2', 'S10 MAX'],
  [571700, 'LT 4X2 TA 1.2L TURBO', 'MONTANA'],
  [640900, 'RS 4X2 TA 1.2L TURBO', 'MONTANA'],
  [999500, 'WT V8 4X2 RC', 'SILVERADO'],
  [1058200, 'WT V8 4X4 RC', 'SILVERADO'],
  [1122000, 'Z71 4X4', 'COLORADO'],
  [1255700, 'ZR2 4X4', 'COLORADO'],
  // TORNADO / EXPRESS / SILVERADO crew
  [356200, 'CARGO LS', 'TORNADO VAN'],
  [787700, 'CARGO VAN', 'EXPRESS'],
  [1221300, 'CUSTOM 4X4 CC', 'SILVERADO'],
  [1240100, 'LT 4X4', 'SILVERADO'],
  [1453300, 'RST 4X4', 'SILVERADO'],
  [1772900, 'HIGH COUNTRY', 'SILVERADO'],
  [1836700, 'ZR2 4X4', 'SILVERADO'],
  [2006900, 'ZR2 BISON 4X4', 'SILVERADO'],
  // EXPRESS MAX EV
  [1079000, 'SWB LT', 'EXPRESS MAX EV'],
  [1158500, 'LWB LT', 'EXPRESS MAX EV'],
];

function resolveModelo(version, msrp, paquete) {
  const v = normalizeKey(version);
  const m = Number(msrp) || 0;

  // GROOVE vs TRACKER por paquete cuando MSRP coincide
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

  // fallback fuzzy by version tokens
  if (v.includes('ACTIV')) return 'SPARK EUV';
  if (v.includes('BLACK EDITION') && m < 400000) return 'AVEO HB';
  if (['LS MANUAL', 'LT MANUAL', 'LT PLUS'].includes(v)) {
    return 'DEF'.includes(paquete) ? 'AVEO NB' : 'AVEO HB';
  }
  if (v.includes('SWB') || v.includes('LWB')) return 'EXPRESS MAX EV';
  if (v.includes('CHASIS') || v.includes('CREW CAB 2.4')) return 'S10 MAX';
  if (v.includes('1.2L')) return 'MONTANA';
  if (v.includes('CARGO LS')) return 'TORNADO VAN';
  if (v.includes('CARGO VAN')) return 'EXPRESS';
  if (v.includes('WT V8')) return 'SILVERADO';
  return null;
}

function parsePlanRow(line, { section }) {
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

  const modelo = resolveModelo(version, msrp, paquete);
  const anio = '2026';

  return {
    section,
    modelo,
    anio,
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

function parsePage(pageNum, pageText) {
  let section = null;
  if (pageNum >= 10 && pageNum <= 17) section = 'administracion';
  else if (pageNum >= 18 && pageNum <= 21) section = 'bono-toma-cuenta';
  else return [];

  const lines = pageText.split(/\r?\n/).map(normalizeSpace).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const parsed = parsePlanRow(line, { section });
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

async function main() {
  const pdfPath = process.argv[2] || DEFAULT_PDF;
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF no encontrado:', pdfPath);
    process.exit(1);
  }

  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  const result = await parser.getText();
  const vigenciaMatch = String(result.text || '').match(/APLICABLES A PARTIR DEL\s+([^\n]+)/i);
  const vigencia = vigenciaMatch ? normalizeSpace(vigenciaMatch[1]) : null;

  let admin = [];
  let bonoTac = [];
  for (const p of result.pages || []) {
    const num = Number(p.num || p.pageNumber || p.page || 0);
    const rows = parsePage(num, p.text || '');
    if (num >= 10 && num <= 17) admin = admin.concat(rows);
    if (num >= 18 && num <= 21) bonoTac = bonoTac.concat(rows);
  }

  admin = dedupe(admin);
  bonoTac = dedupe(bonoTac);

  const unmatched = [...admin, ...bonoTac].filter((r) => !r.modelo);
  const modelos = [...new Set([...admin, ...bonoTac].map((r) => r.modelo).filter(Boolean))].sort();
  const tiposPago = [...new Set([...admin, ...bonoTac].map((r) => r.tipoPago).filter(Boolean))].sort();

  const payload = {
    sourceFile: path.basename(pdfPath),
    vigencia,
    parsedAt: new Date().toISOString(),
    sections: {
      administracion: {
        label: 'Guía de planes para Administración',
        pageStart: 10,
        pageEnd: 17,
        columns: ['MSRP', 'Bonificación', 'Precio Final', 'Seguro', 'Tasa', 'Otros'],
        rows: admin,
      },
      'bono-toma-cuenta': {
        label: 'Bono Toma a Cuenta',
        pageStart: 18,
        pageEnd: 21,
        columns: ['MSRP', 'Bonificación', 'Descuento', 'Precio Final', 'Seguro', 'Tasa', 'Otros'],
        note: 'DESCUENTO SOBRE PRECIO DE LISTA (PRECIO CON TOMA A CUENTA)',
        rows: bonoTac,
      },
    },
    catalog: { modelos, tiposPago },
    stats: {
      administracion: admin.length,
      bonoTomaCuenta: bonoTac.length,
      sinModelo: unmatched.length,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload.stats, null, 2));
  console.log('modelos', modelos);
  if (unmatched.length) {
    console.log('sin modelo sample:');
    unmatched.slice(0, 15).forEach((r) => console.log(r.msrp, r.version, r.paquete));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
