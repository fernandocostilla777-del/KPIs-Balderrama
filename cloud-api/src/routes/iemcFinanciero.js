const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const {
  listPeriodos,
  getPeriodo,
  upsertPeriodo,
  listClasificacion,
  upsertClasificacion,
  upsertSnapshot,
  listSnapshots,
  normalizePeriodKey,
} = require('../services/iemcFinancieroStore');

const router = express.Router();

router.get('/periodos', requireApiKey, async (_req, res, next) => {
  try {
    res.json({ ok: true, periodos: await listPeriodos() });
  } catch (err) {
    next(err);
  }
});

router.get('/periodos/:periodKey', requireApiKey, async (req, res, next) => {
  try {
    const periodo = await getPeriodo(req.params.periodKey);
    if (!periodo) {
      return res.status(404).json({
        ok: false,
        error: `Sin parámetros IEMC para ${normalizePeriodKey(req.params.periodKey) || req.params.periodKey}`,
      });
    }
    return res.json({ ok: true, periodo });
  } catch (err) {
    return next(err);
  }
});

router.put('/periodos/:periodKey', requireApiKey, async (req, res, next) => {
  try {
    const periodo = await upsertPeriodo(req.params.periodKey, req.body || {});
    res.json({ ok: true, periodo });
  } catch (err) {
    next(err);
  }
});

router.get('/clasificacion', requireApiKey, async (req, res, next) => {
  try {
    const soloActivos = String(req.query.todos || '') !== '1';
    res.json({ ok: true, items: await listClasificacion({ soloActivos }) });
  } catch (err) {
    next(err);
  }
});

router.post('/clasificacion', requireApiKey, async (req, res, next) => {
  try {
    const item = await upsertClasificacion(req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    next(err);
  }
});

router.get('/snapshots/:periodKey', requireApiKey, async (req, res, next) => {
  try {
    res.json({ ok: true, snapshots: await listSnapshots(req.params.periodKey) });
  } catch (err) {
    next(err);
  }
});

router.put('/snapshots/:periodKey/:kpiClave', requireApiKey, async (req, res, next) => {
  try {
    const snapshot = await upsertSnapshot({
      periodKey: req.params.periodKey,
      kpiClave: req.params.kpiClave,
      payload: req.body?.payload ?? req.body,
      source: req.body?.source || 'api',
    });
    res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
