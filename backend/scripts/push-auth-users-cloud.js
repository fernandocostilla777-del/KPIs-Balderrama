#!/usr/bin/env node
'use strict';
/**
 * Sube users.json local a Railway (tabla auth_users + sync_entities dominio auth).
 *
 * Uso:
 *   node backend/scripts/push-auth-users-cloud.js
 *   node backend/scripts/push-auth-users-cloud.js --replace
 *
 * Requiere CLOUD_SYNC_URL + CLOUD_SYNC_API_KEY (no necesita CLOUD_SYNC_ENABLED).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const userStore = require('../src/auth/userStore');

const BASE = String(process.env.CLOUD_SYNC_URL || process.env.CLOUD_READ_URL || '')
  .trim().replace(/\/$/, '');
const KEY = String(process.env.CLOUD_SYNC_API_KEY || '').trim();

function parseArgs(argv) {
  return { replace: argv.includes('--replace') };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KEY,
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function main() {
  if (!BASE || !KEY) {
    console.error('Faltan CLOUD_SYNC_URL / CLOUD_SYNC_API_KEY');
    process.exit(1);
  }
  const { replace } = parseArgs(process.argv.slice(2));
  const records = userStore.exportCloudSyncRecords();
  console.log(`Usuarios locales: ${records.length}`);
  if (!records.length) {
    console.error('No hay usuarios en users.json');
    process.exit(1);
  }

  // 1) Tabla dedicada auth_users (si el endpoint ya está desplegado)
  let tableResult = null;
  try {
    tableResult = await postJson(`${BASE}/api/auth/users/ingest`, {
      records: records.map((r) => r.data),
      replaceAll: replace,
      source: 'push-auth-users-cloud',
    });
    console.log('auth_users:', tableResult);
  } catch (err) {
    console.warn(`auth_users ingest omitido: ${err.message}`);
  }

  // 2) sync_entities (login legacy + mirror al desplegar)
  const syncResult = await postJson(`${BASE}/api/sync/ingest`, {
    domain: 'auth',
    syncType: 'monthly',
    periodKey: 'global',
    periodStart: null,
    periodEnd: null,
    sourceHost: require('os').hostname(),
    meta: { source: 'push-auth-users-cloud' },
    records,
  });
  console.log('sync auth:', {
    batchId: syncResult.batchId,
    inserted: syncResult.inserted,
    updated: syncResult.updated,
    archived: syncResult.archived,
    authUsersMirror: syncResult.authUsersMirror || null,
  });

  // 3) Verificar login
  const probeUser = records[0]?.data?.username || records[0]?.id;
  console.log(`Listos ${records.length} usuarios. Login nube usa /api/auth/login (ej. ${probeUser}).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
