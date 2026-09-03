/**
 * Descarga el Google Sheet de leads/solicitudes/pruebas y recarga las tablas CRM.
 *
 * Uso:
 *   node backend/scripts/sync-crm-sheets.js
 *
 * Variables opcionales:
 *   CRM_SHEETS_URL  — URL de export xlsx (default: sheet compartido)
 *   CRM_SHEETS_XLSX — Ruta destino del archivo
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const https = require('https');
const http = require('http');

const DEFAULT_SHEET_ID = '1d-cqASV5c6BmlAhQTnTvxZ7H6GsT1-M6FjLzI-Q2JE0';
const DEFAULT_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/export?format=xlsx`;
const XLSX_PATH = process.env.CRM_SHEETS_XLSX
  || path.join(__dirname, '../data/leads-source.xlsx');
const SHEETS_URL = process.env.CRM_SHEETS_URL || DEFAULT_URL;
const SCRIPTS_DIR = __dirname;

function downloadFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, { timeout: 120000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Demasiados redirects al descargar el sheet'));
          return;
        }
        downloadFile(res.headers.location, destPath, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Descarga fallida HTTP ${res.statusCode}`));
        return;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const tmp = `${destPath}.tmp`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try {
            fs.renameSync(tmp, destPath);
            resolve({ bytes: fs.statSync(destPath).size, path: destPath });
          } catch (err) {
            reject(err);
          }
        });
      });
      out.on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        reject(err);
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Timeout descargando Google Sheet'));
    });
    req.on('error', reject);
  });
}

function runEtl(scriptName, xlsxPath) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, xlsxPath], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Falló ${scriptName} (exit ${result.status})`);
  }
}

const ALL_ETLS = [
  'etl-crm-leads.js',
  'etl-crm-solicitudes.js',
  'etl-crm-pruebas-manejo.js',
  'etl-crm-trafico-piso.js',
  'etl-crm-financiamiento.js',
  'etl-crm-pagos-gmf.js',
  'etl-crm-csi.js',
];

async function syncCrmSheets({ quiet = false, etls: onlyEtls } = {}) {
  const startedAt = new Date().toISOString();
  if (!quiet) console.log(`[crm-sheets] Descargando ${SHEETS_URL}`);
  const download = await downloadFile(SHEETS_URL, XLSX_PATH);
  if (!quiet) console.log(`[crm-sheets] Archivo listo: ${download.path} (${download.bytes} bytes)`);

  const etls = Array.isArray(onlyEtls) && onlyEtls.length ? onlyEtls : ALL_ETLS;
  for (const script of etls) {
    if (!quiet) console.log(`[crm-sheets] Ejecutando ${script}...`);
    runEtl(script, XLSX_PATH);
  }

  const finishedAt = new Date().toISOString();
  return {
    ok: true,
    startedAt,
    finishedAt,
    xlsxPath: XLSX_PATH,
    bytes: download.bytes,
    etls,
  };
}

module.exports = { syncCrmSheets, SHEETS_URL, XLSX_PATH };

if (require.main === module) {
  syncCrmSheets()
    .then((r) => {
      console.log('[crm-sheets] Sync completa:', r.finishedAt);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[crm-sheets] Error:', err.message);
      process.exit(1);
    });
}
