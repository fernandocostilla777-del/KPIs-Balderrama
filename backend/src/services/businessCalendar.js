/**
 * Calendario de días hábiles (México): fines de semana + días festivos fijos/móviles.
 * Permite overrides por env: SOFIA_NON_WORKING_DATES=YYYY-MM-DD,YYYY-MM-DD
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** N-ésimo día de la semana en un mes (n=1 → primero). weekday: 0=dom … 1=lun */
function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
  const first = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  let day = 1 + ((weekday - first.getDay() + 7) % 7);
  day += (n - 1) * 7;
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function easterSunday(year) {
  // Meeus/Jones/Butcher
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function mexicoHolidaysForYear(year) {
  const easter = easterSunday(year);
  const holyThursday = new Date(easter);
  holyThursday.setDate(easter.getDate() - 3);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);

  return [
    new Date(year, 0, 1, 12, 0, 0, 0), // Año Nuevo
    nthWeekdayOfMonth(year, 1, 1, 1), // Constitución (1er lunes feb)
    nthWeekdayOfMonth(year, 2, 1, 3), // Benito Juárez (3er lunes mar)
    holyThursday,
    goodFriday,
    new Date(year, 4, 1, 12, 0, 0, 0), // Día del Trabajo
    new Date(year, 8, 16, 12, 0, 0, 0), // Independencia
    nthWeekdayOfMonth(year, 10, 1, 3), // Revolución (3er lunes nov)
    new Date(year, 11, 25, 12, 0, 0, 0), // Navidad
  ].map(toIsoDate);
}

function envNonWorkingSet() {
  const raw = String(process.env.SOFIA_NON_WORKING_DATES || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw.split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
  );
}

function isNonWorkingDay(date, { includeEnv = true } = {}) {
  const d = startOfLocalDay(date);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  const iso = toIsoDate(d);
  if (mexicoHolidaysForYear(d.getFullYear()).includes(iso)) return true;
  if (includeEnv && envNonWorkingSet().has(iso)) return true;
  return false;
}

function isBusinessDay(date) {
  return !isNonWorkingDay(date);
}

/** Si `date` es hábil lo devuelve; si no, avanza al siguiente hábil. */
function nextBusinessDayOnOrAfter(date) {
  const d = startOfLocalDay(date);
  while (isNonWorkingDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function lastCalendarDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 12, 0, 0, 0);
}

/**
 * Día en que deben actualizarse en vivo las notificaciones SOFIA del mes:
 * último día calendario; si es inhábil → siguiente día hábil.
 */
function getSofiaLiveUpdateDayForMonth(year, monthIndex) {
  return nextBusinessDayOnOrAfter(lastCalendarDayOfMonth(year, monthIndex));
}

/**
 * Si hoy es el día de actualización en vivo de algún mes reciente, devuelve el contexto.
 * Cubre el caso en que el cierre se mueve a los primeros días del mes siguiente.
 */
function getSofiaLiveUpdateContext(now = new Date()) {
  const today = startOfLocalDay(now);
  for (const monthOffset of [0, -1]) {
    const ref = new Date(today.getFullYear(), today.getMonth() + monthOffset, 15, 12, 0, 0, 0);
    const year = ref.getFullYear();
    const monthIndex = ref.getMonth();
    const liveDay = getSofiaLiveUpdateDayForMonth(year, monthIndex);
    if (!sameCalendarDay(today, liveDay)) continue;

    const periodKey = `${year}-${pad2(monthIndex + 1)}`;
    const lastDay = lastCalendarDayOfMonth(year, monthIndex);
    return {
      active: true,
      today: toIsoDate(today),
      liveDay: toIsoDate(liveDay),
      lastCalendarDay: toIsoDate(lastDay),
      deferredFromNonWorking: !sameCalendarDay(lastDay, liveDay),
      closingYear: year,
      closingMonthIndex: monthIndex,
      periodKey,
      fechaInicio: `${year}-${pad2(monthIndex + 1)}-01`,
      fechaFin: toIsoDate(lastDay),
    };
  }
  return { active: false, today: toIsoDate(today) };
}

module.exports = {
  toIsoDate,
  sameCalendarDay,
  isNonWorkingDay,
  isBusinessDay,
  nextBusinessDayOnOrAfter,
  lastCalendarDayOfMonth,
  getSofiaLiveUpdateDayForMonth,
  getSofiaLiveUpdateContext,
  mexicoHolidaysForYear,
};
