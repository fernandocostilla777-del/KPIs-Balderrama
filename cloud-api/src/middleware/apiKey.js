function requireApiKey(req, res, next) {
  const expected = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'CLOUD_SYNC_API_KEY no configurada en el servidor' });
  }
  const provided = String(req.headers['x-api-key'] || '').trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'API key inválida' });
  }
  const allowedSource = String(process.env.CLOUD_SYNC_ALLOWED_SOURCE || '').trim();
  if (allowedSource && req.body?.sourceHost && req.body.sourceHost !== allowedSource) {
    return res.status(403).json({ error: 'Origen no autorizado' });
  }
  next();
}

module.exports = { requireApiKey };
