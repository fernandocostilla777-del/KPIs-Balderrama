/**
 * Exporta Cuadre de Órdenes HyP (cuadreOrdenesHyp) a Excel.
 * node scripts/export-hyp-cuadre-xlsx.js 2026-07-01 2026-07-31 [ruta-salida]
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { consultarCuadreOrdenesHyp } = require('../src/services/cuadreOrdenesHyp');

const FI = process.argv[2] || '2026-07-01';
const FF = process.argv[3] || '2026-07-31';
const outArg = process.argv[4];

function defaultOutPath() {
  const tag = FI.slice(0, 7).replace('-', '');
  return path.join(__dirname, '../data', `cuadre-hyp-${tag}.xlsx`);
}

function num(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function buildWorkbook(data) {
  const wb = XLSX.utils.book_new();

  const resumenRows = [
    ['Cuadre HyP MOVDET ↔ DMS (sub sin IVA)'],
    [`Periodo: ${data.periodo.fechaInicio} a ${data.periodo.fechaFin}`],
    [],
    ['Cuenta', 'Concepto', 'Contpaq', 'DMS', 'Diferencia', 'Líneas'],
    ...data.resumen.cuentas.map((c) => [
      c.cuenta, c.label, num(c.contpaq), num(c.dms), num(c.diferencia), c.lineas,
    ]),
    [],
    ['TOTAL', '', num(data.resumen.totalContpaq), num(data.resumen.totalDms), num(data.resumen.diferencia), ''],
    [],
    ['Facturas cuadradas', data.resumen.facturas],
    ['Doctos Contpaq', data.resumen.doctosCp],
    ['Órdenes', data.resumen.ordenes],
    ['VINs únicos', data.resumen.vinsUnicos],
    ['Líneas sin match DMS', data.resumen.lineasSinMatch],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'Resumen');

  const vinRows = [['VIN', '#']];
  data.vinsUnicos.forEach((v, i) => vinRows.push([v, i + 1]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vinRows), 'VINs únicos');

  const matrizHeader = [
    'Orden', 'Factura', 'VIN', 'Cierre', 'Letra', 'Status', 'Fac fecha',
    '0477 RE', '0470 MO', '0479 Pintura', '0476 TOT', 'Neto',
  ];
  const matrizRows = [matrizHeader];
  for (const f of data.facturas) {
    matrizRows.push([
      f.orden,
      f.docto,
      f.vin || '',
      f.cierre || '',
      f.letra,
      f.st,
      f.facFecha || '',
      num(f.porCuenta['0477']),
      num(f.porCuenta['0470']),
      num(f.porCuenta['0479']),
      num(f.porCuenta['0476']),
      num(f.neto),
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizRows), 'Matriz');

  const vinAgg = new Map();
  for (const f of data.facturas) {
    if (!f.vin) continue;
    const cur = vinAgg.get(f.vin) || {
      vin: f.vin,
      orden: f.orden,
      cierre: f.cierre,
      letra: f.letra,
      c0477: 0, c0470: 0, c0479: 0, c0476: 0, neto: 0,
    };
    cur.c0477 += Number(f.porCuenta['0477'] || 0);
    cur.c0470 += Number(f.porCuenta['0470'] || 0);
    cur.c0479 += Number(f.porCuenta['0479'] || 0);
    cur.c0476 += Number(f.porCuenta['0476'] || 0);
    cur.neto += Number(f.neto || 0);
    vinAgg.set(f.vin, cur);
  }
  const vinMontosHeader = ['VIN', 'Orden ejemplo', 'Cierre', 'Letra', '0477', '0470', '0479', '0476', 'Neto'];
  const vinMontosRows = [vinMontosHeader];
  [...vinAgg.values()].sort((a, b) => a.vin.localeCompare(b.vin)).forEach((v) => {
    vinMontosRows.push([
      v.vin, v.orden, v.cierre || '', v.letra,
      num(v.c0477), num(v.c0470), num(v.c0479), num(v.c0476), num(v.neto),
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vinMontosRows), 'VINs montos');

  for (const c of data.resumen.cuentas) {
    const rows = [['Orden', 'Docto', 'Status', 'Letra', 'VIN', 'Cierre', 'Importe', 'Neto factura']];
    const list = data.facturas
      .filter((f) => Math.abs(f.porCuenta[c.cuenta]) > 0.01)
      .sort((a, b) => b.porCuenta[c.cuenta] - a.porCuenta[c.cuenta]);
    for (const f of list) {
      rows.push([
        f.orden, f.docto, f.st, f.letra, f.vin || '', f.cierre || '',
        num(f.porCuenta[c.cuenta]), num(f.neto),
      ]);
    }
    const name = c.cuenta.replace('/', '-');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }

  if (data.sinMatch.length) {
    const sm = [['Cuenta', 'Orden', 'Docto', 'Tipo', 'Neto', 'Nota'],
      ...data.sinMatch.map((u) => [u.cuenta, u.orden, u.docto, u.tipo, num(u.net), u.comp])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sm), 'Sin match');
  }

  return wb;
}

async function main() {
  const data = await consultarCuadreOrdenesHyp({ fechaInicio: FI, fechaFin: FF });
  const outPath = path.resolve(outArg || defaultOutPath());
  const wb = buildWorkbook(data);
  XLSX.writeFile(wb, outPath);
  console.log(`Excel generado: ${outPath}`);
  console.log(`VINs: ${data.resumen.vinsUnicos} | Facturas: ${data.resumen.facturas} | Total: $${num(data.resumen.totalContpaq).toLocaleString('es-MX')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
