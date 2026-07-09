const express = require('express');
const { getOverview } = require('../services/overviewService');
const { loadSalesExecutiveAnalytics } = require('../services/salesExecutiveAnalytics');
const { getVentas } = require('../services/ventas');
const { getInventory } = require('../services/inventoryService');
const { getPostSales } = require('../services/postSalesService');
const { getForecast } = require('../services/forecastService');
const { getGoals, setGoals, getHistoricCatalog } = require('../services/salesGoals');
const { getContabilidad } = require('../services/contabilidadService');
const { loadDailySalesUnits } = require('../services/ventasNuevosFinanciero');

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

router.get('/contabilidad', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, planPisoPeriod, sucursal, area } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getContabilidad({ fechaInicio, fechaFin, planPisoPeriod, sucursal, area }));
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

module.exports = router;
