const crypto = require('crypto');

const COOKIE_NAME = 'balderrama_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isAuthEnabled() {
  return String(process.env.AUTH_ENABLED || 'true').toLowerCase() !== 'false';
}

function getSecret() {
  return process.env.AUTH_SECRET || 'cambiar-en-produccion-balderrama';
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!payload.username || !payload.role) return null;
    return { username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

function createSession(user) {
  const payload = {
    username: user.username,
    role: user.role,
    exp: Date.now() + MAX_AGE_MS,
  };
  return sign(payload);
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function readSession(req) {
  if (!isAuthEnabled()) {
    return { username: 'dev', role: 'direccion', devBypass: true };
  }
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}${secure}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = {
  COOKIE_NAME,
  isAuthEnabled,
  createSession,
  readSession,
  setSessionCookie,
  clearSessionCookie,
};
