/**
 * API Seguimiento 360 (Railway).
 * Prefijo: /api/seguimiento-360
 * Auth: X-API-Key
 */
const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const {
  getResumen,
  buscarContactos,
  getCliente360,
} = require('../services/seguimiento360CloudService');

const router = express.Router();

router.use(requireApiKey);

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    formato: 'seguimiento-360-v1',
    servicio: 'balderrama-cloud-api',
    capa: 'railway',
    endpoints: [
      'GET /api/seguimiento-360/status',
      'GET /api/seguimiento-360/resumen?periodo=YYYY-MM',
      'GET /api/seguimiento-360/buscar?q=',
      'GET /api/seguimiento-360/cliente/:idContacto',
    ],
    nota: 'Resumen desde snapshot sync; expediente cliente = ciclos CRM en Postgres (sin DMS).',
  });
});

router.get('/resumen', async (req, res, next) => {
  try {
    const data = await getResumen({
      periodo: req.query.periodo || null,
      fechaInicio: req.query.fechaInicio || req.query.desde || null,
      fechaFin: req.query.fechaFin || req.query.hasta || null,
    });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      seccion: 'resumen',
      ...data,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/buscar', async (req, res, next) => {
  try {
    const resultados = await buscarContactos({
      q: req.query.q,
      limit: req.query.limit,
    });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      q: String(req.query.q || '').trim(),
      count: resultados.length,
      resultados,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/cliente/:idContacto', async (req, res, next) => {
  try {
    const history = await getCliente360(req.params.idContacto, {
      limit: req.query.limit,
    });
    if (!history.encontrado) {
      return res.status(404).json({
        ok: false,
        error: 'Cliente no encontrado en crm_ciclos (Railway).',
        idContacto: req.params.idContacto,
        limitacionesNube: history.limitacionesNube || [],
      });
    }
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      seccion: 'cliente',
      ...history,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
