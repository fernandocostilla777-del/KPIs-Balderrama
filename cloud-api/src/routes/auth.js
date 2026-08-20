const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { authenticate, signToken } = require('../services/mobileAuth');

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

module.exports = router;
