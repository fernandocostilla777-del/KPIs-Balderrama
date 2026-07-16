const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const { query } = require('../src/db');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'database', '01_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await query(sql);
  console.log('[init-db] Esquema aplicado correctamente');
  process.exit(0);
}

main().catch((err) => {
  console.error('[init-db] Error:', err.message);
  process.exit(1);
});
