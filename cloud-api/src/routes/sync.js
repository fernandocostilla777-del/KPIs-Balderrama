const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const { ingestSyncPayload, getSyncStatus, getHistory } = require('../services/syncIngest');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'balderrama-cloud-api' });
});

router.get('/status', requireApiKey, async (_req, res, next) => {
  try {
    const status = await getSyncStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    next(err);
  }
});

router.get('/history/:domain', requireApiKey, async (req, res, next) => {
  try {
    const rows = await getHistory({
      domain: req.params.domain,
      externalId: req.query.externalId,
      periodKey: req.query.periodKey,
      limit: req.query.limit,
    });
    res.json({ ok: true, domain: req.params.domain, count: rows.length, history: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/ingest', requireApiKey, async (req, res, next) => {
  try {
    const result = await ingestSyncPayload(req.body || {});
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
