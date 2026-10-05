'use strict';
/**
 * Contrato backend ↔ frontend de las alertas inteligentes.
 *
 * kpi-insights.js ancla cada alerta con document.getElementById(kpiId). Si el
 * backend emite un kpiId que ninguna pantalla pinta, la alerta se calcula pero
 * NUNCA se ve (falla silenciosa). Esta prueba lee el código fuente y avisa.
 *
 * Si agregas una alerta nueva: usa el id de una tarjeta existente, o agrega el
 * id a la tarjeta. Si el id lo genera otro archivo, súmalo a EXTRA_FUENTES.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'frontend', 'public');
const SERVICE = path.join(ROOT, 'backend', 'src', 'services', 'intelligentInsightsService.js');

// Constructor de alertas -> archivos de pantalla (sin extensión, en public/ y public/js/)
const PANTALLAS = {
  buildVentasInsights: ['sales', 'sales', 'comisiones', 'analisisComercial', 'financiamiento', 'leads', 'afluencia'],
  buildContabilidadInsights: ['contabilidad', 'eeff'],
  buildAnalisisFinancieroInsights: ['contabilidad', 'analisisFinanciero', 'eeff'],
  buildLiquidezInsights: ['contabilidad', 'analisisFinanciero', 'eeff'],
  buildOverviewInsights: ['index', 'overview'],
  buildInventoryInsights: ['inventory', 'analisisComercial'],
  buildForecastInsights: ['forecast', 'forecast-presupuesto', 'forecast-presupuesto-12m', 'forecast-simulador'],
  buildPostSalesInsights: ['post-sales', 'postSalesAnalytics', 'postSalesOrderTypes'],
  buildSeguimientoInsights: ['seguimiento'],
  buildMarketingInsights: ['sales', 'afluencia'],
};
// Ids que el servidor entrega al frontend (no están escritos en los .html/.js)
const EXTRA_FUENTES = {
  buildOverviewInsights: [path.join(ROOT, 'backend', 'src', 'services', 'summaryKpiPrefsService.js')],
};

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const screenText = (names) => names
  .flatMap((n) => [path.join(PUB, `${n}.html`), path.join(PUB, 'js', `${n}.js`)])
  .map(read).join('\n') + read(path.join(PUB, 'js', 'shared.js'));

function kpiIdsByBuilder() {
  const src = read(SERVICE);
  const out = {};
  const parts = src.split(/\nfunction (build\w+Insights)\(/);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1].split('\nfunction ')[0];
    out[parts[i]] = [...new Set([...body.matchAll(/kpiId:\s*'([^']+)'/g)].map((m) => m[1]))];
  }
  return out;
}

const builders = kpiIdsByBuilder();

test('hay constructores de alertas y todos tienen pantalla asociada', () => {
  assert.ok(Object.keys(builders).length >= 8);
  for (const b of Object.keys(builders)) {
    assert.ok(PANTALLAS[b], `agrega ${b} al mapa PANTALLAS de esta prueba`);
  }
});

for (const [builder, ids] of Object.entries(builders)) {
  test(`${builder}: cada kpiId existe en alguna pantalla`, () => {
    const texto = screenText(PANTALLAS[builder] || [])
      + (EXTRA_FUENTES[builder] || []).map(read).join('\n');
    const huerfanos = ids.filter((id) => !texto.includes(id));
    assert.deepEqual(huerfanos, [], `alertas que nunca se verían (sin tarjeta con ese id): ${huerfanos.join(', ')}`);
  });
}
