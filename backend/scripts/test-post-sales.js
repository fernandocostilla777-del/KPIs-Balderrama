require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getPostSales } = require('../src/services/postSalesService');

function loadBrowserScript(file) {
  const code = fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8');
  const sandbox = { global: {}, window: {} };
  sandbox.global = sandbox.window;
  vm.runInNewContext(code, sandbox);
  return sandbox.global;
}

const browserGlobal = loadBrowserScript('postSalesOrderTypes.js');
const analyticsCode = fs.readFileSync(path.join(__dirname, '../public/js/postSalesAnalytics.js'), 'utf8');
const analyticsSandbox = { global: browserGlobal, window: browserGlobal };
vm.runInNewContext(analyticsCode, analyticsSandbox);
const analytics = analyticsSandbox.PostSalesAnalytics;

(async () => {
  const data = await getPostSales({ fechaInicio: '2026-06-01', fechaFin: '2026-07-06' });
  const dash = analytics.computeDashboard(data.records, {}, data.openSnapshot);
  const facturadas = data.records.filter((r) => r.status === 'I');
  const conImporte = facturadas.filter((r) => r.importe > 0);
  console.log('period', data.total, 'openSnapshot', data.openTotal);
  console.log('facturadas', facturadas.length, 'con importe', conImporte.length);
  console.log('importe facturado', conImporte.reduce((s, r) => s + r.importeFacturado, 0).toFixed(2));
  console.log('ejecutivo', dash.executive);
  console.log('controlOrdenes', dash.tables.controlOrdenes.slice(0, 8));
})().catch((e) => { console.error(e.message); process.exit(1); });
