const { canAccessPage, canAccessApi, canManageUsers, getRole } = require('./roles');
const { isAuthEnabled, readSession } = require('./session');

function getSession(req) {
  return req.session || readSession(req);
}

function attachSession(req, _res, next) {
  req.session = readSession(req);
  next();
}

function requireAuthPage(pageId) {
  return (req, res, next) => {
    if (!isAuthEnabled()) return next();
    const session = req.session || readSession(req);
    if (!session) {
      const returnUrl = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/login.html?returnUrl=${returnUrl}`);
    }
    if (!canAccessPage(session.role, pageId)) {
      const home = getRole(session.role)?.homePath || '/login.html';
      return res.redirect(home);
    }
    next();
  };
}

function requireAuthApi(req, res, next) {
  if (!isAuthEnabled()) return next();
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Sesión requerida. Inicie sesión.' });
  }
  if (!canAccessApi(session.role, req.originalUrl)) {
    return res.status(403).json({ error: 'No tiene permiso para este recurso.' });
  }
  next();
}

function requireSession(req, res, next) {
  if (!isAuthEnabled()) {
    req.session = { username: 'dev', role: 'direccion', devBypass: true };
    return next();
  }
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Sesión requerida. Inicie sesión.' });
  }
  req.session = session;
  next();
}

function requireUserManager(req, res, next) {
  requireSession(req, res, () => {
    if (!canManageUsers(req.session.role)) {
      return res.status(403).json({ error: 'Solo Administración puede gestionar usuarios.' });
    }
    next();
  });
}

module.exports = {
  attachSession,
  requireAuthPage,
  requireAuthApi,
  requireSession,
  requireUserManager,
};
