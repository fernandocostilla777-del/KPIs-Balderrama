function normalizeIp(value) {
  return String(value || '')
    .trim()
    .replace(/^::ffff:/i, '')
    .replace(/^\[|\]$/g, '');
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0];
  const candidate = req.ip || req.socket?.remoteAddress || forwarded;
  return normalizeIp(candidate);
}

function allowedSyncIps() {
  const raw = String(
    process.env.CLOUD_SYNC_ALLOWED_IPS || process.env.CLOUD_SYNC_ALLOWED_SOURCE || ''
  ).trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => normalizeIp(item))
    .filter(Boolean);
}

function requireApiKey(req, res, next) {
  const expected = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'CLOUD_SYNC_API_KEY no configurada en el servidor' });
  }
  const provided = String(req.headers['x-api-key'] || '').trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'API key inválida' });
  }

  const allowed = allowedSyncIps();
  if (allowed.length) {
    const clientIp = getClientIp(req);
    if (!clientIp || !allowed.includes(clientIp)) {
      return res.status(403).json({ error: 'Origen no autorizado' });
    }
  }

  next();
}

module.exports = { requireApiKey, getClientIp };
