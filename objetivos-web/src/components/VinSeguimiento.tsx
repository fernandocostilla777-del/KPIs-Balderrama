"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authHeaders } from "@/lib/auth";

type FilterId = "all" | "pedido" | "piso" | "factura" | "alerta";
type Flag = "cumple" | "pendiente" | "alerta" | "sindato" | "na";

type PreviaDetalle = {
  orden: string;
  fecha: string;
  status: string;
};

type GastosDesglose = {
  previa: number;
  publicidad: number;
  entrega: number;
  gasolina: number;
  gasolinaLitros: number;
  gasolinaPrecioLitro: number;
  gastosLibro: number;
  total: number;
};

type FloatFocus = "resumen" | "gastos" | "previas" | "piso" | "cierre" | "fi" | "peps";

const FLOAT_TITLE: Record<FloatFocus, string> = {
  resumen: "Resumen de unidad",
  gastos: "Gastos",
  previas: "Previas",
  piso: "Plan piso",
  cierre: "Detalle de venta",
  fi: "Ingresos F&I",
  peps: "Referencia PEPS",
};

type FiDetalle = { concepto: string; monto: number; count: number };

type CierreCampos = {
  version: string;
  subtotal: number | null;
  isan: number;
  costo: number | null;
  bonificacion: number;
  notaCargo: number;
  notaCargoFolio: string;
  utilidadBruta: number | null;
  comisionEv: number;
  comisionEvPct: number | null;
  comisionEvPctLeasing: number | null;
  comisionEvUnidadesPrev: number;
  comisionEvMesPrev: string;
  comisionEvArrendamiento: boolean;
  utilidadNeta: number | null;
  ingresoFinanciamiento: number | null;
  ingresoFinanciamientoCount: number;
  ingresoFinanciamientoDetalle: FiDetalle[];
  daysChargeable: number;
  vendedor: string;
  cliente: string;
  tipoVenta: string;
  formaPago: string;
  isFlotilla: boolean;
  isDemo: boolean;
  demoHint: string;
  fechaVenta: string;
  fechaRemision: string;
};

type PipeRow = {
  vin: string;
  carline: string;
  paquete: string;
  unidad: string;
  modelo: string;
  situacion: string;
  stage: number;
  days: number | null;
  previas: number | null;
  previasDetalle: PreviaDetalle[];
  apartada: boolean;
  /** Días desde VEH_FECHSEP (solo SEP). */
  daysApartado: number | null;
  fechaApartado: string;
  apartadoPor: string;
  costo: number;
  gastos: number;
  gastosDesglose: GastosDesglose;
  /** Intereses de Plan Piso del mes seleccionado. */
  piso: number;
  /** Intereses acumulados a hoy (o a la venta). */
  pisoAcumulado: number;
  factura: string;
  fecha: string;
  colorExterior: string;
  colorInterior: string;
  peps: Flag;
  /** VIN más antiguo disponible del mismo modelo (alerta PEPS). */
  pepsRefVin: string;
  pepsRefDays: number | null;
  pepsRefUnidad: string;
  pepsRefColorExterior: string;
  pepsRefColorInterior: string;
  cierre: CierreCampos | null;
};

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "pedido", label: "Pedido" },
  { id: "piso", label: "En piso" },
  { id: "factura", label: "Facturadas" },
  { id: "alerta", label: "Con alerta" },
];

const FLAG_LABEL: Record<Flag, string> = {
  cumple: "Cumple",
  pendiente: "Pendiente",
  alerta: "Alerta",
  sindato: "Sin dato",
  na: "No aplica",
};

const PREVIA_STATUS: Record<string, string> = {
  A: "Abierta",
  T: "En proceso",
  D: "Diagnóstico",
  P: "Presupuesto",
  I: "Facturada",
  C: "Cancelada",
};

function previaStatusLabel(status: string) {
  const key = String(status || "").toUpperCase();
  return PREVIA_STATUS[key] || (key || "Sin estatus");
}

function parsePreviasDetalle(raw: unknown): PreviaDetalle[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => ({
        orden: String((item as PreviaDetalle)?.orden || "").trim(),
        fecha: String((item as PreviaDetalle)?.fecha || "").trim(),
        status: String((item as PreviaDetalle)?.status || "").trim().toUpperCase(),
      }))
      .filter((item) => item.orden);
  }
  return String(raw || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [orden = "", fecha = "", status = ""] = part.split("·");
      return {
        orden: orden.trim(),
        fecha: fecha.trim(),
        status: status.trim().toUpperCase(),
      };
    })
    .filter((item) => item.orden);
}

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function stageOf(situacion: string) {
  const s = String(situacion || "").toUpperCase();
  if (s === "PED") return 0;
  if (s === "PEN" || s === "TRAN") return 1;
  if (s === "VEN") return 4;
  if (s === "FIS" || s === "DIS" || s === "SEP" || s === "DEMO") return 3;
  return 2;
}

function stageLabel(stage: number, situacion: string) {
  const s = String(situacion || "").toUpperCase();
  if (stage === 0) return "Pedido a planta";
  if (stage === 1) return s === "TRAN" ? "Tránsito" : "Pendiente";
  if (s === "SEP") return "Apartada";
  if (s === "DEMO") return "Demo";
  if (s === "DIS") return "Disponible";
  if (s === "FIS") return "Físico";
  if (stage === 4) return "Facturada";
  return "Recibido";
}

/** Disponible vs apartada (y resto de estatus de piso/pedido). */
function disponibilidadOf(row: { situacion: string; apartada: boolean; stage: number }) {
  const s = String(row.situacion || "").toUpperCase();
  if (row.apartada || s === "SEP") return { label: "Apartada", kind: "apartada" as const };
  if (s === "DIS" || s === "FIS") return { label: "Disponible", kind: "disponible" as const };
  if (row.stage === 4) return { label: "Facturada", kind: "otra" as const };
  return { label: stageLabel(row.stage, row.situacion), kind: "otra" as const };
}

function monthRange(year: number, month: number) {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  return {
    fechaInicio: `${year}-${mm}-01`,
    fechaFin: `${year}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

function formatMoney(value: number) {
  return value ? money.format(value) : "—";
}

const PLAN_PISO_FACTOR = 0.00020778;
const PLAN_PISO_DIAS_GRACIA = 30;

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function daysInclusive(start: Date, end: Date) {
  const s = startOfDay(start);
  const e = startOfDay(end);
  if (e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function parseFechaLocal(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parts = text.split(/[/-]/);
  if (parts.length === 3) {
    let day: number;
    let month: number;
    let year: number;
    if (parts[0].length === 4) {
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    } else {
      day = Number(parts[0]);
      month = Number(parts[1]);
      year = Number(parts[2]);
    }
    if (day && month && year) {
      const date = new Date(year, month - 1, day, 12, 0, 0);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : startOfDay(fallback);
}

function calcPlanPisoUntil(importeRemision: number, remisionDate: Date | null, cutoffDate: Date | null) {
  if (!remisionDate || !cutoffDate) return 0;
  const remision = startOfDay(remisionDate);
  const cutoff = startOfDay(cutoffDate);
  if (cutoff < remision) return 0;
  const interestStart = addDays(remision, PLAN_PISO_DIAS_GRACIA + 1);
  if (interestStart > cutoff) return 0;
  const daysChargeable = daysInclusive(interestStart, cutoff);
  const intereses = PLAN_PISO_FACTOR * (Number(importeRemision) || 0) * daysChargeable;
  return Math.round(intereses * 100) / 100;
}

/** Intereses del mes (delta) y acumulado a la fecha de corte. */
function calcPlanPisoMontos(opts: {
  importeRemision: number;
  fechaRemision: unknown;
  year: number;
  month: number;
  fechaCorte?: unknown;
}) {
  const remision = parseFechaLocal(opts.fechaRemision);
  const today = startOfDay(new Date());
  const monthEnd = new Date(opts.year, opts.month, 0, 12, 0, 0);
  const prevMonthEnd = new Date(opts.year, opts.month - 1, 0, 12, 0, 0);
  const hardCutoff = parseFechaLocal(opts.fechaCorte);
  const cutoffAcum = hardCutoff && hardCutoff < today ? hardCutoff : today;
  const cutoffMes = (() => {
    let c = monthEnd < today ? monthEnd : today;
    if (hardCutoff && hardCutoff < c) c = hardCutoff;
    return c;
  })();
  const acumuladoMes = calcPlanPisoUntil(opts.importeRemision, remision, cutoffMes);
  const acumuladoPrev = calcPlanPisoUntil(opts.importeRemision, remision, prevMonthEnd);
  return {
    mensual: Math.max(0, Math.round((acumuladoMes - acumuladoPrev) * 100) / 100),
    acumulado: calcPlanPisoUntil(opts.importeRemision, remision, cutoffAcum),
  };
}

const COSTO_PREVIA = 1669;
const COSTO_PUBLICIDAD = 641.89;
const CARGO_ENTREGA_CHICO = 240;
const CARGO_ENTREGA_GRANDE = 315;
const ENTREGA_MODELOS_CHICOS = ["AVEO", "ONIX", "TORNADO", "GROOVE"];
const GASOLINA_PRECIO_LITRO = 23.39;
const GASOLINA_POR_MODELO: Array<{ key: string; litros: number }> = [
  { key: "CAPTIVA PHEV", litros: 15 },
  { key: "SILVERADO 2500", litros: 25 },
  { key: "EXPRESS VAN", litros: 20 },
  { key: "EXPRESS", litros: 20 },
  { key: "SUBURBAN", litros: 25 },
  { key: "SILVERADO", litros: 25 },
  { key: "CHEYENNE", litros: 25 },
  { key: "TAHOE", litros: 25 },
  { key: "TRAVERSE", litros: 20 },
  { key: "COLORADO", litros: 20 },
  { key: "BLAZER", litros: 20 },
  { key: "BLAIZER", litros: 20 },
  { key: "CAPTIVA", litros: 15 },
  { key: "TRACKER", litros: 15 },
  { key: "TRAX", litros: 15 },
  { key: "CAVALIER", litros: 13 },
  { key: "MONTANA", litros: 13 },
  { key: "TORNADO", litros: 13 },
  { key: "GROOVE", litros: 13 },
  { key: "AVEO", litros: 13 },
  { key: "S10", litros: 18 },
  { key: "S 10", litros: 18 },
  { key: "ONIX", litros: 10 },
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizeMatchKey(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

function buildGastosDesglose(
  carline: string,
  version: string,
  gastosLibroRaw: number,
  fromApi?: Partial<Record<string, unknown>>,
): GastosDesglose {
  if (fromApi && (fromApi.costoPrevia != null || fromApi.gastosAdicionales != null)) {
    const gasolina = Number(fromApi.costoGasolina || 0);
    const previa = Number(fromApi.costoPrevia || COSTO_PREVIA);
    const publicidad = Number(fromApi.costoPublicidad || fromApi.costoMercadotecnia || COSTO_PUBLICIDAD);
    const entrega = Number(fromApi.costoEntrega || 0);
    const gastosLibro = Number(fromApi.gastos || gastosLibroRaw || 0);
    const total = Number(fromApi.gastosAdicionales || 0)
      || round2(previa + publicidad + entrega + gasolina + Math.abs(gastosLibro));
    return {
      previa,
      publicidad,
      entrega,
      gasolina,
      gasolinaLitros: Number(fromApi.gasolinaLitros || 0),
      gasolinaPrecioLitro: Number(fromApi.gasolinaPrecioLitro || GASOLINA_PRECIO_LITRO),
      gastosLibro: Math.abs(gastosLibro),
      total,
    };
  }

  const hay = normalizeMatchKey(`${carline || ""} ${version || ""}`);
  const esChico = ENTREGA_MODELOS_CHICOS.some((key) => hay.includes(key));
  const entrega = esChico ? CARGO_ENTREGA_CHICO : CARGO_ENTREGA_GRANDE;
  const found = [...GASOLINA_POR_MODELO]
    .sort((a, b) => b.key.length - a.key.length)
    .find((row) => hay.includes(row.key));
  const litros = found?.litros || 0;
  const gasolina = round2(litros * GASOLINA_PRECIO_LITRO);
  const gastosLibro = Math.abs(Number(gastosLibroRaw) || 0);
  return {
    previa: COSTO_PREVIA,
    publicidad: COSTO_PUBLICIDAD,
    entrega,
    gasolina,
    gasolinaLitros: litros,
    gasolinaPrecioLitro: GASOLINA_PRECIO_LITRO,
    gastosLibro,
    total: round2(COSTO_PREVIA + COSTO_PUBLICIDAD + entrega + gasolina + gastosLibro),
  };
}

function mapCierreCampos(r: Record<string, unknown>): CierreCampos {
  const detalle = Array.isArray(r.ingresoFinanciamientoDetalle)
    ? (r.ingresoFinanciamientoDetalle as Array<Record<string, unknown>>).map((d) => ({
      concepto: String(d.concepto || "PAGO GMF"),
      monto: Number(d.monto || 0) || 0,
      count: Number(d.count || 0) || 0,
    }))
    : [];
  return {
    version: String(r.version || "").trim(),
    subtotal: r.precio == null ? null : Number(r.precio),
    isan: Number(r.isan || 0) || 0,
    costo: r.costo == null ? null : Number(r.costo),
    bonificacion: Number(r.bonificacion || 0) || 0,
    notaCargo: Number(r.notaCargo || 0) || 0,
    notaCargoFolio: String(r.notaCargoFolio || "").trim(),
    utilidadBruta: r.utilidadPromedio == null ? null : Number(r.utilidadPromedio),
    comisionEv: Number(r.comisionEv || 0) || 0,
    comisionEvPct: r.comisionEvPct == null ? null : Number(r.comisionEvPct),
    comisionEvPctLeasing: r.comisionEvPctLeasing == null ? null : Number(r.comisionEvPctLeasing),
    comisionEvUnidadesPrev: Number(r.comisionEvUnidadesPrev || 0) || 0,
    comisionEvMesPrev: String(r.comisionEvMesPrev || "mes ant.").trim(),
    comisionEvArrendamiento: Boolean(r.comisionEvArrendamiento),
    utilidadNeta: r.utilidadNeta == null ? null : Number(r.utilidadNeta),
    ingresoFinanciamiento: r.ingresoFinanciamiento == null ? null : Number(r.ingresoFinanciamiento),
    ingresoFinanciamientoCount: Number(r.ingresoFinanciamientoCount || 0) || 0,
    ingresoFinanciamientoDetalle: detalle,
    daysChargeable: Number(r.daysChargeable || 0) || 0,
    vendedor: String(r.vendedor || "").trim(),
    cliente: String(r.cliente || "").trim(),
    tipoVenta: String(r.tipoVenta || "").trim(),
    formaPago: String(r.formaPago || "").trim(),
    isFlotilla: Boolean(r.isFlotilla),
    isDemo: Boolean(r.isDemo),
    demoHint: String(r.demoHint || "").trim(),
    fechaVenta: String(r.fechaVenta || "").trim(),
    fechaRemision: String(r.fechaRemision || "").trim(),
  };
}

function costoNetoConBonif(c: CierreCampos) {
  if (c.costo == null && !c.bonificacion) return null;
  return round2(Number(c.costo || 0) - Number(c.bonificacion || 0));
}

function notaCreditoSinIva(c: CierreCampos) {
  return c.notaCargo > 0 ? round2(c.notaCargo / 1.16) : 0;
}

function pctRetencion(bruta: number | null, neta: number | null) {
  if (bruta == null || !Number(bruta)) return null;
  if (neta == null) return null;
  return Math.round((Number(neta) / Number(bruta)) * 1000) / 10;
}

function fmtPct(pct: number | null) {
  if (pct == null) return "—";
  return `${pct.toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
}

function fmtDateShort(iso: string) {
  if (!iso) return "—";
  const text = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [y, m, d] = text.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${dmy[3]}`;
  }
  return text;
}

function paqueteDe(version: string, explicito?: string) {
  const text = String(version || "").toUpperCase().trim();
  if (text) {
    // DMS: PAQ "B" | PAQ."A" | "PAQ" A | … "C"
    const tagged = text.match(
      /(?:PAQ(?:UETE)?|PKG|MOD(?:ELO)?)\s*[."'`]?\s*["'`]?\s*([A-Z])\b/,
    );
    if (tagged) return tagged[1];
    const parts = text
      .replace(/["'`]/g, " ")
      .split(/[\s/_\-,.]+/)
      .filter(Boolean)
      .filter((part) => !/^(MY)?20\d{2}$/.test(part) && !/^\d+$/.test(part));
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (/^[A-Z]$/.test(parts[i])) return parts[i];
    }
  }
  const given = String(explicito || "").trim().toUpperCase();
  return /^[A-Z]$/.test(given) ? given : "";
}

function etiquetaUnidad(carline: string, paquete: string) {
  const linea = carline || "Sin carline";
  return paquete ? `${linea} · ${paquete}` : linea;
}

function previaFlag(row: PipeRow): Flag {
  if (row.stage < 3) return "pendiente";
  if (row.previas == null) return "sindato";
  return row.previas > 0 ? "cumple" : "alerta";
}

function antiguedadFlag(row: PipeRow): Flag {
  if (row.stage < 3 || row.stage === 4) return "na";
  if (row.days == null) return "sindato";
  return row.days >= 60 ? "alerta" : "cumple";
}

function hasAlert(row: PipeRow) {
  return row.peps === "alerta" || previaFlag(row) === "alerta" || antiguedadFlag(row) === "alerta";
}

function FlagCell({ flag }: { flag: Flag }) {
  return <span className={`vin-flag vin-flag--${flag}`}>{FLAG_LABEL[flag]}</span>;
}

function PreviaFlagButton({
  row,
  onOpen,
}: {
  row: PipeRow;
  onOpen: () => void;
}) {
  const flag = previaFlag(row);
  if (flag !== "cumple") {
    return <FlagCell flag={flag} />;
  }
  return (
    <button
      type="button"
      className="vin-flag vin-flag--cumple vin-flag-btn"
      title="Ver detalle de previas"
      onClick={onOpen}
    >
      {FLAG_LABEL.cumple}
    </button>
  );
}

function applyPeps(rows: PipeRow[]) {
  const oldestAvailable = new Map<string, {
    days: number;
    vin: string;
    unidad: string;
    colorExterior: string;
    colorInterior: string;
  }>();
  rows.forEach((row) => {
    if (row.apartada || row.stage !== 3 || row.days == null) return;
    if (!["FIS", "DIS"].includes(row.situacion)) return;
    const key = row.modelo || row.unidad;
    const current = oldestAvailable.get(key);
    if (current == null || row.days > current.days) {
      oldestAvailable.set(key, {
        days: row.days,
        vin: row.vin,
        unidad: row.unidad,
        colorExterior: row.colorExterior,
        colorInterior: row.colorInterior,
      });
    }
  });
  rows.forEach((row) => {
    row.pepsRefVin = "";
    row.pepsRefDays = null;
    row.pepsRefUnidad = "";
    row.pepsRefColorExterior = "";
    row.pepsRefColorInterior = "";
    if (!row.apartada) {
      row.peps = "na";
      return;
    }
    const oldest = oldestAvailable.get(row.modelo || row.unidad);
    if (oldest == null || row.days == null) {
      row.peps = "cumple";
      return;
    }
    if (row.days + 1 < oldest.days) {
      row.peps = "alerta";
      row.pepsRefVin = oldest.vin;
      row.pepsRefDays = oldest.days;
      row.pepsRefUnidad = oldest.unidad;
      row.pepsRefColorExterior = oldest.colorExterior;
      row.pepsRefColorInterior = oldest.colorInterior;
    } else {
      row.peps = "cumple";
    }
  });
}

export function VinSeguimiento({ year, month }: { year: number; month: number }) {
  const [rows, setRows] = useState<PipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [selectedVin, setSelectedVin] = useState<string | null>(null);
  const [floatFocus, setFloatFocus] = useState<FloatFocus>("resumen");

  const openVin = (vin: string, focus: FloatFocus = "resumen") => {
    setFloatFocus(focus);
    setSelectedVin(vin.toUpperCase());
  };

  useEffect(() => {
    let cancelled = false;
    const range = monthRange(year, month);
    setLoading(true);
    setError(null);

    const fetchOnce = async (url: string) => {
      try {
        return await fetch(url, {
          headers: authHeaders(),
          credentials: "include",
          cache: "no-store",
        });
      } catch (err) {
        await new Promise((r) => window.setTimeout(r, 800));
        return fetch(url, {
          headers: authHeaders(),
          credentials: "include",
          cache: "no-store",
        });
      }
    };

    Promise.all([
      fetchOnce("/backend-api/inventory"),
      fetchOnce(
        `/backend-api/inventory/vendidos?fechaInicio=${range.fechaInicio}&fechaFin=${range.fechaFin}`,
      ),
    ])
      .then(async ([invRes, venRes]) => {
        if (!invRes.ok && !venRes.ok) {
          if (invRes.status === 401 || venRes.status === 401) {
            throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
          }
          if ([500, 502, 504].includes(invRes.status) || [500, 502, 504].includes(venRes.status)) {
            throw new Error("El backend local no respondió a tiempo (:3000). Reintenta en unos segundos.");
          }
          throw new Error(`No se pudo leer el inventario (HTTP ${invRes.status}).`);
        }
        if (invRes.status === 401) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");

        const warnings: string[] = [];
        const inv = invRes.ok
          ? await invRes.json()
          : (warnings.push("Inventario en piso incompleto."), { inventoryTable: [], ageingSlowTable: [] });
        const ven = venRes.ok
          ? await venRes.json()
          : (warnings.push("Vendidos del mes incompletos."), { vendidosTable: [] });
        const ageingByVin = new Map<string, Record<string, unknown>>();
        for (const item of inv.ageingSlowTable || []) {
          const vin = String(item.vin || "").trim().toUpperCase();
          if (vin) ageingByVin.set(vin, item);
        }
        const stock: PipeRow[] = (inv.inventoryTable || [])
          .filter((u: Record<string, unknown>) => String(u.situacion || "").toUpperCase() !== "DEMO")
          .map((u: Record<string, unknown>) => {
          const carline = String(u.familia || "").trim();
          const paquete = paqueteDe(String(u.tipoAuto || ""));
          const vin = String(u.serie || "").trim();
          const importe = Number(u.importeRemision || u.miCosto || 0);
          const pisoMontos = calcPlanPisoMontos({
            importeRemision: importe,
            fechaRemision: u.fechaRemision || u.remisionDate,
            year,
            month,
          });
          const gastosDesglose = buildGastosDesglose(
            carline,
            String(u.tipoAuto || ""),
            Number(u.gastos || 0),
            ageingByVin.get(vin.toUpperCase()),
          );
          return {
          vin,
          carline,
          paquete,
          unidad: etiquetaUnidad(carline, paquete),
          modelo: `${carline}||${paquete}`,
          situacion: String(u.situacion || ""),
          stage: stageOf(String(u.situacion || "")),
          days: u.daysInStock == null ? null : Number(u.daysInStock),
          previas: Number(u.previas || 0),
          previasDetalle: parsePreviasDetalle(u.previasDetalle),
          apartada: String(u.situacion || "").toUpperCase() === "SEP" || u.isApartada === true,
          daysApartado: u.daysApartado == null ? null : Number(u.daysApartado),
          fechaApartado: String(u.fechaApartado || "").trim(),
          apartadoPor: String(u.apartadoPor || u.usuarioApartado || "").trim(),
          costo: Number(u.miCosto || u.importeRemision || 0),
          gastos: gastosDesglose.total,
          gastosDesglose,
          piso: pisoMontos.mensual,
          pisoAcumulado: pisoMontos.acumulado,
          factura: "",
          fecha: String(u.fechaRemision || ""),
          colorExterior: String(u.colorExterior || "").trim(),
          colorInterior: String(u.colorInterior || "").trim(),
          peps: "na" as Flag,
          pepsRefVin: "",
          pepsRefDays: null,
          pepsRefUnidad: "",
          pepsRefColorExterior: "",
          pepsRefColorInterior: "",
          cierre: null,
        };
        });
        const sold: PipeRow[] = (ven.vendidosTable || [])
          .filter((r: Record<string, unknown>) => r.isDemo !== true)
          .map((r: Record<string, unknown>) => {
          const carline = String(r.carline || "").trim();
          const paquete = paqueteDe(String(r.version || ""), String(r.paquete || ""));
          const importe = Number(r.importeRemision || r.costo || 0);
          const pisoMontos = calcPlanPisoMontos({
            importeRemision: importe,
            fechaRemision: r.fechaRemision,
            year,
            month,
            fechaCorte: r.fechaVenta || r.fechaRemision,
          });
          const gastosDesglose = buildGastosDesglose(
            carline,
            String(r.version || ""),
            Number(r.gastos || 0),
            r,
          );
          const cierre = mapCierreCampos(r);
          return {
          vin: String(r.vin || "").trim(),
          carline,
          paquete,
          unidad: etiquetaUnidad(carline, paquete),
          modelo: `${carline}||${paquete}`,
          situacion: "VEN",
          stage: 4,
          days: r.daysInStock == null ? null : Number(r.daysInStock),
          previas: Number(r.previas || 0),
          previasDetalle: parsePreviasDetalle(r.previasDetalle),
          apartada: false,
          daysApartado: null,
          fechaApartado: "",
          apartadoPor: "",
          costo: Number(r.costo || 0),
          gastos: Number(r.gastosAdicionales || 0) || gastosDesglose.total,
          gastosDesglose,
          piso: pisoMontos.mensual,
          pisoAcumulado: Number(r.planPisoAcumulado || 0) || pisoMontos.acumulado,
          factura: String(r.factura || "").trim(),
          fecha: String(r.fechaVenta || r.fechaRemision || ""),
          colorExterior: "",
          colorInterior: "",
          peps: "na" as Flag,
          pepsRefVin: "",
          pepsRefDays: null,
          pepsRefUnidad: "",
          pepsRefColorExterior: "",
          pepsRefColorInterior: "",
          cierre,
        };
        });
        const byVin = new Map<string, PipeRow>();
        stock.forEach((row) => { if (row.vin) byVin.set(row.vin.toUpperCase(), row); });
        sold.forEach((row) => {
          if (!row.vin) return;
          const prev = byVin.get(row.vin.toUpperCase());
          if (prev) {
            row.colorExterior = prev.colorExterior;
            row.colorInterior = prev.colorInterior;
            if (!row.paquete) row.paquete = prev.paquete;
            if (!row.carline) row.carline = prev.carline;
            if (prev.previasDetalle.length) {
              const seen = new Set(row.previasDetalle.map((d) => d.orden));
              for (const item of prev.previasDetalle) {
                if (!seen.has(item.orden)) row.previasDetalle.push(item);
              }
            }
            if ((row.previas || 0) < (prev.previas || 0)) row.previas = prev.previas;
            if ((row.previas || 0) < row.previasDetalle.length) {
              row.previas = row.previasDetalle.length;
            }
            if (!row.pisoAcumulado && prev.pisoAcumulado) row.pisoAcumulado = prev.pisoAcumulado;
            if (!row.piso && prev.piso) row.piso = prev.piso;
            row.unidad = etiquetaUnidad(row.carline, row.paquete);
            row.modelo = `${row.carline}||${row.paquete}`;
          }
          byVin.set(row.vin.toUpperCase(), row);
        });
        const list = [...byVin.values()];
        applyPeps(list);
        if (!cancelled) {
          setRows(list);
          setError(warnings.length ? warnings.join(" ") : null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          const msg = String(err?.message || "");
          if (/failed to fetch|network|ECONNREFUSED|socket hang up/i.test(msg)) {
            setError("No hay conexión con el backend local (:3000). Arranca la API e intenta de nuevo.");
          } else {
            setError(msg || "No se pudo cargar el expediente.");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [year, month]);

  const summary = useMemo(() => {
    const stock = rows.filter((row) => row.stage !== 4);
    const disponible = stock.filter((row) => ["FIS", "DIS", "SEP"].includes(row.situacion)).length;
    const enPiso = stock.filter((row) => row.stage === 3);
    const conPrevia = enPiso.filter((row) => (row.previas || 0) > 0).length;
    const viejas = enPiso.filter((row) => (row.days || 0) >= 60).length;
    const pepsMal = rows.filter((row) => row.peps === "alerta").length;
    const pepsBase = rows.filter((row) => row.apartada).length;
    return { disponible, enPiso: enPiso.length, conPrevia, viejas, pepsMal, pepsBase, facturadas: rows.length - stock.length };
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === "pedido") list = list.filter((row) => row.stage <= 1);
    else if (filter === "piso") list = list.filter((row) => row.stage === 2 || row.stage === 3);
    else if (filter === "factura") list = list.filter((row) => row.stage === 4);
    else if (filter === "alerta") list = list.filter(hasAlert);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        `${row.vin} ${row.unidad} ${row.colorExterior} ${row.colorInterior} ${row.factura} ${row.cierre?.vendedor || ""} ${row.cierre?.cliente || ""} ${row.cierre?.version || ""}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (filter === "factura") {
      return [...list].sort((a, b) => (b.days || 0) - (a.days || 0));
    }
    return [...list].sort(
      (a, b) => Number(hasAlert(b)) - Number(hasAlert(a)) || (b.days || 0) - (a.days || 0),
    );
  }, [rows, filter, query]);

  const pdiPct = summary.enPiso ? Math.round((summary.conPrevia / summary.enPiso) * 1000) / 10 : null;
  const selected = rows.find((row) => row.vin.toUpperCase() === selectedVin) || null;

  return (
    <section className="panel vin-panel">
      <div className="panel__head">
        <div>
          <p className="eyebrow">HT-GAU-1 · Mapa de indicadores de Ventas</p>
          <h3>Expediente integral del VIN</h3>
        </div>
        <span className="panel-chip">
          {loading ? "Cargando…" : `${visible.length} de ${rows.length} VIN`}
        </span>
      </div>
      <p className="vin-panel__note">
        Herramienta transversal de control, trazabilidad y diagnóstico. Relaciona por VIN lo que alimenta P-GAU-1 a P-GAU-6. El semáforo usa el DMS de hoy. Daños de recepción (P-GAU-4), incidencias de custodia (P-GAU-5) y el inventario objetivo de P-GAU-1 todavía no tienen fuente en esta vista. Las unidades demo no entran.
      </p>
      <div className="vin-kpis">
        <article>
          <span>P-GAU-1</span>
          <strong>{summary.disponible}</strong>
          <small>Físico disponible · {summary.viejas} con 60+ días</small>
        </article>
        <article>
          <span>P-GAU-2</span>
          <strong>{summary.pepsMal}</strong>
          <small>Apartados sin PEPS de {summary.pepsBase}</small>
        </article>
        <article>
          <span>P-GAU-6</span>
          <strong>{pdiPct == null ? "—" : `${pdiPct}%`}</strong>
          <small>En piso con previa · proxy de PDI</small>
        </article>
        <article>
          <span>Factura</span>
          <strong>{summary.facturadas}</strong>
          <small>Vendidas en el mes</small>
        </article>
      </div>
      <div className="family-filters" role="tablist" aria-label="Filtrar expediente">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "is-active" : ""}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="vin-panel__search">
        <input
          type="search"
          value={query}
          placeholder={
            filter === "factura"
              ? "Buscar VIN, factura, vendedor, cliente…"
              : "Buscar carline, paquete o VIN…"
          }
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && <p className="notice notice--warning">{error}</p>}
      {filter === "factura" ? (
        <>
          <div className="table-wrap table-wrap--cierre">
            <table className="vin-cierre-table">
              <thead>
                <tr>
                  <th>Carline</th>
                  <th>Versión / Paquete</th>
                  <th>VIN</th>
                  <th>Subtotal</th>
                  <th>Costo neto (con bonif.)</th>
                  <th>Nota crédito (s/IVA)</th>
                  <th>Utilidad bruta</th>
                  <th>Comisión E.V.</th>
                  <th>Gastos extra</th>
                  <th>Plan piso</th>
                  <th>Ingresos F&amp;I</th>
                  <th>Utilidad neta</th>
                  <th>% retención</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={13}>Sin ventas en el mes seleccionado.</td></tr>
                )}
                {visible.map((row) => {
                  const c = row.cierre;
                  const costoNeto = c ? costoNetoConBonif(c) : null;
                  const notaSinIva = c ? notaCreditoSinIva(c) : 0;
                  const ret = c ? pctRetencion(c.utilidadBruta, c.utilidadNeta) : null;
                  const uds = Number(c?.comisionEvUnidadesPrev || 0);
                  const udsLabel = uds >= 10 ? "10+" : String(uds);
                  const netaNeg = c?.utilidadNeta != null && c.utilidadNeta < 0;
                  return (
                    <tr
                      key={`${row.vin}-${row.factura || "ven"}`}
                      className={`${selectedVin === row.vin.toUpperCase() ? "is-selected" : ""}${netaNeg ? " is-neta-neg" : ""}`}
                    >
                      <td><strong>{row.carline || "—"}</strong></td>
                      <td title={c?.version || ""}>
                        <span>{c?.version || row.unidad}</span>
                        {row.paquete ? <span className="vin-panel__meta">Paq. {row.paquete}</span> : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="vin-unit-btn"
                          onClick={() => openVin(row.vin, "cierre")}
                        >
                          <strong>{row.vin || "—"}</strong>
                          <span className="vin-panel__meta">Ver detalle</span>
                        </button>
                      </td>
                      <td className="vin-num">
                        {c?.subtotal != null ? formatMoney(c.subtotal) : "—"}
                        {c && c.isan > 0 ? (
                          <span className="vin-panel__meta">− ISAN {formatMoney(c.isan)}</span>
                        ) : null}
                      </td>
                      <td className="vin-num">
                        {costoNeto == null ? "—" : <strong>{formatMoney(costoNeto)}</strong>}
                        {c && c.bonificacion > 0 ? (
                          <span className="vin-panel__meta">− Bonif. {formatMoney(c.bonificacion)}</span>
                        ) : null}
                      </td>
                      <td className="vin-num">
                        {notaSinIva > 0 ? (
                          <>
                            <strong>{formatMoney(notaSinIva)}</strong>
                            <span className="vin-panel__meta">
                              {c?.notaCargoFolio || "A favor del cliente"}
                            </span>
                          </>
                        ) : (
                          <span className="vin-panel__meta">Sin nota</span>
                        )}
                      </td>
                      <td className="vin-num">
                        <strong>{c?.utilidadBruta == null ? "—" : formatMoney(c.utilidadBruta)}</strong>
                      </td>
                      <td className="vin-num">
                        {c && c.comisionEv > 0 ? (
                          <strong>{formatMoney(c.comisionEv)}</strong>
                        ) : null}
                        <span className="vin-panel__meta">
                          {c?.comisionEvPct == null ? "—" : `${c.comisionEvPct}%`}
                          {" · "}
                          {udsLabel} uds menudeo {c?.comisionEvMesPrev || "mes ant."}
                          {c?.comisionEvArrendamiento
                            ? ` · +${c.comisionEvPctLeasing ?? 1}% arrend.`
                            : ""}
                        </span>
                      </td>
                      <td className="vin-num">
                        <button
                          type="button"
                          className="vin-piso-btn"
                          title="Ver desglose de gastos"
                          onClick={() => openVin(row.vin, "gastos")}
                        >
                          {row.gastos ? <strong>{formatMoney(row.gastos)}</strong> : "Sin extra"}
                          {row.gastos ? <span className="vin-panel__meta">Ver detalle</span> : null}
                        </button>
                      </td>
                      <td className="vin-num">
                        <button
                          type="button"
                          className="vin-piso-btn"
                          title="Ver plan piso"
                          onClick={() => openVin(row.vin, "piso")}
                        >
                          {row.pisoAcumulado > 0 ? (
                            <>
                              <strong>{formatMoney(row.pisoAcumulado)}</strong>
                              <span className="vin-panel__meta">
                                {c?.daysChargeable || 0} días cargo
                              </span>
                            </>
                          ) : (
                            <span className="vin-panel__meta">Sin cargo</span>
                          )}
                        </button>
                      </td>
                      <td className="vin-num">
                        {c && c.ingresoFinanciamiento != null && c.ingresoFinanciamiento > 0 ? (
                          <button
                            type="button"
                            className="vin-piso-btn"
                            title="Ver F&I"
                            onClick={() => openVin(row.vin, "fi")}
                          >
                            <strong>{formatMoney(c.ingresoFinanciamiento)}</strong>
                            <span className="vin-panel__meta">
                              {c.ingresoFinanciamientoCount
                                ? `${c.ingresoFinanciamientoCount} pago${c.ingresoFinanciamientoCount === 1 ? "" : "s"}`
                                : "Ver detalle"}
                            </span>
                          </button>
                        ) : (
                          <span className="vin-panel__meta">Sin F&I</span>
                        )}
                      </td>
                      <td className="vin-num">
                        <strong>{c?.utilidadNeta == null ? "—" : formatMoney(c.utilidadNeta)}</strong>
                      </td>
                      <td className="vin-num">
                        <strong
                          className={
                            ret == null
                              ? ""
                              : ret < 0
                                ? "vin-retencion is-neg"
                                : ret < 50
                                  ? "vin-retencion is-warn"
                                  : "vin-retencion is-ok"
                          }
                        >
                          {fmtPct(ret)}
                        </strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
      <div className="table-wrap">
        <table className="vin-stock-table">
          <thead>
            <tr>
              <th>Unidad</th>
              <th>Estatus</th>
              <th>Días · C-3</th>
              <th>P-GAU-6 Previa</th>
              <th>Costo</th>
              <th>Gastos</th>
              <th>Plan piso (mes)</th>
            </tr>
          </thead>
          <tbody>
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7}>No hay VIN en este filtro.</td></tr>
            )}
            {visible.map((row) => {
              const disp = disponibilidadOf(row);
              return (
              <tr
                key={`${row.vin}-${row.factura || row.situacion}`}
                className={selectedVin === row.vin.toUpperCase() ? "is-selected" : ""}
              >
                <td>
                  <div className="vin-unit-cell">
                    <button
                      type="button"
                      className="vin-unit-btn"
                      onClick={() => openVin(row.vin)}
                    >
                      <strong>{row.unidad}</strong>
                      <span className="vin-panel__meta">Ver resumen</span>
                    </button>
                    {row.peps === "alerta" && (
                      <button
                        type="button"
                        className="vin-flag vin-flag--alerta vin-flag-btn vin-peps-inline"
                        title="Ver referencia PEPS"
                        onClick={() => openVin(row.vin, "peps")}
                      >
                        PEPS
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`vin-flag vin-flag--${disp.kind}`}>{disp.label}</span>
                </td>
                <td>
                  <div className="vin-days-cell">
                    <strong>{row.days == null ? "—" : row.days}</strong>
                    <FlagCell flag={antiguedadFlag(row)} />
                  </div>
                </td>
                <td>
                  <PreviaFlagButton
                    row={row}
                    onOpen={() => openVin(row.vin, "previas")}
                  />
                </td>
                <td>{formatMoney(row.costo)}</td>
                <td>
                  <button
                    type="button"
                    className="vin-piso-btn"
                    title="Ver desglose de gastos"
                    onClick={() => openVin(row.vin, "gastos")}
                  >
                    {formatMoney(row.gastos)}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="vin-piso-btn"
                    title="Ver acumulado de Plan Piso"
                    onClick={() => openVin(row.vin, "piso")}
                  >
                    {formatMoney(row.piso)}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {selected && (
        <>
          <button
            type="button"
            className="day-drawer-backdrop"
            aria-label="Cerrar resumen del VIN"
            onClick={() => {
              setSelectedVin(null);
              setFloatFocus("resumen");
            }}
          />
          <aside
            className="day-drawer vin-float"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vin-float-title"
          >
            <div className="day-drawer__header">
              <div>
                <p className="eyebrow">{FLOAT_TITLE[floatFocus]}</p>
                <div className="vin-float-title-row">
                  <h2 id="vin-float-title">{selected.carline || "Sin carline"}</h2>
                  {selected.peps === "alerta" && (
                    <button
                      type="button"
                      className="vin-flag vin-flag--alerta vin-flag-btn vin-peps-inline"
                      title="Ver referencia PEPS"
                      onClick={() => setFloatFocus("peps")}
                    >
                      PEPS
                    </button>
                  )}
                </div>
                <span className="day-drawer__status">
                  {selected.vin || "Sin VIN"}
                  {selected.paquete ? ` · Paq. ${selected.paquete}` : ""}
                  {selected.unidad ? ` · ${selected.unidad}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="day-drawer__close"
                aria-label="Cerrar"
                onClick={() => {
                  setSelectedVin(null);
                  setFloatFocus("resumen");
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="day-drawer__body">
              {floatFocus === "resumen" ? (
                <>
                  <article className="day-drawer__item vin-summary-card">
                    <div className="day-drawer__item-head"><strong>VIN</strong></div>
                    <p className="vin-summary-value">{selected.vin || "—"}</p>
                  </article>
                  <article className="day-drawer__item vin-summary-card">
                    <div className="day-drawer__item-head"><strong>Paquete</strong></div>
                    <p className="vin-summary-value">{selected.paquete || "—"}</p>
                  </article>
                  <article className="day-drawer__item vin-summary-card">
                    <div className="day-drawer__item-head"><strong>Color exterior</strong></div>
                    <p className="vin-summary-value">{selected.colorExterior || "Sin dato"}</p>
                  </article>
                  <article className="day-drawer__item vin-summary-card">
                    <div className="day-drawer__item-head"><strong>Color interior</strong></div>
                    <p className="vin-summary-value">{selected.colorInterior || "Sin dato"}</p>
                  </article>
                  <article className="day-drawer__item vin-summary-card">
                    <div className="day-drawer__item-head"><strong>Estatus</strong></div>
                    <p className="vin-summary-value">
                      {stageLabel(selected.stage, selected.situacion)}
                    </p>
                  </article>
                  {selected.apartada ? (
                    <article className="day-drawer__item vin-summary-card vin-summary-card--apartado">
                      <div className="day-drawer__item-head"><strong>Apartado</strong></div>
                      <p className="vin-summary-value">
                        {selected.daysApartado == null
                          ? "Sin días calculados"
                          : `${selected.daysApartado} día${selected.daysApartado === 1 ? "" : "s"} apartada`}
                      </p>
                      <ul className="vin-previa-list">
                        <li>
                          <strong>Apartó</strong>
                          <span>{selected.apartadoPor || "Sin dato"}</span>
                        </li>
                        {selected.fechaApartado ? (
                          <li>
                            <strong>Desde</strong>
                            <span>{fmtDateShort(selected.fechaApartado)}</span>
                          </li>
                        ) : null}
                      </ul>
                    </article>
                  ) : null}
                  {selected.factura ? (
                    <article className="day-drawer__item vin-summary-card">
                      <div className="day-drawer__item-head"><strong>Factura</strong></div>
                      <p className="vin-summary-value">{selected.factura}</p>
                    </article>
                  ) : null}
                </>
              ) : null}

              {floatFocus === "piso" ? (
                <article className="day-drawer__item vin-summary-card">
                  <div className="day-drawer__item-head"><strong>Plan piso acumulado</strong></div>
                  <p className="vin-summary-value">{formatMoney(selected.pisoAcumulado)}</p>
                  <p className="vin-summary-hint">
                    Acumulado de la unidad
                    {selected.piso ? ` · Mes: ${formatMoney(selected.piso)}` : ""}
                  </p>
                </article>
              ) : null}

              {floatFocus === "gastos" ? (
                <article className="day-drawer__item vin-summary-card vin-summary-card--gastos">
                  <div className="day-drawer__item-head"><strong>Total gastos</strong></div>
                  <p className="vin-summary-value">
                    {formatMoney(selected.gastosDesglose.total || selected.gastos)}
                  </p>
                  <ul className="vin-previa-list">
                    <li>
                      <strong>Previa</strong>
                      <span>{formatMoney(selected.gastosDesglose.previa)}</span>
                    </li>
                    <li>
                      <strong>Mercadotecnia</strong>
                      <span>{formatMoney(selected.gastosDesglose.publicidad)}</span>
                    </li>
                    <li>
                      <strong>Cargo de entrega</strong>
                      <span>{formatMoney(selected.gastosDesglose.entrega)}</span>
                    </li>
                    <li>
                      <strong>Gasolina</strong>
                      <span>
                        {formatMoney(selected.gastosDesglose.gasolina)}
                        {selected.gastosDesglose.gasolinaLitros
                          ? ` · ${selected.gastosDesglose.gasolinaLitros} L × ${formatMoney(selected.gastosDesglose.gasolinaPrecioLitro)}`
                          : ""}
                      </span>
                    </li>
                    <li>
                      <strong>Gastos de remisión</strong>
                      <span>{formatMoney(selected.gastosDesglose.gastosLibro)}</span>
                    </li>
                  </ul>
                </article>
              ) : null}

              {floatFocus === "previas" ? (
                <article className="day-drawer__item vin-summary-card vin-summary-card--previa">
                  <div className="day-drawer__item-head"><strong>Órdenes de previa</strong></div>
                  <p className="vin-summary-value">
                    {Number(selected.previas || 0) || selected.previasDetalle.length} previa
                    {(Number(selected.previas || 0) || selected.previasDetalle.length) === 1 ? "" : "s"}
                  </p>
                  {selected.previasDetalle.length ? (
                    <ul className="vin-previa-list">
                      {selected.previasDetalle.map((item) => (
                        <li key={item.orden}>
                          <strong>{item.orden}</strong>
                          <span>
                            {item.fecha || "Sin fecha"}
                            {" · "}
                            {previaStatusLabel(item.status)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : Number(selected.previas || 0) > 0 ? (
                    <p className="vin-summary-hint">
                      Hay previas registradas, pero el detalle de órdenes no llegó del DMS.
                    </p>
                  ) : (
                    <p className="vin-summary-hint">Sin órdenes de previa en el DMS.</p>
                  )}
                </article>
              ) : null}

              {floatFocus === "peps" ? (
                <article className="day-drawer__item vin-summary-card vin-summary-card--peps">
                  <div className="day-drawer__item-head"><strong>Referencia PEPS</strong></div>
                  {selected.pepsRefVin ? (
                    <>
                      <p className="vin-summary-hint" style={{ marginBottom: 8 }}>
                        Equivalente más antiguo disponible
                        {selected.pepsRefUnidad ? ` · ${selected.pepsRefUnidad}` : ""}
                        {selected.pepsRefDays != null ? ` · ${selected.pepsRefDays} días` : ""}
                      </p>
                      <button
                        type="button"
                        className="vin-unit-btn"
                        onClick={() => openVin(selected.pepsRefVin, "resumen")}
                      >
                        <strong>{selected.pepsRefVin}</strong>
                        <span className="vin-panel__meta">Abrir resumen de la referencia</span>
                      </button>
                      <div className="vin-peps-colors">
                        <div>
                          <span className="vin-panel__meta">Exterior</span>
                          <p className="vin-summary-value">
                            {selected.pepsRefColorExterior || "Sin dato"}
                          </p>
                        </div>
                        <div>
                          <span className="vin-panel__meta">Interior</span>
                          <p className="vin-summary-value">
                            {selected.pepsRefColorInterior || "Sin dato"}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="vin-summary-value">Sin referencia disponible</p>
                  )}
                </article>
              ) : null}

              {floatFocus === "cierre" && selected.cierre ? (
                <article className="day-drawer__item vin-summary-card vin-summary-card--cierre">
                  <div className="day-drawer__item-head"><strong>Detalle de venta</strong></div>
                  <ul className="vin-previa-list">
                    <li><strong>Vendedor</strong><span>{selected.cierre.vendedor || "—"}</span></li>
                    <li><strong>Cliente</strong><span>{selected.cierre.cliente || "—"}</span></li>
                    <li><strong>Factura</strong><span>{selected.factura || "—"}</span></li>
                    <li><strong>Fecha venta</strong><span>{fmtDateShort(selected.cierre.fechaVenta)}</span></li>
                    <li>
                      <strong>Tipo de venta</strong>
                      <span>
                        {selected.cierre.tipoVenta || "—"}
                        {selected.cierre.formaPago ? ` · Clave ${selected.cierre.formaPago}` : ""}
                      </span>
                    </li>
                    <li><strong>Canal</strong><span>{selected.cierre.isFlotilla ? "Flotilla" : "Menudeo"}</span></li>
                    <li>
                      <strong>Demo</strong>
                      <span>
                        {selected.cierre.isDemo
                          ? `Sí${selected.cierre.demoHint ? ` · ${selected.cierre.demoHint}` : ""}`
                          : "No"}
                      </span>
                    </li>
                    <li>
                      <strong>Días en inventario</strong>
                      <span>
                        {selected.days == null ? "—" : `${selected.days} días`}
                        {selected.cierre.fechaRemision
                          ? ` · Remisión ${fmtDateShort(selected.cierre.fechaRemision)}`
                          : ""}
                      </span>
                    </li>
                    <li>
                      <strong>Utilidad bruta</strong>
                      <span>
                        {selected.cierre.utilidadBruta == null
                          ? "—"
                          : formatMoney(selected.cierre.utilidadBruta)}
                      </span>
                    </li>
                    <li>
                      <strong>Comisión E.V.</strong>
                      <span>{formatMoney(selected.cierre.comisionEv)}</span>
                    </li>
                    <li>
                      <strong>Utilidad neta</strong>
                      <span>
                        {selected.cierre.utilidadNeta == null
                          ? "—"
                          : formatMoney(selected.cierre.utilidadNeta)}
                      </span>
                    </li>
                    <li>
                      <strong>% retención</strong>
                      <span>
                        {fmtPct(
                          pctRetencion(selected.cierre.utilidadBruta, selected.cierre.utilidadNeta),
                        )}
                      </span>
                    </li>
                  </ul>
                </article>
              ) : null}

              {floatFocus === "fi" && selected.cierre ? (
                <article className="day-drawer__item vin-summary-card vin-summary-card--cierre">
                  <div className="day-drawer__item-head"><strong>Total F&I</strong></div>
                  <p className="vin-summary-value">
                    {selected.cierre.ingresoFinanciamiento != null
                    && selected.cierre.ingresoFinanciamiento > 0
                      ? formatMoney(selected.cierre.ingresoFinanciamiento)
                      : "Sin F&I"}
                  </p>
                  {selected.cierre.ingresoFinanciamientoDetalle.length ? (
                    <ul className="vin-previa-list">
                      {selected.cierre.ingresoFinanciamientoDetalle.map((item, idx) => (
                        <li key={`${item.concepto}-${idx}`}>
                          <strong>{item.concepto}</strong>
                          <span>
                            {formatMoney(item.monto)}
                            {item.count > 1 ? ` · ${item.count} pagos` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="vin-summary-hint">Sin desglose de pagos GMF.</p>
                  )}
                </article>
              ) : null}
            </div>
          </aside>
        </>
      )}
    </section>
  );
}
