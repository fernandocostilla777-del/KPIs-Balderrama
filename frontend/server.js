const path = require('path');
// DESKTOP_MANAGED=1 (Electron): respetar puertos/URL del proceso padre; no pisar con .env
const desktopManaged = process.env.DESKTOP_MANAGED === '1';
require('dotenv').config({ path: path.join(__dirname, '.env'), override: !desktopManaged });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: false });

const express = require('express');
const os = require('os');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10);
const HOST = process.env.FRONTEND_HOST || '0.0.0.0';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const LAN_IP = process.env.LAN_IP || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  console.log('  BALDERRAMA — Frontend');
  console.log(`  → Local:    http://localhost:${PORT}`);
  console.log(`  → Red LAN:  http://${preferred}:${PORT}`);
  getLanAddresses().filter((ip) => ip !== preferred).forEach((ip) => {
    console.log(`  → También:  http://${ip}:${PORT}`);
  });
  console.log(`  → Login:    http://${preferred}:${PORT}/login.html`);
  console.log(`  → API →     ${BACKEND_URL}/api`);
  console.log('');
  console.log('  Desde otro dispositivo en la misma red, abra la URL "Red LAN".');
  console.log('');
}

app.use(createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  pathFilter: '/api',
  cookieDomainRewrite: { '*': '' },
  // Cuadre HyP / post-sales pueden tardar >30s en Contpaq+DMS
  proxyTimeout: 180000,
  timeout: 180000,
  on: {
    error(err, _req, res) {
      console.error('[Proxy Error]', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Backend no disponible', detail: err.message }));
    },
  },
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

const server = app.listen(PORT, HOST, () => {
  printStartupUrls();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} en uso. Cambia FRONTEND_PORT en .env.`);
  } else {
    console.error('Error al iniciar frontend:', err.message);
  }
  process.exit(1);
});
