const express = require('express');
const { getOverview } = require('../services/overviewService');
const { loadSalesExecutiveAnalytics } = require('../services/salesExecutiveAnalytics');
const { getVentas } = require('../services/ventas');
const { getInventory } = require('../services/inventoryService');
const { getInventoryPostventa } = require('../services/inventoryPostventaService');
const { getPostSales } = require('../services/postSalesService');
const { getForecast } = require('../services/forecastService');
const { getGoals, setGoals, getHistoricCatalog } = require('../services/salesGoals');
const { getContabilidad } = require('../services/contabilidadService');
const { getEeffSummary } = require('../services/eeffSummaryService');
const { loadDailySalesUnits } = require('../services/ventasNuevosFinanciero');
const { isConfigured, runChat, DEFAULT_MODEL } = require('../services/aiAgent');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dashboard-ventas-abp', database: process.env.DB_NAME, timestamp: new Date().toISOString() });
});

router.get('/ventas/objetivos/historico', (_req, res) => {
  try {
    res.json({ months: getHistoricCatalog() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ventas/objetivos', (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(getGoals({ fechaInicio, fechaFin }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/ventas/objetivos', (req, res) => {
  try {
    const { fechaInicio, fechaFin, retail, sofia } = req.body || {};
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'fechaInicio y fechaFin son requeridos.' });
    }
    res.json(setGoals({ fechaInicio, fechaFin, retail, sofia }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ventas', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getVentas({ fechaInicio, fechaFin }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/overview/analytics', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await loadSalesExecutiveAnalytics({ fechaInicio, fechaFin }));
  } catch (err) {
    next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getOverview({ fechaInicio, fechaFin }));
  } catch (err) {
    next(err);
  }
});

router.get('/inventory', async (req, res, next) => {
  try {
    res.json(await getInventory({ planPisoPeriod: req.query.planPisoPeriod || 'all' }));
  } catch (err) {
    next(err);
  }
});

router.get('/inventory/postventa', async (req, res, next) => {
  try {
    res.json(await getInventoryPostventa());
  } catch (err) {
    next(err);
  }
});

router.get('/post-sales', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getPostSales({ fechaInicio, fechaFin }));
  } catch (err) {
    next(err);
  }
});

router.get('/contabilidad/ventas-dia', async (req, res, next) => {
  try {
    const { fecha } = req.query;
    if (!fecha) {
      return res.status(400).json({ error: 'Parametro requerido: fecha (YYYY-MM-DD).' });
    }
    res.json(await loadDailySalesUnits({ fecha }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/eeff', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getEeffSummary({ fechaInicio, fechaFin }));
  } catch (err) {
    next(err);
  }
});

router.get('/contabilidad', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, planPisoPeriod, sucursal, area, includeFi } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getContabilidad({ fechaInicio, fechaFin, planPisoPeriod, sucursal, area, includeFi }));
  } catch (err) {
    next(err);
  }
});

router.get('/forecast', async (req, res, next) => {
  try {
    res.json(await getForecast({ horizon: req.query.horizon }));
  } catch (err) {
    next(err);
  }
});

// Base interna CRM (Balderrama Ciclos) — histórico por ID_CONTACTO (= ID CRM)
router.get('/crm/status', (_req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const sheetsSync = require('../services/crmSheetsSync');
    if (!crm.isAvailable()) {
      return res.json({
        ok: false,
        disponible: false,
        detalle: 'Base CRM no cargada. Ejecute etl-crm-ciclos.js',
        sheetsSync: sheetsSync.getStatus(),
      });
    }
    res.json({ ok: true, disponible: true, ...crm.getCrmStats(), sheetsSync: sheetsSync.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.get('/crm/sheets-sync/status', (_req, res, next) => {
  try {
    const sheetsSync = require('../services/crmSheetsSync');
    res.json({ ok: true, ...sheetsSync.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/crm/sheets-sync/run', async (_req, res, next) => {
  try {
    const sheetsSync = require('../services/crmSheetsSync');
    const result = await sheetsSync.runSync({ reason: 'api' });
    res.status(result.ok ? 200 : (result.skipped ? 409 : 500)).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/cloud-sync/status', (_req, res, next) => {
  try {
    const cloudSync = require('../services/cloudSync/cloudSyncScheduler');
    res.json({ ok: true, ...cloudSync.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.get('/cloud-sync/remote-status', async (_req, res, next) => {
  try {
    const cloudSync = require('../services/cloudSync/cloudSyncScheduler');
    const remote = await cloudSync.fetchCloudStatus();
    res.json({ ok: true, remote });
  } catch (err) {
    next(err);
  }
});

router.post('/cloud-sync/run', async (req, res, next) => {
  try {
    const cloudSync = require('../services/cloudSync/cloudSyncScheduler');
    const type = String(req.body?.type || req.query?.type || 'incremental').toLowerCase();
    if (!['incremental', 'daily', 'monthly'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser incremental, daily o monthly' });
    }
    const result = await cloudSync.runSync({ type, reason: 'api' });
    res.status(result.ok ? 200 : (result.skipped ? 409 : 500)).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/crm/contactos', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Parametro requerido: q (ID CRM, nombre o VIN).' });
    res.json({ resultados: crm.searchContacts({ q, limit }) });
  } catch (err) {
    next(err);
  }
});

router.get('/crm/contactos/:idContacto/historico', async (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const enrichSql = String(req.query.enrichSql || '1') !== '0';
    const fechaInicio = req.query.fechaInicio || null;
    const fechaFin = req.query.fechaFin || null;
    res.json(await crm.getContactHistory(req.params.idContacto, {
      enrichSql,
      fechaInicio,
      fechaFin,
    }));
  } catch (err) {
    next(err);
  }
});

// Leads (interesados) — resumen agregado con filtros
router.get('/crm/leads/resumen', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { desde, hasta, agruparPor, limit } = req.query;
    res.json(crm.getLeadsSummary({ desde, hasta, agruparPor, limit }));
  } catch (err) {
    next(err);
  }
});

// Clientes con órdenes de taller CERRADAS en un periodo (por ORE_FECHACIE)
router.get('/crm/cierres-taller', async (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { fechaInicio, fechaFin, limit } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await crm.getCierresTallerPeriodo({ fechaInicio, fechaFin, limit }));
  } catch (err) {
    next(err);
  }
});

router.get('/ai/status', (_req, res) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    model: DEFAULT_MODEL,
    database: process.env.DB_NAME,
  });
});

router.post('/ai/chat', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({
        error: 'El asistente IA no está configurado. Agrega OPENAI_API_KEY en .env',
      });
    }

    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'Se requiere un arreglo messages con al menos un mensaje.' });
    }

    const sanitized = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.trim() }))
      .filter((m) => m.content);

    if (!sanitized.length || sanitized[sanitized.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
    }

    const result = await runChat(sanitized);
    res.json(result);
  } catch (err) {
    console.error('[AI Error]', err.message);
    res.status(500).json({ error: err.message || 'Error en el asistente IA' });
  }
});

module.exports = router;
