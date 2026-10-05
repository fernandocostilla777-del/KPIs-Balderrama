/**
 * Mantiene fresca la copia local de los ciclos CRM en vivo (crm_ciclos_live)
 * bajándolos del Postgres de solo lectura. El histórico del Excel fijo
 * (crm_actividades) no se toca: el cálculo de maduración une ambas fuentes.
 *
 * Corre en un proceso hijo para no bloquear el backend ni chocar con la
 * conexión de solo lectura que mantiene abierto el servicio.
 */
const path = require('path');
const { spawn } = require('child_process');

// Los ciclos no cambian durante el día: una sincronización diaria basta.
const HORA_DIARIA = 6; // 06:00, hora local del servidor
const SCRIPT = path.join(__dirname, '../../scripts/sync-crm-ciclos-live.js');

let enCurso = false;

function sincronizarCiclosEnVivo({ full = false } = {}) {
  if (enCurso) return Promise.resolve({ skipped: true });
  if (!process.env.PG_READONLY_URL) return Promise.resolve({ skipped: true, reason: 'sin PG_READONLY_URL' });
  enCurso = true;
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--env-file=.env', SCRIPT, ...(full ? ['--full'] : [])], {
      cwd: path.join(__dirname, '../..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.on('error', (err) => { enCurso = false; resolve({ ok: false, error: err.message }); });
    child.on('close', (code) => {
      enCurso = false;
      const ms = Date.now() - t0;
      if (code === 0) {
        console.log(`[crm-ciclos-live] sincronizado en ${ms} ms`);
        resolve({ ok: true, ms });
      } else {
        console.error(`[crm-ciclos-live] falló (exit ${code}): ${error.slice(0, 300)}`);
        resolve({ ok: false, code });
      }
    });
  });
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
  if (!process.env.PG_READONLY_URL) {
    console.log('[crm-ciclos-live] Sin PG_READONLY_URL: la maduración usa solo el histórico local');
    return;
  }
  programarSiguiente();
  console.log(`[crm-ciclos-live] una sincronización al día, a las ${String(HORA_DIARIA).padStart(2, '0')}:00`);
}

module.exports = { sincronizarCiclosEnVivo, startCiclosLiveSync };
