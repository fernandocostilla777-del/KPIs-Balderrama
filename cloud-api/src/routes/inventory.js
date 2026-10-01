const express = require('express');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { query } = require('../db');

const router = express.Router();

/**
 * Lotes de la última corrida completa del dominio (el cliente trocea en chunks
 * y cada chunk es un lote). Los sync incrementales no borran entidades, así que
 * solo cuentan las que esa corrida volvió a ver (last_batch_id).
 */
async function latestRun(domain, periodKey = null) {
  const params = [domain];
  let filter = '';
  if (periodKey) {
    params.push(periodKey);
    filter = `AND period_key = $${params.length}`;
  }
  const result = await query(
    `SELECT id, period_key, meta, created_at
     FROM sync_batches
     WHERE domain = $1 AND status = 'ok' ${filter}
     ORDER BY created_at DESC
     LIMIT 60`,
    params
  );
  const rows = result.rows;
  if (!rows.length) return null;
  const head = rows[0];
  const ids = [];
  let runsLeft = Number(head.meta?.chunk || 1) < Number(head.meta?.totalChunks || 1) ? 2 : 1;
  for (const row of rows) {
    if (row.period_key !== head.period_key) break;
    ids.push(row.id);
    if (Number(row.meta?.chunk || 1) === 1) {
      runsLeft -= 1;
      if (runsLeft === 0) break;
    }
  }
  return { ids, periodKey: head.period_key, meta: head.meta || {}, syncedAt: head.created_at };
}

async function payloadsOfRun(domain, run) {
  const result = await query(
    `SELECT payload
     FROM sync_entities
     WHERE domain = $1 AND period_key IS NOT DISTINCT FROM $2 AND last_batch_id = ANY($3::bigint[])`,
    [domain, run.periodKey, run.ids]
  );
  return result.rows.map((row) => row.payload || {});
}

router.get('/', requireMobileAuth, async (_req, res, next) => {
  try {
    const run = await latestRun('inventario');
    if (!run) {
      return res.status(404).json({ ok: false, error: 'Sin inventario sincronizado.' });
    }
    const payloads = await payloadsOfRun('inventario', run);
    return res.json({
      inventoryTable: payloads.filter((p) => p.tipo === 'autos_nuevos'),
      ageingSlowTable: payloads.filter((p) => p.tipo === 'ageing_slow'),
      summary: run.meta.summaryNuevos || null,
      cloud: { periodKey: run.periodKey, syncedAt: run.syncedAt },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/vendidos', requireMobileAuth, async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin || '')) {
      return res.status(400).json({ ok: false, error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const periodKey = String(fechaInicio).slice(0, 7);
    const run = await latestRun('vendidos', periodKey);
    if (!run) {
      return res.status(404).json({
        ok: false,
        error: `Sin vendidos sincronizados para ${periodKey}.`,
        periodKey,
      });
    }
    const vendidosTable = await payloadsOfRun('vendidos', run);
    return res.json({
      fechaInicio,
      fechaFin,
      vendidosTable,
      summary: run.meta.summary || null,
      comisionEvMesPrev: run.meta.comisionEvMesPrev || null,
      cloud: { periodKey: run.periodKey, syncedAt: run.syncedAt },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
