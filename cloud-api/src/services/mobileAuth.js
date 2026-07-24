const crypto = require('crypto');
const { rolePages, getRoleScope } = require('./mobileRoles');

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function getSecret() {
  const secret = String(process.env.MOBILE_AUTH_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error('MOBILE_AUTH_SECRET debe tener al menos 32 caracteres');
  }
  return secret;
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

/** Misma verificación scrypt que el dashboard web (salt:hash). */
function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  if (!String(stored).includes(':')) {
    return safeEqual(String(password), String(stored));
  }
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = Buffer.from(test, 'hex');
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Fallback legacy: MOBILE_AUTH_USERS=user:pass:role;... */
function getEnvUsers() {
  const raw = String(process.env.MOBILE_AUTH_USERS || '').trim();
  if (!raw) return [];
  return raw.split(';').map((entry) => {
    const [username, password, role = 'direccion'] = entry.split(':');
    return {
      username: normalizeUsername(username),
      password: String(password || ''),
      role: String(role || 'direccion').trim(),
      active: true,
      source: 'env',
    };
  }).filter((user) => user.username && user.password);
}

async function getSyncedUsers() {
  try {
    const { query } = require('../db');
    const result = await query(
      `SELECT external_id, payload
       FROM sync_entities
       WHERE domain = 'auth'
         AND period_key IS NOT DISTINCT FROM 'global'
       ORDER BY last_seen_at DESC`
    );
    return (result.rows || []).map((row) => {
      const p = row.payload || {};
      return {
        username: normalizeUsername(p.username || row.external_id),
        passwordHash: p.passwordHash || null,
        role: String(p.role || 'direccion').trim(),
        active: p.active !== false,
        source: 'sync',
      };
    }).filter((u) => u.username && u.passwordHash);
  } catch (err) {
    console.warn('[mobile-auth] No se pudieron leer usuarios sync:', err.message);
    return [];
  }
}

function publicUser(user) {
  const role = user.role || 'direccion';
  const scope = getRoleScope(role);
  const pages = rolePages(role);
  return {
    username: user.username,
    role,
    roleLabel: scope.label,
    pages,
    homePath: pages.includes('dashboard')
      ? '/tabs/dashboard'
      : pages.includes('metrics')
        ? '/tabs/metrics'
        : '/tabs/assistant',
    canManageUsers: role === 'administracion',
    metricSections: scope.metricSections,
    aiTools: scope.tools,
  };
}

async function authenticate(username, password) {
  const key = normalizeUsername(username);
  if (!key || !password) return null;

  const synced = await getSyncedUsers();
  if (synced.length) {
    const user = synced.find((u) => u.username === key);
    if (!user || user.active === false) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return publicUser(user);
  }

  // Fallback temporal si aún no hay sync de auth
  const envUser = getEnvUsers().find((u) => u.username === key);
  if (!envUser || !safeEqual(envUser.password, password)) return null;
  return publicUser(envUser);
}

function signToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: user.username,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  });
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims.sub || Number(claims.exp) <= Math.floor(Date.now() / 1000)) return null;
    return publicUser({ username: claims.sub, role: claims.role || 'direccion' });
  } catch {
    return null;
  }
}

module.exports = { authenticate, signToken, verifyToken, getSyncedUsers };
