const express = require('express');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const {
  getBdcEmbudo,
  getObjetivosSnapshot,
  listObjetivosPeriodos,
} = require('../services/objetivosResultadosService');
const monthlyObjectives = require('../services/monthlyObjectivesStore');

const router = express.Router();

router.get('/periodos', requireMobileAuth, async (_req, res, next) => {
  try {
    res.json({ ok: true, periodos: await listObjetivosPeriodos() });
  } catch (err) {
    next(err);
  }
});

router.get('/meses', requireMobileAuth, async (_req, res, next) => {
  try {
    res.json({ ok: true, months: await monthlyObjectives.listMonths() });
  } catch (err) {
    next(err);
  }
});

router.get('/meses/:id', requireMobileAuth, async (req, res, next) => {
  try {
    const month = await monthlyObjectives.getMonth(req.params.id);
    if (!month) return res.status(404).json({ ok: false, error: 'Mes no encontrado' });
    return res.json({ ok: true, month });
  } catch (err) {
    return next(err);
  }
});

router.put('/meses', requireMobileAuth, async (req, res, next) => {
  try {
    if (!monthlyObjectives.isAdminUser(req.mobileUser)) {
      return res.status(403).json({ ok: false, error: 'Solo Administración puede guardar meses.' });
    }
    const month = await monthlyObjectives.upsertMonth(req.body?.month || req.body);
    return res.json({
      ok: true,
      month,
      months: await monthlyObjectives.listMonths(),
    });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ ok: false, error: err.message });
    return next(err);
  }
});

router.delete('/meses/:id', requireMobileAuth, async (req, res, next) => {
  try {
    if (!monthlyObjectives.isAdminUser(req.mobileUser)) {
      return res.status(403).json({ ok: false, error: 'Solo Administración puede eliminar meses.' });
    }
    const months = await monthlyObjectives.removeMonth(req.params.id);
    return res.json({ ok: true, months });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ ok: false, error: err.message });
    return next(err);
  }
});

router.get('/', requireMobileAuth, async (req, res, next) => {
  try {
    const snapshot = await getObjetivosSnapshot({
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
    });

    if (!snapshot.found) {
      return res.status(404).json({
        ok: false,
        error: `Sin datos sincronizados para el periodo ${snapshot.periodKey}.`,
        periodKey: snapshot.periodKey,
      });
    }

    const payload = {
      ...snapshot.payload,
      sincronizadoEn: snapshot.sincronizadoEn,
      origen: 'cloud-sync',
    };

    // BDC en vivo desde crm_ciclos (Railway). Contactos = ciclos ∪ leads EV
    // del snapshot local (crm_leads completo). Si el snapshot ya trae el union
    // enriquecido, no dejamos que el live lo pise a solo ciclos.
    const bdcLive = await getBdcEmbudo({
      fechaInicio: req.query.fechaInicio,
      fechaFin: req.query.fechaFin,
    });
    const snapBdc = payload.resultados?.bdc || {};
    const snapReal = snapBdc.real || {};
    const liveReal = bdcLive.real || {};
    const ciclos = Number(liveReal.contactos || snapReal.contactosCiclos || 0);
    const leadsAsignados = Number(snapReal.contactosLeadsAsignados || 0);
    const overlap = Number(snapReal.contactosOverlap || 0);
    const snapContactos = Number(snapReal.contactos || 0);
    let contactos;
    if (leadsAsignados > 0) {
      contactos = Math.max(0, ciclos + leadsAsignados - overlap);
    } else if (snapContactos > ciclos) {
      // Snapshot ya venía con union (o cifra mayor) aunque falte el desglose.
      contactos = snapContactos;
    } else {
      contactos = ciclos;
    }

    payload.resultados = {
      ...(payload.resultados || {}),
      bdc: {
        ...snapBdc,
        ...bdcLive,
        meta: snapBdc.meta || null,
        real: {
          ...liveReal,
          contactos,
          contactosCiclos: ciclos,
          contactosLeadsAsignados: leadsAsignados || null,
          contactosOverlap: leadsAsignados > 0 ? overlap : null,
        },
        fuente: leadsAsignados > 0
          ? 'crm_ciclos (Railway) + crm_leads EV asignados (snapshot)'
          : (snapContactos > ciclos
            ? 'crm_ciclos (Railway) + contactos enriquecidos (snapshot)'
            : (bdcLive.fuente || 'crm_ciclos (Railway)')),
        nota: leadsAsignados > 0
          ? `Contactos = ciclos (${ciclos}) ∪ leads con ejecutivo asignado (${leadsAsignados}; solape ${overlap}).`
          : (snapContactos > ciclos
            ? `Contactos desde snapshot enriquecido (${snapContactos}); ciclos Railway=${ciclos}.`
            : (bdcLive.nota || snapBdc.nota || null)),
      },
    };

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
