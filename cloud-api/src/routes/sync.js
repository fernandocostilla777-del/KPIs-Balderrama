const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const { ingestSyncPayload, getSyncStatus, getHistory } = require('../services/syncIngest');
const officeCommands = require('../services/officeCommandsStore');

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

/** Backend de oficina: reclama el siguiente comando pendiente. */
router.get('/office-commands/next', requireApiKey, async (req, res, next) => {
  try {
    const rawTypes = String(req.query.types || req.query.type || '').trim();
    const types = rawTypes
      ? rawTypes.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;
    const command = await officeCommands.claimNext({ types });
    if (!command) return res.json({ ok: true, command: null });
    return res.json({ ok: true, command });
  } catch (err) {
    return next(err);
  }
});

/** Backend de oficina: reporta resultado del comando. */
router.post('/office-commands/:id/complete', requireApiKey, async (req, res, next) => {
  try {
    const body = req.body || {};
    const ok = body.ok !== false;
    const completed = await officeCommands.completeCommand(req.params.id, {
      ok,
      result: body.result || null,
      error: body.error || null,
    });
    if (!completed) {
      return res.status(404).json({ ok: false, error: 'Comando no encontrado o ya finalizado' });
    }
    return res.json({ ok: true, command: completed });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
