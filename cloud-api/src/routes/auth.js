const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireApiKey } = require('../middleware/apiKey');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { authenticate, signToken } = require('../services/mobileAuth');
const {
  upsertAuthUsersBatch,
  listAuthUsers,
  getAuthUsersSummary,
} = require('../services/authUsersStore');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Intente más tarde.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const user = await authenticate(username, password);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }
    return res.json({ ok: true, token: signToken(user), user });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireMobileAuth, (req, res) => {
  res.json(req.mobileUser);
});

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

/** Resumen de la tabla auth_users (sync oficina → nube). */
router.get('/users/summary', requireApiKey, async (_req, res, next) => {
  try {
    const summary = await getAuthUsersSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    return next(err);
  }
});

router.get('/users', requireApiKey, async (_req, res, next) => {
  try {
    const users = await listAuthUsers();
    res.json({ ok: true, count: users.length, users });
  } catch (err) {
    return next(err);
  }
});

/**
 * Carga / refresca usuarios desde la oficina.
 * Body: { records: [{ username, passwordHash, role, active }], replaceAll?: true }
 */
router.post('/users/ingest', requireApiKey, async (req, res, next) => {
  try {
    const body = req.body || {};
    const records = Array.isArray(body)
      ? body
      : (body.records || body.users || []);
    const result = await upsertAuthUsersBatch(records, {
      replaceAll: body.replaceAll === true || body.replaceAll === 'true',
      source: String(body.source || 'api'),
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
