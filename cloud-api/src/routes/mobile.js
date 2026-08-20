const express = require('express');
const {
  getLatestOverview,
  getVentasSummary,
  getInventorySummary,
  getMetricsSection,
} = require('../services/mobileData');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { isConfigured, runMobileChat, DEFAULT_MODEL } = require('../services/mobileAi');
const {
  canAccessMetricSection,
  canAccessPage,
  roleMetricSections,
  roleTools,
  normalizeMetricSection,
} = require('../services/mobileRoles');

const router = express.Router();

router.use(requireMobileAuth);

router.get('/ai/status', (req, res) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    model: DEFAULT_MODEL,
    role: req.mobileUser.role,
    tools: roleTools(req.mobileUser.role),
    sections: roleMetricSections(req.mobileUser.role),
    source: 'cloud-sync',
  });
});

router.post('/ai/chat', async (req, res, next) => {
  try {
    const messages = req.body?.messages;
    const result = await runMobileChat({
      messages,
      user: req.mobileUser,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    return next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    if (!canAccessPage(req.mobileUser.role, 'dashboard')) {
      return res.status(403).json({ ok: false, error: 'Tu rol no tiene acceso al panel de control' });
    }
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getLatestOverview(period));
  } catch (err) {
    next(err);
  }
});

router.get('/ventas', async (req, res, next) => {
  try {
    if (!canAccessMetricSection(req.mobileUser.role, 'ventas')) {
      return res.status(403).json({ ok: false, error: 'Sin acceso a ventas' });
    }
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getVentasSummary(period));
  } catch (err) {
    next(err);
  }
});

router.get('/inventory', async (req, res, next) => {
  try {
    if (!canAccessMetricSection(req.mobileUser.role, 'inventory')) {
      return res.status(403).json({ ok: false, error: 'Sin acceso a inventario' });
    }
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getInventorySummary(period));
  } catch (err) {
    next(err);
  }
});

router.get('/metrics/:section', async (req, res, next) => {
  try {
    const section = normalizeMetricSection(req.params.section);
    if (!section) {
      return res.status(400).json({
        ok: false,
        error: 'Sección no válida',
        sections: roleMetricSections(req.mobileUser.role),
      });
    }
    if (!canAccessMetricSection(req.mobileUser.role, section)) {
      return res.status(403).json({
        ok: false,
        error: 'Sin acceso a esta sección',
        sections: roleMetricSections(req.mobileUser.role),
      });
    }
    const period = req.query.periodKey || req.query.fechaInicio;
    const options = {};
    if (req.query.area) options.area = String(req.query.area);
    if (req.query.estatus) options.estatus = String(req.query.estatus);
    res.json(await getMetricsSection(section, period, options));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
