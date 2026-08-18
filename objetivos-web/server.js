const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CLOUD_API_URL = String(
  process.env.CLOUD_API_URL || 'https://kpis-balderrama-production.up.railway.app'
).replace(/\/$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'objetivos-web', api: CLOUD_API_URL });
});

app.use('/api', createProxyMiddleware({
  target: CLOUD_API_URL,
  changeOrigin: true,
  on: {
    error(err, _req, res) {
      console.error('[objetivos-web proxy]', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ ok: false, error: 'Cloud API no disponible' }));
    },
  },
}));

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, HOST, () => {
  console.log(`  Objetivos web → http://localhost:${PORT}`);
  console.log(`  API proxy     → ${CLOUD_API_URL}`);
});
