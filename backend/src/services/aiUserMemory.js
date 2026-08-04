/**
 * Memoria persistente del asistente por usuario.
 * Guarda preferencias y hechos útiles para personalizar razonamiento.
 */
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/ai-user-memory.json');
const MAX_FACTS = 40;

function emptyUserMemory(username) {
  return {
    username: String(username || '').trim().toLowerCase() || 'anon',
    updatedAt: null,
    facts: [],
    preferences: {},
    notes: '',
  };
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ users: {} }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return { users: {} };
    if (!raw.users || typeof raw.users !== 'object') raw.users = {};
    return raw;
  } catch {
    return { users: {} };
  }
}

function writeStore(store) {
  ensureStore();
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

function userKey(username) {
  return String(username || '').trim().toLowerCase() || 'anon';
}

function getUserMemory(username) {
  const key = userKey(username);
  const store = readStore();
  return store.users[key] ? { ...emptyUserMemory(key), ...store.users[key] } : emptyUserMemory(key);
}

function saveUserMemory(username, patch = {}) {
  const key = userKey(username);
  const store = readStore();
  const current = store.users[key] || emptyUserMemory(key);
  const next = {
    ...current,
    ...patch,
    username: key,
    updatedAt: new Date().toISOString(),
  };
  if (Array.isArray(patch.facts)) next.facts = patch.facts.slice(0, MAX_FACTS);
  if (patch.preferences && typeof patch.preferences === 'object') {
    next.preferences = { ...(current.preferences || {}), ...patch.preferences };
  }
  store.users[key] = next;
  writeStore(store);
  return next;
}

/**
 * @param {string} username
 * @param {{ key?: string, value: string, category?: string }} fact
 */
function rememberFact(username, fact = {}) {
  const value = String(fact.value || '').trim();
  if (!value) throw new Error('Se requiere value para recordar.');
  const key = String(fact.key || value.slice(0, 48)).trim().toLowerCase().replace(/\s+/g, '_');
  const category = String(fact.category || 'general').trim().toLowerCase() || 'general';
  const mem = getUserMemory(username);
  const facts = Array.isArray(mem.facts) ? [...mem.facts] : [];
  const idx = facts.findIndex((f) => f.key === key);
  const entry = {
    key,
    category,
    value,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) facts[idx] = entry;
  else facts.unshift(entry);
  return saveUserMemory(username, { facts: facts.slice(0, MAX_FACTS) });
}

function rememberPreference(username, prefKey, prefValue) {
  const k = String(prefKey || '').trim();
  if (!k) throw new Error('Se requiere clave de preferencia.');
  return saveUserMemory(username, {
    preferences: { [k]: prefValue },
  });
}

function clearUserMemory(username) {
  const key = userKey(username);
  const store = readStore();
  delete store.users[key];
  writeStore(store);
  return { ok: true, username: key };
}

function buildUserMemoryPromptBlock(username) {
  const mem = getUserMemory(username);
  const prefs = mem.preferences && Object.keys(mem.preferences).length
    ? Object.entries(mem.preferences).map(([k, v]) => `- ${k}: ${v}`)
    : [];
  const facts = (mem.facts || []).slice(0, 15).map((f) => `- [${f.category || 'general'}] ${f.value}`);

  if (!prefs.length && !facts.length && !mem.notes) {
    return [
      '### Memoria del usuario',
      'Aún no hay preferencias guardadas.',
      'Si el usuario indica periodo favorito, sucursal, fuerza, métrica preferida o forma de reportar, usa actualizar_memoria_usuario.',
    ].join('\n');
  }

  const lines = ['### Memoria del usuario (personalización)'];
  if (prefs.length) {
    lines.push('Preferencias:');
    lines.push(...prefs);
  }
  if (facts.length) {
    lines.push('Hechos / focos recordados:');
    lines.push(...facts);
  }
  if (mem.notes) lines.push(`Notas: ${mem.notes}`);
  lines.push('Aplica esta memoria al interpretar preguntas y al priorizar qué consultar.');
  return lines.join('\n');
}

module.exports = {
  getUserMemory,
  saveUserMemory,
  rememberFact,
  rememberPreference,
  clearUserMemory,
  buildUserMemoryPromptBlock,
  STORE_PATH,
};
