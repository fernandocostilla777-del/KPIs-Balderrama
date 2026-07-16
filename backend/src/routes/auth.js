const express = require('express');
const {
  authenticate,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getAssignableRoles,
} = require('../auth/users');
const { ROLES, getRole, canManageUsers } = require('../auth/roles');
const { requireSession, requireUserManager } = require('../auth/middleware');
const {
  isAuthEnabled,
  createSession,
  readSession,
  setSessionCookie,
  clearSessionCookie,
} = require('../auth/session');

const router = express.Router();

router.get('/config', (_req, res) => {
  res.json({
    enabled: isAuthEnabled(),
    roles: Object.values(ROLES).map((r) => ({ id: r.id, label: r.label, pages: r.pages })),
    assignableRoles: getAssignableRoles(),
  });
});

router.get('/me', requireSession, (req, res) => {
  const session = req.session;
  const role = getRole(session.role);
  res.json({
    username: session.username,
    role: session.role,
    roleLabel: role?.label || session.role,
    pages: role?.pages || [],
    homePath: role?.homePath || '/',
    canManageUsers: canManageUsers(session.role),
    devBypass: !!session.devBypass,
  });
});

router.post('/login', (req, res) => {
  if (!isAuthEnabled()) {
    return res.json({ ok: true, role: 'direccion', roleLabel: 'Dirección (modo desarrollo)' });
  }
  const { username, password } = req.body || {};
  const user = authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const token = createSession(user);
  setSessionCookie(res, token);
  const role = getRole(user.role);
  res.json({
    ok: true,
    username: user.username,
    role: user.role,
    roleLabel: role?.label || user.role,
    homePath: role?.homePath || '/',
    canManageUsers: canManageUsers(user.role),
  });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/users', requireUserManager, (_req, res) => {
  res.json({ users: listUsers(), roles: getAssignableRoles() });
});

router.post('/users', requireUserManager, (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    const user = createUser({ username, password, role });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:username', requireUserManager, (req, res) => {
  try {
    const { password, role, active } = req.body || {};
    const user = updateUser(req.params.username, { password, role, active });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/users/:username', requireUserManager, (req, res) => {
  try {
    deleteUser(req.params.username, req.session.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
