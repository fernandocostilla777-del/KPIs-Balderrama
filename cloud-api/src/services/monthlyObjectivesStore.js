const { query } = require('../db');

const PRODUCT_LINES = [
  { linea: 'Aveo HB', familia: 'Pasajeros', trafico: 124, solicitudes: 93, facturas: 31, entregas: 30 },
  { linea: 'Aveo NB', familia: 'Pasajeros', trafico: 88, solicitudes: 66, facturas: 22, entregas: 22 },
  { linea: 'Onix', familia: 'Pasajeros', trafico: 52, solicitudes: 39, facturas: 13, entregas: 13 },
  { linea: 'Tracker', familia: "SUV's", trafico: 12, solicitudes: 9, facturas: 3, entregas: 3 },
  { linea: 'Trax', familia: "SUV's", trafico: 20, solicitudes: 15, facturas: 5, entregas: 5 },
  { linea: 'Captiva', familia: "SUV's", trafico: 36, solicitudes: 27, facturas: 9, entregas: 9 },
  { linea: 'Groove', familia: "SUV's", trafico: 64, solicitudes: 48, facturas: 16, entregas: 16 },
  { linea: 'Traverse', familia: "SUV's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
  { linea: 'Tahoe', familia: "SUV's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
  { linea: 'Suburban', familia: "SUV's", trafico: 8, solicitudes: 6, facturas: 2, entregas: 2 },
  { linea: 'Blazer EV', familia: "SUV's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
  { linea: 'Spark EUV', familia: "SUV's", trafico: 16, solicitudes: 12, facturas: 4, entregas: 4 },
  { linea: 'Captiva PHEV SUV', familia: "SUV's", trafico: 28, solicitudes: 21, facturas: 7, entregas: 7 },
  { linea: 'Colorado', familia: "Pick up's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
  { linea: 'Silverado / Cheyenne Crew Cab', familia: "Pick up's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
  { linea: 'S10 MAX Chassis Cab', familia: "Pick up's", trafico: 20, solicitudes: 15, facturas: 5, entregas: 5 },
  { linea: 'S10 MAX Crew Cab', familia: "Pick up's", trafico: 24, solicitudes: 18, facturas: 6, entregas: 6 },
  { linea: 'S10 MAX Regular Cab', familia: "Pick up's", trafico: 12, solicitudes: 9, facturas: 3, entregas: 3 },
  { linea: 'Montana', familia: "Pick up's", trafico: 8, solicitudes: 6, facturas: 2, entregas: 2 },
  { linea: 'Tornado Van', familia: "Van's", trafico: 36, solicitudes: 27, facturas: 9, entregas: 9 },
  { linea: 'Express Max', familia: "Van's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
];

const BDC_DEFAULT = {
  contacts: 1420,
  appointmentsScheduled: 355,
  appointmentsConfirmed: 284,
  appointmentsCompleted: 213,
  deliveries: 85,
};

function cloneProducts() {
  return PRODUCT_LINES.map((row) => ({ ...row }));
}

function buildAugustDaily() {
  const rows = [
    [1, 18, 14, 1, 1], [2, 37, 28, 1, 1], [3, 55, 42, 3, 2],
    [4, 74, 55, 6, 5], [5, 92, 69, 9, 7], [6, 111, 83, 12, 11],
    [7, 129, 97, 17, 15], [8, 148, 111, 19, 18], [9, 166, 125, 19, 18],
    [10, 185, 138, 24, 22], [11, 203, 152, 29, 27], [12, 221, 166, 34, 31],
    [13, 240, 180, 40, 35], [14, 258, 194, 45, 40], [15, 277, 208, 48, 44],
    [16, 295, 221, 48, 44], [17, 314, 235, 53, 48], [18, 332, 249, 60, 54],
    [19, 351, 263, 66, 59], [20, 369, 277, 72, 64], [21, 387, 291, 79, 69],
    [22, 406, 304, 82, 74], [23, 424, 318, 82, 74], [24, 443, 332, 88, 80],
    [25, 461, 346, 95, 86], [26, 480, 360, 102, 93], [27, 498, 374, 110, 101],
    [28, 517, 387, 119, 109], [29, 535, 401, 125, 117],
    [30, 554, 415, 125, 117], [31, 572, 429, 143, 142],
  ];
  return rows.map(([day, trafico, solicitudes, facturas, entregas]) => ({
    fecha: `2026-08-${String(day).padStart(2, '0')}`,
    trafico,
    solicitudes,
    facturas,
    entregas,
  }));
}

function buildSeptemberDaily() {
  const august = buildAugustDaily();
  const closing = august[august.length - 1];
  const days = august.slice(0, 29).map((row, index) => ({
    ...row,
    fecha: `2026-09-${String(index + 1).padStart(2, '0')}`,
  }));
  days.push({
    fecha: '2026-09-30',
    trafico: closing.trafico,
    solicitudes: closing.solicitudes,
    facturas: closing.facturas,
    entregas: closing.entregas,
  });
  return days;
}

function defaultSeeds() {
  return [
    {
      id: '2026-08',
      label: 'Agosto 2026',
      distribuidor: '323 Automotriz Balderrama Puebla',
      month: 8,
      year: 2026,
      importedAt: '2026-08-14T00:00:00.000Z',
      sourceFile: 'Agosto 2026.pdf',
      volumeReference: 142,
      marketShareTarget: 15.6,
      estimatedIndustry: 908,
      invoicesTarget: 143,
      deliveriesTarget: 142,
      invoiceDeadline: '24/08/2026',
      carryOverInitial: 0,
      carryOverFinal: 1,
      applicationsTarget: 429,
      gmfContractsTarget: 99,
      gmfPenetrationTarget: 70,
      salesPerAdvisor: 5,
      accessoriesTarget: 269800,
      onstarTarget: 12,
      essentialsAnnualPct: 30,
      essentialsMultiAnnualPct: 23,
      usedVehiclesPoints: 5,
      tacNuevosTarget: 25,
      gmfSeminuevosTarget: 10,
      bdc: { ...BDC_DEFAULT },
      daily: buildAugustDaily(),
      products: cloneProducts(),
    },
    {
      id: '2026-09',
      label: 'Septiembre 2026',
      distribuidor: '323 Automotriz Balderrama Puebla',
      month: 9,
      year: 2026,
      importedAt: new Date().toISOString(),
      sourceFile: 'seed-servidor',
      volumeReference: 142,
      marketShareTarget: 15.6,
      estimatedIndustry: 908,
      invoicesTarget: 143,
      deliveriesTarget: 142,
      invoiceDeadline: '24/09/2026',
      carryOverInitial: 0,
      carryOverFinal: 1,
      applicationsTarget: 429,
      gmfContractsTarget: 99,
      gmfPenetrationTarget: 70,
      salesPerAdvisor: 5,
      accessoriesTarget: 269800,
      onstarTarget: 12,
      essentialsAnnualPct: 30,
      essentialsMultiAnnualPct: 23,
      usedVehiclesPoints: 5,
      tacNuevosTarget: 25,
      gmfSeminuevosTarget: 9,

function isPlausibleMonth(month) {
  if (!month || typeof month !== 'object') return false;
  const year = Number(month.year);
  const mon = Number(month.month);
  const current = new Date().getFullYear();
  if (!Number.isFinite(year) || !Number.isFinite(mon)) return false;
  if (mon < 1 || mon > 12) return false;
  if (year < 2024 || year > current + 1) return false;
  const expectedId = `${year}-${String(mon).padStart(2, '0')}`;
  if (month.id && String(month.id) !== expectedId) return false;
  return true;
}

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS monthly_objectives (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const seeds = defaultSeeds();
  for (const seed of seeds) {
    await query(
      `INSERT INTO monthly_objectives (id, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [seed.id, JSON.stringify(seed)],
    );
  }

  // Repara filas ya creadas sin curva diaria (rompe el calendario)
  // y metas SEMINUEVOS mal parseadas (TAC=75 de Entregas BDC, etc.).
  const existing = await query(`SELECT id, payload FROM monthly_objectives`);
  const byId = Object.fromEntries(seeds.map((seed) => [seed.id, seed]));
  for (const row of existing.rows || []) {
    const seed = byId[row.id];
    if (!seed) continue;
    const daily = row.payload?.daily;
    let repaired = { ...row.payload };
    let dirty = false;
    if ((!Array.isArray(daily) || daily.length === 0) && seed.daily.length > 0) {
      repaired = { ...repaired, daily: seed.daily };
      dirty = true;
    }
    if (
      seed.tacNuevosTarget != null
      && Number(repaired.tacNuevosTarget) !== Number(seed.tacNuevosTarget)
    ) {
      repaired = { ...repaired, tacNuevosTarget: seed.tacNuevosTarget };
      dirty = true;
    }
    if (
      seed.gmfSeminuevosTarget != null
      && (
        repaired.gmfSeminuevosTarget == null
        || Number(repaired.gmfSeminuevosTarget) !== Number(seed.gmfSeminuevosTarget)
      )
    ) {
      repaired = { ...repaired, gmfSeminuevosTarget: seed.gmfSeminuevosTarget };
      dirty = true;
    }
    if (dirty) {
      await query(
        `UPDATE monthly_objectives
         SET payload = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [row.id, JSON.stringify(repaired)],
      );
    }
  }

  ensured = true;
}

async function listMonths() {
  await ensureTable();
  const result = await query(
    `SELECT payload FROM monthly_objectives ORDER BY id DESC`,
  );
  return (result.rows || [])
    .map((row) => row.payload)
    .filter(isPlausibleMonth);
}

async function getMonth(id) {
  await ensureTable();
  const result = await query(
    `SELECT payload FROM monthly_objectives WHERE id = $1 LIMIT 1`,
    [String(id || '')],
  );
  const month = result.rows?.[0]?.payload;
  return isPlausibleMonth(month) ? month : null;
}

async function upsertMonth(month) {
  if (!isPlausibleMonth(month)) {
    const err = new Error('Periodo inválido. Usa un mes/año reciente (p. ej. 2026-09).');
    err.status = 400;
    throw err;
  }
  await ensureTable();
  const id = String(month.id);
  const seed = defaultSeeds().find((item) => item.id === id);
  const daily = Array.isArray(month.daily) && month.daily.length
    ? month.daily
    : (seed?.daily || []);
  const payload = {
    ...month,
    id,
    importedAt: month.importedAt || new Date().toISOString(),
    products: Array.isArray(month.products) ? month.products : cloneProducts(),
    bdc: month.bdc || { ...BDC_DEFAULT },
    daily,
  };
  await query(
    `INSERT INTO monthly_objectives (id, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE
       SET payload = EXCLUDED.payload,
           updated_at = NOW()`,
    [id, JSON.stringify(payload)],
  );
  return payload;
}

async function removeMonth(id) {
  const key = String(id || '');
  if (key === '2026-08' || key === '2026-09') {
    const err = new Error('No se puede eliminar el mes base del catálogo.');
    err.status = 400;
    throw err;
  }
  await ensureTable();
  const result = await query(`DELETE FROM monthly_objectives WHERE id = $1 RETURNING id`, [key]);
  if (!result.rowCount) {
    const err = new Error('Mes no encontrado.');
    err.status = 404;
    throw err;
  }
  return listMonths();
}

function isAdminUser(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'administracion' || role === 'admin' || user?.canManageUsers === true;
}

module.exports = {
  listMonths,
  getMonth,
  upsertMonth,
  removeMonth,
  isPlausibleMonth,
  isAdminUser,
};
