const express = require('express');
const {
  authenticate,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getAssignableRoles,
  revealPassword,
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
const {
  listAlertTypes,
  getPrefs,
  updatePrefs,
  getAlertsForRole,
} = require('../services/alertsService');

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

router.get('/users/:username/password', requireUserManager, (req, res) => {
  try {
    const result = revealPassword(req.params.username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/alerts', requireSession, async (req, res) => {
  try {
    const role = req.session.role;
    const alerts = await getAlertsForRole(role);
    res.json({
      role,
      roleLabel: getRole(role)?.label || role,
      count: alerts.length,
      alerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudieron cargar las alertas.' });
  }
});

router.get('/alert-types', requireUserManager, (_req, res) => {
  res.json({ types: listAlertTypes(), roles: getAssignableRoles() });
});

router.get('/alert-prefs', requireUserManager, (_req, res) => {
  res.json({
    types: listAlertTypes(),
    roles: getAssignableRoles(),
    byRole: getPrefs(),
  });
});

router.put('/alert-prefs', requireUserManager, (req, res) => {
  try {
    const byRole = updatePrefs(req.body?.byRole || {});
    res.json({ ok: true, byRole, types: listAlertTypes() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/admin-expense-proration', requireUserManager, (_req, res) => {
  try {
    const {
      getAdminExpenseProration,
    } = require('../services/adminExpenseProrationStore');
    res.json(getAdminExpenseProration());
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo cargar el prorrateo.' });
  }
});

router.put('/admin-expense-proration', requireUserManager, (req, res) => {
  try {
    const {
      saveAdminExpenseProration,
      resetAdminExpenseProration,
    } = require('../services/adminExpenseProrationStore');
    const result = req.body?.reset
      ? resetAdminExpenseProration()
      : saveAdminExpenseProration(req.body?.config || req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message, details: err.details || null });
  }
});

module.exports = router;
