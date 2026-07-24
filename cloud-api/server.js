const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const syncRoutes = require('./src/routes/sync');
const authRoutes = require('./src/routes/auth');
const mobileRoutes = require('./src/routes/mobile');

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '25mb' }));

const defaultOrigins = [
  'http://localhost:8100',
  'http://localhost:4200',
  'http://127.0.0.1:8100',
  'http://127.0.0.1:4200',
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'balderrama-cloud-api' });
});

app.use('/api/sync', syncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/mobile', mobileRoutes);

app.use((err, _req, res, _next) => {
  console.error('[cloud-api]', err.message);
  const status = /inválid|debe incluir|sin id/i.test(err.message) ? 400 : 500;
  res.status(status).json({ ok: false, error: err.message });
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
}

ensureSchema()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('  BALDERRAMA — Cloud Sync API');
      console.log(`  → http://localhost:${PORT}/api/health`);
      console.log(`  → POST http://localhost:${PORT}/api/sync/ingest`);
      console.log('');
    });
  })
  .catch((err) => {
    console.error('[cloud-api] No se pudo iniciar:', err.message);
    process.exit(1);
  });
