const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

const ROLE_LABELS = {
  administracion: 'Administración',
  direccion: 'Dirección',
  gerencia_comercial: 'Gerencia comercial',
  contabilidad: 'Contabilidad',
};

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

function getUsers() {
  const raw = String(process.env.MOBILE_AUTH_USERS || '').trim();
  if (!raw) {
    throw new Error('MOBILE_AUTH_USERS no configurado');
  }
  return raw.split(';').map((entry) => {
    const [username, password, role = 'direccion'] = entry.split(':');
    return {
      username: String(username || '').trim(),
      password: String(password || ''),
      role: String(role || 'direccion').trim(),
    };
  }).filter((user) => user.username && user.password);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUser(user) {
  return {
    username: user.username,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    pages: ['dashboard', 'metrics', 'profile'],
    homePath: '/tabs/dashboard',
    canManageUsers: user.role === 'administracion',
  };
}

function authenticate(username, password) {
  const user = getUsers().find((item) => safeEqual(item.username, String(username || '').trim()));
  if (!user || !safeEqual(user.password, password || '')) return null;
  return publicUser(user);
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

module.exports = { authenticate, signToken, verifyToken };
