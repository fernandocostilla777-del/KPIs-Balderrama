const express = require('express');
const {
  catalogoCobertura,
  getPlantillaMetas,
  getObjetivosResultadosCompleto,
  getVolumenResultados,
  getLineasResultados,
  getFinanciamientoResultados,
  getAfluenciaResultados,
  getSolicitudesResultados,
  getDiarioResultados,
  getSeminuevosResultados,
} = require('../services/objetivosResultadosService');
const monthlyObjectives = require('../services/monthlyObjectivesStore');
const { requireSession, requireUserManager } = require('../auth/middleware');

const router = express.Router();

function periodFromQuery(req, res) {
  const { fechaInicio, fechaFin } = req.query;
  if (!fechaInicio || !fechaFin) {
    res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    return null;
  }
  return { fechaInicio, fechaFin };
}

function sendError(res, next, err) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  return next(err);
}

/** Catálogo de objetivos + cobertura (sin DB). */
router.get('/catalogo', (_req, res) => {
  res.json({
    formato: 'objetivos-resultados-v1',
    catalogo: catalogoCobertura(),
    plantillaMetas: getPlantillaMetas({}),
  });
});

/** Metas plantilla PDF (opcionalmente amarradas al periodo). */
router.get('/metas', (req, res) => {
  const { fechaInicio, fechaFin } = req.query;
  res.json({
    formato: 'objetivos-resultados-v1',
    plantillaMetas: getPlantillaMetas({ fechaInicio, fechaFin }),
  });
});

/** Meses/plantillas del scorecard (compartidos: backend/data/monthly-objectives.json). */
router.get('/meses', (_req, res, next) => {
  try {
    res.json({ ok: true, months: monthlyObjectives.listMonths() });
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/meses/:id', (req, res, next) => {
  try {
    const month = monthlyObjectives.getMonth(req.params.id);
    if (!month) return res.status(404).json({ ok: false, error: 'Mes no encontrado' });
    res.json({ ok: true, month });
  } catch (err) {
    sendError(res, next, err);
  }
});

router.put('/meses', requireSession, requireUserManager, (req, res, next) => {
  try {
    const month = monthlyObjectives.upsertMonth(req.body?.month || req.body);
    res.json({ ok: true, month, months: monthlyObjectives.listMonths() });
  } catch (err) {
    sendError(res, next, err);
  }
});

router.delete('/meses/:id', requireSession, requireUserManager, (req, res, next) => {
  try {
    const months = monthlyObjectives.removeMonth(req.params.id);
    res.json({ ok: true, months });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** Payload completo en formato de resultados. */
router.get('/', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getObjetivosResultadosCompleto(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/volumen', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getVolumenResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/lineas', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getLineasResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/financiamiento', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getFinanciamientoResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/afluencia', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getAfluenciaResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/solicitudes', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getSolicitudesResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/diario', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getDiarioResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/seminuevos', async (req, res, next) => {
  try {
    const period = periodFromQuery(req, res);
    if (!period) return;
    res.json(await getSeminuevosResultados(period));
  } catch (err) {
    sendError(res, next, err);
  }
});

module.exports = router;
