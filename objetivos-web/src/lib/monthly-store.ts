import type { MonthlyGoals } from "./types";
import { applyBdcCatalog, applyProductCatalog, AUGUST_2026_SEED } from "./seed";
import { authHeaders } from "./auth";

function normalizeMonth(month: MonthlyGoals): MonthlyGoals {
  const withCatalog = {
    ...month,
    products: applyProductCatalog(month.products),
    bdc: applyBdcCatalog(month.bdc),
  };

  if (withCatalog.id !== AUGUST_2026_SEED.id) return withCatalog;

  return {
    ...AUGUST_2026_SEED,
    ...withCatalog,
    products: applyProductCatalog(withCatalog.products),
    bdc: applyBdcCatalog(withCatalog.bdc),
    tacNuevosTarget: withCatalog.tacNuevosTarget ?? AUGUST_2026_SEED.tacNuevosTarget,
    usedVehiclesPoints: withCatalog.usedVehiclesPoints ?? AUGUST_2026_SEED.usedVehiclesPoints,
    gmfSeminuevosTarget: withCatalog.gmfSeminuevosTarget ?? AUGUST_2026_SEED.gmfSeminuevosTarget,
  };
}

function fallbackMonths(): MonthlyGoals[] {
  return [normalizeMonth({ ...AUGUST_2026_SEED })];
}

/** Carga meses compartidos desde el servidor (backend/data o Postgres en Railway). */
export async function loadMonths(): Promise<MonthlyGoals[]> {
  try {
    const response = await fetch("/backend-api/objetivos-resultados/meses", {
      credentials: "include",
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const months = Array.isArray(data.months) ? (data.months as MonthlyGoals[]) : [];
    const normalized = months.map(normalizeMonth);
    if (!normalized.some((month) => month.id === AUGUST_2026_SEED.id)) {
      normalized.push(normalizeMonth({ ...AUGUST_2026_SEED }));
    }
    return normalized.sort((a, b) => b.id.localeCompare(a.id));
  } catch {
    return fallbackMonths();
  }
}

/** Guarda/actualiza un mes en el servidor (solo admin). */
export async function saveMonth(month: MonthlyGoals): Promise<MonthlyGoals[]> {
  const normalized = normalizeMonth(month);
  const response = await fetch("/backend-api/objetivos-resultados/meses", {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ month: normalized }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `No se pudo guardar el mes (${response.status})`);
  }
  if (Array.isArray(data.months) && data.months.length) {
    return (data.months as MonthlyGoals[]).map(normalizeMonth);
  }
  return loadMonths();
}

export function monthRange(month: MonthlyGoals): { fechaInicio: string; fechaFin: string } {
  const lastDay = new Date(month.year, month.month, 0).getDate();
  const mm = String(month.month).padStart(2, "0");
  return {
    fechaInicio: `${month.year}-${mm}-01`,
    fechaFin: `${month.year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}
