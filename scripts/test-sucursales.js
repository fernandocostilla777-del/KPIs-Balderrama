require('dotenv').config({ override: true });
const { getAccountingKpis } = require('../src/services/accountingEeffService');

(async () => {
  for (const [s, a, label] of [
    ['todos', 'todos', 'Consolidado'],
    ['piso', 'todos', 'Piso (EEFF)'],
    ['foraneos', 'todos', 'Foraneos'],
    ['todos', 'seminuevos', 'Seminuevos'],
    ['todos', 'postventa', 'Postventa'],
  ]) {
    const r = await getAccountingKpis({ fechaInicio: '2025-12-01', fechaFin: '2025-12-31', sucursal: s, area: a });
    console.log(`\n=== ${label} (${r.filtros.scopeLabel}) ===`);
    console.log('Ventas:', r.income.summary.ventasNetas.toFixed(0));
    console.log('Util bruta:', r.income.summary.utilidadBruta.toFixed(0));
    console.log('Util oper:', r.income.summary.utilidadOperacion.toFixed(0));
    if (r.balance.branchPosition) console.log('CxC suc:', r.balance.branchPosition.value.toFixed(0));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
