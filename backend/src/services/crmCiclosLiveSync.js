/**
 * Mantiene fresca la copia local de los ciclos CRM en vivo (crm_ciclos_live).
 * Orden híbrido:
 *   1) PG_READONLY_URL → script sync-crm-ciclos-live.js (Postgres directo)
 *   2) CLOUD_SYNC_URL + CLOUD_SYNC_API_KEY → pull HTTP /api/crm (crmCloudPull)
 *
 * El histórico Excel (crm_actividades / leads Sheets) no se toca aquí.
 */
const path = require('path');
const { spawn } = require('child_process');
const { canPullViaApi, pullCrmCiclosFromCloud, localCrmStatus } = require('./crmCloudPull');

const HORA_DIARIA = 6;
const SCRIPT = path.join(__dirname, '../../scripts/sync-crm-ciclos-live.js');

let enCurso = false;

async function sincronizarViaPg({ full = false } = {}) {
  if (!process.env.PG_READONLY_URL) {
    return { skipped: true, reason: 'sin PG_READONLY_URL' };
  }
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--env-file=.env', SCRIPT, ...(full ? ['--full'] : [])], {
      cwd: path.join(__dirname, '../..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      if (code === 0) {
        console.log(`[crm-ciclos-live] sincronizado vía PG en ${ms} ms`);
        resolve({ ok: true, ms, via: 'postgres' });
      } else {
        console.error(`[crm-ciclos-live] PG falló (exit ${code}): ${error.slice(0, 300)}`);
        resolve({ ok: false, code, via: 'postgres' });
      }
    });
  });
}

async function sincronizarCiclosEnVivo({ full = false, forceApi = false } = {}) {
  if (enCurso) return { skipped: true };
  enCurso = true;
  try {
    if (!forceApi && process.env.PG_READONLY_URL) {
      const viaPg = await sincronizarViaPg({ full });
      if (viaPg.ok || viaPg.skipped) return viaPg;
    }
    if (canPullViaApi()) {
      console.log('[crm-ciclos-live] bajando ciclos desde cloud-api…');
      const result = await pullCrmCiclosFromCloud({ full });
      if (result.ok) {
        console.log(
          `[crm-ciclos-live] API OK · ${result.pulled} filas · tabla ${result.tableRows} · ${result.ms} ms`,
        );
      } else {
        console.warn('[crm-ciclos-live] API:', result.reason || result.error || 'falló');
      }
      return { ...result, via: 'api' };
    }
    return { skipped: true, reason: 'sin PG_READONLY_URL ni CLOUD_SYNC_API_KEY' };
  } finally {
    enCurso = false;
  }
}

function msHastaProximaCorrida() {
  const ahora = new Date();
  const proxima = new Date(ahora);
  proxima.setHours(HORA_DIARIA, 0, 0, 0);
  if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
  return proxima.getTime() - ahora.getTime();
}

function programarSiguiente() {
  const espera = msHastaProximaCorrida();
  setTimeout(() => {
    sincronizarCiclosEnVivo().finally(programarSiguiente);
  }, espera).unref();
}

function startCiclosLiveSync() {
  const local = localCrmStatus();
  const hasCloud = canPullViaApi();
  const hasPg = Boolean(process.env.PG_READONLY_URL);

  if (!hasPg && !hasCloud) {
    console.log('[crm-ciclos-live] Sin PG_READONLY_URL ni cloud API: solo histórico local');
    return;
  }

  programarSiguiente();
  const via = hasPg ? 'Postgres RO' : 'cloud-api /api/crm';
  console.log(`[crm-ciclos-live] híbrido · fuente ${via} · sync diaria ${String(HORA_DIARIA).padStart(2, '0')}:00`);

  // Si no hay copia local (o está vacía), baja al arrancar.
  const needsPull = !local.exists || !local.ciclosLive;
  if (needsPull || String(process.env.CRM_CLOUD_PULL_ON_START || '').toLowerCase() === 'true') {
    sincronizarCiclosEnVivo({ full: true }).catch((err) => {
      console.warn('[crm-ciclos-live] pull inicial:', err.message);
    });
  }
}

module.exports = { sincronizarCiclosEnVivo, startCiclosLiveSync, localCrmStatus: () => localCrmStatus() };
