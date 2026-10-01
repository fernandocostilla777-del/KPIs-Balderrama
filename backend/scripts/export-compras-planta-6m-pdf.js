/**
 * PDF: Compras a planta GM — últimos 6 meses (con gráficos).
 * node scripts/export-compras-planta-6m-pdf.js [rutaSalida]
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const META = 5_600_000;

const MENSUAL = [
  { label: 'Mar', full: 'Mar 2026', docs: 83, compra: 6_342_551, devolucion: 422_234, neto: 5_920_317, piezas: 15_038 },
  { label: 'Abr', full: 'Abr 2026', docs: 111, compra: 8_125_384, devolucion: 396_257, neto: 7_729_127, piezas: 27_679 },
  { label: 'May', full: 'May 2026', docs: 118, compra: 7_975_254, devolucion: 433_741, neto: 7_541_513, piezas: 12_731 },
  { label: 'Jun', full: 'Jun 2026', docs: 95, compra: 5_131_895, devolucion: 1_489_663, neto: 3_642_232, piezas: 10_063 },
  { label: 'Jul', full: 'Jul 2026', docs: 90, compra: 6_028_086, devolucion: 917_639, neto: 5_110_447, piezas: 10_642 },
  { label: 'Ago', full: 'Ago 2026', docs: 115, compra: 4_386_104, devolucion: 942_365, neto: 3_443_739, piezas: 5_493 },
];

const SEP = { label: 'Sep*', full: 'Sep 2026*', docs: 15, compra: 999_522, devolucion: 42_299, neto: 957_223, piezas: 2_632 };

function mx(n) {
  return Number(n || 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function mxM(n) {
  return `$${(Number(n) / 1_000_000).toLocaleString('es-MX', { maximumFractionDigits: 2 })} M`;
}

const netoTotal = MENSUAL.reduce((s, r) => s + r.neto, 0);
const compraTotal = MENSUAL.reduce((s, r) => s + r.compra, 0);
const devTotal = MENSUAL.reduce((s, r) => s + r.devolucion, 0);
const piezasTotal = MENSUAL.reduce((s, r) => s + r.piezas, 0);
const docsTotal = MENSUAL.reduce((s, r) => s + r.docs, 0);
const avgNeto = Math.round(netoTotal / MENSUAL.length);
const avgCompra = Math.round(compraTotal / MENSUAL.length);
const pctDev = Math.round((devTotal / compraTotal) * 1000) / 10;
const vsMeta = avgNeto - META;

const OUT = process.argv[2]
  || path.join(
    process.env.USERPROFILE || __dirname,
    'Desktop',
    `compras-planta-gm-6m-${new Date().toISOString().slice(0, 10)}.pdf`,
  );

const COLORS = {
  slate: '#64748B',
  blue: '#2563EB',
  teal: '#0F766E',
  amber: '#D97706',
  rose: '#E11D48',
  grid: '#E2E8F0',
  text: '#0F172A',
  muted: '#475569',
  soft: '#F8FAFC',
};

function drawGroupedBarChart(doc, {
  x, y, width, height,
  categories,
  series, // [{ name, values[], color }]
  yMax,
  referenceLine, // { value, label, color }
  title,
}) {
  const padL = 42;
  const padR = 12;
  const padT = 28;
  const padB = 36;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxVal = yMax || Math.max(...series.flatMap((s) => s.values), referenceLine?.value || 0) * 1.1;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(title, x, y, { width });

  // background
  doc.save();
  doc.roundedRect(x, y + 16, width, height - 16, 4).fill(COLORS.soft);
  doc.restore();

  // grid + y labels
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.slate);
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const gy = plotY + plotH - t * plotH;
    const val = maxVal * t;
    doc.strokeColor(COLORS.grid).lineWidth(0.5)
      .moveTo(plotX, gy).lineTo(plotX + plotW, gy).stroke();
    doc.fillColor(COLORS.slate)
      .text(val >= 1 ? val.toFixed(1) : val.toFixed(2), x, gy - 4, { width: padL - 4, align: 'right' });
  }

  // reference line (meta)
  if (referenceLine && Number.isFinite(referenceLine.value)) {
    const ry = plotY + plotH - (referenceLine.value / maxVal) * plotH;
    doc.save();
    doc.strokeColor(referenceLine.color || COLORS.amber).lineWidth(1)
      .dash(3, { space: 2 })
      .moveTo(plotX, ry).lineTo(plotX + plotW, ry).stroke();
    doc.undash();
    doc.font('Helvetica').fontSize(7).fillColor(referenceLine.color || COLORS.amber)
      .text(referenceLine.label || '', plotX + plotW - 70, ry - 10, { width: 68, align: 'right' });
    doc.restore();
  }

  const n = categories.length;
  const groupW = plotW / n;
  const barGap = 3;
  const barW = Math.min(18, (groupW - 10 - barGap * (series.length - 1)) / series.length);

  categories.forEach((cat, i) => {
    const groupX = plotX + i * groupW + (groupW - (barW * series.length + barGap * (series.length - 1))) / 2;
    series.forEach((s, si) => {
      const v = Number(s.values[i] || 0);
      const bh = Math.max(0, (v / maxVal) * plotH);
      const bx = groupX + si * (barW + barGap);
      const by = plotY + plotH - bh;
      doc.rect(bx, by, barW, bh).fill(s.color);
    });
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(cat, plotX + i * groupW, plotY + plotH + 6, { width: groupW, align: 'center' });
  });

  // legend
  let lx = plotX;
  const ly = y + height - 12;
  series.forEach((s) => {
    doc.rect(lx, ly, 8, 8).fill(s.color);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(s.name, lx + 11, ly - 1);
    lx += doc.widthOfString(s.name) + 28;
  });

  return y + height;
}

function drawTable(doc, headers, rows, colWidths, startY) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;
  let y = startY;
  const rowH = 17;
  const fontSize = 8;

  const drawRow = (cells, { header = false, zebra = false } = {}) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 36) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    if (zebra) {
      doc.save();
      doc.rect(x0, y - 2, pageWidth, rowH).fill('#F1F5F9');
      doc.restore();
    }
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#0F172A');
    let x = x0;
    cells.forEach((cell, i) => {
      const w = colWidths[i];
      doc.text(String(cell), x + 2, y, { width: w - 4, align: i === 0 ? 'left' : 'right', lineBreak: false });
      x += w;
    });
    y += rowH;
  };

  drawRow(headers, { header: true });
  doc.moveTo(x0, y - 2).lineTo(x0 + pageWidth, y - 2).strokeColor('#CBD5E1').lineWidth(0.6).stroke();
  rows.forEach((r, idx) => drawRow(r, { zebra: idx % 2 === 1 }));
  return y;
}

function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 42, bottom: 42, left: 42, right: 42 },
    info: {
      Title: 'Compras a planta GM — últimos 6 meses',
      Author: 'Dashboard Balderrama',
      Subject: 'PAR_MOVTOS tipo 01-51 · GENERAL MOTORS DE MEXICO',
    },
  });
  const stream = fs.createWriteStream(OUT);
  doc.pipe(stream);

  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.text)
    .text('Compras a planta GM — últimos 6 meses');
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
    .text('GENERAL MOTORS DE MÉXICO (proveedor 2) · tipo 01 COMPRAS PLANTA − 51 DEV');
  doc.text('Periodo cerrado: marzo–agosto 2026 · Septiembre parcial (corte ~07/09/2026)');
  doc.text(`Generado: ${new Date().toLocaleString('es-MX')}`);
  doc.moveDown(0.7);

  // KPI boxes
  const boxW = (contentW - 24) / 4;
  const boxY = doc.y;
  const kpis = [
    { label: 'Neto promedio / mes', value: mxM(avgNeto) },
    { label: 'Meta mensual', value: mxM(META) },
    { label: 'Gap vs meta', value: `${vsMeta >= 0 ? '+' : ''}${mxM(vsMeta)}` },
    { label: 'Devoluciones / bruto', value: `${pctDev}%` },
  ];
  kpis.forEach((k, i) => {
    const x = left + i * (boxW + 8);
    doc.roundedRect(x, boxY, boxW, 48, 4).strokeColor('#CBD5E1').lineWidth(0.8).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.slate).text(k.label, x + 7, boxY + 7, { width: boxW - 14 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text).text(k.value, x + 7, boxY + 22, { width: boxW - 14 });
  });
  doc.y = boxY + 58;

  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted)
    .text(
      `En los 6 meses cerrados el neto promedio fue ${mx(avgNeto)} — prácticamente a la meta de $5.6 M `
      + `(${vsMeta >= 0 ? '+' : ''}${mx(vsMeta)}). Compra bruta promedio ${mxM(avgCompra)}; `
      + `devoluciones = ${pctDev}% del bruto.`,
      { align: 'justify' },
    );
  doc.moveDown(0.7);

  // Chart 1: compra vs neto
  const chartData = [...MENSUAL, SEP];
  const chart1Y = doc.y;
  drawGroupedBarChart(doc, {
    x: left,
    y: chart1Y,
    width: contentW,
    height: 168,
    title: 'Compra bruta vs neto mensual (millones MXN)',
    categories: chartData.map((r) => r.label),
    yMax: 9,
    referenceLine: { value: 5.6, label: 'Meta 5.6', color: COLORS.amber },
    series: [
      { name: 'Compra bruta', values: chartData.map((r) => r.compra / 1e6), color: COLORS.blue },
      { name: 'Neto (compra − dev)', values: chartData.map((r) => r.neto / 1e6), color: COLORS.teal },
    ],
  });
  doc.y = chart1Y + 176;

  // Chart 2: gap vs meta (solo cerrados)
  const chart2Y = doc.y;
  const gaps = MENSUAL.map((r) => (r.neto - META) / 1e6);
  const gapMax = Math.max(2.5, ...gaps.map(Math.abs)) * 1.15;
  drawGapChart(doc, {
    x: left,
    y: chart2Y,
    width: contentW,
    height: 140,
    title: 'Brecha del neto vs meta $5.6 M (millones MXN)',
    categories: MENSUAL.map((r) => r.label),
    values: gaps,
    yAbsMax: gapMax,
  });
  doc.y = chart2Y + 148;
  doc.font('Helvetica-Oblique').fontSize(7).fillColor(COLORS.slate)
    .text('Sep* en el primer gráfico es mes parcial. El segundo gráfico usa solo meses cerrados.');

  // New page for table + narrative
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text).text('Detalle mensual');
  doc.moveDown(0.35);

  const colW = [72, 36, 78, 78, 78, 78, 54];
  const headers = ['Mes', 'Docs', 'Compra', 'Devoluciones', 'Neto', 'vs 5.6 M', 'Piezas'];
  const rows = [
    ...MENSUAL.map((r) => {
      const gap = r.neto - META;
      return [
        r.full,
        String(r.docs),
        mx(r.compra),
        mx(r.devolucion),
        mx(r.neto),
        `${gap >= 0 ? '+' : ''}${mx(gap)}`,
        r.piezas.toLocaleString('es-MX'),
      ];
    }),
    [
      SEP.full,
      String(SEP.docs),
      mx(SEP.compra),
      mx(SEP.devolucion),
      mx(SEP.neto),
      '—',
      SEP.piezas.toLocaleString('es-MX'),
    ],
  ];
  let y = drawTable(doc, headers, rows, colW, doc.y);
  doc.y = y + 10;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text).text('Totales marzo–agosto (cerrados)');
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  [
    ['Compra bruta', mx(compraTotal)],
    ['Devoluciones', mx(devTotal)],
    ['Neto', mx(netoTotal)],
    ['Documentos de compra', String(docsTotal)],
    ['Piezas netas', piezasTotal.toLocaleString('es-MX')],
  ].forEach(([a, b]) => {
    doc.font('Helvetica').text(`${a}: `, { continued: true }).font('Helvetica-Bold').text(b);
  });

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text).text('Lectura operativa');
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  doc.text(`• Pico: abril (${mxM(7_729_127)} neto) con más piezas (27.7k).`);
  doc.text(`• Piso: agosto (${mxM(3_443_739)} neto) — el más bajo de los 6 cerrados (~$0.94 M en devoluciones).`);
  doc.text(`• Junio: peor ratio de devolución (~29% del bruto); neto ${mxM(3_642_232)}.`);
  doc.text('• Tendencia: neto promedio Mar–May ~$7.1 M; Jun–Ago ~$4.1 M. La compra se desaceleró en la 2ª mitad del semestre.');

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(7.5).fillColor('#94A3B8')
    .text('Fuente: PAR_MOVTOS + PAR_MOVDET · Mov_Idpersona = 2 · Dashboard Balderrama KPIs');

  doc.end();
  stream.on('finish', () => console.log('PDF generado:', OUT));
}

/** Barras positivas/negativas centradas en 0 (gap vs meta). */
function drawGapChart(doc, {
  x, y, width, height, title, categories, values, yAbsMax,
}) {
  const padL = 42;
  const padR = 12;
  const padT = 28;
  const padB = 32;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const zeroY = plotY + plotH / 2;
  const maxAbs = yAbsMax || Math.max(...values.map(Math.abs), 0.5) * 1.1;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(title, x, y, { width });
  doc.save();
  doc.roundedRect(x, y + 16, width, height - 16, 4).fill(COLORS.soft);
  doc.restore();

  // zero line
  doc.strokeColor(COLORS.slate).lineWidth(0.8)
    .moveTo(plotX, zeroY).lineTo(plotX + plotW, zeroY).stroke();
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.slate)
    .text('0', x, zeroY - 4, { width: padL - 4, align: 'right' });
  doc.text(maxAbs.toFixed(1), x, plotY - 2, { width: padL - 4, align: 'right' });
  doc.text((-maxAbs).toFixed(1), x, plotY + plotH - 6, { width: padL - 4, align: 'right' });

  const n = categories.length;
  const groupW = plotW / n;
  const barW = Math.min(22, groupW * 0.45);

  categories.forEach((cat, i) => {
    const v = Number(values[i] || 0);
    const bh = Math.abs(v / maxAbs) * (plotH / 2);
    const bx = plotX + i * groupW + (groupW - barW) / 2;
    const by = v >= 0 ? zeroY - bh : zeroY;
    doc.rect(bx, by, barW, Math.max(bh, 0.5)).fill(v >= 0 ? COLORS.teal : COLORS.rose);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(cat, plotX + i * groupW, plotY + plotH + 6, { width: groupW, align: 'center' });
  });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
  doc.rect(plotX, y + height - 12, 8, 8).fill(COLORS.teal);
  doc.text('Sobre meta', plotX + 11, y + height - 13);
  doc.rect(plotX + 80, y + height - 12, 8, 8).fill(COLORS.rose);
  doc.text('Bajo meta', plotX + 91, y + height - 13);
}

main();
