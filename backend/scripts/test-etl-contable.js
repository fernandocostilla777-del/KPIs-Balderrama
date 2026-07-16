require('dotenv').config({ override: true });
const { runAccountingEtl } = require('../src/services/accountingEtlService');

const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);

async function main() {
  const fechaInicio = process.argv[2] || '2026-06-01';
  const fechaFin = process.argv[3] || '2026-06-30';

  console.log('');
  console.log('=== Prueba ETL Contable BALDERRAMA ===');
  console.log(`Periodo: ${fechaInicio} → ${fechaFin}`);
  console.log('');

  const etl = await runAccountingEtl({ fechaInicio, fechaFin });

  if (!etl.available) {
    console.log('❌ Sin datos — verifique CON_CTAS para el periodo.');
    process.exit(1);
  }

  console.log(`✓ Proceso A — Transacciones extraídas: ${etl.procesoA.transactionCount}`);
  console.log(`✓ Proceso B — Bolsón administrativo: ${fmt(etl.procesoB.totalBolson)} (${etl.procesoB.rowCount} cuentas)`);
  console.log(`✓ Proceso C — Prorrateo a ${etl.procesoC.assignments.length} centros`);
  console.log('');
  console.log('--- Proceso D: Consolidado por centro de costo ---');
  console.log('Centro'.padEnd(18), 'Ventas'.padStart(14), 'Costo'.padStart(14), 'Util.Bruta'.padStart(14), 'G.Directo'.padStart(14), 'G.Asignado'.padStart(14), 'Util.Oper.'.padStart(14));
  console.log('-'.repeat(104));

  for (const row of etl.procesoD.rows) {
    console.log(
      row.ccLabel.padEnd(18),
      fmt(row.ventasNetas).padStart(14),
      fmt(row.costoVentas).padStart(14),
      fmt(row.utilidadBruta).padStart(14),
      fmt(row.gastoDirecto).padStart(14),
      fmt(row.gastoAsignado).padStart(14),
      fmt(row.utilidadOperativa).padStart(14),
    );
  }

  const t = etl.procesoD.totals;
  console.log('-'.repeat(104));
  console.log(
    'TOTAL'.padEnd(18),
    fmt(t.ventasNetas).padStart(14),
    fmt(t.costoVentas).padStart(14),
    fmt(t.utilidadBruta).padStart(14),
    fmt(t.gastoDirecto).padStart(14),
    fmt(t.gastoAsignado).padStart(14),
    fmt(t.utilidadOperativa).padStart(14),
  );
  console.log('');
  console.log(`Margen bruto: ${t.margenBrutoPct}%  |  Margen operativo: ${t.margenOperativoPct}%`);
  console.log('');
  console.log('✓ ETL completado correctamente.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
