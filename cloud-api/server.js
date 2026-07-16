const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const syncRoutes = require('./src/routes/sync');

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'balderrama-cloud-api' });
});

app.use('/api/sync', syncRoutes);

app.use((err, _req, res, _next) => {
  console.error('[cloud-api]', err.message);
  const status = /inválid|debe incluir|sin id/i.test(err.message) ? 400 : 500;
  res.status(status).json({ ok: false, error: err.message });
});

async function ensureSchema() {
  if (process.env.CLOUD_AUTO_INIT_DB !== 'true') return;
  const schemaPath = path.join(__dirname, 'database', '01_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const { query } = require('./src/db');
  await query(sql);
  console.log('[cloud-api] Esquema PostgreSQL verificado');
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
