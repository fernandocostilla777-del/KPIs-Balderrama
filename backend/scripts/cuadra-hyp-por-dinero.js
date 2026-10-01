/**
 * Cuadre HyP vs 0470/0476/0477/0479 — orden+factura, abono/cargo Contpaq.
 * node scripts/cuadra-hyp-por-dinero.js [fechaInicio] [fechaFin] [--contpaq]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { consultarCuadreHyp } = require('../src/services/hypCuadreService');

const FI = process.argv[2] || '2026-07-01';
const FF = process.argv[3] || '2026-07-31';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const data = await consultarCuadreHyp({ fechaInicio: FI, fechaFin: FF });

  console.log(`\nCUADRE HyP · ${FI} a ${FF}`);
  console.log('Orden+factura · MOVDET VS/DVS ↔ DMS · sub sin IVA\n');
  console.log('── vs CONTABILIDAD ──');
  for (const c of data.resumen.cuentas) {
    console.log(`${c.cuenta} ${c.label}`);
    console.log(`  Contpaq: $${fmt(c.contpaq)} | DMS: $${fmt(c.dms)} | Dif: $${fmt(c.diferencia)} | líneas ${c.lineas}`);
  }
  console.log(`TOTAL Contpaq: $${fmt(data.resumen.totalContpaq)} | DMS: $${fmt(data.resumen.totalDms)} | Dif: $${fmt(data.resumen.diferencia)}`);
  console.log(`\nFacturas cuadradas: ${data.resumen.facturas} | Doctos CP: ${data.resumen.doctosCp} | Órdenes: ${data.resumen.ordenes}`);
  console.log(`VINs únicos: ${data.resumen.vinsUnicos}`);
  if (data.resumen.lineasSinMatch) {
    console.log(`Sin match DMS: ${data.resumen.lineasSinMatch} líneas CP (ver detalle)`);
  }

  const outPath = path.join(
    __dirname,
    '../data',
    FI.startsWith('2026-07') && FF.startsWith('2026-07') ? 'cuadre-julio-final.txt' : 'cuadre-hyp-por-dinero.txt',
  );
  fs.writeFileSync(outPath, data.texto, 'utf8');
  console.log(`\nDetalle: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
