const userStore = require('./userStore');

function authenticate(username, password) {
  return userStore.authenticateUser(username, password);
}

/**
 * Login local; si falla y hay CLOUD_SYNC_URL + API key, intenta Railway /api/auth/login.
 * Útil en escritorios híbridos sin users.json completo.
 */
async function authenticateHybrid(username, password) {
  const local = userStore.authenticateUser(username, password);
  if (local) return { ...local, source: 'local' };

  const base = String(process.env.CLOUD_SYNC_URL || process.env.CLOUD_READ_URL || '')
    .trim().replace(/\/$/, '');
  const key = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  const enabled = !['0', 'false', 'no', 'off'].includes(
    String(process.env.AUTH_CLOUD_FALLBACK ?? 'true').trim().toLowerCase(),
  );
  if (!enabled || !base || !username || !password) return null;

  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok || !body.user?.username) return null;
    return {
      username: body.user.username,
      role: body.user.role,
      source: 'cloud',
    };
  } catch (err) {
    console.warn('[auth] fallback nube falló:', err.message);
    return null;
  }
}

module.exports = {
  authenticate,
  authenticateHybrid,
  listUsers: userStore.listUsers,
  createUser: userStore.createUser,
  updateUser: userStore.updateUser,
  deleteUser: userStore.deleteUser,
  getAssignableRoles: userStore.getAssignableRoles,
  revealPassword: userStore.revealPassword,
};
