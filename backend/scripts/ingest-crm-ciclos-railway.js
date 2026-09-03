/**
 * Ingesta incremental Balderrama Ciclos → Railway + SQLite local.
 *
 * - Railway (crm_ciclos): fuente operativa del embudo BDC
 * - SQLite (crm_actividades): histórico local en crecimiento (sin DROP TABLE)
 *
 * Uso:
 *   node backend/scripts/ingest-crm-ciclos-railway.js "C:/ruta/export-ciclos.csv"
 *   node backend/scripts/ingest-crm-ciclos-railway.js --local-only "export.csv"
 *   node backend/scripts/ingest-crm-ciclos-railway.js --railway-only "export.csv"
 *
 * Requiere CLOUD_SYNC_URL y CLOUD_SYNC_API_KEY para la parte Railway.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const fs = require('fs');
const { iterCiclosRecords, toCloudRow } = require('./lib/crmCiclosParse');
const {
  openLocalStore,
  upsertLocalBatch,
  localStats,
  DB_PATH,
} = require('./lib/crmCiclosLocalStore');

const BATCH_SIZE = Math.max(50, Number(process.env.CRM_CICLOS_INGEST_BATCH || 400));

async function postBatch(baseUrl, apiKey, records) {
  const res = await fetch(`${baseUrl}/api/crm/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      records,
      source: 'ciclos-export',
      replaceAll: false,
    }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  return data;
}

function parseArgs(argv) {
  const localOnly = argv.includes('--local-only');
  const railwayOnly = argv.includes('--railway-only');
  const sourcePath = argv.find((a) => !a.startsWith('--'));
  return { localOnly, railwayOnly, sourcePath };
}

async function run() {
  const { localOnly, railwayOnly, sourcePath } = parseArgs(process.argv.slice(2));
  const syncLocal = !railwayOnly;
  const syncRailway = !localOnly;

  if (!sourcePath) {
    console.error('Uso: node ingest-crm-ciclos-railway.js [--local-only|--railway-only] "<ruta CSV/XLSX>"');
    process.exit(1);
  }
  if (!fs.existsSync(sourcePath)) {
    console.error(`No existe el archivo: ${sourcePath}`);
    process.exit(1);
  }
  if (localOnly && railwayOnly) {
    console.error('Use solo uno de --local-only o --railway-only.');
    process.exit(1);
  }

  const baseUrl = String(process.env.CLOUD_SYNC_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  if (syncRailway && (!baseUrl || !apiKey)) {
    console.error('Configure CLOUD_SYNC_URL y CLOUD_SYNC_API_KEY en backend/.env');
    process.exit(1);
  }

  const db = syncLocal ? openLocalStore() : null;
  let total = 0;
  let skipped = 0;
  let batches = 0;
  let localInserted = 0;
  let localUpdated = 0;
  let railwayTotal = null;
  const started = Date.now();
  let batch = [];

  console.log(`Archivo: ${sourcePath}`);
  if (syncRailway && syncLocal) {
    console.log(`Destinos: Railway (${baseUrl}) + SQLite (${DB_PATH})`);
  } else if (syncLocal) {
    console.log(`Destino: SQLite (${DB_PATH})`);
  } else {
    console.log(`Destino: Railway (${baseUrl})`);
  }

  async function flushBatch() {
    if (!batch.length) return;
    let batchLocal = null;
    if (syncRailway) {
      const result = await postBatch(baseUrl, apiKey, batch);
      railwayTotal = result.total ?? railwayTotal;
    }
    if (syncLocal) {
      batchLocal = upsertLocalBatch(db, batch);
      localInserted += batchLocal.inserted;
      localUpdated += batchLocal.updated;
    }
    total += batch.length;
    batches += 1;
    console.log(
      `  lote ${batches}: ${batch.length} filas`
      + (syncRailway ? ` · Railway total≈${railwayTotal ?? '?'}` : '')
      + (syncLocal && batchLocal ? ` · local +${batchLocal.inserted} ~${batchLocal.updated}` : '')
    );
    batch = [];
  }

  for await (const rec of iterCiclosRecords(sourcePath)) {
    if (!rec.ID_CONTACTO) {
      skipped += 1;
      continue;
    }
    batch.push(toCloudRow(rec));
    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  await flushBatch();

  const secs = Math.round((Date.now() - started) / 1000);
  const summary = {
    filasProcesadas: total,
    omitidas: skipped,
    lotes: batches,
    segundos: secs,
  };
  if (syncLocal) {
    summary.localInsertadas = localInserted;
    summary.localActualizadas = localUpdated;
    Object.assign(summary, localStats(db));
    db.close();
  }
  if (syncRailway) summary.railwayTotal = railwayTotal;

  console.log('\nListo.');
  console.table([summary]);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
