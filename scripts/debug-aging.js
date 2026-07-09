require('dotenv').config();
const { loadOrders } = require('../src/services/postSalesLoad');

(async () => {
  const records = await loadOrders({ fechaInicio: '2026-07-01', fechaFin: '2026-07-06' });
  const open = records.filter((r) => ['A', 'T', 'D', 'P'].includes(r.status));
  console.log('total', records.length, 'open', open.length);
  console.log('by status', records.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {}));
  console.log('open by antiguedad', open.reduce((m, r) => { m[r.antiguedad] = (m[r.antiguedad] || 0) + 1; return m; }, {}));
  console.log('open by statusGroup', records.reduce((m, r) => { m[r.statusGroup] = (m[r.statusGroup] || 0) + 1; return m; }, {}));
  const openSample = open.filter((r) => r.dias > 0).slice(0, 5);
  console.log('open with dias>0', openSample);
  const notOpenButMaybe = records.filter((r) => r.status === 'I' && !r.cierre).slice(0, 3);
  console.log('I without cierre sample', notOpenButMaybe);
})().catch(console.error);
