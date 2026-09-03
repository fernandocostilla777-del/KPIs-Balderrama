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
const summaryKpiPrefs = require('../services/summaryKpiPrefsService');
const messagesService = require('../services/messagesService');
const { requestPasswordReset, confirmPasswordReset } = require('../auth/passwordReset');

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

router.post('/password-reset/request', (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const result = requestPasswordReset(req.body?.username, ip);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/password-reset/confirm', async (req, res) => {
  try {
    const result = confirmPasswordReset(req.body?.username, req.body?.code, req.body?.password);
    try {
      const { syncAuthUsers } = require('../services/cloudSync/cloudSyncScheduler');
      await syncAuthUsers({ reason: 'password-reset' });
    } catch (syncErr) {
      console.warn('[auth] sync usuarios a cloud:', syncErr.message);
    }
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
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

router.get('/summary-kpi-prefs', requireSession, (req, res) => {
  const role = getRole(req.session.role);
  const pages = role?.pages || [];
  const prefs = summaryKpiPrefs.getUserPrefs(req.session.username, pages, req.session.role);
  const grouped = summaryKpiPrefs.getCatalogGrouped(pages, { full: true });
  res.json({
    ok: true,
    ...grouped,
    ...prefs,
    role: req.session.role,
    roleLabel: role.label,
    profile: summaryKpiPrefs.getProfileIndicators(req.session.role),
  });
});

router.put('/summary-kpi-prefs', requireSession, (req, res) => {
  try {
    const role = getRole(req.session.role);
    const pages = role?.pages || [];
    const prefs = summaryKpiPrefs.setUserPrefs(
      req.session.username,
      req.body?.slots ?? req.body?.kpiIds,
      pages,
      req.body?.sizes,
      req.body?.heights,
      req.body?.views,
      req.session.role,
    );
    res.json({ ok: true, ...prefs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/summary-kpi-prefs', requireSession, (req, res) => {
  summaryKpiPrefs.resetUserPrefs(req.session.username);
  const role = getRole(req.session.role);
  const pages = role?.pages || [];
  const prefs = summaryKpiPrefs.getUserPrefs(req.session.username, pages, req.session.role);
  res.json({ ok: true, ...prefs });
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

const multer = require('multer');
const planesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    if (!ok) return cb(new Error('Solo se permiten archivos PDF de la guía mensual de planes.'));
    cb(null, true);
  },
});

router.get('/lista-precios/catalog', requireUserManager, (_req, res) => {
  try {
    const { getActivePlansMeta } = require('../services/planesChevroletParser');
    res.json(getActivePlansMeta());
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo leer el catálogo vigente.' });
  }
});

router.post('/lista-precios/upload', requireUserManager, (req, res) => {
  planesUpload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Error al subir el archivo.' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Seleccione un PDF de la lista de precios mensual.' });
    }
    try {
      const { publishPlanesPdf } = require('../services/planesChevroletParser');
      const result = await publishPlanesPdf(req.file.buffer, {
        originalName: req.file.originalname,
        uploadedBy: req.session?.username || null,
      });
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'No se pudo procesar el PDF.' });
    }
  });
});

const carImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const okName = /\.(jpe?g|png|webp)$/i.test(name);
    if (!okMime && !okName) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP.'));
    }
    cb(null, true);
  },
});

router.get('/lista-precios/images', requireUserManager, (_req, res) => {
  try {
    const { listImages } = require('../services/listaPreciosImagesService');
    const { getActivePlansMeta } = require('../services/planesChevroletParser');
    const meta = getActivePlansMeta();
    const images = listImages();
    const byModelo = Object.fromEntries(images.map((img) => [img.modelo, img]));
    const catalogModelos = Array.isArray(meta.modelos) ? meta.modelos : (meta.catalog?.modelos || []);
    const modelos = [...new Set([
      ...catalogModelos.map((m) => (typeof m === 'string' ? m : m?.modelo)).filter(Boolean),
      ...images.map((i) => i.modelo),
    ])].sort((a, b) => a.localeCompare(b, 'es')).map((modelo) => ({
      modelo,
      imagen: byModelo[modelo] || null,
    }));
    res.json({
      ok: true,
      totalConImagen: images.length,
      modelos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudieron listar las imágenes.' });
  }
});

router.post('/lista-precios/images', requireUserManager, (req, res) => {
  carImageUpload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Error al subir la imagen.' });
    }
    try {
      const { saveImage } = require('../services/listaPreciosImagesService');
      const modelo = String(req.body?.modelo || '').trim();
      const saved = saveImage(modelo, req.file, {
        uploadedBy: req.session?.username || null,
      });
      res.json({ ok: true, imagen: saved });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'No se pudo guardar la imagen.' });
    }
  });
});

router.delete('/lista-precios/images/:modelo', requireUserManager, (req, res) => {
  try {
    const { deleteImage } = require('../services/listaPreciosImagesService');
    const result = deleteImage(decodeURIComponent(req.params.modelo || ''));
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo eliminar la imagen.' });
  }
});

module.exports = router;
