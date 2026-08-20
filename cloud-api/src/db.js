const { Pool } = require('pg');

let pool;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL no configurada en cloud-api/.env');
  }
  const isProd = process.env.NODE_ENV === 'production';
  const sslDisabled = process.env.PG_SSL === 'false';
  const rejectUnauthorized = isProd
    ? process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false'
    : process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true';

  pool = new Pool({
    connectionString: url,
    ssl: sslDisabled ? false : { rejectUnauthorized },
    max: 10,
  });
  pool.on('error', (err) => {
    console.error('[cloud-api pg]', err.message);
  });
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, withTransaction };
