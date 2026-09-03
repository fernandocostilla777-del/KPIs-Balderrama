import type { DailyGoal, MonthlyGoals, ProductGoal } from "./types";

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const MONTH_SHORT: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

function numberAfter(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() || null;
}

function isoDate(day: string, month: string, year: string): string {
  const monthNumber = MONTH_SHORT[month.toLowerCase()] || 1;
  const fullYear = year.length === 2 ? Number(`20${year}`) : Number(year);
  return `${fullYear}-${String(monthNumber).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function parseDaily(text: string): DailyGoal[] {
  const rows: DailyGoal[] = [];
  const pattern =
    /(\d{1,2})-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)-(\d{2,4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/gi;
  for (const match of text.matchAll(pattern)) {
    rows.push({
      fecha: isoDate(match[1], match[2], match[3]),
      trafico: Number(match[4]),
      solicitudes: Number(match[5]),
      facturas: Number(match[6]),
      entregas: Number(match[7]),
    });
  }
  return rows.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function parseProducts(text: string): ProductGoal[] {
  const rows: ProductGoal[] = [];
  let pendingRows: ProductGoal[] = [];
  const ignored = /^(total|día|linea|línea|agosto|marzo|contactos|citas|contratos|ventas)/i;
  const familyTotals = [
    { marker: "Total Pasajeros", family: "Pasajeros" },
    { marker: "Total Suv", family: "SUV's" },
    { marker: "Total Pick", family: "Pick up's" },
    { marker: "Total Van", family: "Van's" },
  ];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const total = familyTotals.find((item) =>
      line.toLocaleLowerCase("es").startsWith(item.marker.toLocaleLowerCase("es")),
    );
    if (total) {
      pendingRows = pendingRows.map((row) => ({ ...row, familia: total.family }));
      rows.push(...pendingRows);
      pendingRows = [];
      continue;
    }

    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (!match || ignored.test(match[1])) continue;
    const name = match[1].trim();
    if (/^\d+$/.test(name)) continue;
    pendingRows.push({
      linea: name,
      familia: "Sin clasificar",
      trafico: Number(match[2]),
      solicitudes: Number(match[3]),
      facturas: Number(match[4]),
      entregas: Number(match[5]),
    });
  }
  rows.push(...pendingRows);
  return rows;
}

function detectPeriod(text: string): { month: number; year: number; label: string } {
  const lowered = text.toLocaleLowerCase("es");
  const monthEntry = Object.entries(MONTHS).find(([name]) => lowered.includes(name));
  const month = monthEntry?.[1] || new Date().getMonth() + 1;
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  const monthName =
    Object.entries(MONTHS).find(([, value]) => value === month)?.[0] || "mes";
  return {
    month,
    year,
    label: `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`,
  };
}

export function parseObjectivesText(text: string, sourceFile: string): MonthlyGoals {
  const normalized = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const period = detectPeriod(normalized);
  const id = `${period.year}-${String(period.month).padStart(2, "0")}`;

  return {
    id,
    label: period.label,
    distribuidor:
      firstMatch(normalized, /\b(\d{3}\s+AUTOMOTRIZ[^\n]+)/i) ||
      "Automotriz Balderrama Puebla",
    month: period.month,
    year: period.year,
    importedAt: new Date().toISOString(),
    sourceFile,
    volumeReference: numberAfter(normalized, /Volumen de Referencia\s+([\d,]+)/i),
    marketShareTarget: numberAfter(normalized, /Market Share Objetivo\s+([\d.]+)%/i),
    estimatedIndustry: numberAfter(normalized, /Industria Estimada\s+([\d,]+)/i),
    invoicesTarget: numberAfter(normalized, /Durante el mes se deben facturar:\s*([\d,]+)/i),
    deliveriesTarget:
      numberAfter(normalized, /TOTAL\s+\d+\s+\d+\s+\d+\s+(\d+)/i) ||
      numberAfter(normalized, /Volumen de Referencia\s+([\d,]+)/i),
    invoiceDeadline: firstMatch(
      normalized,
      /Debe facturar antes de\s+(\d{2}\/\d{2}\/\d{4})/i,
    ),
    carryOverInitial: numberAfter(
      normalized,
      /inicia el mes con un CarryOver de Facturas:\s*([\d,]+)/i,
    ),
    carryOverFinal: numberAfter(
      normalized,
      /Quedando un CarryOver de Facturas:\s*([\d,]+)/i,
    ),
    applicationsTarget: numberAfter(
      normalized,
      /ingreso de solicitudes mínimo de:\s*([\d,]+)/i,
    ),
    gmfContractsTarget: numberAfter(
      normalized,
      /volumen de contratos de:\s*([\d,]+)/i,
    ),
    gmfPenetrationTarget: numberAfter(
      normalized,
      /Penetración para Scorecard de:\s*([\d.]+)%/i,
    ),
    salesPerAdvisor: numberAfter(
      normalized,
      /promedio de\s+([\d.]+)\s+ventas\/asesor/i,
    ),
    accessoriesTarget:
      numberAfter(normalized, /OBJETIVO ACCESORIOS[\s\S]{0,100}?\$?\s*([\d,]+)/i) ||
      numberAfter(normalized, /\$\s*([\d,]+)/i),
    onstarTarget:
      numberAfter(normalized, /TOTAL OnStar\s+([\d,]+)/i) ||
      numberAfter(normalized, /OBJETIVO OnStar[\s\S]{0,40}\s([\d,]+)/i),
    essentialsAnnualPct: numberAfter(
      normalized,
      /Essentials Anual\s*\(([\d.]+)%\)/i,
    ),
    essentialsMultiAnnualPct: numberAfter(
      normalized,
      /Essentials Multianual\s*\(([\d.]+)%\)/i,
    ),
    usedVehiclesPoints: numberAfter(
      normalized,
      /OBJETIVO SEMINUEVOS\s*\(([\d.]+)\s*pts?\)/i,
    ),
    tacNuevosTarget:
      numberAfter(normalized, /TAC\s*Nuevos\s+([\d,]+)/i) ||
      numberAfter(normalized, /([\d,]+)\s*TAC\s*Nuevos/i),
    gmfSeminuevosTarget:
      numberAfter(normalized, /Contratos\s+GMF\s+Seminuevos?\s*:?\s*([\d,]+)/i) ||
      numberAfter(normalized, /([\d,]+)\s*Contratos\s+GMF\s+Seminuevos?/i),
    bdc: {
      contacts: numberAfter(normalized, /Contactos\s+([\d,]+)/i),
      appointmentsScheduled: numberAfter(
        normalized,
        /Citas Agendadas\s+[\d.]+%\s+([\d,]+)/i,
      ),
      appointmentsConfirmed: numberAfter(
        normalized,
        /Citas Confirmadas\s+[\d.]+%\s+([\d,]+)/i,
      ),
      appointmentsCompleted: numberAfter(
        normalized,
        /Citas Cumplidas\s+[\d.]+%\s+([\d,]+)/i,
      ),
      deliveries: numberAfter(normalized, /Entregas BDC\s+[\d.]+%\s+([\d,]+)/i),
    },
    daily: parseDaily(normalized),
    products: parseProducts(normalized),
    rawText: normalized,
  };
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pageText += `${item.str}${item.hasEOL ? "\n" : " "}`;
    }
    pages.push(pageText);
  }
  return pages.join("\n");
}

