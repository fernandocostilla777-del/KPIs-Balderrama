/**
 * Sincroniza compras VIN (serie → ID CRM) desde Railway cloud hacia SQLite local.
 * Cubre el hueco cuando crm_actividades local no trae facturas recientes.
 *
 * Uso:
 *   node backend/scripts/sync-crm-vin-compras-cloud.js
 *   node backend/scripts/sync-crm-vin-compras-cloud.js --desde=2026-01-01 --hasta=2026-09-30
 *   node backend/scripts/sync-crm-vin-compras-cloud.js --vin=LSFAM2AB1TA074457
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const Database = require('better-sqlite3');
const { openLocalStore, upsertLocalBatch, DB_PATH } = require('./lib/crmCiclosLocalStore');

function parseArgs(argv) {
  const out = { desde: null, hasta: null, vins: [] };
  for (const a of argv) {
    if (a.startsWith('--desde=')) out.desde = a.slice(8);
    else if (a.startsWith('--hasta=')) out.hasta = a.slice(8);
    else if (a.startsWith('--vin=')) out.vins.push(a.slice(6).trim().toUpperCase());
  }
  return out;
}

function apiRowToCloudRow(row) {
  return {
    id_contacto: row.idContacto || row.id_contacto || null,
    nombre_contacto: row.nombreContacto || row.nombre_contacto || null,
    id_ciclo: row.idCiclo || row.id_ciclo || null,
    fecha_inicio_ciclo: row.fechaInicioCiclo || row.fecha_inicio_ciclo || null,
    fecha_esperada_cierre: row.fechaEsperadaCierre || row.fecha_esperada_cierre || null,
    estatus: row.estatus || null,
    fecha_estatus: row.fechaEstatus || row.fecha_estatus || null,
    tipo_actividad: row.tipoActividad || row.tipo_actividad || null,
    fecha_crea_actividad: row.fechaCreaActividad || row.fecha_crea_actividad || null,
    fecha_prog_actividad: row.fechaProgActividad || row.fecha_prog_actividad || null,
    fecha_resp_actividad: row.fechaRespActividad || row.fecha_resp_actividad || null,
    resultado_actividad: row.resultadoActividad || row.resultado_actividad || null,
    forma_contacto: row.formaContacto || row.forma_contacto || null,
    medio_contacto: row.medioContacto || row.medio_contacto || null,
    submedio_contacto: row.submedioContacto || row.submedio_contacto || null,
    num_factura: row.numFactura || row.num_factura || null,
    facturado_a: row.facturadoA || row.facturado_a || null,
    producto_vendido: row.productoVendido || row.producto_vendido || null,
    fecha_factura: row.fechaFactura || row.fecha_factura || null,
    vin: row.vin ? String(row.vin).trim().toUpperCase() : null,
    fecha_entrega: row.fechaEntrega || row.fecha_entrega || null,
    vendedor: row.vendedor || null,
  };
}

async function fetchCiclosByVin(baseUrl, apiKey, vin) {
  const url = `${baseUrl}/api/crm?vin=${encodeURIComponent(vin)}&limit=20`;
  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status} vin=${vin}`);
  }
  return Array.isArray(data.ciclos) ? data.ciclos : [];
}

function collectVinsFromFinanciamiento(db, { desde, hasta, extraVins }) {
  const set = new Set((extraVins || []).map((v) => String(v).trim().toUpperCase()).filter(Boolean));
  const where = ['vin IS NOT NULL', `trim(vin) <> ''`];
  const params = [];
  if (desde) {
    where.push('substr(fecha_compra, 1, 10) >= ?');
    params.push(String(desde).slice(0, 10));
  }
  if (hasta) {
    where.push('substr(fecha_compra, 1, 10) <= ?');
    params.push(String(hasta).slice(0, 10));
  }
  const hasFin = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'`).get();
  if (hasFin) {
    const rows = db.prepare(`
      SELECT DISTINCT upper(trim(vin)) AS vin
      FROM crm_financiamiento
      WHERE ${where.join(' AND ')}
    `).all(...params);
    for (const r of rows) if (r.vin) set.add(r.vin);
  }
  return [...set];
}

async function syncCrmVinComprasFromCloud(opts = {}) {
  const baseUrl = String(process.env.CLOUD_SYNC_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Configure CLOUD_SYNC_URL y CLOUD_SYNC_API_KEY');
  }

  const dbRead = new Database(DB_PATH, { readonly: true });
  let vins;
  try {
    vins = collectVinsFromFinanciamiento(dbRead, opts);
  } finally {
    dbRead.close();
  }

  if (!vins.length) {
    return { ok: true, vins: 0, found: 0, upserted: 0 };
  }

  const db = openLocalStore();
  let found = 0;
  let upserted = 0;
  const missing = [];
  const batch = [];

  for (const vin of vins) {
    try {
      const ciclos = await fetchCiclosByVin(baseUrl, apiKey, vin);
      const withVin = ciclos
        .map(apiRowToCloudRow)
        .filter((r) => r.id_contacto && r.vin);
      if (!withVin.length) {
        missing.push(vin);
        continue;
      }
      found += 1;
      batch.push(...withVin);
      if (batch.length >= 80) {
        const r = upsertLocalBatch(db, batch.splice(0, batch.length));
        upserted += (r.inserted || 0) + (r.updated || 0);
      }
    } catch (err) {
      missing.push(vin);
      console.warn(`[vin-sync] ${vin}: ${err.message}`);
    }
  }

  if (batch.length) {
    const r = upsertLocalBatch(db, batch);
    upserted += (r.inserted || 0) + (r.updated || 0);
  }

  db.close();
  return {
    ok: true,
    vins: vins.length,
    found,
    missing: missing.length,
    missingSample: missing.slice(0, 15),
    upserted,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const desde = args.desde || '2026-01-01';
  const hasta = args.hasta || '2026-09-30';
  console.log(`Sync VIN→ID CRM cloud→local · ${desde} → ${hasta} · extra vins=${args.vins.length}`);
  const result = await syncCrmVinComprasFromCloud({
    desde,
    hasta,
    extraVins: args.vins,
  });
  console.table([result]);
}

module.exports = { syncCrmVinComprasFromCloud, apiRowToCloudRow };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
