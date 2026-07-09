require('dotenv').config({ override: true });
const { getAccountingKpis } = require('../src/services/accountingEeffService');

(async () => {
  const r = await getAccountingKpis({ fechaInicio: '2025-12-01', fechaFin: '2025-12-31' });
  console.log(JSON.stringify({
    balance: r.balance.totals,
    income: r.income.summary,
    ratios: r.ratios,
    revenueLines: r.income.revenueLines,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
