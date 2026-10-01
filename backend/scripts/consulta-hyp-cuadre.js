/**
 * CLI del Cuadre de Órdenes HyP (cuadreOrdenesHyp).
 * node scripts/consulta-hyp-cuadre.js 2026-07-01 2026-07-31
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { consultarCuadreOrdenesHyp, generarConsultas } = require('../src/services/cuadreOrdenesHyp');

const FI = process.argv[2] || '2026-07-01';
const FF = process.argv[3] || '2026-07-31';
const asJson = process.argv.includes('--json');
const asSql = process.argv.includes('--sql');
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  if (asSql) {
    const q = generarConsultas(FI, []);
    console.log('-- Cuadre HyP · MOVDET mes');
    console.log(q.movdetHyp);
    console.log('\n-- VINs únicos con mov. HyP en el mes');
    console.log(q.vinsUnicos);
    console.log('\n-- Matriz por factura (como Excel: status, facFecha, montos)');
    console.log(q.matrizPorFactura);
    console.log('\n-- DMS componentes (agregar doctos SRV/S000 del MOVDET)');
    console.log(q.dmsComponentes);
    return;
  }

  const data = await consultarCuadreOrdenesHyp({
    fechaInicio: FI,
    fechaFin: FF,
    incluirSql: asJson,
  });

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`\nCUADRE HyP · ${FI} a ${FF}`);
  console.log('MOVDET VS/DVS ↔ DMS · sub sin IVA\n');
  for (const c of data.resumen.cuentas) {
    console.log(`${c.cuenta} ${c.label}`);
    console.log(`  Contpaq: $${fmt(c.contpaq)} | DMS: $${fmt(c.dms)} | Dif: $${fmt(c.diferencia)} | líneas ${c.lineas}`);
  }
  console.log(`TOTAL Contpaq: $${fmt(data.resumen.totalContpaq)} | DMS: $${fmt(data.resumen.totalDms)} | Dif: $${fmt(data.resumen.diferencia)}`);
  console.log(`\nFacturas: ${data.resumen.facturas} | Doctos CP: ${data.resumen.doctosCp} | Órdenes: ${data.resumen.ordenes}`);
  console.log(`VINs únicos: ${data.resumen.vinsUnicos}`);
  if (data.resumen.lineasSinMatch) {
    console.log(`Sin match DMS: ${data.resumen.lineasSinMatch} líneas`);
  }

  if (outPath) {
    const abs = path.resolve(outPath);
    fs.writeFileSync(abs, data.texto, 'utf8');
    console.log(`\nDetalle: ${abs}`);
  } else {
    console.log('\nTip: use --out ruta.txt para guardar el detalle completo');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
