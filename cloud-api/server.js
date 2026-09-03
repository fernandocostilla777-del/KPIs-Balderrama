const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const syncRoutes = require('./src/routes/sync');
const authRoutes = require('./src/routes/auth');
const mobileRoutes = require('./src/routes/mobile');
const personalRoutes = require('./src/routes/personal');
const objetivosResultadosRoutes = require('./src/routes/objetivosResultados');
const crmRoutes = require('./src/routes/crm');
const desktopUpdatesRoutes = require('./src/routes/desktopUpdates');
const iemcFinancieroRoutes = require('./src/routes/iemcFinanciero');
const { ensurePersonalTable } = require('./src/services/dmsPersonalService');
const { ensureCrmCiclosTable } = require('./src/services/crmCiclosCloudService');
const { ensureCrmTables } = require('./src/services/crmCiclosCloud');
const { ensureIemcFinancieroTables } = require('./src/services/iemcFinancieroStore');

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '25mb' }));

const defaultOrigins = [
  'http://localhost:8100',
  'http://localhost:4200',
  'http://127.0.0.1:8100',
  'http://127.0.0.1:4200',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'https://objetivos-web-production.up.railway.app',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
];
const allowedOrigins = new Set([
  ...defaultOrigins,
  ...String(process.env.MOBILE_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'balderrama-cloud-api' });
});

app.use('/api/sync', syncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/personal', personalRoutes);
app.use('/api/objetivos-resultados', objetivosResultadosRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/iemc-financiero', iemcFinancieroRoutes);
app.use('/desktop-updates', desktopUpdatesRoutes);

app.use((err, _req, res, _next) => {
  console.error('[cloud-api]', err.message);
  const status = err.status || (/inválid|debe incluir|sin id/i.test(err.message) ? 400 : 500);
  const publicMessage = !isProd
    ? err.message
    : status >= 500
      ? 'Error interno del servidor'
      : 'Solicitud inválida';
  res.status(status).json({ ok: false, error: publicMessage });
});

async function ensureSchema() {
  const { query } = require('./src/db');
  if (process.env.CLOUD_AUTO_INIT_DB === 'true') {
    const schemaPath = path.join(__dirname, 'database', '01_schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await query(sql);
    console.log('[cloud-api] Esquema PostgreSQL verificado');
    return;
  }
  await query('ALTER TABLE sync_batches ADD COLUMN IF NOT EXISTS meta JSONB');
  await ensurePersonalTable();
  await ensureCrmCiclosTable();
  await ensureCrmTables();
  await ensureIemcFinancieroTables();
}

ensureSchema()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('  BALDERRAMA — Cloud Sync API');
      console.log(`  → http://localhost:${PORT}/api/health`);
      console.log(`  → POST http://localhost:${PORT}/api/sync/ingest`);
      console.log(`  → GET  http://localhost:${PORT}/api/personal`);
      console.log(`  → POST http://localhost:${PORT}/api/crm/ingest`);
      console.log(`  → GET  http://localhost:${PORT}/api/iemc-financiero/periodos`);
      console.log(`  → GET  http://localhost:${PORT}/desktop-updates/status`);
      console.log('');
    });
  })
  .catch((err) => {
    console.error('[cloud-api] No se pudo iniciar:', err.message);
    process.exit(1);
  });
