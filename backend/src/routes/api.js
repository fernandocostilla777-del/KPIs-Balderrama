const express = require('express');
const { getOverview } = require('../services/overviewService');
const { loadSalesExecutiveAnalytics } = require('../services/salesExecutiveAnalytics');
const { getVentas } = require('../services/ventas');
const { getInventory, getIntercambiosHistorico } = require('../services/inventoryService');
const { getInventoryPostventa } = require('../services/inventoryPostventaService');
const { getPostSales, getPostSalesOrderDetail } = require('../services/postSalesService');
const { getRefaccionesPedidos, getRefaccionesDashboard } = require('../services/refaccionesPedidosService');
const { getForecast } = require('../services/forecastService');
const { getGoals, setGoals, getHistoricCatalog } = require('../services/salesGoals');
const { getFinanciamientoDashboard, getPvaTrimestreYtd } = require('../services/financiamientoService');
const { getComisionesFi, listComisionTypes } = require('../services/comisionesFiService');
const { getAfluenciaDashboard } = require('../services/afluenciaService');
const financiamientoNotes = require('../services/financiamientoNotesStore');
const gerentesFi = require('../services/gerentesFinanciamientoStore');
const { getFacturaMovimientos } = require('../services/facturaMovimientosService');
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
    const data = await getVentas({ fechaInicio, fechaFin });
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

router.get('/ventas/comisiones/tipos', (_req, res) => {
  res.json({ tipos: listComisionTypes() });
});

router.get('/ventas/comisiones', (req, res, next) => {
  try {
    const { fechaInicio, fechaFin, tipo } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    const kind = String(tipo || 'fi').toLowerCase();
    if (kind !== 'fi') {
      return res.status(400).json({ error: `Tipo de comisión no disponible: ${kind}. Use tipo=fi.` });
    }
    res.json(getComisionesFi({ fechaInicio, fechaFin }));
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

router.get('/ventas/leads', (req, res, next) => {
  try {
    const crm = require('../services/crmCiclosService');
    const { fechaInicio, fechaFin, limit } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).' });
    }
    res.json(crm.getLeadsDashboard({ fechaInicio, fechaFin, limit }));
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
    res.json(getAfluenciaDashboard({ fechaInicio, fechaFin, limit }));
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

router.get('/inventory', async (req, res, next) => {
  try {
    res.json(await getInventory({ planPisoPeriod: req.query.planPisoPeriod || 'all' }));
  } catch (err) {
    next(err);
  }
});

router.get('/inventory/intercambios', async (req, res, next) => {
  try {
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
    res.json(await getContabilidad({ fechaInicio, fechaFin, planPisoPeriod, sucursal, area, includeFi }));
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
      sucursal: sucursal || 'todos',
      refined: refined === 'true' || refined === '1',
    }));
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
    res.json({ resultados: crm.searchContacts({ q, limit }) });
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
    res.json(await crm.getCierresTallerPeriodo({ fechaInicio, fechaFin, limit }));
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
    const insights = buildInsights(body);
    res.json({
      ok: true,
      module: body.module || null,
      count: insights.length,
      insights,
    });
  } catch (err) {
    console.error('[AI Insights]', err.message);
    res.status(500).json({ error: err.message || 'No se pudieron generar insights' });
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
