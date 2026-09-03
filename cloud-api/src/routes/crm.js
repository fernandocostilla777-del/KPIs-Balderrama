const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const { upsertCrmBatch, listCrm, getCrmSummary } = require('../services/crmCiclosCloudService');
const { getBdcEmbudo } = require('../services/objetivosResultadosService');

const router = express.Router();

router.get('/bdc', requireApiKey, async (req, res, next) => {
  try {
    const bdc = await getBdcEmbudo({
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
    });
    res.json(bdc);
  } catch (err) {
    next(err);
  }
});

router.get('/summary', requireApiKey, async (_req, res, next) => {
  try {
    const summary = await getCrmSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireApiKey, async (req, res, next) => {
  try {
    const rows = await listCrm({
      q: req.query.q,
      vendedor: req.query.vendedor,
      estatus: req.query.estatus,
      idContacto: req.query.idContacto || req.query.D_CONTACTO || req.query.ID_CONTACTO,
      vin: req.query.vin,
      idCiclo: req.query.idCiclo || req.query.ID_CICLO,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ ok: true, count: rows.length, ciclos: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * Carga remota desde el servidor de oficina.
 * Body: { records: [...], replaceAll?: false }
 * También acepta { rows: [...] } o un array directo.
 */
router.post('/ingest', requireApiKey, async (req, res, next) => {
  try {
    const body = req.body || {};
    const records = Array.isArray(body)
      ? body
      : (body.records || body.rows || body.ciclos || []);
    const result = await upsertCrmBatch(records, {
      replaceAll: body.replaceAll === true || body.replaceAll === 'true',
      source: String(body.source || 'api'),
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/:idContacto', requireApiKey, async (req, res, next) => {
  try {
    const rows = await listCrm({
      idContacto: req.params.idContacto,
      limit: req.query.limit || 2000,
      offset: req.query.offset,
    });
    res.json({
      ok: true,
      idContacto: req.params.idContacto,
      count: rows.length,
      ciclos: rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
