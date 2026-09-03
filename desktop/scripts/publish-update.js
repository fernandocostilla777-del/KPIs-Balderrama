/**
 * Publica el instalador Windows y latest.yml en cloud-api.
 *
 * Uso (después de npm run dist:win):
 *   CLOUD_API_URL=https://kpis-balderrama-production.up.railway.app ^
 *   CLOUD_SYNC_API_KEY=tu-clave ^
 *   node desktop/scripts/publish-update.js
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const API = String(process.env.CLOUD_API_URL || 'https://kpis-balderrama-production.up.railway.app').replace(/\/+$/, '');
const KEY = String(process.env.CLOUD_SYNC_API_KEY || '').trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!KEY) fail('Falta CLOUD_SYNC_API_KEY.');
if (!fs.existsSync(DIST_DIR)) fail(`No existe ${DIST_DIR}. Corre primero: npm run dist:win`);

const latestPath = path.join(DIST_DIR, 'latest.yml');
if (!fs.existsSync(latestPath)) {
  fail('No está latest.yml. Revisa electron-builder.yml (publish.provider = generic).');
}

const names = fs.readdirSync(DIST_DIR).filter((name) => (
  name === 'latest.yml'
  || name.endsWith('.blockmap')
  || /^kpis-balderrama-setup-.*\.exe$/i.test(name)
  || /Setup-.*Windows.*\.exe$/i.test(name)
));

if (names.length < 2) {
  fail('No se encontró el instalador NSIS junto a latest.yml.');
}

async function main() {
  const form = new FormData();
  for (const name of names) {
    const buf = fs.readFileSync(path.join(DIST_DIR, name));
    form.append('files', new Blob([buf]), name);
    console.log(' +', name, `${Math.round(buf.length / 1024 / 1024)} MB`);
  }

  const res = await fetch(`${API}/desktop-updates/upload`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(data.error || `Error HTTP ${res.status}`);
  }
  console.log('Publicado en', `${API}/desktop-updates`);
  console.log(JSON.stringify(data.status || data, null, 2));
}

main().catch((err) => fail(err.message));
