const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const { listPersonal, getPersonalSummary } = require('../services/dmsPersonalService');

const router = express.Router();

/** GET /api/personal/summary */
router.get('/summary', requireApiKey, async (_req, res, next) => {
  try {
    const summary = await getPersonalSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/personal
 * Query: categoria, subtipo, q, limit, offset
 */
router.get('/', requireApiKey, async (req, res, next) => {
  try {
    const rows = await listPersonal({
      categoria: req.query.categoria,
      subtipo: req.query.subtipo,
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({
      ok: true,
      count: rows.length,
      personal: rows,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/personal/:categoria */
router.get('/:categoria', requireApiKey, async (req, res, next) => {
  try {
    const rows = await listPersonal({
      categoria: req.params.categoria,
      subtipo: req.query.subtipo,
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({
      ok: true,
      categoria: String(req.params.categoria || '').toUpperCase(),
      count: rows.length,
      personal: rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
