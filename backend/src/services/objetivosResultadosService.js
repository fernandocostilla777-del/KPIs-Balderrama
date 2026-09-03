/**
 * APIs de resultados en formato de objetivos comerciales (PDF scorecard).
 * Agrega datos ya existentes del dashboard; no inventa market share / TAC.
 */

const { getVentas, getTomasACuenta } = require('./ventas');
const { getGoals } = require('./salesGoals');
const { getFinanciamientoDashboard, loadSolicitudes } = require('./financiamientoService');
const { getAfluenciaDashboard, classifyReconciliacion, isNuevos } = require('./afluenciaService');
const { getEeffSummary } = require('./eeffSummaryService');
const crmCiclos = require('./crmCiclosService');

/** Cuentas técnicas que facturan como casa / intercambios. */
const USUARIOS_CASA_IDS = new Set(['BCV', 'BCS', 'CIB']);
/**
 * Plantilla activa de ejecutivos de autos nuevos (valor operativo confirmado).
 * PNC_USUARIOS marca demasiados usuarios como activos, así que se fija aquí.
 */
const EJECUTIVOS_ACTIVOS_NUEVOS = 31;

/** Metas de referencia del PDF Agosto 2026 (plantilla del formato). */
const METAS_AGOSTO_2026 = {
  distribuidor: '323 Automotriz Balderrama Puebla',
  mes: 8,
  anio: 2026,
  label: 'Agosto 2026',
  volumenReferencia: 142,
  marketShareObjetivoPct: 15.6,
  industriaEstimada: 908,
  facturasAFacturar: 143,
  carryOverInicial: 0,
  carryOverFinalEsperado: 1,
  fechaLimiteFacturas: '2026-08-24',
  solicitudesMinimas: 429,
  contratosGmf: 99,
  penetracionGmfPct: 70,
  ventasPorAsesor: 5,
  onstarUnidades: 12,
  accesoriosMonto: 269800,
  essentialsAnualPct: 30,
  essentialsMultianualPct: 23,
  usedVehiclesPoints: 5,
  tacNuevos: 28,
  contratosGmfSeminuevos: 10,
  bdc: {
    contactos: 1420,
    citasAgendadasPct: 25,
    citasAgendadas: 355,
    citasConfirmadasPct: 80,
    citasConfirmadas: 284,
    citasCumplidasPct: 60,
    citasCumplidas: 213,
    entregasBdcPct: 40,
    entregasBdc: 85,
  },
  lineasProducto: [
    { linea: 'Aveo HB', familia: 'Pasajeros', trafico: 124, solicitudes: 93, facturas: 31, entregas: 30 },
    { linea: 'Aveo NB', familia: 'Pasajeros', trafico: 88, solicitudes: 66, facturas: 22, entregas: 22 },
    { linea: 'Onix', familia: 'Pasajeros', trafico: 52, solicitudes: 39, facturas: 13, entregas: 13 },
    { linea: 'Tracker', familia: "SUV's", trafico: 12, solicitudes: 9, facturas: 3, entregas: 3 },
    { linea: 'Trax', familia: "SUV's", trafico: 20, solicitudes: 15, facturas: 5, entregas: 5 },
    { linea: 'Captiva', familia: "SUV's", trafico: 36, solicitudes: 27, facturas: 9, entregas: 9 },
    { linea: 'Groove', familia: "SUV's", trafico: 64, solicitudes: 48, facturas: 16, entregas: 16 },
    { linea: 'Traverse', familia: "SUV's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
    { linea: 'Tahoe', familia: "SUV's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
    { linea: 'Suburban', familia: "SUV's", trafico: 8, solicitudes: 6, facturas: 2, entregas: 2 },
    { linea: 'Blazer EV', familia: "SUV's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
    { linea: 'Spark EUV', familia: "SUV's", trafico: 16, solicitudes: 12, facturas: 4, entregas: 4 },
    { linea: 'Captiva PHEV SUV', familia: "SUV's", trafico: 28, solicitudes: 21, facturas: 7, entregas: 7 },
    { linea: 'Colorado', familia: "Pick up's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
    { linea: 'Silverado / Cheyenne Crew Cab', familia: "Pick up's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
    { linea: 'S10 MAX Chassis Cab', familia: "Pick up's", trafico: 20, solicitudes: 15, facturas: 5, entregas: 5 },
    { linea: 'S10 MAX Crew Cab', familia: "Pick up's", trafico: 24, solicitudes: 18, facturas: 6, entregas: 6 },
    { linea: 'S10 MAX Regular Cab', familia: "Pick up's", trafico: 12, solicitudes: 9, facturas: 3, entregas: 3 },
    { linea: 'Montana', familia: "Pick up's", trafico: 8, solicitudes: 6, facturas: 2, entregas: 2 },
    { linea: 'Tornado Van', familia: "Van's", trafico: 36, solicitudes: 27, facturas: 9, entregas: 9 },
    { linea: 'Express Max', familia: "Van's", trafico: 4, solicitudes: 3, facturas: 1, entregas: 1 },
  ],
};

function parseDateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy) {
    let y = dmy[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

function requirePeriod(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) {
    const err = new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }
  if (!parseDateOnly(fechaInicio) || !parseDateOnly(fechaFin)) {
    const err = new Error('fechaInicio y fechaFin deben ser YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
}

function pct(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t === 0) return null;
  return Math.round((p / t) * 1000) / 10;
}

function metric({ key, label, disponible, meta = null, real = null, unidad = null, fuente = null, detalle = null, nota = null }) {
  const avancePct = meta != null && real != null && Number(meta) !== 0
    ? Math.round((Number(real) / Number(meta)) * 1000) / 10
    : null;
  return {
    key,
    label,
    disponible: Boolean(disponible),
    meta,
    real,
    unidad,
    avancePct,
    fuente,
    detalle,
    nota,
  };
}

function catalogoCobertura() {
  return [
    { key: 'volumen', label: 'Volumen / entregas SOFIA', status: 'ok', endpoint: '/api/objetivos-resultados/volumen' },
    { key: 'facturacion', label: 'Facturación DMS', status: 'ok', endpoint: '/api/objetivos-resultados/volumen' },
    { key: 'lineasProducto', label: 'Desglose por línea / modelo', status: 'ok', endpoint: '/api/objetivos-resultados/lineas' },
    { key: 'gmf', label: 'Contratos GMF y penetración', status: 'ok', endpoint: '/api/objetivos-resultados/financiamiento' },
    { key: 'gmfSeminuevos', label: 'Contratos GMF Seminuevos', status: 'ok', endpoint: '/api/objetivos-resultados/financiamiento' },
    { key: 'onstar', label: 'OnStar', status: 'ok', endpoint: '/api/objetivos-resultados/financiamiento' },
    { key: 'accesorios', label: 'Accesorios (monto PVA)', status: 'ok', endpoint: '/api/objetivos-resultados/financiamiento' },
    { key: 'seminuevos', label: 'TAC Nuevos', status: 'ok', endpoint: '/api/objetivos-resultados/seminuevos' },
    { key: 'afluencia', label: 'Tráfico / afluencia / citas', status: 'ok', endpoint: '/api/objetivos-resultados/afluencia' },
    { key: 'solicitudes', label: 'Solicitudes (Google Sheets CRM)', status: 'ok', endpoint: '/api/objetivos-resultados/solicitudes' },
    { key: 'leads', label: 'Leads / citas CRM', status: 'parcial', endpoint: '/api/objetivos-resultados/afluencia' },
    { key: 'diario', label: 'Serie diaria facturas/entregas', status: 'ok', endpoint: '/api/objetivos-resultados/diario' },
    { key: 'fuerzaVentas', label: 'Asesores y productividad', status: 'ok', endpoint: '/api/objetivos-resultados/volumen' },
    { key: 'bdc', label: 'Embudo BDC 25/80/60/40', status: 'ok', endpoint: '/api/objetivos-resultados/afluencia' },
    { key: 'marketShare', label: 'Market share vs industria', status: 'no_disponible', endpoint: null },
    { key: 'essentials', label: 'Essentials anual / multianual (OnStar por plazo)', status: 'ok', endpoint: '/api/objetivos-resultados/financiamiento' },
    { key: 'tacCertificaciones', label: 'TAC / Certificaciones / Garantía Plus', status: 'no_disponible', endpoint: null },
  ];
}

function getPlantillaMetas({ fechaInicio, fechaFin } = {}) {
  const start = parseDateOnly(fechaInicio);
  const esAgosto2026 = start
    && start.getFullYear() === 2026
    && start.getMonth() === 7;
  return {
    plantillaId: 'agosto-2026-pdf',
    aplicadaAlPeriodo: Boolean(esAgosto2026),
    ...METAS_AGOSTO_2026,
  };
}

/**
 * Traduce la descripción comercial del DMS (VEH_TIPOAUTO) a la línea del PDF.
 * El orden importa: las variantes más específicas se evalúan primero.
 */
const REGLAS_LINEA = [
  [/AVEO\s*4\s*PTAS/, 'Aveo NB'],
  [/AVEO\s*5\s*PTAS/, 'Aveo HB'],
  [/AVEO/, 'Aveo HB'],
  [/ONIX/, 'Onix'],
  [/TRACKER/, 'Tracker'],
  [/TRAX/, 'Trax'],
  [/CAPTIVA\s*PHEV/, 'Captiva PHEV SUV'],
  [/CAPTIVA/, 'Captiva'],
  [/GROOVE/, 'Groove'],
  [/TRAVERSE/, 'Traverse'],
  [/TAHOE/, 'Tahoe'],
  [/SUBURBAN/, 'Suburban'],
  [/BLAZER\s*EV/, 'Blazer EV'],
  [/SPARK\s*EUV/, 'Spark EUV'],
  [/EQUINOX\s*EV/, 'Equinox EV'],
  [/S10\s*MAX.*(CHASIS|CHASSIS)/, 'S10 MAX Chassis Cab'],
  [/S10\s*MAX.*CREW/, 'S10 MAX Crew Cab'],
  [/S10\s*MAX.*(CABINA\s*REGULAR|REGULAR\s*CAB)/, 'S10 MAX Regular Cab'],
  [/S10/, 'S10 MAX Crew Cab'],
  [/(SILVERADO|CHEYENNE).*(CHASIS|CHASSIS)/, 'Silverado Chassis Cab'],
  [/(SILVERADO|CHEYENNE).*(DOBLE\s*CABINA|CREW)/, 'Silverado / Cheyenne Crew Cab'],
  [/(SILVERADO|CHEYENNE)/, 'Silverado / Cheyenne Crew Cab'],
  [/COLORADO/, 'Colorado'],
  [/MONTANA/, 'Montana'],
  [/TORNADO/, 'Tornado Van'],
  [/EXPRESS/, 'Express Max'],
  [/SPARK/, 'Spark EUV'],
  [/BLAZER/, 'Blazer EV'],
];

function normalizeLinea(descripcion) {
  const raw = String(descripcion || '').trim();
  if (!raw) return '(sin modelo)';
  const up = raw.toUpperCase().replace(/["'.]/g, ' ').replace(/\s+/g, ' ');
  for (const [regex, linea] of REGLAS_LINEA) {
    if (regex.test(up)) return linea;
  }
  return raw;
}

/** Letra de paquete en columna N (versión). Ignora año, LS/LT y el resto. */
function extractPaqueteLetter(version) {
  const up = String(version || '')
    .toUpperCase()
    .replace(/["'.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!up) return null;
  const named = up.match(/PAQ(?:UETE)?\s*([A-G])/);
  if (named) return named[1];
  const isolated = up.match(/(?:^|[/\s])([A-G])(?=$|[/\s])/);
  return isolated ? isolated[1] : null;
}

/**
 * Cruce de tráfico a piso: Aveo / S10 / Captiva se distinguen por col. N.
 * Aveo HB = A/B/C/G · Aveo NB = D/E/F
 * S10 Chassis = A · Crew = B · Regular = C/F
 * Captiva PHEV solo si la versión (o el auto) dice PHEV.
 */
function normalizeLineaTrafico(autoInteres, version) {
  const raw = String(autoInteres || '').trim();
  const up = raw.toUpperCase().replace(/["'.]/g, ' ').replace(/\s+/g, ' ');
  const ver = String(version || '').toUpperCase();
  const letter = extractPaqueteLetter(version);

  if (/AVEO/.test(up)) {
    if (/\bHB\b|HATCH|5\s*PTAS/.test(ver) || /\bHB\b|5\s*PTAS/.test(up)) return 'Aveo HB';
    if (/\b(SEDAN|NB)\b|4\s*PTAS/.test(ver) || /4\s*PTAS/.test(up)) return 'Aveo NB';
    if (letter && /[ABCG]/.test(letter)) return 'Aveo HB';
    if (letter && /[DEF]/.test(letter)) return 'Aveo NB';
    return 'AVEO';
  }

  if (/S10/.test(up)) {
    if (/CHASIS|CHASSIS/.test(ver) || /CHASIS|CHASSIS/.test(up)) return 'S10 MAX Chassis Cab';
    if (/CREW|DOBLE\s*CABINA/.test(ver) || /CREW|DOBLE\s*CABINA/.test(up)) return 'S10 MAX Crew Cab';
    if (/REGULAR|REG\s*CAB|CABINA\s*REGULAR/.test(ver) || /REGULAR/.test(up)) return 'S10 MAX Regular Cab';
    if (letter === 'A') return 'S10 MAX Chassis Cab';
    if (letter === 'B') return 'S10 MAX Crew Cab';
    if (letter && /[CF]/.test(letter)) return 'S10 MAX Regular Cab';
    return 'S10';
  }

  if (/CAPTIVA/.test(up)) {
    if (/PHEV/.test(ver) || /PHEV/.test(up)) return 'Captiva PHEV SUV';
    return 'Captiva';
  }

  return normalizeLinea(autoInteres);
}

/** Clave de Carline para cruzar líneas del PDF con columna M (UNIDAD Y PAQUETE). */
function carlineFromLineaPdf(linea) {
  const up = String(linea || '').toUpperCase().replace(/["'.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!up) return null;
  if (/^AVEO\s*HB/.test(up) || /^AVEO\s*5/.test(up)) return 'AVEO HB';
  if (/^AVEO\s*NB/.test(up) || /^AVEO\s*4/.test(up)) return 'AVEO NB';
  if (/^AVEO\b/.test(up)) return 'AVEO';
  if (/S10.*CHASIS|S10.*CHASSIS/.test(up)) return 'S10 MAX Chassis Cab';
  if (/S10.*CREW/.test(up)) return 'S10 MAX Crew Cab';
  if (/S10.*(CABINA\s*REGULAR|REGULAR\s*CAB)/.test(up)) return 'S10 MAX Regular Cab';
  if (/^S10/.test(up)) return 'S10';
  if (/SILVERADO|CHEYENNE/.test(up)) return 'SILVERADO';
  if (/CAPTIVA/.test(up)) {
    return /PHEV|HIBRIDA|HÍBRIDA/.test(up) ? 'CAPTIVA PHEV' : 'CAPTIVA';
  }
  if (/BLAZER/.test(up)) return 'BLAZER';
  if (/SPARK/.test(up)) return 'SPARK';
  if (/TORNADO/.test(up)) return 'TORNADO';
  if (/EXPRESS/.test(up)) return 'EXPRESS';
  if (/EQUINOX/.test(up)) return 'EQUINOX';
  const first = up.split(' ')[0];
  return first || null;
}

function loadTraficoDiario(fechaInicio, fechaFin) {
  const empty = { porFecha: new Map(), detallePorFecha: new Map() };
  const fs = require('fs');
  const path = require('path');
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '../../data/crm-ciclos.db');
  if (!fs.existsSync(dbPath)) return empty;

  const d = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const has = d.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_trafico_piso'`
    ).get();
    if (!has) return empty;

    const fi = String(fechaInicio).slice(0, 10);
    const ff = String(fechaFin).slice(0, 10);
    const rows = d.prepare(`
      SELECT fecha, hora_ingreso, asesor, cliente, auto_interes, comentarios,
             reconciliacion, medio, id_crm, centro_trabajo
      FROM crm_trafico_piso
      WHERE fecha IS NOT NULL
        AND (
          substr(fecha, 1, 10) BETWEEN ? AND ?
          OR fecha LIKE '__/__/____%'
          OR fecha LIKE '__-__-____%'
        )
    `).all(fi, ff);

    const porFecha = new Map();
    const detallePorFecha = new Map();
    const maxPorDia = 80;
    for (const row of rows) {
      const iso = toIsoDate(row.fecha);
      if (!iso || iso < fi || iso > ff) continue;
      if (!isNuevos(row.comentarios)) continue;
      if (!classifyReconciliacion(row.reconciliacion).afluencia) continue;
      porFecha.set(iso, (porFecha.get(iso) || 0) + 1);
      if (!detallePorFecha.has(iso)) detallePorFecha.set(iso, []);
      const list = detallePorFecha.get(iso);
      if (list.length >= maxPorDia) continue;
      list.push({
        cliente: row.cliente || null,
        asesor: row.asesor || null,
        autoInteres: row.auto_interes || null,
        hora: row.hora_ingreso || null,
        sucursal: row.centro_trabajo || null,
        tipo: row.reconciliacion || null,
        medio: row.medio || null,
        idCrm: row.id_crm != null ? String(row.id_crm) : null,
      });
    }
    return { porFecha, detallePorFecha };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

async function loadInventarioPorLinea() {
  const empty = { porLinea: new Map(), porCarline: new Map(), total: 0 };
  try {
    const { query } = require('../db');
    const rows = await query(`
      SELECT
        LTRIM(RTRIM(ISNULL(v.VEH_TIPOAUTO, ''))) AS tipoAuto,
        LTRIM(RTRIM(ISNULL(c.UNC_FAMILIA, ''))) AS familia,
        COUNT(*) AS unidades
      FROM SER_VEHICULO v
      INNER JOIN UNI_CATALOGO c
        ON c.UNC_MODELO = v.VEH_ANMODELO
        AND c.UNC_IDCATALOGO = v.VEH_CATALOGO
      WHERE v.VEH_SITUACION IN ('FIS', 'DIS', 'PED', 'PEN', 'SEP', 'DEMO', 'TRAN')
      GROUP BY
        LTRIM(RTRIM(ISNULL(v.VEH_TIPOAUTO, ''))),
        LTRIM(RTRIM(ISNULL(c.UNC_FAMILIA, '')))
    `);
    const porLinea = new Map();
    const porCarline = new Map();
    let total = 0;
    for (const row of rows || []) {
      const n = Number(row.unidades || row.UNIDADES || 0) || 0;
      if (!n) continue;
      const tipo = String(row.tipoAuto || row.tipoauto || '').trim();
      const familia = String(row.familia || '').trim();
      const linea = normalizeLinea(tipo || familia);
      const carlineKey = String(
        carlineFromLineaPdf(linea !== '(sin modelo)' ? linea : `${familia} ${tipo}`)
        || carlineFromLineaPdf(familia)
        || ''
      ).toUpperCase();
      porLinea.set(linea, (porLinea.get(linea) || 0) + n);
      if (carlineKey) porCarline.set(carlineKey, (porCarline.get(carlineKey) || 0) + n);
      total += n;
    }
    return { porLinea, porCarline, total };
  } catch {
    return empty;
  }
}

function loadTraficoPorLinea(fechaInicio, fechaFin) {
  const empty = { porLinea: new Map(), porCarline: new Map(), total: 0 };
  const fs = require('fs');
  const path = require('path');
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '../../data/crm-ciclos.db');
  if (!fs.existsSync(dbPath)) return empty;

  const d = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const has = d.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_trafico_piso'`
    ).get();
    if (!has) return empty;

    const fi = String(fechaInicio).slice(0, 10);
    const ff = String(fechaFin).slice(0, 10);
    const rows = d.prepare(`
      SELECT fecha, auto_interes, version, comentarios, reconciliacion
      FROM crm_trafico_piso
      WHERE fecha IS NOT NULL
        AND (
          substr(fecha, 1, 10) BETWEEN ? AND ?
          OR fecha LIKE '__/__/____%'
          OR fecha LIKE '__-__-____%'
        )
    `).all(fi, ff);

    const porLinea = new Map();
    const porCarline = new Map();
    let total = 0;
    for (const row of rows) {
      const iso = toIsoDate(row.fecha);
      if (!iso || iso < fi || iso > ff) continue;
      if (!isNuevos(row.comentarios)) continue;
      if (!classifyReconciliacion(row.reconciliacion).afluencia) continue;
      const linea = normalizeLineaTrafico(row.auto_interes, row.version);
      const resolved = linea !== '(sin modelo)' && linea !== 'AVEO' && linea !== 'S10';
      const carlineKey = String(
        carlineFromLineaPdf(resolved ? linea : row.auto_interes)
        || carlineFromLineaPdf(row.auto_interes)
        || ''
      ).toUpperCase();
      porLinea.set(linea, (porLinea.get(linea) || 0) + 1);
      if (carlineKey && linea !== 'AVEO' && linea !== 'S10') {
        porCarline.set(carlineKey, (porCarline.get(carlineKey) || 0) + 1);
      }
      total += 1;
    }
    return { porLinea, porCarline, total };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

function buildLineasDesdeVentas(registros = [], entregasRows = [], metasLineas = []) {
  const agg = new Map();
  const bump = (descripcion, campo) => {
    const linea = normalizeLinea(descripcion);
    if (!agg.has(linea)) {
      agg.set(linea, { linea, facturas: 0, entregas: 0, modelosDms: new Set() });
    }
    const row = agg.get(linea);
    row[campo] += 1;
    if (descripcion) row.modelosDms.add(String(descripcion).trim());
  };

  for (const r of registros || []) bump(r.VEH_TIPOAUTO, 'facturas');
  for (const e of entregasRows || []) bump(e.VEH_TIPOAUTO, 'entregas');

  const familiaPorLinea = new Map(
    (metasLineas || []).map((m) => [m.linea, m.familia || null])
  );

  const reales = [...agg.values()]
    .map((row) => ({
      linea: row.linea,
      familia: familiaPorLinea.get(row.linea) || null,
      facturas: row.facturas,
      entregas: row.entregas,
      trafico: null,
      solicitudes: null,
      modelosDms: [...row.modelosDms].sort(),
      fuente: 'dms_facturas + sofia_entregas',
    }))
    .sort((a, b) => b.facturas - a.facturas || a.linea.localeCompare(b.linea));

  const metaMatch = (metasLineas || []).map((m) => {
    const row = agg.get(m.linea);
    const facturasReal = row ? row.facturas : 0;
    const entregasReal = row ? row.entregas : 0;
    return {
      ...m,
      facturasReal,
      entregasReal,
      avanceFacturasPct: pct(facturasReal, m.facturas),
      avanceEntregasPct: pct(entregasReal, m.entregas),
      pendienteFacturas: Math.max(0, Number(m.facturas || 0) - facturasReal),
      cumplida: facturasReal >= Number(m.facturas || 0),
      modelosDms: row ? [...row.modelosDms].sort() : [],
    };
  });

  const conMeta = new Set((metasLineas || []).map((m) => m.linea));
  const sinMeta = reales.filter((r) => !conMeta.has(r.linea));

  return { reales, metaMatch, sinMeta };
}

const VENDEDOR_SIN_DATO = /^\(?\s*(sin dato|sin vendedor|n\/?a)\s*\)?$/i;

function normalizePersonName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Excluye cuentas que facturan como casa / intercambios. */
function isVendedorCasa({ id = '', nombre = '' } = {}) {
  const uid = String(id || '').trim().toUpperCase();
  if (uid && USUARIOS_CASA_IDS.has(uid)) return true;
  const up = normalizePersonName(nombre);
  if (!up) return false;
  if (/\bCASA\b/.test(up)) return true;
  if (/\bINTERCAMBIOS\b/.test(up) && /\bBALDERRAMA\b/.test(up)) return true;
  return false;
}

/**
 * Productividad del periodo sobre la plantilla activa (no solo quien facturó).
 * Excluye facturas del canal CASA y vendedores-cuenta casa.
 */
function buildPlantillaVentas(ventas) {
  const registros = (ventas.registros || []).filter((r) => {
    const nombre = String(r.VENDEDOR || '').trim();
    if (!nombre || VENDEDOR_SIN_DATO.test(nombre)) return false;
    if (String(r.CANAL_VENTA || '').toUpperCase() === 'CASA') return false;
    if (isVendedorCasa({ nombre })) return false;
    return true;
  });

  const porVendedor = new Map();
  const retail = new Set();
  const flotilla = new Set();
  for (const r of registros) {
    const nombre = String(r.VENDEDOR).trim();
    porVendedor.set(nombre, (porVendedor.get(nombre) || 0) + 1);
    if (String(r.CANAL_VENTA || '').toUpperCase() === 'FLOTILLAS') flotilla.add(nombre);
    else retail.add(nombre);
  }

  const ejecutivosActivos = EJECUTIVOS_ACTIVOS_NUEVOS;
  const facturas = registros.length;
  const facturasRetail = registros.filter(
    (r) => String(r.CANAL_VENTA || '').toUpperCase() !== 'FLOTILLAS',
  ).length;
  const conVenta = porVendedor.size;
  const sinVenta = Math.max(0, ejecutivosActivos - conVenta);

  const promedio = (total, headcount) => (headcount > 0
    ? Math.round((total / headcount) * 10) / 10
    : null);

  return {
    ejecutivos: ejecutivosActivos,
    ejecutivosConVenta: conVenta,
    ejecutivosSinVenta: sinVenta,
    ejecutivosRetail: retail.size,
    ejecutivosFlotilla: flotilla.size,
    facturasConVendedor: facturas,
    promedioVentas: promedio(facturas, ejecutivosActivos),
    promedioVentasRetail: promedio(facturasRetail, ejecutivosActivos),
  };
}

function mapDiaLabelToIso(label, fallbackYear) {
  return toIsoDate(label) || null;
}

async function getVolumenResultados({ fechaInicio, fechaFin, ventas: ventasPrefetch = null }) {
  requirePeriod(fechaInicio, fechaFin);
  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  const [ventas, goals] = await Promise.all([
    ventasPrefetch || getVentas({ fechaInicio, fechaFin }),
    Promise.resolve(getGoals({ fechaInicio, fechaFin })),
  ]);
  const s = ventas.resumen || {};
  const metaVolumen = goals.sofia ?? metas.volumenReferencia;
  const metaFacturas = goals.retail ?? metas.facturasAFacturar;
  const entregas = Number(s.totalNotificacionesEntrega ?? (ventas.entregasSofia || []).length ?? 0);
  const facturas = Number(s.totalUnidadesFacturadas || s.totalVentas || 0);
  const plantilla = buildPlantillaVentas(ventas);
  const asesores = plantilla.ejecutivos;
  const ventasPorAsesor = plantilla.promedioVentas;

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    metasReferencia: {
      volumen: metaVolumen,
      facturas: metaFacturas,
      ventasPorAsesor: metas.ventasPorAsesor,
      goalsSource: { retail: goals.retailSource, sofia: goals.sofiaSource },
    },
    resultados: {
      volumen: metric({
        key: 'volumen',
        label: 'Entregas SOFIA',
        disponible: true,
        meta: metaVolumen,
        real: entregas,
        unidad: 'unidades',
        fuente: 'sofia_entregas',
        detalle: {
          entregasSinPrevias: s.totalEntregasSinPrevias ?? null,
          entregasConPrevias: s.totalEntregasConPrevias ?? null,
          demosSofia: s.totalDemosSofia ?? null,
          demosOtrosMeses: s.demosOtrosMeses ?? null,
          demosNota: s.sofiaDemosNota || null,
        },
        nota: s.sofiaDemosNota || null,
      }),
      facturacion: metric({
        key: 'facturacion',
        label: 'Unidades facturadas DMS',
        disponible: true,
        meta: metaFacturas,
        real: facturas,
        unidad: 'unidades',
        fuente: 'dms_ventas',
        detalle: {
          retail: s.totalRetail ?? null,
          flotillas: s.totalFlotillas ?? null,
          demos: s.totalDemos ?? null,
          demosSofia: s.totalDemosSofia ?? null,
          demosFacturaSinSofiaMes: s.demosFacturaSinSofiaMes ?? s.demosOtrosMeses ?? null,
          demosOtrosMeses: s.demosOtrosMeses ?? null,
          sinTimbrar: s.totalUnidadesFacturadasNoTimbradas ?? null,
          coberturaNumerador: s.numeradorCobertura ?? null,
        },
        nota: Number(s.totalDemos) > 0
          ? `${s.totalDemos} demo${Number(s.totalDemos) === 1 ? '' : 's'} en factura por fecha de facturación`
            + (Number(s.totalDemosSofia) > 0
              ? ` · ${s.totalDemosSofia} también en SOFIA (timbrado este mes)`
              : '')
            + (Number(s.demosFacturaSinSofiaMes || s.demosOtrosMeses) > 0
              ? ` · ${s.demosFacturaSinSofiaMes || s.demosOtrosMeses} sin timbrado de este mes (igual en factura)`
              : '')
            + '.'
          : null,
      }),
      carryOver: {
        key: 'carryOver',
        label: 'Carry over (informativo PDF)',
        disponible: true,
        informativo: true,
        meta: null,
        real: null,
        unidad: 'unidades',
        fuente: 'pdf_objetivos',
        avancePct: null,
        detalle: {
          inicialPdf: metas.carryOverInicial,
          finalEsperadoPdf: metas.carryOverFinalEsperado,
        },
        nota: 'Dato informativo del PDF mensual. No se calcula resultado operativo.',
      },
      fuerzaVentas: metric({
        key: 'fuerzaVentas',
        label: 'Vendedores activos',
        disponible: true,
        meta: metaVolumen && metas.ventasPorAsesor
          ? Math.floor(Number(metaVolumen) / Number(metas.ventasPorAsesor))
          : null,
        real: asesores,
        unidad: 'vendedores',
        fuente: 'plantilla_autos_nuevos',
        detalle: {
          conVenta: plantilla.ejecutivosConVenta,
          sinVenta: plantilla.ejecutivosSinVenta,
          ventasPorAsesorReal: ventasPorAsesor,
          ventasPorAsesorMeta: metas.ventasPorAsesor,
          excluyeCasa: true,
        },
        nota: 'Plantilla activa de autos nuevos. Incluye quien no facturó. Excluye cuentas casa.',
      }),
      promedioVentasEjecutivo: metric({
        key: 'promedioVentasEjecutivo',
        label: 'Promedio de ventas por vendedor',
        disponible: ventasPorAsesor != null,
        meta: metas.ventasPorAsesor,
        real: ventasPorAsesor,
        unidad: 'unidades por vendedor',
        fuente: 'dms_ventas / plantilla_autos_nuevos',
        detalle: {
          facturas: plantilla.facturasConVendedor,
          vendedoresActivos: asesores,
          conVenta: plantilla.ejecutivosConVenta,
          sinVenta: plantilla.ejecutivosSinVenta,
          promedioRetail: plantilla.promedioVentasRetail,
        },
        nota: 'Facturas del periodo (sin canal/cuenta casa) ÷ vendedores activos de plantilla.',
      }),
    },
  };
}

async function getLineasResultados({ fechaInicio, fechaFin, ventas: ventasPrefetch = null }) {
  requirePeriod(fechaInicio, fechaFin);
  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  const [ventas, sol, trafico, inventario] = await Promise.all([
    ventasPrefetch || getVentas({ fechaInicio, fechaFin }),
    Promise.resolve().then(() => {
      try {
        return loadSolicitudes(fechaInicio, fechaFin);
      } catch (e) {
        return { porCarline: [], error: e.message };
      }
    }),
    Promise.resolve().then(() => {
      try {
        return loadTraficoPorLinea(fechaInicio, fechaFin);
      } catch {
        return { porLinea: new Map(), porCarline: new Map(), total: 0 };
      }
    }),
    loadInventarioPorLinea(),
  ]);
  const built = buildLineasDesdeVentas(
    ventas.registros || [],
    ventas.entregasSofia || [],
    metas.lineasProducto,
  );

  const solByCarline = new Map(
    (sol?.porCarline || []).map((row) => [String(row.carline || '').toUpperCase(), row])
  );
  const carlineOwners = new Map();
  const ownersByKey = new Map();
  for (const m of metas.lineasProducto || []) {
    const key = String(carlineFromLineaPdf(m.linea) || '').toUpperCase();
    if (!key) continue;
    carlineOwners.set(key, (carlineOwners.get(key) || 0) + 1);
    if (!ownersByKey.has(key)) ownersByKey.set(key, []);
    ownersByKey.get(key).push(m);
  }

  // Evita doble conteo cuando varias líneas PDF comparten carline (p. ej. Captiva).
  const solicitudesAsignadas = new Map();
  for (const [key, siblings] of ownersByKey.entries()) {
    const total = Number(solByCarline.get(key)?.total || 0);
    if (siblings.length === 1) {
      solicitudesAsignadas.set(siblings[0].linea, total);
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
      solicitudesAsignadas.set(sibling.linea, value);
    });
  }

  const metaMatch = built.metaMatch.map((m) => {
    const carline = carlineFromLineaPdf(m.linea);
    const solicitudesReal = Number(solicitudesAsignadas.get(m.linea) || 0);
    const carlineKey = carline ? String(carline).toUpperCase() : '';
    const uniqueCarline = Boolean(carlineKey && carlineOwners.get(carlineKey) === 1);
    const fromLinea = Number(trafico.porLinea.get(m.linea) || 0);
    const fromCarline = uniqueCarline ? Number(trafico.porCarline.get(carlineKey) || 0) : 0;
    const skipTokenFallback = /^(AVEO|S10|CAPTIVA)/.test(carlineKey);
    const fromToken = uniqueCarline && !skipTokenFallback
      ? Number(trafico.porCarline.get(carlineKey.split(/\s+/)[0]) || 0)
      : 0;
    const traficoReal = fromLinea || fromCarline || fromToken;
    const inventarioFromLinea = Number(inventario.porLinea.get(m.linea) || 0);
    const inventarioFromCarline = uniqueCarline && !skipTokenFallback
      ? Number(inventario.porCarline.get(carlineKey) || 0)
      : 0;
    const inventarioReal = inventarioFromLinea || inventarioFromCarline;
    return {
      ...m,
      carline,
      solicitudesReal,
      avanceSolicitudesPct: pct(solicitudesReal, m.solicitudes),
      traficoReal,
      avanceTraficoPct: pct(traficoReal, m.trafico),
      inventarioReal,
    };
  });

  const carlinesUsados = new Set(
    metaMatch.map((m) => String(m.carline || '').toUpperCase()).filter(Boolean)
  );
  const carlinesSinMeta = (sol?.porCarline || []).filter((row) => {
    const key = String(row.carline || '').toUpperCase();
    return key && !carlinesUsados.has(key);
  });
  const solicitudesEnLineas = metaMatch.reduce((a, r) => a + Number(r.solicitudesReal || 0), 0);
  const solicitudesTotal = (sol?.porCarline || []).reduce((a, r) => a + Number(r.total || 0), 0);
  const solicitudesOtros = carlinesSinMeta.reduce((a, r) => a + Number(r.total || 0), 0);

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    disponible: true,
    nota: 'Real facturas/entregas = DMS + SOFIA. Solicitudes = col. M. Tráfico = crm_trafico_piso (NUEVOS · Fresh up + Citas).',
    resultados: {
      porModeloReal: built.reales,
      vsMetaPlantilla: metaMatch,
      lineasSinMeta: built.sinMeta,
      solicitudesPorCarline: sol?.porCarline || [],
      traficoPorLinea: Object.fromEntries(trafico.porLinea || []),
      inventarioPorLinea: Object.fromEntries(inventario.porLinea || []),
      carlinesSinMetaPdf: carlinesSinMeta,
      totalesReal: {
        facturas: built.reales.reduce((a, r) => a + Number(r.facturas || 0), 0),
        entregas: built.reales.reduce((a, r) => a + Number(r.entregas || 0), 0),
        solicitudes: solicitudesTotal,
        solicitudesEnLineas,
        solicitudesOtros,
        trafico: Number(trafico.total || 0),
        inventario: Number(inventario.total || 0),
        modelos: built.reales.length,
        lineasCumplidas: metaMatch.filter((m) => m.cumplida).length,
        lineasConMeta: metaMatch.length,
      },
    },
  };
}

async function getFinanciamientoResultados({ fechaInicio, fechaFin }) {
  requirePeriod(fechaInicio, fechaFin);
  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  const fi = await getFinanciamientoDashboard({ fechaInicio, fechaFin });
  const mix = fi.sofiaGmfMix || fi.retailMix || {};
  const summary = fi.summary || {};
  const onstar = fi.onstarTech || {};
  const essentialsFi = fi.essentials || {};
  const accesorios = (summary.porTipoPva || []).find((p) => p.key === 'accesorios') || null;
  const onstarPva = (summary.porTipoPva || []).find((p) => p.key === 'onstar') || null;

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    fuente: fi.fuente || null,
    resultados: {
      gmf: metric({
        key: 'gmf',
        label: 'Penetración GMF (entregas SOFIA)',
        disponible: mix.penetracionGmfPct != null || mix.gmf != null,
        meta: metas.penetracionGmfPct,
        real: mix.penetracionGmfPct ?? null,
        unidad: '%',
        fuente: 'sofia_gmf_mix',
        detalle: {
          entregasGmf: mix.gmf ?? null,
          entregasTotal: mix.totalSofia ?? mix.total ?? null,
          facturasGmf: mix.facturasGmf ?? null,
          contratosCrmMeta: metas.contratosGmf,
          // Solo nuevos: los seminuevos van en gmfSeminuevos (evita doble conteo).
          contratosCrmReal: summary.unidadesNuevos ?? null,
          contratosCrmTotales: summary.contratos ?? null,
          contratosCrmSeminuevos: summary.unidadesSeminuevos ?? null,
          contratosCrmFlotilla: summary.unidadesFlotilla ?? null,
          contratosCrmDemo: summary.unidadesDemo ?? null,
        },
      }),
      contratosGmf: metric({
        key: 'contratosGmf',
        label: 'Contratos GMF Nuevos',
        disponible: summary.unidadesNuevos != null,
        meta: metas.contratosGmf,
        real: summary.unidadesNuevos ?? null,
        unidad: 'contratos',
        fuente: 'crm_financiamiento.tipo_compra',
        detalle: {
          tipoCompra: 'NUEVO',
          columna: 'AN',
          excluye: ['SEMINUEVO', 'DEMO', 'FLOTILLA'],
          contratosTotales: summary.contratos ?? null,
          contratosSeminuevos: summary.unidadesSeminuevos ?? null,
          contratosDemo: summary.unidadesDemo ?? null,
          contratosFlotilla: summary.unidadesFlotilla ?? null,
        },
        nota: 'Solo AN=NUEVO. Seminuevos y DEMO no entran (tienen KPI aparte o se excluyen).',
      }),
      gmfSeminuevos: metric({
        key: 'gmfSeminuevos',
        label: 'Contratos GMF Seminuevos',
        disponible: summary.unidadesSeminuevos != null,
        meta: metas.contratosGmfSeminuevos ?? null,
        real: summary.unidadesSeminuevos ?? null,
        unidad: 'contratos',
        fuente: 'crm_financiamiento.tipo_compra',
        detalle: {
          tipoCompra: 'SEMINUEVO',
          columna: 'AN',
          contratosNuevos: summary.unidadesNuevos ?? null,
          contratosTotales: summary.contratos ?? null,
        },
        nota: 'Columna AN = SEMINUEVO. No se incluye en Contratos GMF Nuevos.',
      }),
      onstar: metric({
        key: 'onstar',
        label: 'OnStar',
        disponible: true,
        meta: metas.onstarUnidades,
        real: onstar.conContrato ?? onstarPva?.contratos ?? null,
        unidad: 'contratos',
        fuente: 'crm_financiamiento',
        detalle: {
          penetracionPct: onstar.penetracionPct ?? onstarPva?.penetracionPct ?? null,
          elegibles: onstar.elegibles ?? null,
          sinContrato: onstar.sinContrato ?? null,
          montoPva: onstarPva?.montoTotal ?? null,
          vins: (onstar.muestra || [])
            .filter((row) => row.hasOnstarContrato)
            .map((row) => String(row.vin || '').toUpperCase())
            .filter(Boolean),
          unidadesTech: (onstar.muestra || []).map((row) => ({
            vin: row.vin ? String(row.vin).toUpperCase() : null,
            unidad: row.unidad || null,
            fecha: row.fecha || null,
            hasOnstarContrato: Boolean(row.hasOnstarContrato),
            plazoOnstar: row.plazoOnstar || null,
            onstarMonto: row.onstarMonto ?? null,
            tipoCompra: row.tipoCompra || null,
            cliente: row.cliente || null,
          })),
        },
        nota: 'Elegibles = modelos con tecnología OnStar. Resultado = con contrato (monto/plazo) en el periodo.',
      }),
      accesorios: metric({
        key: 'accesorios',
        label: 'Accesorios (PVA)',
        disponible: Boolean(accesorios),
        meta: metas.accesoriosMonto,
        real: accesorios?.montoTotal ?? null,
        unidad: 'MXN',
        fuente: 'crm_financiamiento_pva',
        detalle: {
          contratos: accesorios?.contratos ?? null,
          penetracionPct: accesorios?.penetracionPct ?? null,
        },
      }),
      essentials: {
        key: 'essentials',
        label: 'Essentials anual / multianual',
        disponible: Number(essentialsFi.totalOnstar || 0) > 0 || essentialsFi.baseClasificada != null,
        fuente: essentialsFi.fuente || 'crm_financiamiento.plazo_onstar',
        meta: {
          anualPct: metas.essentialsAnualPct,
          multianualPct: metas.essentialsMultianualPct,
        },
        real: {
          anual: essentialsFi.anual ?? 0,
          multianual: essentialsFi.multianual ?? 0,
          anualPct: essentialsFi.anualPct,
          multianualPct: essentialsFi.multianualPct,
        },
        avancePct: {
          anual: essentialsFi.anualPct != null && metas.essentialsAnualPct
            ? Math.round((Number(essentialsFi.anualPct) / Number(metas.essentialsAnualPct)) * 1000) / 10
            : null,
          multianual: essentialsFi.multianualPct != null && metas.essentialsMultianualPct
            ? Math.round((Number(essentialsFi.multianualPct) / Number(metas.essentialsMultianualPct)) * 1000) / 10
            : null,
        },
        unidad: '% sobre OnStar con plazo 12 / +12',
        detalle: {
          totalOnstar: essentialsFi.totalOnstar ?? null,
          baseClasificada: essentialsFi.baseClasificada ?? null,
          sinPlazoOMenor12: essentialsFi.sinPlazoOMenor12 ?? null,
          porPlazo: essentialsFi.porPlazo || [],
        },
        nota: 'Histórico de contratos (Google Sheets): Anual = OnStar 12 meses; Multianual = OnStar +12 meses.',
      },
      pvas: {
        disponible: true,
        penetracionPvaPct: summary.penetracionPvaPct ?? null,
        montoTotalPvas: summary.montoTotalPvas ?? null,
        porTipo: summary.porTipoPva || [],
      },
    },
  };
}

async function getSolicitudesResultados({ fechaInicio, fechaFin, solicitudesPrefetch = null }) {
  requirePeriod(fechaInicio, fechaFin);
  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  let sol = null;
  let err = null;
  try {
    sol = solicitudesPrefetch || loadSolicitudes(fechaInicio, fechaFin);
  } catch (e) {
    err = e.message;
  }

  const total = sol?.total != null ? Number(sol.total) : null;
  const disponible = !err && total != null;

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    resultados: {
      solicitudes: metric({
        key: 'solicitudes',
        label: 'Solicitudes de crédito (Google Sheets)',
        disponible,
        meta: metas.solicitudesMinimas,
        real: disponible ? total : null,
        unidad: 'solicitudes',
        fuente: 'crm_solicitudes',
        detalle: {
          aprobadas: sol?.aprobadas ?? null,
          conCompra: sol?.conCompra ?? null,
          tasaAprobacionPct: sol?.tasaAprobacionPct ?? null,
          porEstatus: sol?.porEstatus || [],
          porFinanciera: sol?.porFinanciera || [],
          porCarline: sol?.porCarline || [],
          error: err,
        },
        nota: 'Fuente: hoja CRM de solicitudes (Google Sheets). Carline = columna M UNIDAD Y PAQUETE.',
      }),
    },
  };
}

async function fetchBdcFromCloud({ fechaInicio, fechaFin }) {
  const baseUrl = String(process.env.CLOUD_SYNC_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  if (!baseUrl || !apiKey) return null;
  const query = new URLSearchParams({ fechaInicio, fechaFin });
  const response = await fetch(`${baseUrl}/api/crm/bdc?${query}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload?.real) return null;
  return payload;
}

/**
 * Embudo BDC operativo en Railway (crm_ciclos). La SQLite local de Balderrama
 * Ciclos queda como respaldo histórico si la nube no responde o no tiene datos.
 */
async function resolveBdcEmbudo({ fechaInicio, fechaFin, metas }) {
  let cloud = null;
  let cloudErr = null;
  try {
    cloud = await fetchBdcFromCloud({ fechaInicio, fechaFin });
    if (Number(cloud?.real?.contactos || 0) > 0) {
      return {
        ...cloud,
        meta: metas,
        fuente: cloud.fuente || 'crm_ciclos (Railway)',
        nota: cloud.nota || 'Fuente operativa: CRM sincronizado en Railway.',
      };
    }
  } catch (err) {
    cloudErr = err.message;
  }

  let local = null;
  try {
    local = crmCiclos.getBdcEmbudo({ fechaInicio, fechaFin });
    if (Number(local?.real?.contactos || 0) > 0) {
      return {
        ...local,
        meta: metas,
        fuente: 'crm_actividades (histórico local)',
        nota: 'Respaldo histórico Balderrama Ciclos. La fuente operativa es Railway.',
      };
    }
  } catch (err) {
    local = { disponible: false, status: 'error', real: null, nota: err.message };
  }

  if (cloud?.real) {
    return {
      ...cloud,
      meta: metas,
      disponible: false,
      status: 'sin-datos',
      nota: cloud.nota || 'Sin contactos en Railway para el periodo.',
    };
  }

  return {
    ...(local || { disponible: false, status: 'sin-datos', real: null }),
    meta: metas,
    nota: cloudErr
      ? `Railway no disponible (${cloudErr}). Sin respaldo histórico local para el periodo.`
      : (local?.nota || 'Sin datos BDC en Railway ni en histórico local.'),
  };
}

async function getAfluenciaResultados({ fechaInicio, fechaFin, afluenciaPrefetch = null }) {
  requirePeriod(fechaInicio, fechaFin);
  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  let afluencia = null;
  let leads = null;
  let errA = null;
  let errL = null;
  try {
    afluencia = afluenciaPrefetch || getAfluenciaDashboard({ fechaInicio, fechaFin });
  } catch (e) {
    errA = e.message;
  }
  try {
    leads = crmCiclos.getLeadsDashboard({ fechaInicio, fechaFin });
  } catch (e) {
    errL = e.message;
  }

  const af = afluencia?.summary || {};
  const ld = leads?.summary || {};
  const cobLeads = leads?.cobertura || null;
  const leadsSinCarga = Boolean(cobLeads?.sinDatosEnPeriodo);
  const bdcMeta = metas.bdc;
  const bdc = await resolveBdcEmbudo({ fechaInicio, fechaFin, metas: bdcMeta });

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    resultados: {
      afluencia: metric({
        key: 'afluencia',
        label: 'Afluencia / tráfico piso (nuevos)',
        disponible: !errA,
        meta: null,
        real: af.afluenciaTotal ?? af.total ?? null,
        unidad: 'registros',
        fuente: 'crm_trafico_piso',
        detalle: {
          freshUp: af.freshUp ?? null,
          citas: af.citas ?? null,
          snv: af.snv ?? null,
          pruebasManejo: af.pruebasManejo ?? null,
          error: errA,
        },
        nota: `Meta PDF solicitudes mínimas: ${metas.solicitudesMinimas}`,
      }),
      leads: metric({
        key: 'leads',
        label: 'Leads / citas CRM',
        disponible: !errL && !leadsSinCarga,
        meta: metas.solicitudesMinimas,
        real: leadsSinCarga ? null : (ld.leads ?? null),
        unidad: 'leads',
        fuente: 'crm_leads',
        nota: leadsSinCarga && cobLeads?.maxFechaEntrada
          ? `Sin leads cargados en el periodo. Última carga CRM: ${cobLeads.maxFechaEntrada}.`
          : null,
        detalle: {
          cobertura: cobLeads,
          contactados: ld.contactados ?? null,
          citas: ld.citas ?? null,
          citasAsistidas: ld.citasAsistidas ?? null,
          compras: ld.compras ?? null,
          conversionCitaPct: ld.conversionCitaPct ?? null,
          conversionCompraPct: ld.conversionCompraPct ?? null,
          error: errL,
        },
      }),
      bdc: {
        ...bdc,
        meta: bdcMeta,
      },
    },
  };
}

async function getDiarioResultados({
  fechaInicio,
  fechaFin,
  ventas: ventasPrefetch = null,
  afluencia: afluenciaPrefetch = null,
  solicitudes: solicitudesPrefetch = null,
}) {
  requirePeriod(fechaInicio, fechaFin);
  const ventas = ventasPrefetch || await getVentas({ fechaInicio, fechaFin });
  let solicitudes = solicitudesPrefetch;
  if (!solicitudes) {
    try {
      solicitudes = loadSolicitudes(fechaInicio, fechaFin);
    } catch {
      solicitudes = { muestra: [] };
    }
  }

  const detallePorFecha = {};
  const addDetalle = (fecha, tipo, registro) => {
    if (!fecha) return;
    if (!detallePorFecha[fecha]) {
      detallePorFecha[fecha] = {
        trafico: [],
        solicitudes: [],
        facturas: [],
        entregas: [],
      };
    }
    detallePorFecha[fecha][tipo].push(registro);
  };

  const facturasPorFecha = new Map();
  for (const d of ventas.resumen?.porDia || []) {
    const iso = mapDiaLabelToIso(d.label);
    if (!iso) continue;
    facturasPorFecha.set(iso, (facturasPorFecha.get(iso) || 0) + Number(d.count || d.value || 0));
  }
  for (const factura of ventas.registros || []) {
    const iso = mapDiaLabelToIso(factura.VTE_FECHDOCTO);
    addDetalle(iso, 'facturas', {
      documento: factura.VTE_DOCTO || null,
      cliente: factura.CLIENTE || null,
      vendedor: factura.VENDEDOR || null,
      modelo: factura.VEH_TIPOAUTO || null,
      anioModelo: factura.VEH_ANMODELO || null,
      vin: factura.VTE_SERIE || null,
      canal: factura.CANAL_LABEL || factura.CANAL_VENTA || null,
      formaPago: factura.FORMAPAGO_ORIGINAL || null,
    });
  }

  const entregasPorFecha = new Map();
  for (const e of ventas.entregasSofia || []) {
    const iso = mapDiaLabelToIso(e.FECHA_PERIODO || e.SOF_FechAct || e.FECHA_FACTURA);
    if (!iso) continue;
    entregasPorFecha.set(iso, (entregasPorFecha.get(iso) || 0) + 1);
    addDetalle(iso, 'entregas', {
      factura: e.SOF_Factura || null,
      cliente: e.CLIENTE || null,
      modelo: e.VEH_TIPOAUTO || null,
      vin: e.SOF_VIN || null,
      hora: e.SOF_HoraAct || null,
      usuario: e.SOF_CveUSu || null,
      formaPago: e.FORMAPAGO_ORIGINAL || null,
      tipoVenta: e.TIPOVENTA || null,
    });
  }

  let traficoPorFecha = new Map();
  try {
    const traficoDiario = loadTraficoDiario(fechaInicio, fechaFin);
    traficoPorFecha = traficoDiario.porFecha;
    for (const [iso, registros] of traficoDiario.detallePorFecha) {
      for (const registro of registros) addDetalle(iso, 'trafico', registro);
    }
  } catch {
    traficoPorFecha = new Map();
  }

  const solicitudesPorFecha = new Map();
  for (const solicitud of solicitudes.muestra || []) {
    const iso = toIsoDate(solicitud.fecha);
    if (!iso) continue;
    solicitudesPorFecha.set(iso, (solicitudesPorFecha.get(iso) || 0) + 1);
    const list = detallePorFecha[iso]?.solicitudes;
    if (list && list.length >= 80) continue;
    addDetalle(iso, 'solicitudes', {
      cliente: solicitud.cliente || null,
      asesor: solicitud.asesor || null,
      unidad: solicitud.unidad || solicitud.carline || null,
      estatus: solicitud.estatus || null,
      financiera: solicitud.financiera || null,
      noSolicitud: solicitud.noSolicitud || null,
      idCrm: solicitud.idCrm || null,
    });
  }

  const serie = [];
  let traficoAcum = 0;
  let solicitudesAcum = 0;
  let facturasAcum = 0;
  let entregasAcum = 0;
  const cursor = parseDateOnly(fechaInicio);
  const fin = parseDateOnly(fechaFin);
  while (cursor && fin && cursor <= fin) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const trafico = traficoPorFecha.get(iso) || 0;
    const solicitudesDia = solicitudesPorFecha.get(iso) || 0;
    const facturas = facturasPorFecha.get(iso) || 0;
    const entregas = entregasPorFecha.get(iso) || 0;
    traficoAcum += trafico;
    solicitudesAcum += solicitudesDia;
    facturasAcum += facturas;
    entregasAcum += entregas;
    serie.push({
      fecha: iso,
      dia: cursor.getDate(),
      trafico,
      solicitudes: solicitudesDia,
      facturas,
      entregas,
      traficoAcum,
      solicitudesAcum,
      facturasAcum,
      entregasAcum,
      conMovimiento: trafico > 0 || solicitudesDia > 0 || facturas > 0 || entregas > 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const ultimoConMovimiento = [...serie].reverse().find((d) => d.conMovimiento) || null;

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    disponible: true,
    status: 'ok',
    nota: 'Serie y detalle diario de tráfico, solicitudes, facturas DMS y entregas SOFIA.',
    resultados: {
      serie,
      detallePorFecha,
      totalTrafico: traficoAcum,
      totalSolicitudes: solicitudesAcum,
      facturasPorDia: serie.map((d) => ({ fecha: d.fecha, label: d.fecha, facturas: d.facturas })),
      entregasPorDia: serie.map((d) => ({ fecha: d.fecha, entregas: d.entregas })),
      totalFacturas: facturasAcum,
      totalEntregas: entregasAcum,
      ultimoDiaConMovimiento: ultimoConMovimiento?.fecha || null,
    },
  };
}

async function getSeminuevosResultados({
  fechaInicio,
  fechaFin,
  tomas: tomasPrefetch = null,
  skipExtras = false,
}) {
  requirePeriod(fechaInicio, fechaFin);
  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  const [eeff, fi, tomas] = await Promise.all([
    skipExtras
      ? Promise.resolve(null)
      : getEeffSummary({ fechaInicio, fechaFin }).catch((e) => ({ error: e.message })),
    skipExtras
      ? Promise.resolve(null)
      : getFinanciamientoDashboard({ fechaInicio, fechaFin }).catch((e) => ({ error: e.message })),
    tomasPrefetch
      ? Promise.resolve(tomasPrefetch)
      : getTomasACuenta({ fechaInicio, fechaFin }).catch((e) => ({ error: e.message, total: null })),
  ]);
  const ventasSem = eeff?.seminuevos?.summary?.ventas ?? null;
  const contratosSem = fi?.summary?.unidadesSeminuevos ?? null;
  const tomasTotal = tomas?.total != null ? Number(tomas.total) : null;
  const tomasDisponible = tomasTotal != null && !tomas?.error;

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    resultados: {
      seminuevos: metric({
        key: 'seminuevos',
        label: 'TAC Nuevos',
        disponible: tomasDisponible || ventasSem != null || contratosSem != null,
        meta: metas.tacNuevos ?? null,
        real: tomasDisponible ? tomasTotal : null,
        unidad: 'tomas',
        fuente: 'dms_tomas_a_cuenta',
        detalle: {
          tomasACuenta: tomasTotal,
          montoTomas: tomas?.montoTotal ?? null,
          montoAdquisicion: tomas?.montoAdquisicion ?? null,
          vendidasMismoMes: tomas?.totalVendidosMismoMes ?? null,
          pctVendidasMismoMes: tomas?.pctVendidosMismoMes ?? null,
          puntosMetaPdf: metas.usedVehiclesPoints ?? null,
          ventasEeffMxn: ventasSem,
          contratosCrm: contratosSem,
          errorTomas: tomas?.error || null,
          errorEeff: eeff?.error || null,
          errorFi: fi?.error || null,
        },
        nota: 'Resultado = tomas a cuenta del periodo. Meta = TAC Nuevos del PDF (no los puntos de scorecard).',
      }),
    },
  };
}

async function getObjetivosResultadosCompleto({ fechaInicio, fechaFin }) {
  requirePeriod(fechaInicio, fechaFin);

  // Una sola carga de ventas/tomas para no saturar DMS (antes: 3–4 llamadas en paralelo → hang ups).
  const ventas = await getVentas({ fechaInicio, fechaFin });
  const tomasFromVentas = {
    total: ventas?.resumen?.totalTomasACuenta ?? null,
    montoTotal: ventas?.resumen?.montoTomasACuenta ?? null,
    montoAdquisicion: ventas?.resumen?.montoAdquisicionTomas ?? null,
    totalVendidosMismoMes: ventas?.resumen?.totalTomasVendidasMismoMes ?? null,
    pctVendidosMismoMes: ventas?.resumen?.pctTomasVendidasMismoMes ?? null,
    error: ventas?.tomasACuenta?.error || null,
  };
  let afluenciaRaw = null;
  let solicitudesRaw = null;
  try {
    afluenciaRaw = getAfluenciaDashboard({ fechaInicio, fechaFin, limit: 2000 });
  } catch { /* El resultado parcial conserva facturas y entregas. */ }
  try {
    solicitudesRaw = loadSolicitudes(fechaInicio, fechaFin);
  } catch { /* El resultado parcial conserva el resto del calendario. */ }

  const [
    volumen,
    lineas,
    financiamiento,
    afluencia,
    solicitudes,
    diario,
    seminuevos,
  ] = await Promise.all([
    getVolumenResultados({ fechaInicio, fechaFin, ventas }),
    getLineasResultados({ fechaInicio, fechaFin, ventas }),
    getFinanciamientoResultados({ fechaInicio, fechaFin }),
    getAfluenciaResultados({ fechaInicio, fechaFin, afluenciaPrefetch: afluenciaRaw }),
    getSolicitudesResultados({ fechaInicio, fechaFin, solicitudesPrefetch: solicitudesRaw }),
    getDiarioResultados({
      fechaInicio,
      fechaFin,
      ventas,
      afluencia: afluenciaRaw,
      solicitudes: solicitudesRaw,
    }),
    getSeminuevosResultados({ fechaInicio, fechaFin, tomas: tomasFromVentas, skipExtras: true }),
  ]);

  const metas = getPlantillaMetas({ fechaInicio, fechaFin });

  return {
    periodo: { fechaInicio, fechaFin },
    formato: 'objetivos-resultados-v1',
    generadoEn: new Date().toISOString(),
    plantillaMetas: metas,
    catalogo: catalogoCobertura(),
    disponibilidad: Object.fromEntries(
      catalogoCobertura().map((c) => [c.key, c.status])
    ),
    resultados: {
      ...volumen.resultados,
      lineasProducto: lineas.resultados,
      ...financiamiento.resultados,
      ...afluencia.resultados,
      ...solicitudes.resultados,
      diario: diario.resultados,
      ...seminuevos.resultados,
      marketShare: metric({
        key: 'marketShare',
        label: 'Market share',
        disponible: false,
        meta: metas.marketShareObjetivoPct,
        real: null,
        unidad: '%',
        nota: `Sin industria estimada (${metas.industriaEstimada}).`,
      }),
      tacCertificaciones: metric({
        key: 'tacCertificaciones',
        label: 'TAC / Certificaciones / Garantía Plus',
        disponible: false,
        meta: null,
        real: null,
        nota: 'Sin módulo de scorecard GM.',
      }),
    },
  };
}

module.exports = {
  METAS_AGOSTO_2026,
  catalogoCobertura,
  normalizeLinea,
  normalizeLineaTrafico,
  getPlantillaMetas,
  getObjetivosResultadosCompleto,
  getVolumenResultados,
  getLineasResultados,
  getFinanciamientoResultados,
  getAfluenciaResultados,
  getSolicitudesResultados,
  getDiarioResultados,
  getSeminuevosResultados,
};
