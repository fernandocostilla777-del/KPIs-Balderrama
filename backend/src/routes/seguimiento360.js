/**
 * API Seguimiento 360 — expediente comercial / postventa del cliente.
 * Prefijo: /api/seguimiento-360
 *
 * Reutiliza crmCiclosService (SQLite CRM + enriquecimiento DMS).
 * Las rutas legacy /api/crm/contactos* siguen activas.
 */
const express = require('express');

const router = express.Router();

function crm() {
  return require('../services/crmCiclosService');
}

function sendError(res, next, err) {
  if (err?.status) return res.status(err.status).json({ ok: false, error: err.message });
  return next(err);
}

/** Estado de la base CRM local. */
router.get('/status', (_req, res, next) => {
  try {
    const svc = crm();
    const available = svc.isAvailable();
    const stats = available ? svc.getCrmStats() : null;
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      available,
      stats,
      endpoints: [
        'GET /api/seguimiento-360/status',
        'GET /api/seguimiento-360/resumen',
        'GET /api/seguimiento-360/buscar?q=',
        'GET /api/seguimiento-360/cliente/:idContacto',
        'GET /api/seguimiento-360/vendedores',
        'GET /api/seguimiento-360/vendedor?vendedor=',
        'GET /api/seguimiento-360/expediente/:idContacto',
        'GET /api/seguimiento-360/cartera?vendedor=',
        'GET /api/seguimiento-360/cierres-taller?fechaInicio=&fechaFin=',
        'GET /api/seguimiento-360/maduracion?fechaInicio=&fechaFin=',
      ],
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

/**
 * KPIs agregados del periodo (leads, F&I, pruebas, ciclos, PVA, conversiones).
 * Query: fechaInicio|desde, fechaFin|hasta, o periodo=YYYY-MM
 */
router.get('/resumen', (req, res, next) => {
  try {
    const svc = crm();
    if (!svc.isAvailable()) {
      return res.status(503).json({ ok: false, error: 'Base CRM no disponible en el servidor de oficina.' });
    }
    const fechaInicio = req.query.fechaInicio || req.query.desde || null;
    const fechaFin = req.query.fechaFin || req.query.hasta || null;
    const periodo = req.query.periodo || null;
    const data = svc.getSeguimiento360Summary({
      periodo,
      desde: fechaInicio,
      hasta: fechaFin,
    });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      seccion: 'resumen',
      ...data,
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** Búsqueda de contactos por ID CRM, nombre o VIN. */
router.get('/buscar', (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ ok: false, error: 'Parámetro requerido: q (ID CRM, nombre o VIN).' });
    }
    const limit = req.query.limit;
    const resultados = crm().searchContacts({ q, limit });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      q,
      count: resultados.length,
      resultados,
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

/**
 * Expediente 360 completo del cliente (ficha + timeline + dominios).
 * Query: enrichSql=0|1, fechaInicio, fechaFin
 */
router.get('/cliente/:idContacto', async (req, res, next) => {
  try {
    const idContacto = String(req.params.idContacto || '').trim();
    if (!idContacto) {
      return res.status(400).json({ ok: false, error: 'idContacto requerido.' });
    }
    const enrichSql = String(req.query.enrichSql || '1') !== '0';
    const fechaInicio = req.query.fechaInicio || null;
    const fechaFin = req.query.fechaFin || null;
    const history = await crm().getContactHistory(idContacto, {
      enrichSql,
      fechaInicio,
      fechaFin,
    });
    if (!history?.encontrado) {
      return res.status(404).json({
        ok: false,
        error: 'Cliente no encontrado en CRM.',
        idContacto,
      });
    }
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      seccion: 'cliente',
      ...history,
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** Listado / búsqueda de vendedores. */
router.get('/vendedores', (req, res, next) => {
  try {
    const { q, limit } = req.query;
    const vendedores = crm().listVendedores({ q, limit });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      count: vendedores.length,
      vendedores,
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** Resumen de desempeño de un vendedor en el periodo. */
router.get('/vendedor', async (req, res, next) => {
  try {
    const vendedor = String(req.query.vendedor || '').trim();
    if (!vendedor) {
      return res.status(400).json({ ok: false, error: 'Parámetro requerido: vendedor.' });
    }
    const data = await crm().getVendedorResumen({
      vendedor,
      fechaInicio: req.query.fechaInicio || null,
      fechaFin: req.query.fechaFin || null,
      limit: req.query.limit,
    });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      seccion: 'vendedor',
      ...data,
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** HT-PRO-1 — expediente del prospecto por ID CRM. */
router.get('/expediente/:idContacto', (req, res, next) => {
  try {
    const data = crm().getExpedienteProspecto(req.params.idContacto);
    res.json({ ok: true, formato: 'seguimiento-360-v1', seccion: 'ht-pro-1', ...data });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** P-VTA-4 — Tiempo de Maduración Comercial y cobertura del objetivo. */
router.get('/maduracion', (req, res, next) => {
  try {
    const data = crm().getTiempoMaduracion({
      fechaInicio: req.query.fechaInicio || null,
      fechaFin: req.query.fechaFin || null,
    });
    res.json({ ok: true, formato: 'seguimiento-360-v1', seccion: 'p-vta-4', ...data });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** HT-PRO-2 — cartera activa y lista 1 a 1 de un ejecutivo. */
router.get('/cartera', (req, res, next) => {
  try {
    const data = crm().getCarteraEjecutivo({
      vendedor: req.query.vendedor,
      fechaFin: req.query.fechaFin || null,
    });
    res.json({ ok: true, formato: 'seguimiento-360-v1', seccion: 'ht-pro-2', ...data });
  } catch (err) {
    sendError(res, next, err);
  }
});

/** Clientes con órdenes de taller cerradas en el periodo. */
router.get('/cierres-taller', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, limit } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({
        ok: false,
        error: 'Parámetros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).',
      });
    }
    const data = await crm().getCierresTallerPeriodo({ fechaInicio, fechaFin, limit });
    res.json({
      ok: true,
      formato: 'seguimiento-360-v1',
      seccion: 'cierres-taller',
      ...data,
    });
  } catch (err) {
    sendError(res, next, err);
  }
});

module.exports = router;
