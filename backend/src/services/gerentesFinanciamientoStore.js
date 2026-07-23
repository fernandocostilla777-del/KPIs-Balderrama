const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../data/gerentes-financiamiento.json');

function personTokenKey(v) {
  const s = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!s || s === 'NULL') return null;
  const tokens = s.split(' ').filter(Boolean);
  return tokens.length ? tokens.sort().join(' ') : null;
}

function loadRaw() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.asesores)) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function buildIndex(raw) {
  const byToken = new Map();
  const asesores = [];
  const gerentesSet = new Set();

  for (const row of raw?.asesores || []) {
    const asesor = String(row.asesor || '').trim();
    const gerente = String(row.gerente || '').trim();
    if (!asesor || !gerente) continue;
    asesores.push({ asesor, gerente });
    gerentesSet.add(gerente);
    const tok = personTokenKey(asesor);
    if (tok) byToken.set(tok, gerente);
    // también clave literal normalizada (sin reordenar) por si el DMS coincide exactamente
    const lit = String(asesor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if (lit) byToken.set(lit, gerente);
  }

  return {
    updatedAt: raw?.updatedAt || null,
    asesores,
    gerentes: [...gerentesSet].sort((a, b) => a.localeCompare(b, 'es')),
    byToken,
  };
}

let cache = null;

function getCatalog() {
  if (!cache) {
    const raw = loadRaw();
    cache = raw
      ? buildIndex(raw)
      : { updatedAt: null, asesores: [], gerentes: [], byToken: new Map() };
  }
  return cache;
}

function resolveGerente(vendedorNombre) {
  const cat = getCatalog();
  if (!vendedorNombre || !cat.byToken.size) return null;

  const tok = personTokenKey(vendedorNombre);
  if (tok && cat.byToken.has(tok)) return cat.byToken.get(tok);

  const lit = String(vendedorNombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (lit && cat.byToken.has(lit)) return cat.byToken.get(lit);

  // fallback: el nombre DMS contiene (o es contenido por) el asesor del catálogo
  if (tok) {
    const tokens = new Set(tok.split(' '));
    for (const [key, gerente] of cat.byToken.entries()) {
      const keyTokens = key.split(' ');
      if (keyTokens.length < 2) continue;
      const allIn = keyTokens.every((t) => tokens.has(t));
      const allOut = [...tokens].every((t) => keyTokens.includes(t));
      if (allIn || (tokens.size >= 2 && allOut)) return gerente;
    }
  }
  return null;
}

function getGerentesPayload() {
  const cat = getCatalog();
  return {
    updatedAt: cat.updatedAt,
    totalAsesores: cat.asesores.length,
    gerentes: cat.gerentes,
    asesores: cat.asesores,
  };
}

function reload() {
  cache = null;
  return getCatalog();
}

module.exports = {
  personTokenKey,
  resolveGerente,
  getGerentesPayload,
  reload,
};
