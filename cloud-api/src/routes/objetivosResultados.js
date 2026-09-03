const express = require('express');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const {
  getBdcEmbudo,
  getObjetivosSnapshot,
  listObjetivosPeriodos,
} = require('../services/objetivosResultadosService');

const router = express.Router();

router.get('/periodos', requireMobileAuth, async (_req, res, next) => {
  try {
    res.json({ ok: true, periodos: await listObjetivosPeriodos() });
  } catch (err) {
    next(err);
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
