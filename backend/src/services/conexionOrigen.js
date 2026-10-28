'use strict';

const fs = require('fs');
const path = require('path');

/** Las tres salidas del tablero. La nube queda visible, todavía sin uso. */
const MODOS = {
  local: { id: 'local', label: 'Local', host: '192.168.0.2', disponible: true },
  remota: { id: 'remota', label: 'Remota', host: '189.197.60.78', disponible: true },
  nube: { id: 'nube', label: 'La nube', host: null, disponible: false, nota: 'Próximamente' },
};

const ARCHIVO = path.join(__dirname, '../../data/conexion-origen.json');

function error(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function leerModoGuardado() {
  try {
    const data = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    if (MODOS[data.modo]?.disponible) return data.modo;
  } catch {
    /* sin archivo: se infiere del host configurado */
  }
  return null;
}

function modoDesdeHost(host) {
  const h = String(host || '').trim();
  const hallado = Object.values(MODOS).find((m) => m.disponible && m.host === h);
  return hallado ? hallado.id : 'local';
}

function modoActivo() {
  return leerModoGuardado() || modoDesdeHost(process.env.DB_HOST);
}

function guardar(modo) {
  fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
  fs.writeFileSync(ARCHIVO, JSON.stringify({ modo }, null, 2));
}

function estado() {
  const modo = modoActivo();
  const actual = MODOS[modo];
  return {
    modo,
    label: actual.label,
    host: actual.host,
    opciones: Object.values(MODOS).map((m) => ({
      id: m.id,
      label: m.label,
      host: m.host,
      disponible: m.disponible,
      nota: m.nota || null,
      activo: m.id === modo,
    })),
  };
}

/** Aplica el modo guardado al arrancar, sin probar la red. */
function aplicarGuardado() {
  const { setServer } = require('../db');
  const host = MODOS[modoActivo()].host;
  setServer(host);
  return estado();
}

async function probarHost(host) {
  const sql = require('mssql');
  const pool = new sql.ConnectionPool({
    server: host,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 8000 },
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
  });
  try {
    await pool.connect();
    await pool.request().query('SELECT 1 AS ok');
  } finally {
    try { await pool.close(); } catch { /* ignore */ }
  }
}

/**
 * Cambia la base en caliente. Prueba el host antes de soltar la conexión actual.
 * @param {string} modo
 * @param {{ probar?: (host: string) => Promise<void> }} [opts]
 */
async function seleccionar(modo, { probar = probarHost } = {}) {
  const item = MODOS[String(modo || '').trim()];
  if (!item) throw error(400, 'Conexión no reconocida. Use local o remota.');
  if (!item.disponible) throw error(400, 'La nube está próxima. Elija local o remota.');
  try {
    await probar(item.host);
  } catch (err) {
    throw error(502, `No se pudo conectar a ${item.label} (${item.host}). ${err.message}`);
  }
  guardar(item.id);
  const { setServer } = require('../db');
  await setServer(item.host);
  try {
    require('./ventas').clearVentasSofiaCaches();
  } catch {
    /* el caché se vence solo */
  }
  console.log(`[conexion] ${item.label} · ${item.host}`);
  return estado();
}

module.exports = {
  MODOS,
  estado,
  aplicarGuardado,
  seleccionar,
};
