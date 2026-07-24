/**
 * One-shot: sincroniza TODOS los dominios juntos al cloud.
 * Uso: node scripts/run-full-cloud-sync.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });

const { runSync, SYNC_DOMAINS } = require('../src/services/cloudSync/cloudSyncScheduler');

(async () => {
  console.log('[full-sync] Dominios:', SYNC_DOMAINS.join(', '));
  const result = await runSync({ type: 'full', reason: 'manual-full-align' });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
})().catch((err) => {
  console.error('[full-sync] Error:', err.message || err);
  process.exit(1);
});
