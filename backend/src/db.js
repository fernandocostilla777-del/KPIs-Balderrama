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
  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
      if (attempt < 2 && isConnError(err)) {
        await resetPool();
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { getPool, query, sql, resetPool };

