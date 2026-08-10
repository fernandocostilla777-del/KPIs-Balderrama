const path = require('path');
// DESKTOP_MANAGED=1 (Electron): respetar PORT/HOST del proceso padre; no pisar con .env
const desktopManaged = process.env.DESKTOP_MANAGED === '1';
require('dotenv').config({ path: path.join(__dirname, '.env'), override: !desktopManaged });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: false });

const express = require('express');
const os = require('os');
const apiRoutes = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const { attachSession, requireAuthApi } = require('./src/auth/middleware');
const { isAuthEnabled } = require('./src/auth/session');
const { buildOpenApiSpec } = require('./src/openapi');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LAN_IP = process.env.LAN_IP || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

function printStartupUrls() {
  const preferred = LAN_IP || getLanAddresses()[0] || 'localhost';
  console.log('');
  console.log('  BALDERRAMA — Backend API');
  console.log(`  → API local:  http://localhost:${PORT}/api`);
  console.log(`  → API LAN:    http://${preferred}:${PORT}/api`);
  console.log(`  → Frontend:   ${FRONTEND_URL}`);
  console.log(`  BD: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log(`  Auth: ${isAuthEnabled() ? 'activado' : 'desactivado (AUTH_ENABLED=false)'}`);
  console.log('');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = new Set([
    FRONTEND_URL,
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:8100',
    'http://127.0.0.1:8100',
    'capacitor://localhost',
    'http://localhost',
  ]);
  getLanAddresses().forEach((ip) => {
    allowed.add(`http://${ip}:5173`);
    allowed.add(`http://${ip}:${PORT}`);
    allowed.add(`http://${ip}:8100`);
  });
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(attachSession);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'balderrama-backend' });
});

app.get('/api/openapi.json', (_req, res) => {
  const preferred = LAN_IP || getLanAddresses()[0] || null;
  res.json(buildOpenApiSpec({ port: PORT, lanIp: preferred }));
});

app.get(['/api/docs', '/api/docs/'], (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BALDERRAMA API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #f6f8fb; }
    .topbar { display: none; }
    .swagger-ui .info { margin: 32px 0 20px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
      requestInterceptor: function (request) {
        request.credentials = 'include';
        return request;
      }
    });
  </script>
</body>
</html>`);
});

app.use('/api/auth', authRoutes);
app.use('/api', requireAuthApi, apiRoutes);

app.use((err, _req, res, _next) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ error: 'Error al consultar la base de datos', detail: err.message });
});

const server = app.listen(PORT, HOST, () => {
  printStartupUrls();
  try {
    const { startScheduler } = require('./src/services/crmSheetsSync');
    startScheduler();
  } catch (err) {
    console.error('[crm-sheets-sync] No se pudo iniciar el scheduler:', err.message);
  }
  try {
    const { startScheduler: startCloudSync } = require('./src/services/cloudSync/cloudSyncScheduler');
    startCloudSync();
  } catch (err) {
    console.error('[cloud-sync] No se pudo iniciar el scheduler:', err.message);
  }
  try {
    const { startScheduler: startSofiaLive } = require('./src/services/sofiaMonthEndLive');
    startSofiaLive();
  } catch (err) {
    console.error('[sofia-live] No se pudo iniciar el scheduler:', err.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} en uso. Cambia PORT en .env o detén el proceso que lo ocupa.`);
  } else {
    console.error('Error al iniciar servidor:', err.message);
  }
  process.exit(1);
});
