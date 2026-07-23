const express = require('express');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { authenticate, signToken } = require('../services/mobileAuth');

const router = express.Router();

router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const user = authenticate(username, password);
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
