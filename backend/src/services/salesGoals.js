const fs = require('fs');
const path = require('path');

const GOALS_FILE = path.join(__dirname, '../../data/sales-goals.json');
const HISTORIC_FILE = path.join(__dirname, '../../data/sales-goals-historic.json');

function periodKey(fechaInicio, fechaFin) {
  return `${fechaInicio}_${fechaFin}`;
}

function loadStore() {
  try {
    if (fs.existsSync(GOALS_FILE)) {
      const raw = fs.readFileSync(GOALS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    /* archivo corrupto o ausente */
  }
  return { periods: {} };
}

function loadHistoric() {
  try {
    if (fs.existsSync(HISTORIC_FILE)) {
      const raw = fs.readFileSync(HISTORIC_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.months && typeof parsed.months === 'object') return parsed.months;
    }
  } catch {
    /* sin histórico */
  }
  return {};
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(GOALS_FILE), { recursive: true });
  fs.writeFileSync(GOALS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function parseGoal(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function isFullCalendarMonth(fechaInicio, fechaFin) {
  const start = parseDateOnly(fechaInicio);
  const end = parseDateOnly(fechaFin);
  if (!start || !end) return null;
  if (start.getFullYear() !== end.getFullYear() || start.getMonth() !== end.getMonth()) return null;
  if (start.getDate() !== 1) return null;
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  if (end.getDate() !== lastDay) return null;
  return {
    year: start.getFullYear(),
    month: start.getMonth() + 1,
  };
}

function monthPeriodRange(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return {
    fechaInicio: `${year}-${mm}-01`,
    fechaFin: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function getHistoricForMonth(month) {
  const months = loadHistoric();
  return months[String(month)] || null;
}

function getHistoricCatalog() {
  return loadHistoric();
}

function getGoals({ fechaInicio, fechaFin }) {
  const store = loadStore();
  const key = periodKey(fechaInicio, fechaFin);
  const period = store.periods[key] || {};
  const monthInfo = isFullCalendarMonth(fechaInicio, fechaFin);
  const historic = monthInfo ? getHistoricForMonth(monthInfo.month) : null;

  const retailSaved = period.retail ?? null;
  const sofiaSaved = period.sofia ?? null;

  return {
    fechaInicio,
    fechaFin,
    retail: retailSaved ?? historic?.retail ?? null,
    sofia: sofiaSaved ?? historic?.sofia ?? null,
    updatedAt: period.updatedAt ?? null,
    updatedBy: period.updatedBy ?? null,
    retailSource: retailSaved != null ? 'saved' : (historic ? 'historic' : null),
    sofiaSource: sofiaSaved != null ? 'saved' : (historic ? 'historic' : null),
    historicMonth: historic?.label ?? null,
  };
}

function setGoals({ fechaInicio, fechaFin, retail, sofia, updatedBy }) {
  if (!fechaInicio || !fechaFin) {
    throw new Error('fechaInicio y fechaFin son requeridos.');
  }

  const store = loadStore();
  const key = periodKey(fechaInicio, fechaFin);
  const prev = store.periods[key] || {};
  const next = {
    ...prev,
    updatedAt: new Date().toISOString(),
  };

  if (retail !== undefined) next.retail = parseGoal(retail);
  if (sofia !== undefined) next.sofia = parseGoal(sofia);
  if (updatedBy) next.updatedBy = String(updatedBy);

  store.periods[key] = next;
  saveStore(store);
  return getGoals({ fechaInicio, fechaFin });
}

/** Precarga objetivos históricos en el almacén compartido (solo periodos mensuales sin valor guardado). */
function seedHistoricGoals(year = 2026) {
  const store = loadStore();
  const months = loadHistoric();
  let changed = false;

  for (const [monthStr, entry] of Object.entries(months)) {
    const month = Number(monthStr);
    if (!month || !entry) continue;
    const { fechaInicio, fechaFin } = monthPeriodRange(year, month);
    const key = periodKey(fechaInicio, fechaFin);
    const prev = store.periods[key] ? { ...store.periods[key] } : {};
    let periodChanged = false;

    if (prev.retail == null && entry.retail > 0) {
      prev.retail = entry.retail;
      periodChanged = true;
    }
    if (prev.sofia == null && entry.sofia > 0) {
      prev.sofia = entry.sofia;
      periodChanged = true;
    }
    if (periodChanged) {
      prev.updatedAt = new Date().toISOString();
      prev.seededFrom = 'historic';
      store.periods[key] = prev;
      changed = true;
    }
  }

  if (changed) saveStore(store);
  return store;
}

seedHistoricGoals(2026);

module.exports = {
  getGoals,
  setGoals,
  getHistoricCatalog,
  isFullCalendarMonth,
  seedHistoricGoals,
};
