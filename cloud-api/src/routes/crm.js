const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { upsertCrmBatch, listCrm, getCrmSummary } = require('../services/crmCiclosCloudService');
const { getBdcEmbudo } = require('../services/objetivosResultadosService');
const monthlyObjectives = require('../services/monthlyObjectivesStore');
const officeCommands = require('../services/officeCommandsStore');

const router = express.Router();

const SHEETS_SYNC_FULL = 'crm-sheets-sync-full';
const SHEETS_SYNC_PARTIAL = 'crm-sheets-sync';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Admin Objetivos Web: encola sync en la oficina (Google Sheets + push a nube).
 * Espera hasta ~90s; si la oficina tarda más, responde 202 con jobId para polling.
 */
router.post('/sheets-sync/run', requireMobileAuth, async (req, res, next) => {
  try {
    if (!monthlyObjectives.isAdminUser(req.mobileUser)) {
      return res.status(403).json({
        ok: false,
        error: 'Solo Administración puede forzar la actualización completa de Objetivos Web.',
      });
    }

    const body = req.body || {};
    const fullObjetivos = body.fullObjetivos === true
      || ['1', 'true', 'yes', 'full'].includes(String(req.query?.full || '').toLowerCase());
    const type = fullObjetivos ? SHEETS_SYNC_FULL : SHEETS_SYNC_PARTIAL;

    const existing = await officeCommands.getLatestByType(type);
    if (existing && (existing.status === 'pending' || existing.status === 'claimed')) {
      // Reutilizar job en curso para no apilar syncs.
      const waitMs = Math.min(85_000, Number(body.waitMs) || 85_000);
      const deadline = Date.now() + waitMs;
      let current = existing;
      while (Date.now() < deadline) {
        current = await officeCommands.getCommand(existing.id);
        if (!current) break;
        if (current.status === 'done') {
          return res.json({
            ok: true,
            reused: true,
            jobId: current.id,
            status: current.status,
            fullObjetivos,
            ...(current.result || {}),
          });
        }
        if (current.status === 'failed') {
          return res.status(500).json({
            ok: false,
            reused: true,
            jobId: current.id,
            status: current.status,
            error: current.error || 'La sincronización en oficina falló.',
          });
        }
        await sleep(2000);
      }
      return res.status(202).json({
        ok: true,
        pending: true,
        reused: true,
        jobId: existing.id,
        status: current?.status || existing.status,
        fullObjetivos,
        message: 'Sincronización en curso en el servidor de oficina. Espera unos minutos.',
      });
    }

    const job = await officeCommands.createCommand({
      type,
      payload: {
        fullObjetivos,
        skipCloud: body.skipCloud === true,
        reason: fullObjetivos ? 'objetivos-web-admin-full' : 'objetivos-web-admin',
      },
      requestedBy: req.mobileUser?.username || null,
    });

    const waitMs = Math.min(85_000, Number(body.waitMs) || 85_000);
    const deadline = Date.now() + waitMs;
    let current = job;
    while (Date.now() < deadline) {
      current = await officeCommands.getCommand(job.id);
      if (!current) break;
      if (current.status === 'done') {
        return res.json({
          ok: true,
          jobId: current.id,
          status: current.status,
          fullObjetivos,
          ...(current.result || {}),
        });
      }
      if (current.status === 'failed') {
        return res.status(500).json({
          ok: false,
          jobId: current.id,
          status: current.status,
          error: current.error || 'La sincronización en oficina falló.',
        });
      }
      await sleep(2000);
    }

    return res.status(202).json({
      ok: true,
      pending: true,
      jobId: job.id,
      status: current?.status || 'pending',
      fullObjetivos,
      message: 'Pedido enviado al servidor de oficina. La actualización puede tardar unos minutos.',
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/sheets-sync/jobs/:id', requireMobileAuth, async (req, res, next) => {
  try {
    if (!monthlyObjectives.isAdminUser(req.mobileUser)) {
      return res.status(403).json({ ok: false, error: 'Sin permiso.' });
    }
    const job = await officeCommands.getCommand(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Trabajo no encontrado' });
    return res.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      error: job.error,
      result: job.result,
      createdAt: job.createdAt,
      claimedAt: job.claimedAt,
      finishedAt: job.finishedAt,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/sheets-sync/status', requireMobileAuth, async (_req, res, next) => {
  try {
    const full = await officeCommands.getLatestByType(SHEETS_SYNC_FULL);
    const partial = await officeCommands.getLatestByType(SHEETS_SYNC_PARTIAL);
    return res.json({
      ok: true,
      service: 'cloud-relay',
      latestFull: full,
      latestPartial: partial,
    });
  } catch (err) {
    return next(err);
  }
});

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
