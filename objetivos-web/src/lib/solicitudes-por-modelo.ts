import type { LineResult } from "./types";

type ProductMeta = {
  linea: string;
  familia?: string | null;
  trafico: number;
  solicitudes: number;
  facturas: number;
  entregas: number;
};

type CarlineRow = {
  carline?: string | null;
  total?: number | null;
};

/**
 * Reasigna solicitudes reales por línea sin doble conteo y calcula "Otros"
 * para que líneas + otros = total KPI (solicitudes mínimas real).
 */
export function allocateSolicitudesPorModelo(options: {
  products: ProductMeta[];
  vsMeta: LineResult[];
  porCarline?: CarlineRow[] | null;
  carlinesSinMeta?: CarlineRow[] | null;
  kpiTotal?: number | null;
}): {
  byLinea: Map<string, number>;
  otros: number;
  total: number;
  enLineas: number;
} {
  const {
    products,
    vsMeta,
    porCarline = [],
    carlinesSinMeta = [],
    kpiTotal = null,
  } = options;

  const realByLinea = new Map<string, LineResult>();
  for (const row of vsMeta) {
    if (!row?.linea) continue;
    realByLinea.set(row.linea, row);
    realByLinea.set(String(row.linea).trim().toLowerCase(), row);
  }

  const porCarlineMap = new Map<string, number>();
  for (const row of porCarline || []) {
    const key = String(row.carline || "").trim().toUpperCase();
    if (!key) continue;
    porCarlineMap.set(key, Number(row.total || 0));
  }

  const groups = new Map<string, ProductMeta[]>();
  for (const product of products) {
    const real =
      realByLinea.get(product.linea)
      || realByLinea.get(String(product.linea).trim().toLowerCase());
    const carline = String(real?.carline || "").trim().toUpperCase() || `__LINEA__:${product.linea}`;
    if (!groups.has(carline)) groups.set(carline, []);
    groups.get(carline)!.push(product);
  }

  const byLinea = new Map<string, number>();
  const usedCarlines = new Set<string>();

  for (const [carline, siblings] of groups.entries()) {
    const fromMap = porCarlineMap.has(carline) ? Number(porCarlineMap.get(carline) || 0) : null;
    const fromRows = siblings.reduce((sum, product) => {
      const real =
        realByLinea.get(product.linea)
        || realByLinea.get(String(product.linea).trim().toLowerCase());
      return sum + Number(real?.solicitudesReal || 0);
    }, 0);

    // Si el carline está en porCarline, usamos ese total (evita doble conteo del snapshot viejo).
    // Si no, caemos al valor ya reportado por línea.
    const total = fromMap != null ? fromMap : fromRows;
    if (!carline.startsWith("__LINEA__:")) usedCarlines.add(carline);

    if (siblings.length === 1) {
      byLinea.set(siblings[0].linea, total);
      continue;
    }

    const metaSum = siblings.reduce((a, s) => a + Number(s.solicitudes || 0), 0) || siblings.length;
    let used = 0;
    siblings.forEach((sibling, index) => {
      const weight = Number(sibling.solicitudes || 0) || 1;
      const value = index === siblings.length - 1
        ? Math.max(0, total - used)
        : Math.floor((total * weight) / metaSum);
      used += value;
      byLinea.set(sibling.linea, value);
    });
  }

  let otros = (carlinesSinMeta || []).reduce((a, row) => {
    const key = String(row.carline || "").trim().toUpperCase();
    if (!key || usedCarlines.has(key)) return a;
    return a + Number(row.total || 0);
  }, 0);

  // Incluye carlines del mapa que no cayeron en ninguna línea PDF.
  for (const [key, total] of porCarlineMap.entries()) {
    if (usedCarlines.has(key)) continue;
    // Si ya venía en carlinesSinMeta, no sumar dos veces.
    const already = (carlinesSinMeta || []).some(
      (row) => String(row.carline || "").trim().toUpperCase() === key,
    );
    if (!already) otros += Number(total || 0);
  }

  const enLineas = [...byLinea.values()].reduce((a, n) => a + n, 0);
  let total = enLineas + otros;
  if (kpiTotal != null && Number.isFinite(Number(kpiTotal))) {
    const expected = Number(kpiTotal);
    // Ajusta "Otros" para cerrar exacto contra el KPI cuando hay residual.
    if (expected >= enLineas) {
      otros = expected - enLineas;
      total = expected;
    }
  }

  return { byLinea, otros, total, enLineas };
}
