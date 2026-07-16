function pad2(n) {
  return String(n).padStart(2, '0');
}

function getCurrentMonthRange(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return {
    periodKey: `${y}-${pad2(m + 1)}`,
    fechaInicio: `${y}-${pad2(m + 1)}-01`,
    fechaFin: `${y}-${pad2(m + 1)}-${pad2(lastDay)}`,
  };
}

function getMonthRangeForKey(periodKey) {
  const [y, m] = String(periodKey).split('-').map(Number);
  if (!y || !m) throw new Error(`periodKey inválido: ${periodKey}`);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    periodKey,
    fechaInicio: `${y}-${pad2(m)}-01`,
    fechaFin: `${y}-${pad2(m)}-${pad2(lastDay)}`,
  };
}

function serializeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function chunkArray(items, size = 400) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

module.exports = {
  getCurrentMonthRange,
  getMonthRangeForKey,
  serializeRow,
  chunkArray,
};
