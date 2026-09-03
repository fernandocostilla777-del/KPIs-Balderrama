const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./password');
const { findUser, updateUser, listUsers } = require('./userStore');
const messagesService = require('../services/messagesService');

const RESETS_FILE = path.join(__dirname, '../../data/passwordResets.json');
const CODE_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 90 * 1000;
const MAX_ATTEMPTS = 5;
const GENERIC_REQUEST_MSG = 'Si el usuario existe, Administración recibió un código de 6 dígitos. Introdúcelo junto con tu nueva contraseña.';
const GENERIC_INVALID_MSG = 'Código inválido o vencido. Solicita uno nuevo.';

const requestByIp = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function loadStore() {
  try {
    if (!fs.existsSync(RESETS_FILE)) return { byUser: {} };
    const raw = JSON.parse(fs.readFileSync(RESETS_FILE, 'utf8'));
    return {
      byUser: raw?.byUser && typeof raw.byUser === 'object' ? raw.byUser : {},
    };
  } catch {
    return { byUser: {} };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(RESETS_FILE), { recursive: true });
  fs.writeFileSync(RESETS_FILE, JSON.stringify({
    byUser: store.byUser || {},
    updatedAt: nowIso(),
  }, null, 2), 'utf8');
}

function pruneExpired(store) {
  const now = Date.now();
  for (const [key, entry] of Object.entries(store.byUser || {})) {
    if (!entry?.expiresAt || Date.parse(entry.expiresAt) <= now) {
      delete store.byUser[key];
    }
  }
  return store;
}

function tooManyRequests(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const hits = (requestByIp.get(key) || []).filter((ts) => now - ts < windowMs);
  if (hits.length >= 8) {
    requestByIp.set(key, hits);
    return true;
  }
  hits.push(now);
  requestByIp.set(key, hits);
  return false;
}

function notifyAdmins(username, code) {
  const admins = listUsers().filter((user) => (
    user.role === 'administracion' && user.active !== false
  ));
  const body = [
    `El usuario ${username} pidió restablecer su contraseña.`,
    '',
    `Código: ${code}`,
    'Vence en 30 minutos. Compártelo solo con esa persona.',
  ].join('\n');
  for (const admin of admins) {
    try {
      messagesService.createMessage({
        fromUsername: 'sistema',
        toUsername: admin.username,
        subject: `Código para restablecer contraseña · ${username}`,
        body,
        type: 'direct',
        source: {
          kind: 'alert',
          module: 'auth',
          insightTitle: 'Restablecimiento de contraseña',
        },
      });
    } catch (err) {
      console.warn('[auth] No se pudo avisar a', admin.username, err.message);
    }
  }
}

function requestPasswordReset(username, ip) {
  if (tooManyRequests(ip)) {
    const err = new Error('Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.');
    err.status = 429;
    throw err;
  }

  const key = normalizeUsername(username);
  const generic = { ok: true, message: GENERIC_REQUEST_MSG };
  if (!key) return generic;

  const user = findUser(key);
  if (!user || user.active === false) return generic;

  const store = pruneExpired(loadStore());
  const previous = store.byUser[key];
  if (previous?.requestedAt && Date.now() - Date.parse(previous.requestedAt) < RESEND_COOLDOWN_MS) {
    return generic;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  store.byUser[key] = {
    codeHash: hashPassword(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    requestedAt: nowIso(),
  };
  saveStore(store);
  notifyAdmins(user.username, code);
  console.log(`[auth] Código de restablecimiento para ${user.username}: ${code}`);
  return generic;
}

function confirmPasswordReset(username, code, password) {
  const key = normalizeUsername(username);
  const rawCode = String(code || '').replace(/\s+/g, '');
  if (!key || !/^\d{6}$/.test(rawCode)) {
    const err = new Error(GENERIC_INVALID_MSG);
    err.status = 400;
    throw err;
  }

  const store = pruneExpired(loadStore());
  const entry = store.byUser[key];
  if (!entry?.codeHash || Date.parse(entry.expiresAt) <= Date.now()) {
    const err = new Error(GENERIC_INVALID_MSG);
    err.status = 400;
    throw err;
  }

  if ((entry.attempts || 0) >= MAX_ATTEMPTS) {
    delete store.byUser[key];
    saveStore(store);
    const err = new Error('Se superó el número de intentos. Solicita un código nuevo.');
    err.status = 400;
    throw err;
  }

  if (!verifyPassword(rawCode, entry.codeHash)) {
    entry.attempts = (entry.attempts || 0) + 1;
    store.byUser[key] = entry;
    saveStore(store);
    const err = new Error(GENERIC_INVALID_MSG);
    err.status = 400;
    throw err;
  }

  const user = updateUser(key, { password });
  delete store.byUser[key];
  saveStore(store);
  return {
    ok: true,
    username: user.username,
    message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
  };
}

module.exports = {
  requestPasswordReset,
  confirmPasswordReset,
};
