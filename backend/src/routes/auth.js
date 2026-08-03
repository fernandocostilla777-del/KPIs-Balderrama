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
const {
  getRole,
  canManageUsers,
  getRolePermissionsPayload,
  saveRolePermissions,
  restoreDefaultRolePermissions,
} = require('../auth/roles');
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
const messagesService = require('../services/messagesService');

const router = express.Router();

router.get('/config', (_req, res) => {
  const { listRoles } = require('../auth/roles');
  res.json({
    enabled: isAuthEnabled(),
    roles: listRoles(),
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

router.post('/users', requireUserManager, async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    const user = createUser({ username, password, role });
    try {
      const { syncAuthUsers } = require('../services/cloudSync/cloudSyncScheduler');
      await syncAuthUsers({ reason: 'user-create' });
    } catch (syncErr) {
      console.warn('[auth] sync usuarios a cloud:', syncErr.message);
    }
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:username', requireUserManager, async (req, res) => {
  try {
    const { password, role, active } = req.body || {};
    const user = updateUser(req.params.username, { password, role, active });
    try {
      const { syncAuthUsers } = require('../services/cloudSync/cloudSyncScheduler');
      await syncAuthUsers({ reason: 'user-update' });
    } catch (syncErr) {
      console.warn('[auth] sync usuarios a cloud:', syncErr.message);
    }
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/users/:username', requireUserManager, async (req, res) => {
  try {
    deleteUser(req.params.username, req.session.username);
    try {
      const { syncAuthUsers } = require('../services/cloudSync/cloudSyncScheduler');
      await syncAuthUsers({ reason: 'user-delete' });
    } catch (syncErr) {
      console.warn('[auth] sync usuarios a cloud:', syncErr.message);
    }
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
    const username = req.session.username;
    const alerts = await getAlertsForRole(role);
    const messages = messagesService.listMessagesForUser(username, { box: 'inbox', includeDone: true });
    const unreadMessages = messagesService.countUnread(username);
    const messageAlerts = messagesService.messagesAsAlertItems(username);
    res.json({
      role,
      roleLabel: getRole(role)?.label || role,
      count: alerts.length,
      alerts,
      messages,
      unreadMessages,
      messageAlerts,
      totalUnreadHint: unreadMessages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudieron cargar las alertas.' });
  }
});

router.get('/directory', requireSession, (req, res) => {
  res.json({ users: messagesService.listDirectory(req.session.username) });
});

router.get('/messages', requireSession, (req, res) => {
  const box = String(req.query.box || 'inbox');
  const includeDone = String(req.query.includeDone || 'true') !== 'false';
  const messages = messagesService.listMessagesForUser(req.session.username, { box, includeDone });
  res.json({
    box,
    count: messages.length,
    unread: messagesService.countUnread(req.session.username),
    messages,
  });
});

router.post('/messages', requireSession, (req, res) => {
  try {
    const { toUsername, subject, body, type, source } = req.body || {};
    const message = messagesService.createMessage({
      fromUsername: req.session.username,
      toUsername,
      subject,
      body,
      type,
      source,
    });
    res.status(201).json({ ok: true, message });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/messages/:id/read', requireSession, (req, res) => {
  try {
    const message = messagesService.markRead(req.params.id, req.session.username);
    res.json({ ok: true, message });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/messages/:id/reply', requireSession, (req, res) => {
  try {
    const message = messagesService.replyMessage(req.params.id, req.session.username, req.body?.body);
    res.json({ ok: true, message });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/messages/:id/done', requireSession, (req, res) => {
  try {
    const message = messagesService.closeMessage(
      req.params.id,
      req.session.username,
      req.body || {}
    );
    res.json({ ok: true, message });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
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

router.get('/role-permissions', requireUserManager, (_req, res) => {
  res.json(getRolePermissionsPayload());
});

router.put('/role-permissions', requireUserManager, (req, res) => {
  try {
    if (req.body?.reset) {
      return res.json({ ok: true, ...restoreDefaultRolePermissions() });
    }
    const payload = saveRolePermissions(req.body?.byRole || req.body || {});
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
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
