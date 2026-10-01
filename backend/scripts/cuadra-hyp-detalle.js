/**
 * Detalle cuadre HyP: órdenes válidas/canceladas por cuenta vs Contpaq.
 * node scripts/cuadra-hyp-detalle.js 2026-07-01 2026-07-31
 */
require('dotenv').config();
const { query } = require('../src/db');
const {
  CUENTAS,
  CUENTA_LABEL,
  fmt,
  ordenesHyPCuadra,
  agregarPorVin,
  sumPorCuenta,
  contpaqPorCuenta,
} = require('./lib/hypCuadraLogic');

const FECHA_INICIO = process.argv[2] || '2026-07-01';
const FECHA_FIN = process.argv[3] || '2026-07-31';

(async () => {
  const cont = await contpaqPorCuenta(query, FECHA_INICIO, FECHA_FIN);
  const orders = await ordenesHyPCuadra(query, FECHA_INICIO, FECHA_FIN);
  const validas = orders.filter((o) => o.validaMonetaria);
  const canceladasMes = orders.filter((o) => o.soloCancelada);

  const dmsSub = sumPorCuenta(orders, 'porCuentaSub');
  const dmsNet = sumPorCuenta(orders, 'porCuentaConIva');
  const byVinValidas = agregarPorVin(orders, true);

  console.log(`\nCUADRE HyP · ${FECHA_INICIO} a ${FECHA_FIN}`);
  console.log('Fiscal mes: I (+) · C (−) por VTE_FECHDOCTO\n');

  console.log('── CUADRE vs CONTABILIDAD ──');
  for (const c of CUENTAS) {
    console.log(
      `${c} | ${CUENTA_LABEL[c]} | Contpaq $${fmt(cont.byPrefix[c])} | DMS neto $${fmt(dmsNet[c])} | Dif $${fmt(cont.byPrefix[c] - dmsNet[c])}`,
    );
  }
  console.log(`TOTAL | $${fmt(cont.total)} | $${fmt(dmsNet.total)} | $${fmt(cont.total - dmsNet.total)}`);

  console.log('\n── RESUMEN ──');
  console.log(`Órdenes cerradas: ${orders.length}`);
  console.log(`Válidas monetariamente: ${validas.length}`);
  console.log(`Canceladas en mes (neto negativo): ${canceladasMes.length}`);
  console.log(`VIN únicos válidos: ${byVinValidas.length}`);

  console.log('\n── ÓRDENES VÁLIDAS POR CUENTA ──');
  for (const c of CUENTAS) {
    const list = validas
      .filter((o) => o.porCuentaConIva[c] > 0.01)
      .map((o) => ({ ...o, monto: o.porCuentaConIva[c] }))
      .sort((a, b) => b.monto - a.monto);

    console.log(`\n### ${c} — ${CUENTA_LABEL[c]} (${list.length} órdenes)`);
    list.forEach((o) => {
      const fac = o.facturasVigentes.map((f) => f.docto).join(',');
      console.log(`${o.orden} | ${o.vin} | ${o.cierre} | ${fac} | $${fmt(o.monto)}`);
    });
  }

  if (canceladasMes.length) {
    console.log('\n── ÓRDENES CANCELADAS EN MES (reverso) ──');
    canceladasMes.forEach((o) => {
      const fac = o.facturasCanceladas.map((f) => f.docto).join(',');
      console.log(`${o.orden} | ${o.vin} | ${o.cierre} | ${fac} | neto $${fmt(o.importeConIva)}`);
    });
  }

  console.log('\n── LISTA ÓRDENES VÁLIDAS (orden · VIN · cierre · factura · neto) ──');
  validas.forEach((o) => {
    const fac = o.facturasVigentes.map((f) => f.docto).join(',');
    console.log(`${o.orden} | ${o.vin} | ${o.cierre} | ${fac} | $${fmt(o.importeConIva)}`);
  });

  console.log('\n── VIN ÚNICOS VÁLIDOS ──');
  byVinValidas.forEach((g) => {
    console.log(`${g.vin} | ${g.numOrdenes} ord [${g.ordenes.join(', ')}] | $${fmt(g.importeConIva)}`);
  });

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
