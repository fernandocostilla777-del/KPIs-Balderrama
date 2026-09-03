export type ProductGoal = {
  linea: string;
  familia: string;
  trafico: number;
  solicitudes: number;
  facturas: number;
  entregas: number;
};

export type DailyGoal = {
  fecha: string;
  trafico: number;
  solicitudes: number;
  facturas: number;
  entregas: number;
};

export type MonthlyGoals = {
  id: string;
  label: string;
  distribuidor: string;
  month: number;
  year: number;
  importedAt: string;
  sourceFile: string;
  volumeReference: number | null;
  marketShareTarget: number | null;
  estimatedIndustry: number | null;
  invoicesTarget: number | null;
  deliveriesTarget: number | null;
  invoiceDeadline: string | null;
  carryOverInitial: number | null;
  carryOverFinal: number | null;
  applicationsTarget: number | null;
  gmfContractsTarget: number | null;
  gmfPenetrationTarget: number | null;
  salesPerAdvisor: number | null;
  accessoriesTarget: number | null;
  onstarTarget: number | null;
  essentialsAnnualPct: number | null;
  essentialsMultiAnnualPct: number | null;
  usedVehiclesPoints: number | null;
  tacNuevosTarget: number | null;
  gmfSeminuevosTarget: number | null;
  bdc: {
    contacts: number | null;
    appointmentsScheduled: number | null;
    appointmentsConfirmed: number | null;
    appointmentsCompleted: number | null;
    deliveries: number | null;
  };
  daily: DailyGoal[];
  products: ProductGoal[];
  rawText?: string;
};

export type ResultMetric = {
  key: string;
  label: string;
  disponible: boolean;
  meta: number | Record<string, number> | null;
  real: number | null;
  unidad: string | null;
  avancePct: number | null;
  fuente: string | null;
  detalle?: Record<string, unknown> | null;
  nota?: string | null;
};

export type DailySeriesPoint = {
  fecha: string;
  dia: number;
  trafico: number;
  solicitudes: number;
  facturas: number;
  entregas: number;
  traficoAcum: number;
  solicitudesAcum: number;
  facturasAcum: number;
  entregasAcum: number;
  conMovimiento: boolean;
};

export type CalendarMetric = "trafico" | "solicitudes" | "facturas" | "entregas";

export type DailyDetailRow = Record<string, string | number | null>;

export type DailyDetail = Record<
  string,
  Record<CalendarMetric, DailyDetailRow[]>
>;

export type LineResult = {
  linea: string;
  familia: string | null;
  carline?: string | null;
  trafico: number | null;
  solicitudes: number | null;
  solicitudesReal?: number | null;
  avanceSolicitudesPct?: number | null;
  traficoReal?: number | null;
  avanceTraficoPct?: number | null;
  inventarioReal?: number | null;
  facturas: number;
  entregas: number;
  facturasReal: number;
  entregasReal: number;
  avanceFacturasPct: number | null;
  avanceEntregasPct: number | null;
  pendienteFacturas: number;
  cumplida: boolean;
};

export type BdcResult = {
  disponible?: boolean;
  status?: string;
  fuente?: string;
  nota?: string;
  real?: {
    contactos: number | null;
    citasAgendadas: number | null;
    citasConfirmadas: number | null;
    citasCumplidas: number | null;
    entregasBdc: number | null;
  };
  conversion?: {
    citasSobreContactosPct: number | null;
    confirmadasSobreAgendadasPct: number | null;
    cumplidasSobreConfirmadasPct: number | null;
    entregasSobreCumplidasPct: number | null;
  };
};

export type ResultsPayload = {
  periodo: { fechaInicio: string; fechaFin: string };
  generadoEn?: string;
  resultados: Record<string, ResultMetric | Record<string, unknown>>;
};

