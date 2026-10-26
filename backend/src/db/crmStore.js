'use strict';
/**
 * Acceso común a la base del CRM (ciclos, leads, financiamiento, CSI, tráfico…).
 *
 * Motor según CRM_DB en backend/.env:
 *   - sqlite   (por omisión): backend/data/crm-ciclos.db, como hasta ahora.
 *   - postgres: servidor PostgreSQL de la oficina en CRM_PG_URL.
 *
 * Los servicios escriben SQL con marcadores `?`; aquí se convierten a $1, $2…
 * para PostgreSQL. Todo es asíncrono para que el mismo código sirva a ambos
 * motores. Mientras dure la migración por etapas, SQLite queda de respaldo.
 */
const fs = require('fs');
const path = require('path');

const SQLITE_PATH = process.env.CRM_SQLITE_PATH
  || path.join(__dirname, '../../data/crm-ciclos.db');

function motor() {
  const m = String(process.env.CRM_DB || 'sqlite').trim().toLowerCase();
  return m === 'postgres' || m === 'postgresql' || m === 'pg' ? 'postgres' : 'sqlite';
}

/** Convierte `?` a $1…$n, sin tocar los que estén dentro de comillas. */
function toPgPlaceholders(sql) {
  let n = 0;
  let out = '';
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) { out += sql[i + 1]; i += 1; } else quote = null;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

// ── PostgreSQL ──────────────────────────────────────────────────────────────
let pgPool = null;

function getPgPool() {
  if (pgPool) return pgPool;
  const url = process.env.CRM_PG_URL;
  if (!url) {
    const err = new Error('CRM_DB=postgres pero falta CRM_PG_URL en backend/.env');
    err.status = 503;
    throw err;
  }
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: url,
    ssl: process.env.CRM_PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.CRM_PG_POOL_MAX || '10', 10),
    // Valores numéricos de PostgreSQL llegan como número, igual que en SQLite.
    types: {
      getTypeParser(oid, format) {
        const pgTypes = require('pg').types;
        if (oid === 20 || oid === 1700) return (v) => (v === null ? null : Number(v)); // bigint, numeric
        return pgTypes.getTypeParser(oid, format);
      },
    },
  });
  pgPool.on('error', (err) => console.error('[crmStore pg]', err.message));
  return pgPool;
}

// ── SQLite ──────────────────────────────────────────────────────────────────
function withSqlite(fn) {
  if (!fs.existsSync(SQLITE_PATH)) return null;
  const Database = require('better-sqlite3');
  const db = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ── API común ───────────────────────────────────────────────────────────────

/** ¿Hay base disponible? (archivo SQLite presente o URL de PostgreSQL configurada) */
function disponible() {
  return motor() === 'postgres' ? !!process.env.CRM_PG_URL : fs.existsSync(SQLITE_PATH);
}

/** Todas las filas. Sin base disponible regresa [] (la pantalla muestra «sin datos»). */
async function all(sql, params = []) {
  if (motor() === 'postgres') {
    const { rows } = await getPgPool().query(toPgPlaceholders(sql), params);
    return rows;
  }
  return withSqlite((db) => db.prepare(sql).all(...params)) || [];
}

/** Primera fila o null. */
async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function tableExists(name) {
  if (motor() === 'postgres') {
    const row = await get('SELECT to_regclass(?) AS t', [`public.${name}`]);
    return !!row?.t;
  }
  const row = await get("SELECT 1 AS t FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  return !!row;
}

async function close() {
  if (pgPool) {
    const p = pgPool;
    pgPool = null;
    await p.end();
  }
}

module.exports = {
  motor,
  disponible,
  all,
  get,
  tableExists,
  close,
  toPgPlaceholders,
  SQLITE_PATH,
};
