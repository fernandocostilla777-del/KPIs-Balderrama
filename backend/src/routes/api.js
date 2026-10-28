const express = require('express');
const { getOverview } = require('../services/overviewService');
const { loadSalesExecutiveAnalytics } = require('../services/salesExecutiveAnalytics');
const { getVentas } = require('../services/ventas');
const { getInventory, getIntercambiosHistorico, getVendidosAnalisis } = require('../services/inventoryService');
const { computeIemcF2 } = require('../services/iemcF2Service');
const { getInventoryPostventa } = require('../services/inventoryPostventaService');
const { getInventorySeminuevos } = require('../services/inventorySeminuevosService');
const { getListaPrecios, getListaPreciosFicha } = require('../services/listaPreciosService');
const { getPostSales, getPostSalesOrderDetail } = require('../services/postSalesService');
const { getHypAseguradorasCobranza, getHypGarantiasCobranza } = require('../services/hypAseguradorasCobranza');
const { consultarCuadreOrdenesHyp } = require('../services/cuadreOrdenesHyp');
const { getRefaccionesPedidos, getRefaccionesDashboard } = require('../services/refaccionesPedidosService');
const { getForecast } = require('../services/forecastService');
const { getGoals, setGoals, getHistoricCatalog } = require('../services/salesGoals');
const { getFinanciamientoDashboard, getPvaTrimestreYtd } = require('../services/financiamientoService');
const { getPagosGmf } = require('../services/pagosGmfService');
const { getComisionesFi, listComisionTypes } = require('../services/comisionesFiService');
const { getAfluenciaDashboard } = require('../services/afluenciaService');
const financiamientoNotes = require('../services/financiamientoNotesStore');
const gerentesFi = require('../services/gerentesFinanciamientoStore');
const { getFacturaMovimientos } = require('../services/facturaMovimientosService');
const { getAnalisisFinanciero } = require('../services/analisisFinancieroService');
const { getAnalisisComercial } = require('../services/analisisComercialService');
const { getContabilidad } = require('../services/contabilidadService');
const { alcanceDeRol } = require('../auth/alcanceSucursal');

function alcanceDe(req) {
  return alcanceDeRol(req.session?.role);
}
const { getEeffSummary } = require('../services/eeffSummaryService');
const { loadDailySalesUnits } = require('../services/ventasNuevosFinanciero');
const { isConfigured, runChat, synthesizeSpeech, transcribeAudio, DEFAULT_MODEL } = require('../services/aiAgent');
const { canManageUsers } = require('../auth/roles');
const { isAuthEnabled } = require('../auth/session');
const { requireSession } = require('../auth/middleware');
const objetivosResultadosRoutes = require('./objetivosResultados');
const seguimiento360Routes = require('./seguimiento360');

const router = express.Router();

router.get('/conexion', async (req, res) => {
  try {
    const svc = require('../services/conexionOrigen');
    const probe = String(req.query.probe || '1') !== '0';
    const data = probe ? await svc.estadoConPrueba() : svc.estado();
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      aviso: 'No se pudo verificar la conexión a la base de datos.',
      conectado: false,
      opciones: [],
    });
  }
});

router.put('/conexion', async (req, res) => {
  try {
    const { canManageUsers } = require('../auth/roles');
    if (!canManageUsers(req.session?.role)) {
      return res.status(403).json({ error: 'Solo administración puede cambiar la conexión.' });
    }
    const data = await require('../services/conexionOrigen').seleccionar(req.body?.modo);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dashboard-ventas-abp', database: process.env.DB_NAME, timestamp: new Date().toISOString() });
});

/** Resultados en formato de objetivos comerciales (PDF scorecard). */
router.use('/objetivos-resultados', objetivosResultadosRoutes);

/** Expediente y KPIs de Seguimiento 360 (CRM + DMS). */
router.use('/seguimiento-360', seguimiento360Routes);

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

router.put('/ventas/objetivos', requireSession, (req, res) => {
  try {
    if (isAuthEnabled() && !canManageUsers(req.session?.role)) {
      return res.status(403).json({
        error: 'Solo Administración puede modificar los objetivos de Avance Facturas GMMX y Entregas SOFIA.',
      });
    }
    const { fechaInicio, fechaFin, retail, sofia } = req.body || {};
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'fechaInicio y fechaFin son requeridos.' });
    }
    res.json(setGoals({
      fechaInicio,
      fechaFin,
      retail,
      sofia,
      updatedBy: req.session?.username || null,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ventas', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, fresh } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const forceFresh = ['1', 'true', 'yes'].includes(String(fresh || '').toLowerCase());
    if (forceFresh) {
      try {
        require('../services/ventas').clearVentasSofiaCaches();
      } catch {
        /* ignore */
      }
    }
    const alcance = alcanceDe(req);
    const data = await getVentas({
      fechaInicio,
      fechaFin,
      fresh: forceFresh,
      canal: alcance?.canalVenta || null,
    });
    let sofiaLiveUpdate = { active: false };
    try {
      const status = require('../services/sofiaMonthEndLive').getStatus();
      sofiaLiveUpdate = {
        ...(status.context || { active: false }),
        intervalMinutes: status.intervalMinutes,
        enabled: status.enabled,
      };
    } catch {
      /* optional */
    }
    res.json({ ...data, sofiaLiveUpdate });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ventas/sofia-live-status', (_req, res, next) => {
  try {
    const sofiaLive = require('../services/sofiaMonthEndLive');
    res.json({ ok: true, ...sofiaLive.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/ventas/sofia-live-sync', async (_req, res, next) => {
  try {
    const sofiaLive = require('../services/sofiaMonthEndLive');
    const ctx = sofiaLive.getSofiaLiveUpdateContext();
    if (!ctx.active) {
      return res.status(409).json({
        ok: false,
        skipped: true,
        reason: 'Hoy no es el día de actualización en vivo de entregas SOFIA',
        context: ctx,
      });
    }
    const result = await sofiaLive.syncSofiaVentasLive(ctx, { reason: 'api' });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    next(err);
  }
});

// Financiamiento (contratos del CRM y SOFIA) no trae sucursal: un perfil de sucursal no lo consulta.
router.use('/ventas/financiamiento', (req, res, next) => {
  if (alcanceDe(req)) {
    return res.status(403).json({ error: 'Financiamiento no está disponible para este perfil.' });
  }
  return next();
});

router.get('/ventas/financiamiento', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, pvaAnio, pvaTrimestre } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getFinanciamientoDashboard({ fechaInicio, fechaFin, pvaAnio, pvaTrimestre }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/comisiones/tipos', (req, res) => {
  if (alcanceDe(req)) {
    return res.status(403).json({ error: 'Las comisiones no están disponibles para este perfil.' });
  }
  res.json({ tipos: listComisionTypes() });
});

router.get('/ventas/comisiones', async (req, res, next) => {
  try {
    if (alcanceDe(req)) {
      return res.status(403).json({ error: 'Las comisiones no están disponibles para este perfil.' });
    }
    const { fechaInicio, fechaFin, tipo } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const kind = String(tipo || 'fi').toLowerCase();
    if (kind !== 'fi') {
      return res.status(400).json({ error: `Tipo de comisión no disponible: ${kind}. Use tipo=fi.` });
    }
    res.json(await getComisionesFi({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/financiamiento/pva-trimestre', (req, res, next) => {
  try {
    const { anio, trimestre, pvaAnio, pvaTrimestre } = req.query;
    res.json(getPvaTrimestreYtd({
      anio: anio || pvaAnio,
      trimestre: trimestre || pvaTrimestre,
    }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/financiamiento/pagos-gmf', (req, res, next) => {
  try {
    const vin = req.query.vin || req.query.serie || null;
    const contrato = req.query.contrato || req.query.noContrato || null;
    if (!vin && !contrato) {
      return res.status(400).json({ error: 'Indique vin o contrato.' });
    }
    res.json(getPagosGmf({ vin, contrato }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Tiempo a compra de los últimos 12 meses hasta fechaFin (Kaplan–Meier). Sin datos personales.
router.get('/ventas/leads/supervivencia', (req, res, next) => {
  try {
    const { getSupervivencia } = require('../services/leadsSupervivenciaService');
    const { fechaFin, horizonte } = req.query;
    if (!fechaFin) {
      return res.status(400).json({ error: 'Parametro requerido: fechaFin (YYYY-MM-DD).' });
    }
    const alcance = alcanceDe(req);
    res.json(getSupervivencia({
      fechaFin,
      horizonte,
      crmTexto: alcance?.crmTexto || null,
    }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/leads/prospeccion', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const alcance = alcanceDe(req);
    res.json(crm.getProspeccionIndicadores({
      fechaInicio,
      fechaFin,
      crmTexto: alcance?.crmTexto || null,
    }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/leads', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { fechaInicio, fechaFin, limit, kpi } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    // ?kpi=compras → detalle completo del indicador (misma ruta, sin depender de /detalle)
    const alcance = alcanceDe(req);
    if (kpi) {
      return res.json(crm.getLeadsKpiDetalle({
        fechaInicio,
        fechaFin,
        kpi,
        limit: limit || 5000,
        crmTexto: alcance?.crmTexto || null,
      }));
    }
    res.json(crm.getLeadsDashboard({
      fechaInicio,
      fechaFin,
      limit,
      crmTexto: alcance?.crmTexto || null,
    }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/leads/detalle', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { fechaInicio, fechaFin, kpi, limit } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const alcance = alcanceDe(req);
    res.json(crm.getLeadsKpiDetalle({
      fechaInicio,
      fechaFin,
      kpi: kpi || 'leads',
      limit: limit || 5000,
      crmTexto: alcance?.crmTexto || null,
    }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/monitoreo-cholula', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, vendedor } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const monitoreo = require('../services/monitoreoCholulaService');
    if (vendedor) {
      return res.json(await monitoreo.getMonitoreoCholulaDetalle({ fechaInicio, fechaFin, vendedor }));
    }
    res.json(await monitoreo.getMonitoreoCholula({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/monitoreo-cholula/calendario', (req, res, next) => {
  try {
    const monitoreo = require('../services/monitoreoCholulaService');
    res.json(monitoreo.getCalendarioCholula({ mes: req.query.mes }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/monitoreo-cholula/clientes', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaFin) {
      return res.status(400).json({ error: 'Parametro requerido: fechaFin (YYYY-MM-DD).' });
    }
    const monitoreo = require('../services/monitoreoCholulaService');
    res.json(await monitoreo.getCarteraCholula({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.put('/ventas/monitoreo-cholula/clientes/:idCrm', (req, res, next) => {
  try {
    // Las etiquetas viven en el servidor de la oficina; fuera de la red no se guardan
    // para no tener dos copias distintas.
    if (require('../services/dataSource').isCloud()) {
      return res.status(503).json({ error: 'Las etiquetas de clientes solo se guardan conectado a la red de la oficina.' });
    }
    const { etiqueta, motivo, nota } = req.body || {};
    const autor = req.session?.username || 'usuario';
    const monitoreo = require('../services/monitoreoCholulaService');
    res.json(monitoreo.etiquetarClienteCholula(req.params.idCrm, { etiqueta, motivo, nota, autor }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/afluencia', (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, limit } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const alcance = alcanceDe(req);
    res.json(getAfluenciaDashboard({
      fechaInicio,
      fechaFin,
      limit,
      sucursalKey: alcance?.afluenciaKey || null,
    }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/financiamiento/gerentes', (_req, res, next) => {
  try {
    res.json(gerentesFi.getGerentesPayload());
  } catch (err) {
    next(err);
  }
});

router.get('/ventas/financiamiento/factura/:docto', async (req, res, next) => {
  try {
    const data = await getFacturaMovimientos(req.params.docto);
    const notes = financiamientoNotes.listNotes({ factura: req.params.docto });
    res.json({ ...data, notes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/financiamiento/notas', (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, factura, soloFacturas } = req.query;
    res.json({
      notes: financiamientoNotes.listNotes({
        fechaInicio,
        fechaFin,
        factura,
        soloFacturas: soloFacturas === '1' || soloFacturas === 'true',
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/ventas/financiamiento/notas', (req, res, next) => {
  try {
    const { text, scope, fechaInicio, fechaFin, factura } = req.body || {};
    const author = req.session?.username || req.session?.name || 'usuario';
    const note = financiamientoNotes.createNote({
      text,
      author,
      scope,
      factura,
      fechaInicio: fechaInicio || req.query.fechaInicio,
      fechaFin: fechaFin || req.query.fechaFin,
    });
    res.status(201).json({ note });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.put('/ventas/financiamiento/notas/:id', (req, res, next) => {
  try {
    const author = req.session?.username || req.session?.name || 'usuario';
    const note = financiamientoNotes.updateNote(req.params.id, {
      text: req.body?.text,
      author,
    });
    res.json({ note });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/ventas/financiamiento/notas/:id', (req, res, next) => {
  try {
    financiamientoNotes.deleteNote(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
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

router.get('/lista-precios', async (req, res, next) => {
  try {
    const vista = String(req.query.vista || 'ficha').toLowerCase();
    const filters = {
      section: req.query.section,
      tipoPago: req.query.tipoPago,
      modelo: req.query.modelo,
      q: req.query.q,
      soloConStock: req.query.soloConStock,
    };
    const data = vista === 'tabla'
      ? await getListaPrecios(filters)
      : await getListaPreciosFicha(filters);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/lista-precios/images/:modelo', (req, res) => {
  try {
    const { getImageFile } = require('../services/listaPreciosImagesService');
    const file = getImageFile(decodeURIComponent(req.params.modelo || ''));
    if (!file) return res.status(404).json({ error: 'Imagen no encontrada para ese modelo.' });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', file.mime || 'image/jpeg');
    return res.sendFile(file.absolutePath);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo servir la imagen.' });
  }
});

router.get('/inventory', async (req, res, next) => {
  try {
    res.json(await getInventory({ planPisoPeriod: req.query.planPisoPeriod || 'all' }));
  } catch (err) {
    next(err);
  }
});

router.get('/inventory/vendidos', async (req, res, next) => {
  try {
    if (alcanceDe(req)) {
      return res.status(403).json({ error: 'Este perfil consulta la disponibilidad de autos, no el cierre de utilidad.' });
    }
    const { fechaInicio, fechaFin } = req.query;
    const vendidos = await getVendidosAnalisis({ fechaInicio, fechaFin });
    const iemc = await computeIemcF2({
      fechaInicio,
      fechaFin,
      vendidosTable: vendidos.vendidosTable,
    });
    res.json({
      ...vendidos,
      iemc,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/inventory/intercambios', async (req, res, next) => {
  try {
    if (alcanceDe(req)) {
      return res.status(403).json({ error: 'Los intercambios de planta no están disponibles para este perfil.' });
    }
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getIntercambiosHistorico({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/inventory/postventa', async (req, res, next) => {
  try {
    if (alcanceDe(req)) {
      return res.status(403).json({ error: 'El inventario de postventa no está disponible para este perfil.' });
    }
    const { fechaInicio, fechaFin } = req.query;
    res.json(await getInventoryPostventa({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Traspasos de refacciones entre almacenes (DE…A…) */
router.get('/inventory/postventa/traspasos', async (req, res, next) => {
  try {
    if (alcanceDe(req)) {
      return res.status(403).json({ error: 'El inventario de postventa no está disponible para este perfil.' });
    }
    const { getTraspasosEntreAlmacenes } = require('../services/inventoryPostventaService');
    const { fechaInicio, fechaFin } = req.query;
    res.json(await getTraspasosEntreAlmacenes({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/inventory/seminuevos', async (req, res, next) => {
  try {
    const mesesRotacion = Number(req.query.mesesRotacion || 12);
    const alcance = alcanceDe(req);
    res.json(await getInventorySeminuevos({
      mesesRotacion,
      ubicacion: alcance?.inventarioUbicacion || null,
      sucursal: alcance?.label || null,
    }));
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

router.get('/post-sales/hyp/aseguradoras-cobranza', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    res.json(await getHypAseguradorasCobranza({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/post-sales/hyp/garantias-cobranza', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    res.json(await getHypGarantiasCobranza({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Cuadre de Órdenes HyP · 0470/0476/0477/0479 · Contpaq MOVDET ↔ DMS */
async function handleCuadreOrdenesHyp(req, res, next) {
  try {
    const { fechaInicio, fechaFin, sql } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const incluirSql = sql === '1' || sql === 'true';
    const data = await consultarCuadreOrdenesHyp({ fechaInicio, fechaFin, incluirSql });
    // No enviar `texto` al UI (duplica la matriz y alarga la respuesta).
    const { texto, ...rest } = data || {};
    res.json({ ...rest, modulo: 'cuadreOrdenesHyp' });
  } catch (err) {
    console.error('[cuadreOrdenesHyp]', err.message || err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

router.get('/post-sales/hyp/cuadre-ordenes', handleCuadreOrdenesHyp);
router.get('/post-sales/hyp/cuadre', handleCuadreOrdenesHyp);

router.get('/post-sales/refacciones-pedidos', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getRefaccionesPedidos({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/post-sales/refacciones', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getRefaccionesDashboard({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/post-sales/orden/:orden', async (req, res, next) => {
  try {
    const data = await getPostSalesOrderDetail(req.params.orden);
    res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/post-sales/export-xlsx', (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const rawName = String(req.body?.filename || 'export.xlsx').replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ ]+/g, '_');
    const filename = rawName.toLowerCase().endsWith('.xlsx') ? rawName : `${rawName}.xlsx`;
    const sheets = Array.isArray(req.body?.sheets) ? req.body.sheets : [];
    if (!sheets.length) {
      return res.status(400).json({ error: 'No hay hojas para exportar.' });
    }

    const wb = XLSX.utils.book_new();
    let appended = 0;
    for (const sheet of sheets) {
      const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
      if (!rows.length) continue;
      const name = String(sheet?.name || `Hoja${appended + 1}`).slice(0, 31) || `Hoja${appended + 1}`;
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
      appended += 1;
    }
    if (!appended) {
      return res.status(400).json({ error: 'Las hojas no tienen filas para exportar.' });
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
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
    const alcance = alcanceDe(req);
    res.json(await getContabilidad({
      fechaInicio,
      fechaFin,
      planPisoPeriod,
      sucursal: alcance?.contabilidadId || sucursal,
      area,
      includeFi,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/contabilidad/punto-equilibrio', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, sucursal, refined } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const { getPuntoEquilibrio } = require('../services/breakEvenService');
    res.json(await getPuntoEquilibrio({
      fechaInicio,
      fechaFin,
      sucursal: alcanceDe(req)?.contabilidadId || sucursal || 'todos',
      refined: refined === 'true' || refined === '1',
    }));
  } catch (err) {
    next(err);
  }
});

// Contabilidad con el formato de VECSA y el cálculo de Balderrama.
router.get('/contabilidad/estado-resultados', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const { getEstadoResultadosFormato } = require('../services/contabilidadFormatoService');
    res.json(await getEstadoResultadosFormato({
      fechaInicio,
      fechaFin,
      alcanceSucursal: alcanceDe(req)?.contabilidadId || null,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/contabilidad/balance', async (req, res, next) => {
  try {
    const { fechaFin } = req.query;
    if (!fechaFin) return res.status(400).json({ error: 'Parametro requerido: fechaFin (YYYY-MM-DD).' });
    const { getBalanceFormato } = require('../services/contabilidadFormatoService');
    if (alcanceDe(req)?.contabilidadId) {
      return res.json({
        disponible: false,
        alcanceSucursal: alcanceDe(req).contabilidadId,
        nota: 'El balance es de toda la agencia. Este perfil solo consulta el estado de resultados de su sucursal.',
      });
    }
    res.json(await getBalanceFormato({ fechaFin }));
  } catch (err) {
    next(err);
  }
});

router.get('/contabilidad/analisis-financiero', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    if (alcanceDe(req)?.contabilidadId) {
      return res.json({
        disponible: false,
        nota: 'El análisis financiero de agencia no aplica a un perfil de sucursal.',
      });
    }
    res.json(await getAnalisisFinanciero({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/ventas/analisis-comercial', async (req, res, next) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(await getAnalisisComercial({ fechaInicio, fechaFin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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

// Pronóstico › Presupuesto de la empresa (P&L presupuestal 2026, misma base que Contabilidad › EEFF)
router.get('/forecast/presupuesto', async (req, res, next) => {
  try {
    const { getPresupuestoEmpresa } = require('../services/presupuestoEmpresaService');
    const mesCorte = req.query.mesCorte != null && req.query.mesCorte !== '' ? Number(req.query.mesCorte) : undefined;
    const fresh = ['1', 'true'].includes(String(req.query.fresh || '').toLowerCase());
    res.json(await getPresupuestoEmpresa({ mesCorte, fresh }));
  } catch (err) {
    next(err);
  }
});

// Pronóstico › Generador de presupuesto próximos 12 meses
function parsePresupuesto12mParams(req) {
  const src = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  let supuestos = src.supuestos;
  if (typeof supuestos === 'string') {
    try { supuestos = JSON.parse(supuestos); } catch { supuestos = {}; }
  }
  return {
    inicio: src.inicio,
    mesesHistoria: src.mesesHistoria,
    supuestos,
    fresh: ['1', 'true', true].includes(src.fresh),
  };
}

router.all('/forecast/presupuesto-12m', async (req, res, next) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { getPresupuesto12m } = require('../services/presupuestoGeneradorService');
    res.json(await getPresupuesto12m(parsePresupuesto12mParams(req)));
  } catch (err) {
    next(err);
  }
});

router.post('/forecast/presupuesto-12m/xlsx', async (req, res, next) => {
  try {
    const { getPresupuesto12m, buildXlsx } = require('../services/presupuestoGeneradorService');
    const data = await getPresupuesto12m(parsePresupuesto12mParams(req));
    if (!data.available) return res.status(400).json({ error: data.reason || 'Sin datos para generar el presupuesto.' });
    const buffer = buildXlsx(data);
    const name = `presupuesto-12m-${data.inicio}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.get('/forecast/presupuesto-12m/escenarios', (_req, res, next) => {
  try {
    const { listEscenarios } = require('../services/presupuestoGeneradorService');
    res.json({ escenarios: listEscenarios() });
  } catch (err) {
    next(err);
  }
});

router.get('/forecast/presupuesto-12m/escenarios/:id', (req, res, next) => {
  try {
    const { getEscenario } = require('../services/presupuestoGeneradorService');
    const esc = getEscenario(req.params.id);
    if (!esc) return res.status(404).json({ error: 'Escenario no encontrado' });
    res.json(esc);
  } catch (err) {
    next(err);
  }
});

router.post('/forecast/presupuesto-12m/escenarios', (req, res, next) => {
  try {
    const { saveEscenario } = require('../services/presupuestoGeneradorService');
    const body = req.body || {};
    const saved = saveEscenario({
      id: body.id,
      nombre: body.nombre,
      inicio: body.inicio,
      mesesHistoria: body.mesesHistoria,
      supuestos: body.supuestos,
      usuario: req.session?.username || null,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.delete('/forecast/presupuesto-12m/escenarios/:id', (req, res, next) => {
  try {
    const { deleteEscenario } = require('../services/presupuestoGeneradorService');
    if (!deleteEscenario(req.params.id)) return res.status(404).json({ error: 'Escenario no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Base interna CRM (Balderrama Ciclos) — histórico por ID_CONTACTO (= ID CRM)
router.get('/crm/status', (_req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const sheetsSync = require('../services/crmSheetsSync');
    const { localCrmStatus, canPullViaApi } = require('../services/crmCloudPull');
    const hybrid = {
      local: localCrmStatus(),
      cloudPullConfigured: canPullViaApi(),
      pgReadonly: Boolean(process.env.PG_READONLY_URL),
    };
    if (!crm.isAvailable()) {
      return res.json({
        ok: false,
        disponible: false,
        detalle: 'Base CRM no cargada. Ejecute etl-crm-ciclos.js o POST /api/crm/pull-cloud',
        sheetsSync: sheetsSync.getStatus(),
        hybrid,
      });
    }
    res.json({
      ok: true,
      disponible: true,
      ...crm.getCrmStats(),
      sheetsSync: sheetsSync.getStatus(),
      hybrid,
    });
  } catch (err) {
    next(err);
  }
});

/** Baja ciclos CRM desde Railway a SQLite local (modo híbrido). */
router.post('/crm/pull-cloud', requireSession, async (req, res, next) => {
  try {
    if (isAuthEnabled() && !canManageUsers(req.session?.role)) {
      return res.status(403).json({ error: 'Solo Administración puede bajar el CRM desde la nube.' });
    }
    const { sincronizarCiclosEnVivo } = require('../services/crmCiclosLiveSync');
    const result = await sincronizarCiclosEnVivo({
      full: req.body?.full !== false,
      forceApi: req.body?.forceApi === true,
    });
    res.status(result.ok ? 200 : (result.skipped ? 409 : 500)).json(result);
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

router.post('/crm/sheets-sync/run', requireSession, async (req, res, next) => {
  try {
    const sheetsSync = require('../services/crmSheetsSync');
    const body = req.body || {};
    const fullObjetivos = body.fullObjetivos === true
      || ['1', 'true', 'yes', 'full'].includes(String(req.query?.full || '').toLowerCase());
    if (fullObjetivos && isAuthEnabled() && !canManageUsers(req.session?.role)) {
      return res.status(403).json({
        error: 'Solo Administración puede forzar la actualización completa de Objetivos Web.',
      });
    }
    const result = await sheetsSync.runSync({
      reason: fullObjetivos ? 'api-objetivos-full' : 'api',
      fullObjetivos,
      skipCloud: body.skipCloud === true,
    });
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
    if (!['incremental', 'daily', 'monthly', 'full'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser incremental, daily, monthly o full' });
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
    res.json({
      resultados: crm.searchContacts({
        q,
        limit,
        crmTexto: alcanceDe(req)?.crmTexto || null,
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/crm/vendedores', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { q, limit } = req.query;
    res.json({ vendedores: crm.listVendedores({ q, limit }) });
  } catch (err) {
    next(err);
  }
});

router.get('/crm/vendedores/resumen', async (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { vendedor, fechaInicio, fechaFin, limit } = req.query;
    if (!vendedor) {
      return res.status(400).json({ error: 'Parametro requerido: vendedor.' });
    }
    res.json(await crm.getVendedorResumen({
      vendedor,
      fechaInicio: fechaInicio || null,
      fechaFin: fechaFin || null,
      limit,
    }));
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
    const alcance = alcanceDe(req);
    res.json(await crm.getCierresTallerPeriodo({
      fechaInicio,
      fechaFin,
      limit,
      letrasOrden: alcance?.tallerLetras || null,
      sucursal: alcance?.label || null,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/ai/exports/:fileId', (req, res, next) => {
  try {
    const path = require('path');
    const { resolveExportPath } = require('../services/aiExcelExport');
    const diskPath = resolveExportPath(req.params.fileId);
    if (!diskPath) {
      return res.status(404).json({ error: 'Archivo no encontrado o expirado. Vuelve a pedirle al asistente que genere el Excel.' });
    }
    const rawName = String(req.query.name || 'export.xlsx').replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ ]+/g, '_');
    const filename = rawName.toLowerCase().endsWith('.xlsx') ? rawName : `${rawName}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.sendFile(path.resolve(diskPath));
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

router.post('/ai/insights', (req, res) => {
  try {
    const { buildInsights } = require('../services/intelligentInsightsService');
    const body = req.body || {};
    const roleId = req.session?.role || body.roleId || null;
    const insights = buildInsights({ ...body, roleId });
    res.json({
      ok: true,
      module: body.module || null,
      count: insights.length,
      insights,
      catalogAware: true,
    });
  } catch (err) {
    console.error('[AI Insights]', err.message);
    res.status(500).json({ error: err.message || 'No se pudieron generar insights' });
  }
});

router.get('/ai/kpi-catalog', (req, res) => {
  try {
    const { listCatalog } = require('../services/kpiCatalogSemaforo');
    const roleId = req.session?.role || req.query.roleId || null;
    const items = listCatalog({
      perspectiva: req.query.perspectiva,
      roleId,
    });
    res.json({ ok: true, count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Voz de Balvo: leer la respuesta y escuchar al usuario (OpenAI).
router.post('/ai/speech', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'La voz de OpenAI no está configurada. Agrega OPENAI_API_KEY.' });
    }
    const audio = await synthesizeSpeech(req.body?.text, req.body?.voice);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(audio);
  } catch (err) {
    console.error('[AI speech]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo generar la voz' });
  }
});

router.post('/ai/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '15mb' }), async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'La voz de OpenAI no está configurada. Agrega OPENAI_API_KEY.' });
    }
    const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    const text = await transcribeAudio(Buffer.isBuffer(req.body) ? req.body : null, mime);
    res.json({ text });
  } catch (err) {
    console.error('[AI transcribe]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo transcribir el audio' });
  }
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

    const result = await runChat(sanitized, {
      roleId: req.session?.role || null,
      username: req.session?.username || null,
    });
    res.json(result);
  } catch (err) {
    console.error('[AI Error]', err.message);
    res.status(500).json({ error: err.message || 'Error en el asistente IA' });
  }
});

module.exports = router;
