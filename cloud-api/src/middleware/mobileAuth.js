const { verifyToken } = require('../services/mobileAuth');

function requireMobileAuth(req, res, next) {
  const value = String(req.headers.authorization || '');
  const token = value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  try {
    const user = verifyToken(token);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Sesión inválida o vencida' });
    }
    req.mobileUser = user;
    return next();
  } catch (err) {
    return res.status(503).json({ ok: false, error: err.message });
  }
}

module.exports = { requireMobileAuth };
