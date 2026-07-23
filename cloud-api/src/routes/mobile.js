const express = require('express');
const {
  getLatestOverview,
  getVentasSummary,
  getInventorySummary,
  getMetricsSection,
} = require('../services/mobileData');
const { requireMobileAuth } = require('../middleware/mobileAuth');

const router = express.Router();

router.use(requireMobileAuth);

router.get('/overview', async (req, res, next) => {
  try {
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getLatestOverview(period));
  } catch (err) {
    next(err);
  }
});

router.get('/ventas', async (req, res, next) => {
  try {
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getVentasSummary(period));
  } catch (err) {
    next(err);
  }
});

router.get('/inventory', async (req, res, next) => {
  try {
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getInventorySummary(period));
  } catch (err) {
    next(err);
  }
});

router.get('/metrics/:section', async (req, res, next) => {
  try {
    const period = req.query.periodKey || req.query.fechaInicio;
    res.json(await getMetricsSection(req.params.section, period));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
