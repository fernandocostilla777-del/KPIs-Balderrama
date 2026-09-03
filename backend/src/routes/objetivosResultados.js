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
