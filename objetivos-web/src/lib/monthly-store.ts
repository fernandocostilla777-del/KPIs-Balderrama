import { AUGUST_2026_SEED } from "./seed";
import type { MonthlyGoals } from "./types";

/** Sube de versión para invalidar metas viejas en el navegador (p. ej. GMF Seminuevos 26 → 10). */
const STORAGE_KEY = "balderrama-monthly-objectives-v2";

function normalizeMonth(month: MonthlyGoals): MonthlyGoals {
  if (month.id !== AUGUST_2026_SEED.id) return month;
  return {
    ...AUGUST_2026_SEED,
    ...month,
    tacNuevosTarget: month.tacNuevosTarget ?? AUGUST_2026_SEED.tacNuevosTarget,
    usedVehiclesPoints: month.usedVehiclesPoints ?? AUGUST_2026_SEED.usedVehiclesPoints,
    // Meta corregida: siempre 10 para Agosto 2026 (no dejar 26 del PDF/caché).
    gmfSeminuevosTarget: AUGUST_2026_SEED.gmfSeminuevosTarget,
  };
}

function persist(months: MonthlyGoals[]): MonthlyGoals[] {
  const sorted = [...months].sort((a, b) => b.id.localeCompare(a.id));
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    // Limpia la clave anterior para no volver a leer el 26.
    localStorage.removeItem("balderrama-monthly-objectives-v1");
  }
  return sorted;
}

export function loadMonths(): MonthlyGoals[] {
  if (typeof window === "undefined") return [AUGUST_2026_SEED];
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY)
      || localStorage.getItem("balderrama-monthly-objectives-v1")
      || "[]";
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      const months = (parsed as MonthlyGoals[]).map(normalizeMonth);
      if (!months.some((month) => month.id === AUGUST_2026_SEED.id)) {
        months.push(AUGUST_2026_SEED);
      }
      return persist(months);
    }
  } catch {
    // Recupera la plantilla conocida si el almacenamiento local se dañó.
  }
  return persist([AUGUST_2026_SEED]);
}

export function saveMonth(month: MonthlyGoals): MonthlyGoals[] {
  const normalized = normalizeMonth(month);
  const months = loadMonths().filter((item) => item.id !== normalized.id);
  months.push(normalized);
  return persist(months);
}

export function removeMonth(id: string): MonthlyGoals[] {
  const months = loadMonths().filter(
    (item) => item.id !== id || item.id === AUGUST_2026_SEED.id,
  );
  return persist(months);
}

export function monthRange(month: MonthlyGoals): { fechaInicio: string; fechaFin: string } {
  const lastDay = new Date(month.year, month.month, 0).getDate();
  const mm = String(month.month).padStart(2, "0");
  return {
    fechaInicio: `${month.year}-${mm}-01`,
    fechaFin: `${month.year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}
