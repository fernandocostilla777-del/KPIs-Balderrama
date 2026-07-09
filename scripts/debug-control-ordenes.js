require('dotenv').config();
const { loadOrders } = require('../src/services/postSalesLoad');

(async () => {
  const records = await loadOrders({ fechaInicio: '2026-06-01', fechaFin: '2026-07-06' });
  const sinAseg = records.filter((r) => r.sinAseguradora);
  const byLetra = new Map();
  for (const r of sinAseg) {
    const k = r.letraOrden || '?';
    if (!byLetra.has(k)) byLetra.set(k, { n: 0, tipo: r.tipoPorLetra, sample: r.orden });
    byLetra.get(k).n++;
  }
  console.log('Sin aseguradora:', sinAseg.length, 'de', records.length);
  console.log('Por letra:', [...byLetra.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ letra: k, tipo: v.tipo, n: v.n, sample: v.sample })));
  console.log('Sample sin tipoPorLetra:', sinAseg.filter((r) => !r.tipoPorLetra).slice(0, 3));
})().catch(console.error);
