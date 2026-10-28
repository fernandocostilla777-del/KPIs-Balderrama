require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 30000,
    requestTimeout: 120000,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let pool = null;
let connecting = null;
/** Evita bucles de failover en la misma ráfaga de errores. */
let lastFailoverAt = 0;

function isConnError(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  return /ECONNRESET|ETIMEOUT|ESOCKET|ENOTFOUND|ECONNREFUSED|ConnectionError|Login failed|Could not connect|socket hang up|operation timed out/i.test(
    `${code} ${msg}`,
  );
}

async function resetPool() {
  const old = pool;
  pool = null;
  connecting = null;
  if (old) {
    try { await old.close(); } catch { /* ignore */ }
  }
}

/** Host alterno Local ↔ Remota para modo híbrido. */
function alternateSqlHost(currentHost) {
  try {
    const { MODOS } = require('./services/conexionOrigen');
    const h = String(currentHost || '').trim();
    const actual = Object.values(MODOS).find((m) => m.disponible && m.host === h);
    const alt = Object.values(MODOS).find((m) => m.disponible && m.host && m.host !== h);
    if (!alt) return null;
    return { from: actual?.id || h, to: alt.id, host: alt.host, label: alt.label };
  } catch {
    return null;
  }
}

async function failoverToAlternateHost(reason) {
  const now = Date.now();
  if (now - lastFailoverAt < 15000) return false;
  const alt = alternateSqlHost(config.server);
  if (!alt) return false;
  lastFailoverAt = now;
  console.warn(`[db] Failover SQL ${config.server} → ${alt.host} (${alt.label}): ${reason}`);
  await setServer(alt.host);
  try {
    const { guardar } = require('./services/conexionOrigen');
    if (typeof guardar === 'function') guardar(alt.to);
  } catch {
    /* el archivo de modo es opcional aquí */
  }
  return true;
}

async function getPool() {
  if (pool) return pool;
  if (connecting) return connecting;
  connecting = sql.connect(config)
    .then((p) => {
      pool = p;
      connecting = null;
      p.on?.('error', () => {
        pool = null;
      });
      return p;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });
  return connecting;
}

async function query(text, params = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const p = await getPool();
      const request = p.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      const result = await request.query(text);
      return result.recordset;
    } catch (err) {
      lastErr = err;
      if (!isConnError(err)) throw err;
      await resetPool();
      if (attempt === 2) {
        const switched = await failoverToAlternateHost(err.message);
        if (!switched) break;
        continue;
      }
      if (attempt >= 3) break;
    }
  }
  throw lastErr;
}

function getServer() {
  return config.server;
}

async function setServer(host) {
  config.server = String(host || '').trim();
  await resetPool();
  try { await sql.close(); } catch { /* el pool global ya estaba cerrado */ }
}

module.exports = { getPool, query, sql, resetPool, getServer, setServer, alternateSqlHost };

