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

/** Bloque 6. OBJETIVO SEMINUEVOS — TAC Nuevos y Contratos GMF (seminuevos). */
function extractSeminuevosBlock(text: string): string {
  // En PDFs GM el orden de extracción suele ser: números → Contratos GMF → … → TAC Nuevos → 6. OBJETIVO SEMINUEVOS
  return (
    text.match(
      /(\d{1,3})\s+(\d{1,3})\s+Contratos\s+GMF[\s\S]{0,800}?TAC\s*Nuevos[\s\S]{0,400}?OBJETIVO\s+SEMINEU[\s\S]{0,200}?(?=OBJETIVO\s+ACCESOR|OBJETIVO\s+OnStar|TOTAL\s+OnStar|8\.\s*OBJETIVO|$)/i,
    )?.[0] ||
    text.match(
      /TAC\s*Nuevos[\s\S]{0,500}?OBJETIVO\s+SEMINEU[\s\S]{0,400}?(?=OBJETIVO\s+ACCESOR|OBJETIVO\s+OnStar|TOTAL\s+OnStar|$)/i,
    )?.[0] ||
    text.match(
      /6\.\s*OBJETIVO\s+SEMINEU[\s\S]{0,800}?(?=5\.\s*OBJETIVO\s+ACCESOR|7\.\s*OBJETIVO\s+OnStar|OBJETIVO\s+ACCESOR|OBJETIVO\s+OnStar|TOTAL\s+OnStar|$)/i,
    )?.[0] ||
    text.match(
      /OBJETIVO\s+SEMINEU[\s\S]{0,800}?(?=OBJETIVO\s+ACCESOR|OBJETIVO\s+OnStar|TOTAL\s+OnStar|$)/i,
    )?.[0] ||
    text
  );
}

function parseTacNuevosTarget(semiBlock: string): number | null {
  // Número después de la etiqueta (preferido)
  const after =
    numberAfter(semiBlock, /TAC\s*Nuevos?\s*:?\s*([\d,]+)/i) ||
    numberAfter(semiBlock, /TAC\s*Nuevos?\s*[\r\n]+\s*([\d,]+)/i);
  if (after != null) return after;

  // Cluster PDF: "TAC  ·  GMF" cerca de Contratos GMF + TAC Nuevos + OBJETIVO SEMINUEVOS
  // Primer número del par = TAC (p. ej. 25), no confundir con Entregas BDC.
  const cluster = semiBlock.match(
    /(\d{1,3})\s+(\d{1,3})\s+Contratos\s+GMF[\s\S]{0,800}?TAC\s*Nuevos/i,
  );
  if (cluster) {
    const tac = Number(cluster[1].replace(/,/g, ""));
    if (Number.isFinite(tac) && tac > 0 && tac < 200) return tac;
  }

  // Número antes de la etiqueta — rechazar si viene de Entregas BDC (p. ej. "75 TAC Nuevos")
  const before = semiBlock.match(/([\d,]+)\s{0,30}TAC\s*Nuevos?/i);
  if (before) {
    const idx = before.index ?? 0;
    const ctx = semiBlock.slice(Math.max(0, idx - 48), idx + before[0].length);
    if (/Entregas\s+BDC|BDC\s+\d|%\s*\d+/i.test(ctx)) return null;
    const value = Number(before[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0 && value < 200) return value;
  }
  return null;
}

/** En el PDF la meta de seminuevos aparece como "Contratos GMF" (sin sufijo). */
function parseGmfSeminuevosTarget(semiBlock: string): number | null {
  // Preferir número explícito junto a la etiqueta (misma línea / siguiente).
  const after =
    numberAfter(semiBlock, /Contratos\s+GMF\s+Seminuevos?\s*:?\s*([\d,]+)/i) ||
    numberAfter(semiBlock, /Contratos\s+GMF\s*:?\s*([\d,]+)/i) ||
    numberAfter(semiBlock, /Contratos\s+GMF\s*[\r\n]+\s*([\d,]+)/i);
  if (after != null && after < 200) return after;

  // No usar el 2º número del cluster "25 23 Contratos GMF": en sept el GMF real es otro (p. ej. 9).
  const before = semiBlock.match(/([\d,]+)\s{0,30}Contratos\s+GMF(?!\s+Nuevos)/i);
  if (before) {
    const idx = before.index ?? 0;
    const ctx = semiBlock.slice(Math.max(0, idx - 48), idx + before[0].length);
    if (/volumen de contratos|Penetraci[oó]n|Scorecard|BDC/i.test(ctx)) return null;
    const value = Number(before[1].replace(/,/g, ""));
    return Number.isFinite(value) && value > 0 && value < 200 ? value : null;
  }
  return null;
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
  const ignored =
    /^(total|día|dia|linea|línea|agosto|marzo|septiembre|octubre|noviembre|diciembre|enero|febrero|abril|mayo|junio|julio|contactos|citas|contratos|ventas|market share|industria|ind\.proy|ms cv|fecha|durante|debe|quedando|deberias|para generar|generando|tomando|tu equipo|el promedio|el distribuidor)/i;
  const familyTotals = [
    { marker: "Total Pasajeros", family: "Pasajeros" },
    { marker: "Total Suv", family: "SUV's" },
    { marker: "Total Pick", family: "Pick up's" },
    { marker: "Total Van", family: "Van's" },
  ];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/\s+/g, " ").trim();
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

    // Quita fecha diaria y acumulados del calendario pegados a la línea de producto.
    line = line.replace(/\b\d{1,2}-[a-z]{3}-\d{2}\b.*$/i, "").trim();
    if (!line || /^\d{1,2}-[a-z]{3}-\d{2}\b/i.test(line)) continue;

    const tokens = line.split(" ");
    let idx = 0;
    while (idx < tokens.length && !/^\d+$/.test(tokens[idx])) idx += 1;
    const name = tokens.slice(0, idx).join(" ").trim();
    if (!name || name.length < 2 || ignored.test(name)) continue;
    if (idx + 4 > tokens.length) continue;
    const nums = tokens.slice(idx, idx + 4).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;

    pendingRows.push({
      linea: name,
      familia: "Sin clasificar",
      trafico: nums[0],
      solicitudes: nums[1],
      facturas: nums[2],
      entregas: nums[3],
    });
  }
  rows.push(...pendingRows);
  return rows;
}

function periodLabel(month: number, year: number): string {
  const monthName =
    Object.entries(MONTHS).find(([, value]) => value === month)?.[0] || "mes";
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
}

function plausibleYear(year: number): boolean {
  const current = new Date().getFullYear();
  return year >= 2020 && year <= current + 1;
}

/** Detecta mes/año desde el nombre del archivo (p. ej. "Objetivos Septiembre 2026.pdf"). */
function detectPeriodFromFilename(sourceFile: string): { month: number; year: number } | null {
  const name = sourceFile
    .replace(/\.[^.]+$/, "")
    .toLocaleLowerCase("es")
    // Normaliza separadores para que "Septiembre_2026_objetivos" sí matchee.
    .replace(/[_\-.]+/g, " ");

  const monthAlt = Object.keys(MONTHS).join("|");
  const shortAlt = "ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic";

  const pair =
    name.match(new RegExp(`\\b(${monthAlt})\\s+(20\\d{2})\\b`)) ||
    name.match(new RegExp(`\\b(${shortAlt})\\s+(20\\d{2})\\b`)) ||
    name.match(/\b(20\d{2})\s+(0?[1-9]|1[0-2])\b/) ||
    name.match(/\b(0?[1-9]|1[0-2])\s+(20\d{2})\b/);

  if (!pair) return null;

  let month: number | undefined;
  let year: number | undefined;

  if (/^20\d{2}$/.test(pair[1])) {
    year = Number(pair[1]);
    month = Number(pair[2]);
  } else if (/^\d{1,2}$/.test(pair[1])) {
    month = Number(pair[1]);
    year = Number(pair[2]);
  } else {
    const token = pair[1].toLowerCase();
    month = MONTHS[token] || MONTH_SHORT[token === "sept" ? "sep" : token];
    year = Number(pair[2]);
  }

  if (!month || !year || month < 1 || month > 12 || !plausibleYear(year)) return null;
  return { month, year };
}

/**
 * Evita el bug de tomar el primer mes/año que aparezca en el PDF
 * (p. ej. "marzo" y "2013" en tablas históricas) cuando el documento es de otro periodo.
 */
function detectPeriod(
  text: string,
  sourceFile = "",
): { month: number; year: number; label: string } {
  const fromFile = detectPeriodFromFilename(sourceFile);
  if (fromFile) {
    return { ...fromFile, label: periodLabel(fromFile.month, fromFile.year) };
  }

  const lowered = text.toLocaleLowerCase("es");
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length);

  // 1) Pares explícitos "septiembre 2026" / "septiembre de 2026"
  const pairMatches = [
    ...lowered.matchAll(
      new RegExp(
        `\\b(${monthNames.join("|")})(?:\\s+de)?\\s+(20\\d{2})\\b`,
        "gi",
      ),
    ),
  ];
  const plausiblePairs = pairMatches
    .map((match) => ({
      month: MONTHS[match[1].toLowerCase()],
      year: Number(match[2]),
      index: match.index ?? 0,
    }))
    .filter((item) => item.month && plausibleYear(item.year));
  if (plausiblePairs.length) {
    // Prefiere el par más reciente en el documento (suele ser el título del mes actual).
    const best = plausiblePairs.sort((a, b) => b.year - a.year || b.index - a.index)[0];
    return { month: best.month, year: best.year, label: periodLabel(best.month, best.year) };
  }

  // 2) Mayoría de fechas del calendario diario del PDF
  const daily = parseDaily(text);
  if (daily.length) {
    const counts = new Map<string, number>();
    for (const row of daily) {
      const key = row.fecha.slice(0, 7); // YYYY-MM
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key)) continue;
      const year = Number(key.slice(0, 4));
      if (!plausibleYear(year)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]));
    if (ranked[0]) {
      const [yearStr, monthStr] = ranked[0][0].split("-");
      const month = Number(monthStr);
      const year = Number(yearStr);
      return { month, year, label: periodLabel(month, year) };
    }
  }

  // 3) Fallback: mes mencionado + año plausible más reciente del texto
  const years = [...text.matchAll(/\b(20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter(plausibleYear);
  const year =
    years.length > 0
      ? Math.max(...years)
      : new Date().getFullYear();

  // Ordenar por longitud evita que "mayo" gane dentro de otra palabra; tomar el último mes del doc.
  let month = new Date().getMonth() + 1;
  let lastIndex = -1;
  for (const name of monthNames) {
    let from = 0;
    while (from < lowered.length) {
      const idx = lowered.indexOf(name, from);
      if (idx < 0) break;
      if (idx >= lastIndex) {
        lastIndex = idx;
        month = MONTHS[name];
      }
      from = idx + name.length;
    }
  }

  return { month, year, label: periodLabel(month, year) };
}

export function parseObjectivesText(text: string, sourceFile: string): MonthlyGoals {
  const normalized = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const period = detectPeriod(normalized, sourceFile);
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
    tacNuevosTarget: parseTacNuevosTarget(extractSeminuevosBlock(normalized)),
    gmfSeminuevosTarget: parseGmfSeminuevosTarget(extractSeminuevosBlock(normalized)),
    bdc: (() => {
      // Acota al bloque OBJETIVO BDC para no tomar "Contactos" de otras secciones.
      const bdcBlock =
        normalized.match(
          /OBJETIVO\s*BDC([\s\S]{0,1200}?)(?=OBJETIVO\s+SEMINEU|OBJETIVO\s+SEMINUEV|OBJETIVO\s+ACCESOR|OBJETIVO\s+OnStar|TOTAL\s+OnStar|$)/i,
        )?.[1] || normalized;
      return {
        contacts: numberAfter(bdcBlock, /Contactos\s+([\d,]+)/i),
        appointmentsScheduled:
          numberAfter(bdcBlock, /Citas\s+Agendadas\s+[\d.]+%\s+([\d,]+)/i) ||
          numberAfter(bdcBlock, /Citas\s+Agendadas\s+([\d,]+)/i),
        appointmentsConfirmed:
          numberAfter(bdcBlock, /Citas\s+Confirmadas\s+[\d.]+%\s+([\d,]+)/i) ||
          numberAfter(bdcBlock, /Citas\s+Confirmadas\s+([\d,]+)/i),
        appointmentsCompleted:
          numberAfter(bdcBlock, /Citas\s+Cumplidas\s+[\d.]+%\s+([\d,]+)/i) ||
          numberAfter(bdcBlock, /Citas\s+Cumplidas\s+([\d,]+)/i),
        deliveries:
          numberAfter(bdcBlock, /Entregas\s+BDC\s+[\d.]+%\s+([\d,]+)/i) ||
          numberAfter(bdcBlock, /Entregas\s+BDC\s+([\d,]+)/i),
      };
    })(),
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

