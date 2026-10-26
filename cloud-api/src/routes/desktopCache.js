'use strict';
const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const { requireApiKey } = require('../middleware/apiKey');
const store = require('../services/desktopCacheStore');

const router = express.Router();

function rutaValida(ruta) {
  return typeof ruta === 'string' && /^\/[\w\-/.:%]*$/.test(ruta) && !ruta.includes('..') && ruta.length <= 300;
}

function consultaValida(consulta) {
  return typeof consulta === 'string' && consulta.length <= 2000;
}

/**
 * Lectura de la réplica: solo el backend de la oficina o de escritorio, con su
 * llave de solo lectura. Ese backend ya validó la sesión y el perfil del usuario.
 * Es otra llave que la de publicación: si se filtra, no permite escribir.
 */
function requireReadKey(req, res, next) {
  const expected = String(process.env.CLOUD_READ_API_KEY || '').trim();
  if (!expected) return res.status(503).json({ error: 'CLOUD_READ_API_KEY no configurada en el servidor' });
  const provided = String(req.headers['x-read-key'] || '').trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Llave de lectura inválida' });
  }
  return next();
}

router.get('/', requireReadKey, async (req, res, next) => {
  try {
    const ruta = String(req.query.ruta || '');
    const consulta = String(req.query.consulta || '');
    if (!rutaValida(ruta) || !consultaValida(consulta)) {
      return res.status(400).json({ error: 'ruta o consulta inválida' });
    }
    if (store.esRutaExcluida(ruta)) {
      return res.status(404).json({ error: 'Esta vista solo se consulta dentro de la oficina.', excluida: true });
    }
    const row = await store.leer({ scope: '', ruta, consulta });
    if (!row?.generado_at) {
      return res.status(503).json({
        error: 'Esta vista aún no está en la réplica de la nube. Se publicará en unos minutos.',
        pendiente: true,
      });
    }
    res.setHeader('X-Replica-Generado', new Date(row.generado_at).toISOString());
    res.status(row.status || 200).type('application/json');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.send(zlib.gzipSync(row.body || ''));
    }
    return res.send(row.body || '');
  } catch (err) {
    return next(err);
  }
});

/** Servidor de la oficina: publica respuestas calculadas contra SQL Server. */
router.post('/', requireApiKey, async (req, res, next) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!entries) return res.status(400).json({ error: 'entries debe ser un arreglo' });
    const validas = entries.filter((e) => rutaValida(e?.ruta)
      && consultaValida(String(e.consulta ?? ''))
      && Number.isInteger(e.status)
      && typeof e.body === 'string'
      && !store.esRutaExcluida(e.ruta))
      .map((e) => ({ scope: '', ruta: e.ruta, consulta: String(e.consulta ?? ''), status: e.status, body: e.body }));
    const guardadas = await store.guardar(validas);
    return res.status(201).json({ ok: true, guardadas, rechazadas: entries.length - validas.length });
  } catch (err) {
    return next(err);
  }
});

/** Servidor de la oficina: consultas usadas o pedidas que hay que (re)calcular. */
router.get('/pendientes', requireApiKey, async (req, res, next) => {
  try {
    const items = await store.pendientes({ soloFaltantes: req.query.soloFaltantes === '1' });
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

router.get('/estado', requireApiKey, async (_req, res, next) => {
  try {
    return res.json({ ok: true, ...(await store.estado()) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.requireReadKey = requireReadKey;
