/**
 * Comparativo año vs año de ventas de autos nuevos por carline.
 * Misma definición que el tablero: factura tipo A, estatus I, situación VEN,
 * sin VENTAMRS ni VTACON. Carline = familia del catálogo (UNC_FAMILIA).
 *
 * Uso: node scripts/export-ventas-carline-yoy.js
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { query } = require('../src/db');
const { VENTAS_BASE_CTE } = require('../src/services/ventasNuevosFinanciero');

const HOY = '2026-10-16';
const ANIO_A = 2025;
const ANIO_B = 2026;
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const OUT = path.join(__dirname, '../data', 'ventas-carline-yoy-2025-2026.xlsx');

function num(value) {
  return Number(value || 0);
}

function pct(actual, base) {
  if (!base) return null;
  return Math.round(((actual - base) / base) * 1000) / 10;
}

async function loadRows() {
  return query(`
    ${VENTAS_BASE_CTE}
    SELECT
      YEAR(CONVERT(DATE, v.VTE_FECHDOCTO, 103)) AS anio,
      MONTH(CONVERT(DATE, v.VTE_FECHDOCTO, 103)) AS mes,
      DAY(CONVERT(DATE, v.VTE_FECHDOCTO, 103)) AS dia,
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))) AS carline,
      COUNT(*) AS unidades,
      SUM(CASE WHEN v.isFlotilla = 1 THEN 1 ELSE 0 END) AS flotilla,
      SUM(CAST(v.ventaSubtotal AS float)) AS subtotal
    FROM ventas v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    LEFT JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO
      AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    WHERE CONVERT(DATE, v.VTE_FECHDOCTO, 103) >= '2025-01-01'
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) <= '${HOY}'
    GROUP BY
      YEAR(CONVERT(DATE, v.VTE_FECHDOCTO, 103)),
      MONTH(CONVERT(DATE, v.VTE_FECHDOCTO, 103)),
      DAY(CONVERT(DATE, v.VTE_FECHDOCTO, 103)),
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA'))))
  `);
}

function inYtd(row) {
  if (row.mes < 10) return true;
  return row.mes === 10 && row.dia <= 16;
}

function inClosed(row) {
  return row.mes <= 9;
}

function accumulate(rows, keep) {
  const map = new Map();
  for (const row of rows) {
    if (!keep(row)) continue;
    const carline = String(row.carline || 'SIN FAMILIA').trim() || 'SIN FAMILIA';
    const year = num(row.anio);
    if (!map.has(carline)) {
      map.set(carline, {
        carline,
        uA: 0, uB: 0, fA: 0, fB: 0, sA: 0, sB: 0,
        mesesA: Array(12).fill(0),
        mesesB: Array(12).fill(0),
      });
    }
    const item = map.get(carline);
    const mes = num(row.mes) - 1;
    const unidades = num(row.unidades);
    const flotilla = num(row.flotilla);
    const subtotal = num(row.subtotal);
    if (year === ANIO_A) {
      item.uA += unidades;
      item.fA += flotilla;
      item.sA += subtotal;
      if (mes >= 0 && mes < 12) item.mesesA[mes] += unidades;
    } else if (year === ANIO_B) {
      item.uB += unidades;
      item.fB += flotilla;
      item.sB += subtotal;
      if (mes >= 0 && mes < 12) item.mesesB[mes] += unidades;
    }
  }
  return [...map.values()].sort((a, b) => b.uB - a.uB || b.uA - a.uA || a.carline.localeCompare(b.carline));
}

function resumenSheet(items, titulo, nota) {
  const header = [
    'Carline',
    `Unidades ${ANIO_A}`,
    `Unidades ${ANIO_B}`,
    'Diferencia uds',
    'Variación %',
    `Menudeo ${ANIO_A}`,
    `Menudeo ${ANIO_B}`,
    `Flotilla ${ANIO_A}`,
    `Flotilla ${ANIO_B}`,
    `Subtotal ${ANIO_A}`,
    `Subtotal ${ANIO_B}`,
    'Diferencia subtotal',
    'Variación subtotal %',
  ];
  const body = items.map((item) => {
    const menA = item.uA - item.fA;
    const menB = item.uB - item.fB;
    return [
      item.carline,
      item.uA,
      item.uB,
      item.uB - item.uA,
      pct(item.uB, item.uA),
      menA,
      menB,
      item.fA,
      item.fB,
      Math.round(item.sA * 100) / 100,
      Math.round(item.sB * 100) / 100,
      Math.round((item.sB - item.sA) * 100) / 100,
      pct(item.sB, item.sA),
    ];
  });
  const tot = items.reduce((acc, item) => {
    acc.uA += item.uA;
    acc.uB += item.uB;
    acc.fA += item.fA;
    acc.fB += item.fB;
    acc.sA += item.sA;
    acc.sB += item.sB;
    return acc;
  }, { uA: 0, uB: 0, fA: 0, fB: 0, sA: 0, sB: 0 });
  body.push([
    'TOTAL',
    tot.uA,
    tot.uB,
    tot.uB - tot.uA,
    pct(tot.uB, tot.uA),
    tot.uA - tot.fA,
    tot.uB - tot.fB,
    tot.fA,
    tot.fB,
    Math.round(tot.sA * 100) / 100,
    Math.round(tot.sB * 100) / 100,
    Math.round((tot.sB - tot.sA) * 100) / 100,
    pct(tot.sB, tot.sA),
  ]);
  return [
    [titulo],
    [nota],
    [],
    header,
    ...body,
  ];
}

function mensualSheet(items) {
  const meses = MESES.slice(0, 10);
  const header = ['Carline', ...meses.flatMap((m) => [`${m} ${ANIO_A}`, `${m} ${ANIO_B}`, `${m} dif`]), `YTD ${ANIO_A}`, `YTD ${ANIO_B}`, 'YTD dif'];
  const body = items.map((item) => {
    const cells = [item.carline];
    let ytdA = 0;
    let ytdB = 0;
    meses.forEach((_, index) => {
      const a = item.mesesA[index];
      const b = item.mesesB[index];
      ytdA += a;
      ytdB += b;
      cells.push(a, b, b - a);
    });
    cells.push(ytdA, ytdB, ytdB - ytdA);
    return cells;
  });
  return [
    ['Unidades por mes. Octubre va del 1 al 16 en ambos años.'],
    [],
    header,
    ...body,
  ];
}

function writeSheet(wb, name, aoa) {
  const ws = wb.addWorksheet(name);
  for (const row of aoa) ws.addRow(row);
  ws.getColumn(1).width = 28;
  return ws;
}

function chartTitle(text) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="es-MX" sz="1400" b="1"/><a:t>${text}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function strRef(formula, values) {
  const pts = values.map((value, index) => `<c:pt idx="${index}"><c:v>${escapeXml(value)}</c:v></c:pt>`).join('');
  return `<c:strRef><c:f>${formula}</c:f><c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache></c:strRef>`;
}

function numRef(formula, values) {
  const pts = values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('');
  return `<c:numRef><c:f>${formula}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache></c:numRef>`;
}

function seriesBar(idx, title, catFormula, cats, valFormula, vals, color) {
  return `<c:ser>
    <c:idx val="${idx}"/><c:order val="${idx}"/>
    <c:tx><c:v>${escapeXml(title)}</c:v></c:tx>
    <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>
    <c:cat>${strRef(catFormula, cats)}</c:cat>
    <c:val>${numRef(valFormula, vals)}</c:val>
  </c:ser>`;
}

function barChartXml(title, catFormula, cats, series) {
  const sers = series.map((s, i) => seriesBar(i, s.title, catFormula, cats, s.formula, s.values, s.color)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    ${chartTitle(title)}
    <c:plotArea><c:layout/>
      <c:barChart>
        <c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>
        ${sers}
        <c:axId val="1"/><c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="l"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>`;
}

function lineChartXml(title, catFormula, cats, series) {
  const sers = series.map((s, i) => `<c:ser>
    <c:idx val="${i}"/><c:order val="${i}"/>
    <c:tx><c:v>${escapeXml(s.title)}</c:v></c:tx>
    <c:spPr><a:ln w="25000"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:ln></c:spPr>
    <c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>
    <c:cat>${strRef(catFormula, cats)}</c:cat>
    <c:val>${numRef(s.formula, s.values)}</c:val>
    <c:smooth val="0"/>
  </c:ser>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    ${chartTitle(title)}
    <c:plotArea><c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/><c:varyColors val="0"/>
        ${sers}
        <c:marker val="1"/><c:axId val="1"/><c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>`;
}

function drawingXml() {
  const anchor = (fromRow, toRow, chartId, name) => `<xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId}" name="${name}"/><xdr:cNvGraphicFramePr><a:graphicFrameLocks/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${chartId}"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  ${anchor(1, 28, 1, 'Unidades por carline')}
  ${anchor(29, 46, 2, 'Tendencia mensual')}
</xdr:wsDr>`;
}

async function injectCharts(filePath, chartRows) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetTag = workbook.match(/<sheet[^>]*name="Graficas"[^>]*\/>/);
  if (!sheetTag) throw new Error('No está la hoja Graficas');
  const rid = sheetTag[0].match(/r:id="([^"]+)"/)[1];
  const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))[1].replace(/^\//, '');
  const sheetPath = target.startsWith('xl/') ? target : `xl/${target}`;
  const sheetFile = path.posix.basename(sheetPath);
  let sheetXml = await zip.file(sheetPath).async('string');
  if (!sheetXml.includes('<drawing ')) {
    sheetXml = sheetXml.replace('</worksheet>', '<drawing r:id="rIdChart"/></worksheet>');
    zip.file(sheetPath, sheetXml);
  }
  const relPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  zip.file(relPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`);
  zip.remove(`xl/worksheets/_rels/${sheetFile}.xml.rels`);
  const cats = chartRows.map((item) => item.carline);
  const lastCarline = cats.length + 1;
  const months = MESES.slice(0, 10);
  const monthA = months.map((_, index) => chartRows.reduce((sum, row) => sum + row.mesesA[index], 0));
  const monthB = months.map((_, index) => chartRows.reduce((sum, row) => sum + row.mesesB[index], 0));
  const catFormula = `'Datos graficas'!$A$2:$A$${lastCarline}`;
  const mesFormula = `'Datos graficas'!$E$2:$E$11`;
  zip.file('xl/drawings/drawing1.xml', drawingXml());
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>
</Relationships>`);
  zip.file('xl/charts/chart1.xml', barChartXml(
    'Unidades por carline, 1 ene al 16 oct',
    catFormula,
    cats,
    [
      { title: String(ANIO_A), formula: `'Datos graficas'!$B$2:$B$${lastCarline}`, values: chartRows.map((item) => item.uA), color: '64748B' },
      { title: String(ANIO_B), formula: `'Datos graficas'!$C$2:$C$${lastCarline}`, values: chartRows.map((item) => item.uB), color: '2563EB' },
    ],
  ));
  zip.file('xl/charts/chart2.xml', lineChartXml(
    'Unidades por mes, enero a octubre',
    mesFormula,
    months,
    [
      { title: String(ANIO_A), formula: `'Datos graficas'!$F$2:$F$11`, values: monthA, color: '64748B' },
      { title: String(ANIO_B), formula: `'Datos graficas'!$G$2:$G$11`, values: monthB, color: '2563EB' },
    ],
  ));
  let types = await zip.file('[Content_Types].xml').async('string');
  if (!types.includes('/xl/charts/chart1.xml')) {
    types = types.replace('</Types>', `<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`);
    zip.file('[Content_Types].xml', types);
  }
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, out);
}

(async () => {
  const rows = await loadRows();
  const ytd = accumulate(rows, inYtd);
  const closed = accumulate(rows, inClosed);
  const chartRows = [...ytd].sort((a, b) => a.uB - b.uB || a.carline.localeCompare(b.carline));
  const datos = [
    ['Carline', String(ANIO_A), String(ANIO_B), '', 'Mes', String(ANIO_A), String(ANIO_B)],
    ...chartRows.map((item, index) => {
      const mes = MESES[index];
      const mesA = index < 10 ? ytd.reduce((s, row) => s + row.mesesA[index], 0) : '';
      const mesB = index < 10 ? ytd.reduce((s, row) => s + row.mesesB[index], 0) : '';
      return [item.carline, item.uA, item.uB, '', mes || '', mesA, mesB];
    }),
  ];
  const wb = new ExcelJS.Workbook();
  writeSheet(wb, 'Graficas', [
    ['Comparativo de ventas por carline. Las gráficas usan la hoja Datos graficas.'],
  ]);
  writeSheet(wb, 'Datos graficas', datos);
  writeSheet(wb, 'YTD comparable', resumenSheet(
    ytd,
    'Ventas por carline · 1 ene al 16 oct',
    '2026 contra el mismo periodo de 2025. Subtotal sin IVA. Menudeo = unidades menos flotilla (FLOT y FLOTGMF).',
  ));
  writeSheet(wb, 'Ene-Sep', resumenSheet(
    closed,
    'Ventas por carline · meses cerrados ene-sep',
    'Enero a septiembre completos, 2025 contra 2026.',
  ));
  writeSheet(wb, 'Unidades por mes', mensualSheet(ytd));
  writeSheet(wb, 'Notas', [
    ['Criterio'],
    ['Fuente', 'ADE_VTAFI + SER_VEHICULO + UNI_CATALOGO'],
    ['Documento', 'Tipo A, estatus I, vehículo en situación VEN'],
    ['Excluye', 'Formas de pago VENTAMRS y VTACON'],
    ['Incluye', 'Menudeo y flotilla (FLOT, FLOTGMF)'],
    ['Carline', 'UNC_FAMILIA del catálogo. Si no hay familia: SIN FAMILIA'],
    ['Importe', 'Subtotal de venta, sin IVA'],
    ['Corte', HOY],
    ['Graficas', 'Unidades 2025 vs 2026 por carline, y unidades por mes de enero a octubre'],
  ]);
  let out = OUT;
  try {
    await wb.xlsx.writeFile(out);
  } catch (err) {
    if (err.code !== 'EBUSY') throw err;
    out = OUT.replace(/\.xlsx$/, '-graficas.xlsx');
    await wb.xlsx.writeFile(out);
  }
  await injectCharts(out, chartRows);
  const total = ytd.reduce((s, item) => s + item.uB, 0);
  console.log(JSON.stringify({ archivo: out, carlines: ytd.length, unidades2026ytd: total, graficas: 2 }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(String(err.message || err).slice(0, 800));
  process.exit(1);
});
