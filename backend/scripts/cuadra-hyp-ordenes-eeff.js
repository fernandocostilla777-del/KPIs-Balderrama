/**
 * Cuadratura HyP (A,F,V,Z + H,J,Ó) vs cuentas 0470/0476/0477/0479.
 *
 * Fiscal del mes = ADE_VTAFI con VTE_FECHDOCTO en el periodo:
 *   I → ingreso (+)   C → reverso (−)   refactura otro mes no entra
 *
 * Uso: node scripts/cuadra-hyp-ordenes-eeff.js 2026-07-01 2026-07-31
 */
require('dotenv').config();
const { query } = require('../src/db');
const {
  CUENTAS,
  fmt,
  ordenesHyPCuadra,
  agregarPorVin,
  sumPorCuenta,
  contpaqPorCuenta,
} = require('./lib/hypCuadraLogic');

const FECHA_INICIO = process.argv[2] || '2026-08-01';
const FECHA_FIN = process.argv[3] || '2026-08-31';

const EJEMPLOS = ['A00234203', 'V00235681', 'A00227131'];

function describeOrden(o) {
  const vig = o.facturasVigentes.map((f) => `${f.docto}(I $${fmt(f.total)})`).join(', ') || '—';
  const can = o.facturasCanceladas.map((f) => `${f.docto}(C −$${fmt(f.total)})`).join(', ') || '—';
  return [
    `  ${o.orden} · ${o.estadoFiscal} · neto $${fmt(o.importeConIva)}`,
    `    Vigente mes: ${vig}`,
    `    Cancelada mes: ${can}`,
  ].join('\n');
}

(async () => {
  console.log(`\nCuadratura HyP A,F,V,Z,H,J,Ó · ${FECHA_INICIO} a ${FECHA_FIN}`);
  console.log('Órdenes cerradas (ORE_FECHACIE) en periodo · estatus I');
  console.log('Fiscal: facturas con VTE_FECHDOCTO en periodo · I (+) · C (−)\n');

  const cont = await contpaqPorCuenta(query, FECHA_INICIO, FECHA_FIN);
  const orders = await ordenesHyPCuadra(query, FECHA_INICIO, FECHA_FIN);

  const validas = orders.filter((o) => o.validaMonetaria);
  const canceladasMes = orders.filter((o) => o.soloCancelada);
  const sinFactura = orders.filter((o) => o.estadoFiscal === 'sin_factura_mes');

  const byVinAll = agregarPorVin(orders, false);
  const byVinValidas = agregarPorVin(orders, true);
  const dupes = byVinValidas.filter((g) => g.numOrdenes > 1);

  const dmsSub = sumPorCuenta(orders, 'porCuentaSub');
  const dmsNet = sumPorCuenta(orders, 'porCuentaConIva');
  const dmsSubValidas = sumPorCuenta(validas, 'porCuentaSub');
  const dmsNetValidas = sumPorCuenta(validas, 'porCuentaConIva');

  console.log('── CONTABILIDAD (CON_CTAS) ──');
  console.log(`Tabla: ${cont.table}`);
  for (const c of CUENTAS) console.log(`  ${c}: $${fmt(cont.byPrefix[c])}`);
  console.log(`  TOTAL 4 cuentas: $${fmt(cont.total)}\n`);

  console.log('── DMS FISCAL NETO (todas las órdenes cerradas) ──');
  console.log(`  Órdenes cerradas: ${orders.length}`);
  console.log(`  Válidas monetariamente (neto > 0): ${validas.length}`);
  console.log(`  Solo cancelada en mes (neto negativo): ${canceladasMes.length}`);
  console.log(`  Sin factura en mes: ${sinFactura.length}`);
  console.log(`  VIN únicos (todas): ${byVinAll.length}`);
  console.log(`  VIN únicos válidos: ${byVinValidas.length}`);
  console.log(`  VINs válidos con 2+ órdenes: ${dupes.length}`);
  console.log(`  Importe neto total: $${fmt(orders.reduce((a, o) => a + o.importeConIva, 0))}`);
  console.log(`  Importe neto solo válidas: $${fmt(validas.reduce((a, o) => a + o.importeConIva, 0))}\n`);

  console.log('── CRUCE POR CUENTA (neto fiscal = I − C) ──');
  for (const c of CUENTAS) {
    const label = c === '0470' ? 'HP+VA' : c === '0477' ? 'RE' : c === '0479' ? 'PI' : 'TTHP';
    console.log(
      `  ${c} (${label}): Contpaq $${fmt(cont.byPrefix[c])} | DMS neto $${fmt(dmsNet[c])} | Dif $${fmt(cont.byPrefix[c] - dmsNet[c])}`,
    );
  }
  console.log(`  TOTAL: Contpaq $${fmt(cont.total)} | DMS $${fmt(dmsNet.total)} | Dif $${fmt(cont.total - dmsNet.total)}\n`);

  console.log('── CRUCE SOLO ÓRDENES VÁLIDAS (neto > 0) ──');
  for (const c of CUENTAS) {
    console.log(`  ${c}: Contpaq $${fmt(cont.byPrefix[c])} | DMS válidas $${fmt(dmsNetValidas[c])} | Dif $${fmt(cont.byPrefix[c] - dmsNetValidas[c])}`);
  }
  console.log(`  TOTAL válidas: DMS $${fmt(dmsNetValidas.total)}\n`);

  if (canceladasMes.length) {
    console.log('── Canceladas en mes (reverso, no ingreso) ──');
    canceladasMes.slice(0, 15).forEach((o) => {
      console.log(`  ${o.orden} | ${o.vin} | ${o.cierre} | neto $${fmt(o.importeConIva)} | ${o.facturasCanceladas.map((f) => f.docto).join(',')}`);
    });
    if (canceladasMes.length > 15) console.log(`  … y ${canceladasMes.length - 15} más`);
    console.log('');
  }

  console.log('── Ejemplos cancelación / refactura / válida ──');
  for (const id of EJEMPLOS) {
    const o = orders.find((x) => x.orden === id);
    if (o) console.log(describeOrden(o));
    else console.log(`  ${id} · no encontrada en órdenes cerradas del periodo`);
  }
  console.log('');

  console.log('── Notas ──');
  console.log('  · Fecha fiscal = VTE_FECHDOCTO (no fecha cierre orden).');
  console.log('  · Cancelada otro mes (ej. SRV000137175 mayo) no afecta julio.');
  console.log('  · VIN único válido = unidad con al menos una orden neto > 0.\n');

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
