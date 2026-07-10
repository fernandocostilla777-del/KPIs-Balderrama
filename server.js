require('dotenv').config({ override: true });
const express = require('express');
const os = require('os');
const path = require('path');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LAN_IP = process.env.LAN_IP || '';

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
  console.log(`  → Sales:    http://${preferred}:${PORT}/sales.html`);
  console.log(`  → API:      http://${preferred}:${PORT}/api/ventas`);
  console.log(`  BD: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log('');
  console.log('  Desde otro dispositivo en la misma red, abra la URL "Red LAN".');
  console.log('');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/sales.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sales.html'));
});

app.get('/forecast.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forecast.html'));
});

app.get('/assistant.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assistant.html'));
});

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
