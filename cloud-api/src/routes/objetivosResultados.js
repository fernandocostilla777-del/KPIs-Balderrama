const express = require('express');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const {
  getBdcEmbudo,
  getObjetivosSnapshot,
  listObjetivosPeriodos,
} = require('../services/objetivosResultadosService');
const monthlyObjectives = require('../services/monthlyObjectivesStore');

const router = express.Router();

router.get('/periodos', requireMobileAuth, async (_req, res, next) => {
  try {
    res.json({ ok: true, periodos: await listObjetivosPeriodos() });
  } catch (err) {
    next(err);
  }
});

router.get('/meses', requireMobileAuth, async (_req, res, next) => {
  try {
    res.json({ ok: true, months: await monthlyObjectives.listMonths() });
  } catch (err) {
    next(err);
  }
});

router.get('/meses/:id', requireMobileAuth, async (req, res, next) => {
  try {
    const month = await monthlyObjectives.getMonth(req.params.id);
    if (!month) return res.status(404).json({ ok: false, error: 'Mes no encontrado' });
    return res.json({ ok: true, month });
  } catch (err) {
    return next(err);
  }
});

router.put('/meses', requireMobileAuth, async (req, res, next) => {
  try {
    if (!monthlyObjectives.isAdminUser(req.mobileUser)) {
      return res.status(403).json({ ok: false, error: 'Solo Administración puede guardar meses.' });
    }
    const month = await monthlyObjectives.upsertMonth(req.body?.month || req.body);
    return res.json({
      ok: true,
      month,
      months: await monthlyObjectives.listMonths(),
    });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ ok: false, error: err.message });
    return next(err);
  }
});

router.delete('/meses/:id', requireMobileAuth, async (req, res, next) => {
  try {
    if (!monthlyObjectives.isAdminUser(req.mobileUser)) {
      return res.status(403).json({ ok: false, error: 'Solo Administración puede eliminar meses.' });
    }
    const months = await monthlyObjectives.removeMonth(req.params.id);
    return res.json({ ok: true, months });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ ok: false, error: err.message });
    return next(err);
  }
});

router.get('/', requireMobileAuth, async (req, res, next) => {
  try {
    const snapshot = await getObjetivosSnapshot({
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
    });

    if (!snapshot.found) {
      return res.status(404).json({
        ok: false,
        error: `Sin datos sincronizados para el periodo ${snapshot.periodKey}.`,
        periodKey: snapshot.periodKey,
      });
    }

    const payload = {
      ...snapshot.payload,
      sincronizadoEn: snapshot.sincronizadoEn,
      origen: 'cloud-sync',
    };

    // BDC se sirve en vivo desde las tablas CRM de Railway. Así el proyecto
    // separado no depende de esperar al siguiente snapshot del backend local.
    const bdc = await getBdcEmbudo({
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
    });
    payload.resultados = {
      ...(payload.resultados || {}),
      bdc: {
        ...(payload.resultados?.bdc || {}),
        ...bdc,
        meta: payload.resultados?.bdc?.meta || null,
      },
    };

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
