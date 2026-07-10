require('dotenv').config({ override: true });
const express = require('express');
const os = require('os');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const { attachSession, requireAuthPage, requireAuthApi } = require('./src/auth/middleware');
const { isAuthEnabled, readSession } = require('./src/auth/session');
const { getRole } = require('./src/auth/roles');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LAN_IP = process.env.LAN_IP || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const PROTECTED_PAGES = [
  { route: '/admin.html', file: 'admin.html', pageId: 'admin' },
  { route: '/', file: 'index.html', pageId: 'overview' },
  { route: '/sales.html', file: 'sales.html', pageId: 'sales' },
  { route: '/forecast.html', file: 'forecast.html', pageId: 'forecast' },
  { route: '/inventory.html', file: 'inventory.html', pageId: 'inventory' },
  { route: '/contabilidad.html', file: 'contabilidad.html', pageId: 'contabilidad' },
  { route: '/post-sales.html', file: 'post-sales.html', pageId: 'post-sales' },
  { route: '/assistant.html', file: 'assistant.html', pageId: 'assistant' },
];

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
  console.log('  BALDERRAMA Dashboard');
  console.log(`  → Local:    http://localhost:${PORT}`);
  console.log(`  → Red LAN:  http://${preferred}:${PORT}`);
  getLanAddresses().filter((ip) => ip !== preferred).forEach((ip) => {
    console.log(`  → También:  http://${ip}:${PORT}`);
  });
  console.log(`  → Login:    http://${preferred}:${PORT}/login.html`);
  console.log(`  → API:      http://${preferred}:${PORT}/api/ventas`);
  console.log(`  BD: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log(`  Auth: ${isAuthEnabled() ? 'activado' : 'desactivado (AUTH_ENABLED=false)'}`);
  console.log('');
  console.log('  Desde otro dispositivo en la misma red, abra la URL "Red LAN".');
  console.log('');
}

app.use(express.json());
app.use(attachSession);

app.get('/login.html', (req, res) => {
  const session = req.session || readSession(req);
  if (session && isAuthEnabled()) {
    const home = getRole(session.role)?.homePath || '/';
    return res.redirect(home);
  }
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

for (const { route, file, pageId } of PROTECTED_PAGES) {
  app.get(route, requireAuthPage(pageId), (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, file));
  });
}

app.use('/api/auth', authRoutes);
app.use('/api', requireAuthApi, apiRoutes);
app.use(express.static(PUBLIC_DIR));

app.use((err, _req, res, _next) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ error: 'Error al consultar la base de datos', detail: err.message });
});

const server = app.listen(PORT, HOST, () => {
  printStartupUrls();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} en uso. Cambia PORT en .env o detén el proceso que lo ocupa.`);
  } else {
    console.error('Error al iniciar servidor:', err.message);
  }
  process.exit(1);
});
