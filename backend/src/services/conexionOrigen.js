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
const PROBE_MS = 4000;

/** Último resultado de sonda (evita pantalla en blanco si falla la red). */
let ultimoAviso = null;
let ultimoConectado = null;

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

function estadoBase() {
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

function estado() {
  const base = estadoBase();
  return {
    ...base,
    conectado: ultimoConectado,
    aviso: ultimoAviso,
  };
}

async function probarHost(host, timeoutMs = PROBE_MS) {
  const sql = require('mssql');
  const pool = new sql.ConnectionPool({
    server: host,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: timeoutMs,
    },
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
  });
  try {
    await Promise.race([
      pool.connect().then(() => pool.request().query('SELECT 1 AS ok')),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`sin respuesta en ${Math.round(timeoutMs / 1000)} s`)), timeoutMs + 500);
      }),
    ]);
  } finally {
    try { await pool.close(); } catch { /* ignore */ }
  }
}

async function sondearOpcion(op, probar = probarHost) {
  if (!op.disponible || !op.host) {
    return {
      ...op,
      alcanzable: false,
      error: op.nota || 'No disponible',
    };
  }
  try {
    await probar(op.host);
    return { ...op, alcanzable: true, error: null };
  } catch (err) {
    return {
      ...op,
      alcanzable: false,
      error: err.message || 'Sin conexión',
    };
  }
}

/**
 * Estado con prueba de red a local/remota.
 * Marca alcanzable por opción y deja aviso si ninguna responde.
 * @param {{ probar?: (host: string) => Promise<void> }} [opts]
 */
async function estadoConPrueba({ probar = probarHost } = {}) {
  const base = estadoBase();
  const opciones = await Promise.all(base.opciones.map((op) => sondearOpcion(op, probar)));
  const activa = opciones.find((op) => op.activo);
  const alguna = opciones.some((op) => op.alcanzable);
  let aviso = null;
  if (!alguna) {
    aviso = 'No se pudo conectar a ninguna base de datos (local ni remota). Revise la red, VPN o SQL Server.';
  } else if (activa && !activa.alcanzable) {
    const otra = opciones.find((op) => op.alcanzable);
    aviso = otra
      ? `La conexión activa (${activa.label}) no responde. ${otra.label} sí está disponible.`
      : `La conexión activa (${activa.label}) no responde.`;
  }
  ultimoAviso = aviso;
  ultimoConectado = Boolean(activa?.alcanzable);
  return {
    ...base,
    opciones,
    conectado: ultimoConectado,
    algunaAlcanzable: alguna,
    aviso,
  };
}

/** Aplica el modo guardado al arrancar, sin probar la red. */
function aplicarGuardado() {
  const { setServer } = require('../db');
  const host = MODOS[modoActivo()].host;
  setServer(host);
  return estado();
}

/**
 * Al arrancar: prueba el modo guardado; si falla, prueba la otra;
 * si ninguna responde, deja el preferido y un aviso (sin tumbar el proceso).
 */
async function aplicarAlArranque() {
  const { setServer } = require('../db');
  const preferido = modoActivo();
  const orden = [
    preferido,
    ...Object.keys(MODOS).filter((k) => MODOS[k].disponible && k !== preferido),
  ];

  for (const id of orden) {
    const item = MODOS[id];
    try {
      await probarHost(item.host);
      guardar(id);
      await setServer(item.host);
      ultimoConectado = true;
      ultimoAviso = id === preferido
        ? null
        : `Se usó ${item.label} porque ${MODOS[preferido].label} no respondió.`;
      console.log(`[conexion] ${item.label} · ${item.host}${ultimoAviso ? ` (${ultimoAviso})` : ''}`);
      return estado();
    } catch (err) {
      console.warn(`[conexion] ${item.label} (${item.host}) no responde: ${err.message}`);
    }
  }

  const fallback = MODOS[preferido];
  await setServer(fallback.host);
  ultimoConectado = false;
  ultimoAviso = 'No se pudo conectar a ninguna base de datos (local ni remota). El tablero puede quedar sin datos.';
  console.warn(`[conexion] ${ultimoAviso}`);
  return estado();
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
  ultimoConectado = true;
  ultimoAviso = null;
  console.log(`[conexion] ${item.label} · ${item.host}`);
  return estado();
}

module.exports = {
  MODOS,
  estado,
  estadoConPrueba,
  aplicarGuardado,
  aplicarAlArranque,
  seleccionar,
  guardar,
  modoActivo,
};
