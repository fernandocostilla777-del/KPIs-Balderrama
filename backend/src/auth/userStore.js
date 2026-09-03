const fs = require('fs');
const path = require('path');
const { ROLES, resolveRoleFromUsername } = require('./roles');
const { hashPassword, verifyPassword, encryptPassword, decryptPassword } = require('./password');

const USERS_FILE = path.join(__dirname, '../../data/users.json');

const SEED_USERS = [
  { username: 'admin', password: 'Admin2026!', role: 'administracion' },
  { username: 'direccion', password: 'Direccion2026!', role: 'direccion' },
  { username: 'gerente.general', password: 'GgBalderrama2026!', role: 'direccion' },
  { username: 'gerencia', password: 'Comercial2026!', role: 'gerencia_comercial' },
  { username: 'comercial', password: 'Comercial2026!', role: 'gerencia_comercial' },
  { username: 'contabilidad', password: 'Conta2026!', role: 'contabilidad' },
  { username: 'contraloria', password: 'Contraloria2026!', role: 'contabilidad' },
  { username: 'mtk', password: 'MtkBalderrama2026!', role: 'marketing' },
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function parseEnvUsers(raw) {
  if (!raw || !String(raw).trim()) return [];
  const users = [];
  for (const entry of String(raw).split(';')) {
    const part = entry.trim();
    if (!part) continue;
    const pieces = part.split(':');
    const username = pieces[0];
    const password = pieces[1];
    const role = pieces[2] || resolveRoleFromUsername(username);
    if (!username || !password || !role || !ROLES[role]) continue;
    users.push({ username: normalizeUsername(username), password, role });
  }
  return users;
}

function buildSeedUsers() {
  const map = new Map();
  for (const user of SEED_USERS) {
    map.set(user.username, user);
  }
  for (const user of parseEnvUsers(process.env.AUTH_USERS)) {
    map.set(user.username, user);
  }
  return [...map.values()];
}

function toStoredUser({ username, password, role, active = true }) {
  const ts = nowIso();
  return {
    username: normalizeUsername(username),
    passwordHash: hashPassword(password),
    passwordEnc: encryptPassword(password),
    role,
    active,
    createdAt: ts,
    updatedAt: ts,
  };
}

function backfillPasswordEnc(store) {
  let changed = false;
  for (const user of store.users) {
    if (user.passwordEnc) continue;
    const seed = SEED_USERS.find((s) => s.username === user.username);
    if (seed && verifyPassword(seed.password, user.passwordHash)) {
      user.passwordEnc = encryptPassword(seed.password);
      changed = true;
    }
  }
  if (changed) saveStore(store);
  return store;
}

function ensureStore() {
  if (fs.existsSync(USERS_FILE)) return;
  const users = buildSeedUsers().map((u) => toStoredUser(u));
  saveStore({ users });
}

function ensureAdminUser(store) {
  const hasAdmin = store.users.some((u) => u.role === 'administracion' && u.active !== false);
  if (hasAdmin) return store;
  const seed = SEED_USERS.find((u) => u.role === 'administracion');
  if (seed) {
    store.users.push(toStoredUser(seed));
    saveStore(store);
  }
  return store;
}

function loadStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.users && Array.isArray(parsed.users)) {
      return backfillPasswordEnc(ensureAdminUser(parsed));
    }
  } catch {
    /* archivo corrupto */
  }
  const users = buildSeedUsers().map((u) => toStoredUser(u));
  const store = { users };
  saveStore(store);
  return store;
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function sanitizeUser(user) {
  return {
    username: user.username,
    role: user.role,
    roleLabel: ROLES[user.role]?.label || user.role,
    active: user.active !== false,
    hasRevealablePassword: Boolean(user.passwordEnc),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function listUsers() {
  const store = loadStore();
  return store.users.map(sanitizeUser).sort((a, b) => a.username.localeCompare(b.username));
}

function findUser(username) {
  const key = normalizeUsername(username);
  return loadStore().users.find((u) => u.username === key) || null;
}

function authenticateUser(username, password) {
  const user = findUser(username);
  if (!user || user.active === false) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { username: user.username, role: user.role };
}

function validateUsername(username) {
  const key = normalizeUsername(username);
  if (key.length < 3 || key.length > 32) {
    throw new Error('El usuario debe tener entre 3 y 32 caracteres.');
  }
  if (!/^[a-z0-9._-]+$/.test(key)) {
    throw new Error('El usuario solo puede contener letras, números, punto, guion y guion bajo.');
  }
  return key;
}

function validatePassword(password) {
  if (!password || String(password).length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }
  return String(password);
}

function validateRole(role) {
  if (!role || !ROLES[role]) {
    throw new Error('Rol inválido.');
  }
  return role;
}

function createUser({ username, password, role }) {
  const store = loadStore();
  const key = validateUsername(username);
  validatePassword(password);
  const validRole = validateRole(role);
  if (store.users.some((u) => u.username === key)) {
    throw new Error('Ese nombre de usuario ya existe.');
  }
  const user = toStoredUser({ username: key, password, role: validRole, active: true });
  store.users.push(user);
  saveStore(store);
  return sanitizeUser(user);
}

function updateUser(username, { password, role, active }) {
  const store = loadStore();
  const key = normalizeUsername(username);
  const idx = store.users.findIndex((u) => u.username === key);
  if (idx === -1) throw new Error('Usuario no encontrado.');

  const user = store.users[idx];
  if (role !== undefined) user.role = validateRole(role);
  if (active !== undefined) user.active = !!active;
  if (password) {
    const validPassword = validatePassword(password);
    user.passwordHash = hashPassword(validPassword);
    user.passwordEnc = encryptPassword(validPassword);
  }
  user.updatedAt = nowIso();

  store.users[idx] = user;
  saveStore(store);
  return sanitizeUser(user);
}

function deleteUser(username, requesterUsername) {
  const store = loadStore();
  const key = normalizeUsername(username);
  const requester = normalizeUsername(requesterUsername);
  if (key === requester) {
    throw new Error('No puede eliminar su propio usuario.');
  }
  const idx = store.users.findIndex((u) => u.username === key);
  if (idx === -1) throw new Error('Usuario no encontrado.');

  const target = store.users[idx];
  const admins = store.users.filter((u) => u.role === 'administracion' && u.active !== false);
  if (target.role === 'administracion' && admins.length <= 1) {
    throw new Error('Debe existir al menos un usuario de Administración activo.');
  }

  store.users.splice(idx, 1);
  saveStore(store);
  return { ok: true };
}

function getAssignableRoles() {
  const { listRoles } = require('./roles');
  return listRoles().map((r) => ({ id: r.id, label: r.label, pages: r.pages }));
}

function revealPassword(username) {
  const user = findUser(username);
  if (!user) throw new Error('Usuario no encontrado.');
  if (!user.passwordEnc) {
    return {
      available: false,
      username: user.username,
      message: 'No hay contraseña recuperable. Restablézcala desde Administración para poder verla después.',
    };
  }
  const password = decryptPassword(user.passwordEnc);
  if (!password) {
    return {
      available: false,
      username: user.username,
      message: 'No se pudo descifrar la contraseña. Restablézcala e intente de nuevo.',
    };
  }
  return { available: true, username: user.username, password };
}

/** Snapshot para Cloud API (hashes scrypt; sin passwordEnc). */
function exportCloudSyncRecords() {
  const store = loadStore();
  return store.users.map((user) => ({
    id: user.username,
    data: {
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      active: user.active !== false,
      updatedAt: user.updatedAt || null,
    },
  }));
}

module.exports = {
  listUsers,
  findUser,
  authenticateUser,
  createUser,
  updateUser,
  deleteUser,
  getAssignableRoles,
  revealPassword,
  exportCloudSyncRecords,
};
