"use client";

import {
  Activity,
  CalendarDays,
  CarFront,
  ChevronDown,
  CircleDollarSign,
  FileText,
  Gauge,
  Download,
  LogOut,
  RefreshCw,
  Search,
  UploadCloud,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import {
  authHeaders,
  clearSession,
  fetchMe,
  getStoredUser,
  isAdministrator,
  logout,
  type AuthUser,
} from "@/lib/auth";
import { downloadElementPdf } from "@/lib/export-pdf";
import { extractPdfText, parseObjectivesText } from "@/lib/pdf-parser";
import { loadMonths, monthRange, saveMonth } from "@/lib/monthly-store";
import { allocateSolicitudesPorModelo } from "@/lib/solicitudes-por-modelo";
import type {
  BdcResult,
  CalendarMetric,
  DailyDetail,
  DailyDetailRow,
  DailyGoal,
  DailySeriesPoint,
  LineResult,
  MonthlyGoals,
  ResultMetric,
  ResultsPayload,
} from "@/lib/types";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("es-MX");

const CALENDAR_METRICS: Array<{ key: CalendarMetric; label: string }> = [
  { key: "trafico", label: "Tráfico" },
  { key: "solicitudes", label: "Solicitudes" },
  { key: "facturas", label: "Facturas" },
  { key: "entregas", label: "Entregas" },
];

function textOf(value: string | number | null | undefined, fallback = "Sin dato") {
  return value == null || value === "" ? fallback : String(value);
}

function calendarDetailCopy(metric: CalendarMetric, row: DailyDetailRow) {
  if (metric === "facturas") {
    return {
      title: textOf(row.cliente, "Cliente sin nombre"),
      tag: textOf(row.documento, "Sin factura"),
      subtitle: `${textOf(row.modelo, "Modelo sin dato")}${row.anioModelo ? ` ${row.anioModelo}` : ""}`,
      facts: [
        `VIN ${textOf(row.vin)}`,
        textOf(row.canal, "Canal sin dato"),
        textOf(row.formaPago, "Pago sin dato"),
      ],
      meta: textOf(row.vendedor, "Vendedor sin dato"),
    };
  }
  if (metric === "entregas") {
    return {
      title: textOf(row.cliente, "Cliente sin nombre"),
      tag: textOf(row.factura, "Sin factura"),
      subtitle: `${textOf(row.modelo, "Modelo sin dato")} · VIN ${textOf(row.vin)}`,
      facts: [row.hora ? String(row.hora) : "Sin hora", textOf(row.tipoVenta, "Tipo sin dato"), textOf(row.formaPago, "Pago sin dato")],
      meta: textOf(row.usuario, "Usuario sin dato"),
    };
  }
  if (metric === "solicitudes") {
    return {
      title: textOf(row.cliente, "Cliente sin nombre"),
      tag: textOf(row.estatus, "Sin estatus"),
      subtitle: `${textOf(row.unidad, "Unidad sin dato")} · ${textOf(row.financiera, "Financiera sin dato")}`,
      facts: [`Solicitud ${textOf(row.noSolicitud)}`, textOf(row.asesor, "Asesor sin dato")],
      meta: textOf(row.idCrm, "Sin ID CRM"),
    };
  }
  return {
    title: textOf(row.cliente, "Cliente sin nombre"),
    tag: textOf(row.tipo, "Tráfico"),
    subtitle: `${textOf(row.autoInteres, "Vehículo sin dato")} · ${textOf(row.medio, "Medio sin dato")}`,
    facts: [textOf(row.asesor, "Asesor sin dato"), textOf(row.sucursal, "Sucursal sin dato"), row.hora ? String(row.hora) : "Sin hora"],
    meta: textOf(row.idCrm, "Sin ID CRM"),
  };
}

function planMetricValue(row: DailyGoal | undefined, metric: CalendarMetric) {
  if (!row) return null;
  return row[metric];
}

function realMetricValue(
  row: DailySeriesPoint | undefined | null,
  metric: CalendarMetric,
  accumulated = false,
) {
  if (!row) return null;
  if (!accumulated) return row[metric];
  if (metric === "trafico") return row.traficoAcum;
  if (metric === "solicitudes") return row.solicitudesAcum;
  if (metric === "facturas") return row.facturasAcum;
  return row.entregasAcum;
}

type MetricCardProps = {
  title: string;
  target: number | null;
  result?: number | null;
  unit?: "money" | "percent" | "number";
  icon: React.ReactNode;
  tone: string;
  subtitle?: string;
  note?: string;
  onIconClick?: () => void;
  iconTitle?: string;
  iconBusy?: boolean;
};

function formatValue(value: number | null | undefined, unit = "number") {
  if (value == null || !Number.isFinite(Number(value))) return "Sin dato";
  if (unit === "money") return money.format(value);
  if (unit === "percent") return `${value}%`;
  return number.format(value);
}

function bdcGoal(base: number | null | undefined, rate: number) {
  if (base == null || !Number.isFinite(Number(base))) return null;
  return Math.round(Number(base) * rate);
}

function bdcRate(part: number | null | undefined, total: number | null | undefined) {
  if (part == null || total == null || Number(total) <= 0) return null;
  return Math.round((Number(part) / Number(total)) * 1000) / 10;
}

function MetricCard({
  title,
  target,
  result,
  unit = "number",
  icon,
  tone,
  subtitle,
  note,
  onIconClick,
  iconTitle,
  iconBusy = false,
}: MetricCardProps) {
  const progress =
    target && result != null ? Math.round((Number(result) / target) * 1000) / 10 : null;
  const status =
    progress == null ? "Sin resultado" : progress >= 100 ? "Cumplido" : "En avance";

  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-card__head">
        {onIconClick ? (
          <button
            type="button"
            className={`metric-card__icon is-action${iconBusy ? " is-busy" : ""}`}
            onClick={onIconClick}
            disabled={iconBusy}
            title={iconTitle || "Actualizar datos"}
            aria-label={iconTitle || `Actualizar ${title}`}
          >
            {iconBusy ? <RefreshCw size={18} className="spin" /> : icon}
          </button>
        ) : (
          <span className="metric-card__icon">{icon}</span>
        )}
        <span className={`status ${progress != null && progress >= 100 ? "status--ok" : ""}`}>
          {status}
        </span>
      </div>
      <p className="metric-card__label">{title}</p>
      <div className="metric-card__numbers">
        <div>
          <span>Objetivo</span>
          <strong>{formatValue(target, unit)}</strong>
        </div>
        <div>
          <span className="is-real-title">Resultado</span>
          <strong>{formatValue(result, unit)}</strong>
        </div>
      </div>
      <div className="progress" aria-label={`Avance de ${title}`}>
        <span style={{ width: `${Math.min(progress || 0, 100)}%` }} />
      </div>
      <p className="metric-card__foot">
        {progress != null ? `${progress}% de cumplimiento` : subtitle || "Fuente no disponible"}
        {note ? <span className="metric-card__note">{note}</span> : null}
      </p>
    </article>
  );
}

function metricOf(payload: ResultsPayload | null, key: string): ResultMetric | null {
  const value = payload?.resultados?.[key];
  return value && "disponible" in value ? (value as ResultMetric) : null;
}

function AppHeader({
  month,
  months,
  user,
  onMonth,
  onUpload,
  onDownload,
  onLogout,
  loadingPdf,
  downloadingPdf,
}: {
  month: MonthlyGoals;
  months: MonthlyGoals[];
  user: AuthUser;
  onMonth: (id: string) => void;
  onUpload: (file: File) => void;
  onDownload: () => void;
  onLogout: () => void;
  loadingPdf: boolean;
  downloadingPdf: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const admin = isAdministrator(user);
  return (
    <header className="topbar">
      <div className="brand">
        <Image
          src="/balderrama.png"
          alt={month.label}
          width={1024}
          height={186}
          priority
          className="brand__logo"
        />
      </div>
      <div className="topbar__actions">
        <span className="user-chip" title={user.roleLabel || user.role}>
          <Users size={15} />
          {user.username}
        </span>
        {admin && (
          <div className="source-badge"><FileText size={16} /> PDF procesado</div>
        )}
        <label className="month-select">
          <CalendarDays size={17} />
          <select value={month.id} onChange={(event) => onMonth(event.target.value)}>
            {months.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <ChevronDown size={15} />
        </label>
        {admin ? (
          <button className="upload-button" onClick={() => fileRef.current?.click()} disabled={loadingPdf}>
            <UploadCloud size={17} />
            {loadingPdf ? "Leyendo PDF…" : "Cargar PDF mensual"}
          </button>
        ) : (
          <button
            type="button"
            className="download-button"
            onClick={onDownload}
            disabled={downloadingPdf}
          >
            <Download size={17} />
            {downloadingPdf ? "Generando PDF…" : "Descargar PDF"}
          </button>
        )}
        <button type="button" className="logout-button" onClick={onLogout}>
          <LogOut size={16} />
          Salir
        </button>
        {admin && (
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = "";
            }}
          />
        )}
      </div>
    </header>
  );
}

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [months, setMonths] = useState<MonthlyGoals[]>([]);
  const [activeId, setActiveId] = useState("2026-08");
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>("entregas");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [daySearch, setDaySearch] = useState("");
  const [productFamily, setProductFamily] = useState("todas");
  const [productCumplimiento, setProductCumplimiento] = useState<"todas" | "cumplidas" | "pendientes">("todas");
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullStateRef = useRef({
    startY: 0,
    tracking: false,
    pulling: false,
    armed: false,
    distance: 0,
  });
  const loadingResultsRef = useRef(false);
  const monthRef = useRef<MonthlyGoals | null>(null);
  const fetchResultsRef = useRef<
    ((selected: MonthlyGoals, opts?: { silent?: boolean }) => Promise<void>) | null
  >(null);
  const dayPanelOpenRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = loadMonths();
      setMonths(stored);
      setActiveId(stored[0]?.id || "2026-08");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const me = getStoredUser() ? await fetchMe() : null;
        if (cancelled) return;
        if (me) setUser(me);
        else {
          clearSession();
          setUser(null);
        }
        setAuthReady(true);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const month = useMemo(
    () => months.find((item) => item.id === activeId) || months[0],
    [months, activeId],
  );

  const fetchResults = useCallback(async (selected: MonthlyGoals, opts?: { silent?: boolean }) => {
    const range = monthRange(selected);
    if (!opts?.silent) {
      setLoadingResults(true);
      setMessage(null);
    }
    try {
      const query = new URLSearchParams(range);
      query.set("_", String(Date.now()));
      const response = await fetch(`/backend-api/objetivos-resultados?${query}`, {
        credentials: "include",
        cache: "no-store",
        headers: authHeaders(),
      });
      if (response.status === 401) {
        clearSession();
        setUser(null);
        throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
      }
      if (response.status === 404) {
        throw new Error("La API de objetivos aún no está disponible en este entorno.");
      }
      if (!response.ok) throw new Error(`API de resultados: ${response.status}`);
      setResults(await response.json());
      if (!opts?.silent) setMessage(null);
    } catch (error) {
      setResults(null);
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los resultados.");
    } finally {
      if (!opts?.silent) setLoadingResults(false);
    }
  }, []);

  const refreshResultsNow = useCallback(() => {
    const selected = monthRef.current;
    if (!selected || loadingResultsRef.current) return;
    loadingResultsRef.current = true;
    void fetchResults(selected);
  }, [fetchResults]);

  useEffect(() => {
    loadingResultsRef.current = loadingResults;
    if (!loadingResults) {
      setPullRefreshing(false);
      setPullDistance(0);
      pullStateRef.current.armed = false;
      pullStateRef.current.distance = 0;
    }
  }, [loadingResults]);

  useEffect(() => {
    monthRef.current = month || null;
  }, [month]);

  useEffect(() => {
    fetchResultsRef.current = fetchResults;
  }, [fetchResults]);

  useEffect(() => {
    dayPanelOpenRef.current = dayPanelOpen;
  }, [dayPanelOpen]);

  useEffect(() => {
    if (!authReady || !user) return undefined;

    const PULL_ACTIVATE = 12;
    const PULL_THRESHOLD = 72;
    const PULL_MAX = 120;

    const scrollTop = () =>
      window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

    const atTop = () => scrollTop() <= 1;

    const beginRefresh = () => {
      if (loadingResultsRef.current) return;
      const selected = monthRef.current;
      const fetchFn = fetchResultsRef.current;
      if (!selected || !fetchFn) return;
      loadingResultsRef.current = true;
      setPullRefreshing(true);
      setPullDistance(56);
      pullStateRef.current.armed = false;
      pullStateRef.current.pulling = false;
      pullStateRef.current.tracking = false;
      pullStateRef.current.distance = 0;
      void fetchFn(selected);
    };

    const clearPullUi = () => {
      pullStateRef.current.tracking = false;
      pullStateRef.current.pulling = false;
      pullStateRef.current.armed = false;
      pullStateRef.current.startY = 0;
      pullStateRef.current.distance = 0;
      if (!loadingResultsRef.current) setPullDistance(0);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (dayPanelOpenRef.current || loadingResultsRef.current || !atTop()) {
        clearPullUi();
        return;
      }
      pullStateRef.current.startY = event.touches[0]?.clientY || 0;
      pullStateRef.current.tracking = true;
      pullStateRef.current.pulling = false;
      pullStateRef.current.armed = false;
      pullStateRef.current.distance = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pullStateRef.current.tracking || loadingResultsRef.current) return;
      if (dayPanelOpenRef.current || !atTop()) {
        clearPullUi();
        return;
      }

      const currentY = event.touches[0]?.clientY || 0;
      const delta = currentY - pullStateRef.current.startY;

      if (delta < PULL_ACTIVATE && !pullStateRef.current.pulling) {
        return;
      }

      if (delta <= 0) {
        clearPullUi();
        return;
      }

      pullStateRef.current.pulling = true;
      // Evita que el navegador “coma” el gesto de scroll mientras tiramos.
      if (event.cancelable) event.preventDefault();

      const distance = Math.min(PULL_MAX, (delta - PULL_ACTIVATE) * 0.65);
      pullStateRef.current.distance = distance;
      pullStateRef.current.armed = distance >= PULL_THRESHOLD;
      setPullDistance(distance);
    };

    const onTouchEnd = () => {
      if (!pullStateRef.current.tracking && !pullStateRef.current.pulling) return;
      const shouldRefresh = pullStateRef.current.armed && pullStateRef.current.distance >= PULL_THRESHOLD;
      if (shouldRefresh) beginRefresh();
      else clearPullUi();
    };

    let wheelAcc = 0;
    let wheelResetTimer: number | null = null;
    let wheelArmed = false;

    const onWheel = (event: WheelEvent) => {
      if (dayPanelOpenRef.current || loadingResultsRef.current) {
        wheelAcc = 0;
        wheelArmed = false;
        return;
      }
      if (!atTop()) {
        wheelAcc = 0;
        wheelArmed = false;
        if (!loadingResultsRef.current) setPullDistance(0);
        return;
      }
      // Solo gestos hacia arriba (deltaY negativo) cuentan como “tirar”.
      if (event.deltaY >= 0) {
        wheelAcc = 0;
        wheelArmed = false;
        if (!loadingResultsRef.current) setPullDistance(0);
        return;
      }

      wheelAcc += Math.abs(event.deltaY);
      const distance = Math.min(PULL_MAX, wheelAcc * 0.22);
      wheelArmed = distance >= PULL_THRESHOLD;
      setPullDistance(distance);

      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
      wheelResetTimer = window.setTimeout(() => {
        if (wheelArmed && !loadingResultsRef.current) beginRefresh();
        else if (!loadingResultsRef.current) {
          wheelAcc = 0;
          wheelArmed = false;
          setPullDistance(0);
        }
      }, 160);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
      if (wheelResetTimer) window.clearTimeout(wheelResetTimer);
    };
  }, [authReady, user]);

  useEffect(() => {
    if (!authReady || !user || !month) return;
    const timer = window.setTimeout(() => {
      void fetchResults(month);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authReady, user, month, fetchResults]);

  useEffect(() => {
    if (!authReady || !user || !month) return undefined;

    const interval = window.setInterval(() => {
      void fetchResults(month);
    }, 15 * 60 * 1000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchResults(month);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authReady, user, month, fetchResults]);

  useEffect(() => {
    if (!dayPanelOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDayPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [dayPanelOpen]);

  const handleLogout = async () => {
    await logout();
    setResults(null);
    setUser(null);
    setMessage(null);
  };

  const handleUpload = async (file: File) => {
    if (!isAdministrator(user)) {
      setMessage("Solo el administrador puede cargar el PDF mensual.");
      return;
    }
    setLoadingPdf(true);
    setMessage(null);
    try {
      const text = await extractPdfText(file);
      const parsed = parseObjectivesText(text, file.name);
      const updated = saveMonth(parsed);
      setMonths(updated);
      setActiveId(parsed.id);
      setCalendarMetric("entregas");
      setSelectedDay(null);
      setDayPanelOpen(false);
      setDaySearch("");
      setMessage(`${parsed.label} importado: ${parsed.products.length} líneas y ${parsed.daily.length} días.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible interpretar el PDF.");
    } finally {
      setLoadingPdf(false);
    }
  };

  const handleDownloadPdf = async () => {
    const target = document.getElementById("dashboard-export");
    if (!target || !month) return;
    setDownloadingPdf(true);
    setDayPanelOpen(false);
    setMessage(null);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      const stamp = month.label.replace(/\s+/g, "-");
      await downloadElementPdf(target, `Objetivos-${stamp}.pdf`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar el PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!authReady) return <main className="loading-screen">Verificando sesión…</main>;
  if (!user) return <LoginScreen onSuccess={setUser} />;
  if (!month) return <main className="loading-screen">Preparando objetivos…</main>;

  const volume = metricOf(results, "volumen");
  const invoices = metricOf(results, "facturacion");
  const gmf = metricOf(results, "gmf");
  const contratosGmf = metricOf(results, "contratosGmf");
  const gmfSeminuevos = metricOf(results, "gmfSeminuevos");
  // Nuevos: métrica dedicada o detalle CRM. Si el snapshot aún trae el total
  // (nuevos+semi) como "real", restamos seminuevos para no doble-contar.
  const gmfSemiReal = Number(gmfSeminuevos?.real) || 0;
  const contratosGmfNuevosReal = (() => {
    const total =
      Number(gmf?.detalle?.contratosCrmTotales ?? gmf?.detalle?.contratosCrmTotal) || 0;
    const stripIfTotal = (n: number) =>
      Number.isFinite(total) && total > 0 && n === total && gmfSemiReal > 0
        ? Math.max(0, n - gmfSemiReal)
        : n;

    const dedicated = Number(contratosGmf?.real);
    if (contratosGmf && Number.isFinite(dedicated) && dedicated >= 0) {
      return stripIfTotal(dedicated);
    }
    const fromDetalle = Number(gmf?.detalle?.contratosCrmReal);
    if (Number.isFinite(fromDetalle) && fromDetalle >= 0) {
      return stripIfTotal(fromDetalle);
    }
    const raw = Number(gmf?.real) || 0;
    return stripIfTotal(raw);
  })();
  const onstar = metricOf(results, "onstar");
  const accessories = metricOf(results, "accesorios");
  const solicitudes = metricOf(results, "solicitudes");
  const force = metricOf(results, "fuerzaVentas");
  const avgPerAdvisor = metricOf(results, "promedioVentasEjecutivo");
  const seminuevos = metricOf(results, "seminuevos");
  const essentials = results?.resultados?.essentials as
    | {
        disponible?: boolean;
        meta?: { anualPct?: number | null; multianualPct?: number | null };
        real?: {
          anual?: number | null;
          multianual?: number | null;
          anualPct?: number | null;
          multianualPct?: number | null;
        };
      }
    | undefined;
  const bdc = results?.resultados?.bdc as BdcResult | undefined;
  const bdcReal = bdc?.real;
  const contactosReal = bdcReal?.contactos ?? null;
  const agendadasReal = bdcReal?.citasAgendadas ?? null;
  const confirmadasReal = bdcReal?.citasConfirmadas ?? null;
  const cumplidasReal = bdcReal?.citasCumplidas ?? null;
  const entregasReal = bdcReal?.entregasBdc ?? null;
  const contactosMeta = month.bdc.contacts;
  const contactosBase = contactosReal ?? contactosMeta;
  const agendadasMeta = bdcGoal(contactosBase, 0.25);
  const agendadasBase = agendadasReal ?? agendadasMeta;
  const confirmadasMeta = bdcGoal(agendadasBase, 0.80);
  const cumplidasMeta = bdcGoal(agendadasBase, 0.60);
  const cumplidasBase = cumplidasReal ?? cumplidasMeta;
  const entregasMeta = bdcGoal(cumplidasBase, 0.40);
  const bdcStages = [
    {
      label: "Contactos",
      hint: "Base del embudo",
      target: contactosMeta,
      real: contactosReal,
    },
    {
      label: "Citas agendadas",
      hint: `Meta 25% de contactos · real ${formatValue(bdcRate(agendadasReal, contactosBase), "percent")}`,
      target: agendadasMeta,
      real: agendadasReal,
    },
    {
      label: "Citas confirmadas",
      hint: `Meta 80% de agendadas · real ${formatValue(bdcRate(confirmadasReal, agendadasBase), "percent")}`,
      target: confirmadasMeta,
      real: confirmadasReal,
    },
    {
      label: "Citas cumplidas",
      hint: `Meta 60% de agendadas · real ${formatValue(bdcRate(cumplidasReal, agendadasBase), "percent")}`,
      target: cumplidasMeta,
      real: cumplidasReal,
    },
    {
      label: "Entregas BDC",
      hint: `Meta 40% de cumplidas · real ${formatValue(bdcRate(entregasReal, cumplidasBase), "percent")}`,
      target: entregasMeta,
      real: entregasReal,
    },
  ];

  const diario = results?.resultados?.diario as {
    serie?: DailySeriesPoint[];
    detallePorFecha?: DailyDetail;
  } | undefined;
  const serie = diario?.serie ?? [];
  const lastMovement = [...serie].reverse().find((day) => day.conMovimiento) ?? null;
  const currentDay = lastMovement?.dia ?? Math.min(new Date().getDate(), month.daily.length || 31);
  const calendarDay = selectedDay ?? currentDay;
  const planSelected = month.daily.find((item) => Number(item.fecha.slice(-2)) === calendarDay);
  const realSelected = serie.find((day) => day.dia === calendarDay) ?? null;
  const selectedDate = `${month.year}-${String(month.month).padStart(2, "0")}-${String(calendarDay).padStart(2, "0")}`;
  const selectedDetails = diario?.detallePorFecha?.[selectedDate]?.[calendarMetric] ?? [];
  const calendarMetricLabel =
    CALENDAR_METRICS.find((item) => item.key === calendarMetric)?.label ?? "Entregas";
  const dayQuery = daySearch.trim().toLowerCase();
  const visibleDetails = dayQuery
    ? selectedDetails.filter((row) => {
        const copy = calendarDetailCopy(calendarMetric, row);
        return [copy.title, copy.tag, copy.subtitle, copy.meta, ...(copy.facts || [])]
          .join(" ")
          .toLowerCase()
          .includes(dayQuery);
      })
    : selectedDetails;
  const dayTitle =
    calendarMetric === "facturas" ? "Unidades timbradas" : `Detalle de ${calendarMetricLabel.toLowerCase()}`;
  const dayLabel = new Date(month.year, month.month - 1, calendarDay).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const lineasApi = results?.resultados?.lineasProducto as
    | {
        vsMetaPlantilla?: LineResult[];
        traficoPorLinea?: Record<string, number>;
        inventarioPorLinea?: Record<string, number>;
        solicitudesPorCarline?: Array<{ carline?: string | null; total?: number | null }>;
        carlinesSinMetaPdf?: Array<{ carline?: string | null; total?: number | null }>;
        totalesReal?: {
          solicitudes?: number | null;
          solicitudesOtros?: number | null;
          trafico?: number | null;
          facturas?: number | null;
          entregas?: number | null;
          inventario?: number | null;
        };
      }
    | undefined;
  const realByLinea = new Map<string, LineResult>();
  for (const row of lineasApi?.vsMetaPlantilla ?? []) {
    if (!row?.linea) continue;
    realByLinea.set(row.linea, row);
    realByLinea.set(String(row.linea).trim().toLowerCase(), row);
  }
  const productFamilies = Array.from(
    new Map(
      month.products.map((product) => [product.familia || "Sin clasificar", 0]),
    ).keys(),
  ).map((familia) => ({
    familia,
    count: month.products.filter((product) => (product.familia || "Sin clasificar") === familia).length,
  }));
  const isLineaCumplida = (linea: string) => Boolean(
    (realByLinea.get(linea) || realByLinea.get(String(linea).trim().toLowerCase()))?.cumplida,
  );
  const familyProducts = productFamily === "todas"
    ? month.products
    : month.products.filter((product) => (product.familia || "Sin clasificar") === productFamily);
  const lineasCumplidas = familyProducts.filter((product) => isLineaCumplida(product.linea)).length;
  const lineasPendientes = familyProducts.length - lineasCumplidas;
  const visibleProducts = productCumplimiento === "todas"
    ? familyProducts
    : familyProducts.filter((product) => {
      const ok = isLineaCumplida(product.linea);
      return productCumplimiento === "cumplidas" ? ok : !ok;
    });
  const showFamilyCol = productFamily === "todas";

  const kpiSolicitudesReal = solicitudes?.real != null
    ? Number(solicitudes.real)
    : (lineasApi?.totalesReal?.solicitudes != null ? Number(lineasApi.totalesReal.solicitudes) : null);
  const solicitudesAlloc = allocateSolicitudesPorModelo({
    products: month.products,
    vsMeta: lineasApi?.vsMetaPlantilla ?? [],
    porCarline: lineasApi?.solicitudesPorCarline
      ?? ((solicitudes?.detalle?.porCarline as Array<{ carline?: string | null; total?: number | null }> | undefined) ?? []),
    carlinesSinMeta: lineasApi?.carlinesSinMetaPdf ?? [],
    kpiTotal: productFamily === "todas" ? kpiSolicitudesReal : null,
  });
  const productTotals = visibleProducts.reduce(
    (acc, product) => {
      const real = realByLinea.get(product.linea)
        || realByLinea.get(String(product.linea).trim().toLowerCase());
      const traficoReal = real?.traficoReal
        ?? lineasApi?.traficoPorLinea?.[product.linea]
        ?? lineasApi?.traficoPorLinea?.[String(product.linea).trim()]
        ?? 0;
      const inventarioReal = real?.inventarioReal
        ?? lineasApi?.inventarioPorLinea?.[product.linea]
        ?? lineasApi?.inventarioPorLinea?.[String(product.linea).trim()]
        ?? 0;
      const solicitudesReal = solicitudesAlloc.byLinea.get(product.linea) ?? Number(real?.solicitudesReal || 0);
      return {
        traficoMeta: acc.traficoMeta + Number(product.trafico || 0),
        traficoReal: acc.traficoReal + Number(traficoReal || 0),
        solicitudesMeta: acc.solicitudesMeta + Number(product.solicitudes || 0),
        solicitudesReal: acc.solicitudesReal + Number(solicitudesReal || 0),
        facturasMeta: acc.facturasMeta + Number(product.facturas || 0),
        facturasReal: acc.facturasReal + Number(real?.facturasReal || 0),
        entregasMeta: acc.entregasMeta + Number(product.entregas || 0),
        entregasReal: acc.entregasReal + Number(real?.entregasReal || 0),
        inventarioReal: acc.inventarioReal + Number(inventarioReal || 0),
      };
    },
    {
      traficoMeta: 0,
      traficoReal: 0,
      solicitudesMeta: 0,
      solicitudesReal: 0,
      facturasMeta: 0,
      facturasReal: 0,
      entregasMeta: 0,
      entregasReal: 0,
      inventarioReal: 0,
    },
  );
  const showOtrosSolicitudes = productFamily === "todas"
    && productCumplimiento === "todas"
    && solicitudesAlloc.otros > 0;
  const solicitudesFooterReal = productFamily === "todas" && productCumplimiento === "todas"
    ? (kpiSolicitudesReal ?? (productTotals.solicitudesReal + solicitudesAlloc.otros))
    : productTotals.solicitudesReal;
  const solicitudesFooterMeta = productFamily === "todas" && productCumplimiento === "todas"
    ? (month.applicationsTarget ?? productTotals.solicitudesMeta)
    : productTotals.solicitudesMeta;

  const now = new Date();
  const esMesEnCurso = now.getFullYear() === month.year && now.getMonth() + 1 === month.month;
  const diaHoy = esMesEnCurso ? now.getDate() : null;

  const daysInMonth = new Date(month.year, month.month, 0).getDate();
  const leadingBlanks = (new Date(month.year, month.month - 1, 1).getDay() + 6) % 7;
  const planByDay = new Map(month.daily.map((item) => [Number(item.fecha.slice(-2)), item]));
  const realByDay = new Map(serie.map((item) => [item.dia, item]));
  const calendarDays = Array.from({ length: daysInMonth }, (_, index) => {
    const dia = index + 1;
    const metaAcum = planMetricValue(planByDay.get(dia), calendarMetric);
    const metaAnterior = planMetricValue(planByDay.get(dia - 1), calendarMetric) ?? 0;
    const metaDia = metaAcum != null ? metaAcum - metaAnterior : null;
    const realDia = realMetricValue(realByDay.get(dia), calendarMetric);
    const transcurrido = dia <= (diaHoy ?? currentDay);
    let estado = "is-future";
    if (transcurrido) {
      if (metaDia == null || metaDia === 0) estado = "is-neutral";
      else if ((realDia ?? 0) >= metaDia) estado = "is-ok";
      else if ((realDia ?? 0) > 0) estado = "is-warn";
      else estado = "is-risk";
    }
    return { dia, metaDia, realDia, transcurrido, estado };
  });

  return (
    <main className="shell">
      <div
        className={`pull-refresh${pullDistance > 8 || pullRefreshing ? " is-visible" : ""}${pullDistance >= 72 || pullRefreshing ? " is-armed" : ""}${pullRefreshing ? " is-busy" : ""}`}
        style={{ height: pullRefreshing ? 52 : Math.max(0, pullDistance) }}
        aria-hidden={!(pullDistance > 8 || pullRefreshing)}
      >
        <div className="pull-refresh__inner">
          <RefreshCw size={18} className={pullRefreshing ? "spin" : undefined} />
          <span>
            {pullRefreshing
              ? "Actualizando…"
              : pullDistance >= 72
                ? "Suelta para actualizar"
                : "Tira para actualizar"}
          </span>
        </div>
      </div>

      <AppHeader
        month={month}
        months={months}
        user={user}
        onMonth={(id) => {
          setActiveId(id);
          setCalendarMetric("entregas");
          setSelectedDay(null);
          setDayPanelOpen(false);
          setDaySearch("");
          setProductFamily("todas");
        }}
        onUpload={handleUpload}
        onDownload={() => { void handleDownloadPdf(); }}
        onLogout={() => { void handleLogout(); }}
        loadingPdf={loadingPdf}
        downloadingPdf={downloadingPdf}
      />

      <section className="content" id="dashboard-export">
        {(message || loadingResults) && (
          <div className={`notice ${message?.includes("Inicia sesión") ? "notice--warning" : ""}`}>
            {loadingResults ? <><RefreshCw size={16} className="spin" /> Consultando resultados…</> : message}
          </div>
        )}

        <div className="month-heading">
          <h2>Referencia mensual</h2>
        </div>

        <section className="overview-grid">
          <MetricCard
            title="Volumen de entregas"
            target={month.deliveriesTarget || month.volumeReference}
            result={volume?.real}
            icon={<CarFront />}
            tone="blue"
            onIconClick={refreshResultsNow}
            iconBusy={loadingResults}
            iconTitle="Actualizar resultados ahora"
            note={
              (volume?.nota as string | undefined)
              || (volume?.detalle?.demosNota as string | undefined)
              || undefined
            }
            subtitle={
              Number(volume?.detalle?.demosSofia) > 0
                ? `${volume?.detalle?.demosSofia} demo${Number(volume?.detalle?.demosSofia) === 1 ? "" : "s"} del mes en SOFIA`
                : "Entregas SOFIA del periodo"
            }
          />
          <MetricCard
            title="Unidades facturadas"
            target={month.invoicesTarget}
            result={invoices?.real}
            icon={<FileText />}
            tone="violet"
            subtitle={`Límite ${month.invoiceDeadline || "sin fecha"}`}
            note={(invoices?.nota as string | undefined) || undefined}
          />
          <MetricCard title="Penetración GMF" target={month.gmfPenetrationTarget} result={gmf?.real} unit="percent" icon={<CircleDollarSign />} tone="green" />
          <MetricCard
            title="OnStar"
            target={month.onstarTarget}
            result={onstar?.real}
            icon={<Activity />}
            tone="cyan"
          />
          <MetricCard title="Accesorios" target={month.accessoriesTarget} result={accessories?.real} unit="money" icon={<WalletCards />} tone="amber" />

          <section className="panel calendar-panel">
            <div className="panel__head">
              <div>
                <p className="eyebrow">Objetivo diario</p>
                <h3>Calendario de {calendarMetricLabel.toLowerCase()}</h3>
              </div>
              <span className="panel-chip">Día {calendarDay}</span>
            </div>
            <div className="daily-summary daily-summary--compact">
              {CALENDAR_METRICS.map(({ key, label }) => {
                const target = planMetricValue(planSelected, key);
                const real = realMetricValue(realSelected, key, true);
                const ratio =
                  target && real != null
                    ? Math.round((Number(real) / Number(target)) * 1000) / 10
                    : null;
                return (
                  <button
                    type="button"
                    className={calendarMetric === key ? "is-active" : ""}
                    aria-pressed={calendarMetric === key}
                    key={key}
                    onClick={() => setCalendarMetric(key)}
                  >
                    <span>{label}</span>
                    <strong>{formatValue(real)}</strong>
                    <small title={`Meta acumulada del PDF al día ${calendarDay}`}>
                      Meta {formatValue(target)}
                      {ratio != null ? ` · ${ratio}%` : ""}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="calendar">
              <div className="calendar__weekdays">
                {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="calendar__grid">
                {Array.from({ length: leadingBlanks }, (_, index) => (
                  <span key={`blank-${index}`} className="calendar__cell is-empty" />
                ))}
                {calendarDays.map((day) => (
                  <button
                    type="button"
                    key={day.dia}
                    className={`calendar__cell ${day.estado}${day.dia === diaHoy ? " is-today" : ""}${selectedDay === day.dia ? " is-selected" : ""}`}
                    title={`${day.dia === diaHoy ? "Hoy · " : ""}Día ${day.dia} · meta ${day.metaDia ?? "sin dato"} · ${calendarMetricLabel.toLowerCase()} ${day.realDia ?? "sin dato"}`}
                    onClick={() => {
                      setSelectedDay(day.dia);
                      setDaySearch("");
                      setDayPanelOpen(true);
                    }}
                  >
                    <em>{day.dia}</em>
                    <span className="calendar__cell-value">
                      <strong>{day.transcurrido ? day.realDia ?? "—" : "·"}</strong>
                      <small>/{day.metaDia ?? "—"}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="calendar__legend">
              <span><i className="dot dot--ok" />Meta cumplida</span>
              <span><i className="dot dot--warn" />Parcial</span>
              <span><i className="dot dot--risk" />Sin movimiento</span>
            </div>
          </section>

          <section className="panel bdc-panel">
            <div className="panel__head">
              <div>
                <p className="eyebrow">BDC</p>
                <h3>Embudo de citas</h3>
              </div>
            </div>
            {bdcStages.map((item) => {
              const avance =
                item.target && item.real != null
                  ? Math.round((Number(item.real) / Number(item.target)) * 1000) / 10
                  : null;
              const status =
                avance == null ? "Sin resultado" : avance >= 100 ? "Cumplido" : "En avance";
              return (
                <div className="objective-line" key={item.label}>
                  <div className="objective-line__row">
                    <span className="objective-line__label">
                      {item.label}
                      <em>{item.hint}</em>
                    </span>
                    <div className="objective-line__meta">
                      <span className={`status ${avance != null && avance >= 100 ? "status--ok" : ""}`}>
                        {status}
                      </span>
                      <strong>
                        {formatValue(item.real)}
                        <small> / {formatValue(item.target)}</small>
                      </strong>
                    </div>
                  </div>
                  <div className="mini-progress" aria-label={`Avance de ${item.label}`}>
                    <span style={{ width: `${Math.min(avance || 0, 100)}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="objective-box__source">
              {bdc?.fuente || "CRM Railway"}
              {bdc?.nota ? ` · ${bdc.nota}` : ""}
            </p>
          </section>

          <section className="panel essentials-panel">
            <div className="panel__head">
              <div>
                <p className="eyebrow">Essentials</p>
                <h3>Ventas por modalidad</h3>
              </div>
              <Users size={21} />
            </div>
            {[
              {
                label: "Anual (12 meses)",
                hint: `${formatValue(essentials?.real?.anual ?? null)} contratos`,
                target: month.essentialsAnnualPct,
                real: essentials?.real?.anualPct ?? null,
              },
              {
                label: "Multianual (+12)",
                hint: `${formatValue(essentials?.real?.multianual ?? null)} contratos`,
                target: month.essentialsMultiAnnualPct,
                real: essentials?.real?.multianualPct ?? null,
              },
            ].map((item) => {
              const avance =
                item.target && item.real != null
                  ? Math.round((Number(item.real) / Number(item.target)) * 1000) / 10
                  : null;
              const status =
                avance == null ? "Sin resultado" : avance >= 100 ? "Cumplido" : "En avance";
              return (
                <div className="essentials-row" key={item.label}>
                  <div className="essentials-row__head">
                    <span className="essentials-row__label">{item.label}</span>
                    <span className={`status ${avance != null && avance >= 100 ? "status--ok" : ""}`}>
                      {status}
                    </span>
                  </div>
                  <div className="metric-card__numbers">
                    <div>
                      <span>Objetivo</span>
                      <strong>{formatValue(item.target, "percent")}</strong>
                    </div>
                    <div>
                      <span className="is-real-title">Resultado</span>
                      <strong>{formatValue(item.real, "percent")}</strong>
                    </div>
                  </div>
                  <div className="progress" aria-label={`Avance de ${item.label}`}>
                    <span style={{ width: `${Math.min(avance || 0, 100)}%` }} />
                  </div>
                  <p className="metric-card__foot">
                    {avance != null ? `${avance}% de cumplimiento` : "Fuente no disponible"}
                    <span className="metric-card__note">{item.hint}</span>
                  </p>
                </div>
              );
            })}
          </section>
        </section>

        <section className="scorecard-panel">
          <div className="panel__head">
            <div>
              <p className="eyebrow">Indicadores clave</p>
              <h3>Scorecard comercial</h3>
            </div>
            <span className="panel-chip">4 indicadores</span>
          </div>
          <MetricCard
            title="Solicitudes mínimas"
            target={month.applicationsTarget}
            result={solicitudes?.real ?? null}
            icon={<FileText />}
            tone="violet"
          />
          <MetricCard
            title="Contratos GMF"
            target={month.gmfContractsTarget}
            result={contratosGmfNuevosReal}
            icon={<CircleDollarSign />}
            tone="green"
          />
          <MetricCard
            title="TAC Nuevos"
            target={month.tacNuevosTarget ?? 28}
            result={seminuevos?.real ?? null}
            icon={<CarFront />}
            tone="cyan"
          />
          <MetricCard
            title="Contratos GMF Seminuevos"
            target={
              month.id === "2026-08"
                ? 10
                : (gmfSeminuevos?.meta as number | null) ?? month.gmfSeminuevosTarget ?? 10
            }
            result={gmfSemiReal || null}
            icon={<WalletCards />}
            tone="amber"
          />
        </section>

        <section className="panel force-panel">
          <div className="panel__head">
            <div>
              <p className="eyebrow">Plantilla activa de ventas</p>
              <h3>Fuerza de ventas</h3>
            </div>
            <span className="panel-chip">
              {force?.real != null
                ? `${number.format(force.real)} activos`
                : "Sin dato"}
            </span>
          </div>
          <div className="force-grid">
            <div className="force-stat">
              <span className="force-stat__icon"><Users size={18} /></span>
              <div>
                <span>Vendedores activos</span>
                <strong>{formatValue(force?.real)}</strong>
              </div>
            </div>
            <div className="force-stat">
              <span className="force-stat__icon"><Gauge size={18} /></span>
              <div>
                <span>Promedio de ventas por vendedor</span>
                <strong>{formatValue(avgPerAdvisor?.real)}</strong>
              </div>
            </div>
            <div className="force-stat">
              <span className="force-stat__icon"><CarFront size={18} /></span>
              <div>
                <span>Vendedores requeridos</span>
                <strong>
                  {formatValue(
                    (typeof force?.meta === "number" ? force.meta : null)
                      ?? (month.volumeReference && month.salesPerAdvisor
                        ? Math.floor(month.volumeReference / month.salesPerAdvisor)
                        : null),
                  )}
                </strong>
              </div>
            </div>
          </div>
        </section>

        <section className={`panel product-panel${showFamilyCol ? "" : " product-panel--filtered"}`}>
          <div className="panel__head">
            <div>
              <p className="eyebrow">Oportunidad por línea de producto</p>
              <h3>Objetivos por modelo</h3>
            </div>
            <span className="panel-chip">
              {visibleProducts.length} de {familyProducts.length} líneas
            </span>
          </div>
          <div className="family-filters" role="tablist" aria-label="Filtrar por familia">
            <button
              type="button"
              className={productFamily === "todas" ? "is-active" : ""}
              aria-pressed={productFamily === "todas"}
              onClick={() => setProductFamily("todas")}
            >
              Todas
              <em>{month.products.length}</em>
            </button>
            {productFamilies.map(({ familia, count }) => (
              <button
                type="button"
                key={familia}
                className={productFamily === familia ? "is-active" : ""}
                aria-pressed={productFamily === familia}
                onClick={() => setProductFamily(familia)}
              >
                {familia}
                <em>{count}</em>
              </button>
            ))}
          </div>
          <div className="family-filters cumplimiento-filters" role="tablist" aria-label="Filtrar por cumplimiento">
            <button
              type="button"
              className={productCumplimiento === "todas" ? "is-active" : ""}
              aria-pressed={productCumplimiento === "todas"}
              onClick={() => setProductCumplimiento("todas")}
            >
              Todas
              <em>{familyProducts.length}</em>
            </button>
            <button
              type="button"
              className={`filter--ok${productCumplimiento === "cumplidas" ? " is-active" : ""}`}
              aria-pressed={productCumplimiento === "cumplidas"}
              onClick={() => setProductCumplimiento("cumplidas")}
            >
              Cumplidas
              <em>{lineasCumplidas}</em>
            </button>
            <button
              type="button"
              className={`filter--risk${productCumplimiento === "pendientes" ? " is-active" : ""}`}
              aria-pressed={productCumplimiento === "pendientes"}
              onClick={() => setProductCumplimiento("pendientes")}
            >
              No cumplidas
              <em>{lineasPendientes}</em>
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Línea</th>
                  <th>Inventario</th>
                  {showFamilyCol ? <th>Familia</th> : null}
                  <th>Tráfico meta</th>
                  <th className="th-real">Tráfico <b>real</b></th>
                  <th>Solicitudes meta</th>
                  <th className="th-real">Solicitudes <b>real</b></th>
                  <th>Facturas meta</th>
                  <th className="th-real">Facturas <b>real</b></th>
                  <th>Entregas meta</th>
                  <th className="th-real">Entregas <b>real</b></th>
                  <th>Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.length === 0 ? (
                  <tr>
                    <td colSpan={showFamilyCol ? 12 : 11} className="muted">
                      {productCumplimiento === "cumplidas"
                        ? "No hay líneas cumplidas con este filtro."
                        : productCumplimiento === "pendientes"
                          ? "No hay líneas pendientes con este filtro."
                          : "No hay líneas en esta familia."}
                    </td>
                  </tr>
                ) : visibleProducts.map((product) => {
                  const real = realByLinea.get(product.linea)
                    || realByLinea.get(String(product.linea).trim().toLowerCase());
                  const avance = real?.avanceFacturasPct ?? null;
                  const traficoReal = real?.traficoReal
                    ?? lineasApi?.traficoPorLinea?.[product.linea]
                    ?? lineasApi?.traficoPorLinea?.[String(product.linea).trim()];
                  const inventarioReal = real?.inventarioReal
                    ?? lineasApi?.inventarioPorLinea?.[product.linea]
                    ?? lineasApi?.inventarioPorLinea?.[String(product.linea).trim()];
                  const solicitudesReal = solicitudesAlloc.byLinea.get(product.linea)
                    ?? real?.solicitudesReal
                    ?? null;
                  return (
                    <tr key={`${product.familia}-${product.linea}`}>
                      <td><strong>{product.linea}</strong></td>
                      <td className="cell-inv">{formatValue(inventarioReal)}</td>
                      {showFamilyCol ? (
                        <td><span className="family-pill">{product.familia}</span></td>
                      ) : null}
                      <td>{number.format(product.trafico)}</td>
                      <td className="cell-real">{formatValue(traficoReal)}</td>
                      <td>{number.format(product.solicitudes)}</td>
                      <td className="cell-real" title={real?.carline ? `Carline ${real.carline}` : undefined}>
                        {formatValue(solicitudesReal)}
                      </td>
                      <td>{number.format(product.facturas)}</td>
                      <td className="cell-real">{formatValue(real?.facturasReal)}</td>
                      <td>{number.format(product.entregas)}</td>
                      <td className="cell-real">{formatValue(real?.entregasReal)}</td>
                      <td>
                        {avance == null ? (
                          <span className="muted">Sin dato</span>
                        ) : (
                          <div className="cell-progress">
                            <span className={`badge ${real?.cumplida ? "badge--ok" : avance >= 60 ? "badge--warn" : "badge--risk"}`}>
                              {avance}%
                            </span>
                            <i><b style={{ width: `${Math.min(avance, 100)}%` }} /></i>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {showOtrosSolicitudes ? (
                  <tr className="row-otros">
                    <td><strong>Otros / sin meta PDF</strong></td>
                    <td className="cell-inv">—</td>
                    {showFamilyCol ? <td><span className="family-pill">Otros</span></td> : null}
                    <td>—</td>
                    <td className="cell-real">—</td>
                    <td>—</td>
                    <td className="cell-real">{formatValue(solicitudesAlloc.otros)}</td>
                    <td>—</td>
                    <td className="cell-real">—</td>
                    <td>—</td>
                    <td className="cell-real">—</td>
                    <td><span className="muted">Residual CRM</span></td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="cell-inv">{number.format(productTotals.inventarioReal)}</td>
                  {showFamilyCol ? <td /> : null}
                  <td>{number.format(productTotals.traficoMeta)}</td>
                  <td className="cell-real">{number.format(productTotals.traficoReal)}</td>
                  <td>{number.format(solicitudesFooterMeta)}</td>
                  <td className="cell-real" title="Debe coincidir con Solicitudes mínimas (KPI)">
                    {number.format(solicitudesFooterReal)}
                  </td>
                  <td>{number.format(productTotals.facturasMeta)}</td>
                  <td className="cell-real">{number.format(productTotals.facturasReal)}</td>
                  <td>{number.format(productTotals.entregasMeta)}</td>
                  <td className="cell-real">{number.format(productTotals.entregasReal)}</td>
                  <td>
                    {productFamily === "todas" && productCumplimiento === "todas" && kpiSolicitudesReal != null ? (
                      <span className={`badge ${solicitudesFooterReal === kpiSolicitudesReal ? "badge--ok" : "badge--warn"}`}>
                        {solicitudesFooterReal === kpiSolicitudesReal ? "Cuadra con KPI" : "Revisar KPI"}
                      </span>
                    ) : (
                      <span className="muted">Vista filtrada</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </section>

      {dayPanelOpen && (
        <>
          <button
            type="button"
            className="day-drawer-backdrop"
            aria-label="Cerrar detalle del día"
            onClick={() => setDayPanelOpen(false)}
          />
          <aside
            className="day-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="day-drawer-title"
          >
            <div className="day-drawer__header">
              <div>
                <p className="eyebrow">{dayTitle}</p>
                <h2 id="day-drawer-title">{calendarMetricLabel} · {dayLabel}</h2>
                <span className="day-drawer__status">
                  {visibleDetails.length} registro{visibleDetails.length === 1 ? "" : "s"}
                  {dayQuery ? ` de ${selectedDetails.length}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="day-drawer__close"
                aria-label="Cerrar"
                onClick={() => setDayPanelOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="day-drawer__toolbar">
              <label className="day-drawer__search">
                <Search size={15} />
                <input
                  value={daySearch}
                  onChange={(event) => setDaySearch(event.target.value)}
                  placeholder="Buscar cliente, VIN, factura, asesor…"
                />
              </label>
            </div>
            <div className="day-drawer__body">
              {visibleDetails.length ? (
                visibleDetails.map((row, index) => {
                  const copy = calendarDetailCopy(calendarMetric, row);
                  return (
                    <article className="day-drawer__item" key={`${selectedDate}-${calendarMetric}-${index}`}>
                      <div className="day-drawer__item-head">
                        <strong>{copy.title}</strong>
                        <span className="day-drawer__tag">{copy.tag}</span>
                      </div>
                      <p>{copy.subtitle}</p>
                      <div className="day-drawer__facts">
                        {copy.facts.map((fact) => (
                          <span key={fact}>{fact}</span>
                        ))}
                      </div>
                      <small>{copy.meta}</small>
                    </article>
                  );
                })
              ) : (
                <p className="day-drawer__empty">
                  {selectedDetails.length
                    ? "Ningún registro coincide con la búsqueda."
                    : `No hay registros de ${calendarMetricLabel.toLowerCase()} para este día.`}
                </p>
              )}
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
