/**
 * Dashboard de Afluencia (Tráfico piso + Pruebas de manejo).
 * Columna T / reconciliacion: FRESH UP, CITA, SNV, CITA-SNV...
 */
const Database = require('better-sqlite3');
const path = require('path');
const { getLeadNotDuplicateSql } = require('./crmCiclosService');

const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');

const SUCURSALES = [
  { key: 'matriz', label: 'Matriz' },
  { key: 'zacatelco', label: 'Zacatelco' },
  { key: 'cholula', label: 'Cholula' },
];

function getDb() {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function hasTable(d, name) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function mapSucursalKey(centro, fuerza) {
  const c = norm(centro);
  const f = norm(fuerza);
  if (c.includes('ZACATELCO') || f.includes('ZACATELCO')) return 'zacatelco';
  if (c.includes('CHOLULA') || f.includes('CHOLULA')) return 'cholula';
  if (c.includes('MATRIZ') || f.includes('MATRIZ') || c.includes('SERDAN')) return 'matriz';
  return 'otras';
}

/** Columna R (COMENTARIOS): solo NUEVOS cuentan para afluencia. */
function isNuevos(comentarios) {
  const s = norm(comentarios).replace(/[^A-Z]/g, '');
  return s === 'NUEVOS' || s === 'NUVOS';
}

function classifyReconciliacion(value) {
  const s = norm(value).replace(/[_-]+/g, ' ');
  const freshUp = s.includes('FRESH');
  const snv = s.includes('SNV');
  const cita = s.includes('CITA');
  const beBack = s.includes('BE BACK') || s.includes('BEBACK') || s.includes('BEBCAK');
  return {
    freshUp,
    cita,
    snv,
    beBack,
    afluencia: freshUp || cita,
  };
}

function quarterOf(fecha) {
  const m = Number(String(fecha || '').slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  return Math.ceil(m / 3);
}

function emptyBucket(sucursal) {
  return {
    sucursal,
    afluenciaTotal: 0,
    freshUp: 0,
    citas: 0,
    snv: 0,
    beBack: 0,
    pruebasManejo: 0,
    registros: 0,
  };
}

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function emptyMonthMetrics(month) {
  return {
    month,
    label: MONTH_LABELS[month - 1] || `M${month}`,
    quarter: Math.ceil(month / 3),
    afluenciaTotal: 0,
    freshUp: 0,
    citas: 0,
    snv: 0,
    pruebasManejo: 0,
    registros: 0,
  };
}

function emptyQuarterSeries() {
  return [
    { quarter: 1, label: 'T1', afluenciaTotal: 0, freshUp: 0, citas: 0, snv: 0, pruebasManejo: 0, registros: 0 },
    { quarter: 2, label: 'T2', afluenciaTotal: 0, freshUp: 0, citas: 0, snv: 0, pruebasManejo: 0, registros: 0 },
    { quarter: 3, label: 'T3', afluenciaTotal: 0, freshUp: 0, citas: 0, snv: 0, pruebasManejo: 0, registros: 0 },
    { quarter: 4, label: 'T4', afluenciaTotal: 0, freshUp: 0, citas: 0, snv: 0, pruebasManejo: 0, registros: 0 },
  ];
}

function monthsOfQuarter(q) {
  const start = (Number(q) - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

/** Serie mensual del año, opcionalmente cortada a YTD (misma fecha MM-DD). */
function buildYearMonthSeries(d, year, ytdEndDate) {
  const series = Array.from({ length: 12 }, (_, i) => emptyMonthMetrics(i + 1));
  const byM = Object.fromEntries(series.map((m) => [m.month, m]));
  const inicio = `${year}-01-01`;
  const md = String(ytdEndDate || '').slice(5, 10);
  const fin = md && /^\d{2}-\d{2}$/.test(md) ? `${year}-${md}` : `${year}-12-31`;

  if (hasTable(d, 'crm_trafico_piso')) {
    const rows = d.prepare(`
      SELECT fecha, comentarios, reconciliacion
      FROM crm_trafico_piso
      WHERE fecha IS NOT NULL
        AND fecha >= ?
        AND fecha <= ?
    `).all(inicio, fin);

    for (const row of rows) {
      if (!isNuevos(row.comentarios)) continue;
      const month = Number(String(row.fecha || '').slice(5, 7));
      if (!month || !byM[month]) continue;
      const flags = classifyReconciliacion(row.reconciliacion);
      byM[month].registros += 1;
      if (flags.freshUp) byM[month].freshUp += 1;
      if (flags.cita) byM[month].citas += 1;
      if (flags.snv) byM[month].snv += 1;
      if (flags.afluencia) byM[month].afluenciaTotal += 1;
    }
  }

  if (hasTable(d, 'crm_pruebas_manejo')) {
    const pruebas = d.prepare(`
      SELECT fecha
      FROM crm_pruebas_manejo
      WHERE fecha IS NOT NULL
        AND fecha >= ?
        AND fecha <= ?
    `).all(inicio, fin);
    for (const p of pruebas) {
      const month = Number(String(p.fecha || '').slice(5, 7));
      if (!month || !byM[month]) continue;
      byM[month].pruebasManejo += 1;
    }
  }

  return series;
}

function sumMonthMetrics(months) {
  const out = {
    afluenciaTotal: 0,
    freshUp: 0,
    citas: 0,
    snv: 0,
    pruebasManejo: 0,
    registros: 0,
  };
  for (const m of months) {
    out.afluenciaTotal += Number(m.afluenciaTotal || 0);
    out.freshUp += Number(m.freshUp || 0);
    out.citas += Number(m.citas || 0);
    out.snv += Number(m.snv || 0);
    out.pruebasManejo += Number(m.pruebasManejo || 0);
    out.registros += Number(m.registros || 0);
  }
  return out;
}

function buildComparativoYtd(d, fechaFin) {
  const end = String(fechaFin || '').slice(0, 10);
  const year = Number(end.slice(0, 4));
  if (!Number.isFinite(year) || year < 2000) return null;
  const actualMonths = buildYearMonthSeries(d, year, end);
  const anteriorMonths = buildYearMonthSeries(d, year - 1, end);
  const maxQ = quarterOf(end) || 4;
  const maxMonth = Number(end.slice(5, 7)) || 12;

  return {
    anioActual: year,
    anioAnterior: year - 1,
    hasta: end.slice(5, 10),
    maxMonth,
    metricas: [
      { key: 'afluenciaTotal', label: 'Afluencia' },
      { key: 'freshUp', label: 'Fresh up' },
      { key: 'citas', label: 'Citas' },
      { key: 'snv', label: 'SNV' },
      { key: 'pruebasManejo', label: 'Pruebas de manejo' },
    ],
    trimestres: [1, 2, 3, 4]
      .filter((q) => q <= maxQ)
      .map((q) => {
        const monthNums = monthsOfQuarter(q);
        const actualQ = monthNums.map((m) => actualMonths[m - 1] || emptyMonthMetrics(m));
        const anteriorQ = monthNums.map((m) => anteriorMonths[m - 1] || emptyMonthMetrics(m));
        return {
          quarter: q,
          label: `T${q}`,
          actual: { quarter: q, label: `T${q}`, ...sumMonthMetrics(actualQ) },
          anterior: { quarter: q, label: `T${q}`, ...sumMonthMetrics(anteriorQ) },
          meses: monthNums.map((m, i) => ({
            month: m,
            label: MONTH_LABELS[m - 1],
            quarter: q,
            withinYtd: m <= maxMonth,
            actual: actualQ[i],
            anterior: anteriorQ[i],
          })),
        };
      }),
  };
}

/** Submedios que se consideran atracción de marketing (vs orgánico/cartera). */
const MARKETING_SUBMEDIOS = new Set([
  'REDES SOCIALES',
  'INTERNET',
  'ANUNCIO',
  'RADIO',
  'TV',
  'TELEVISION',
  'VOLANTEO',
  'PAGINA WEB',
  'EMAIL',
  'E MAIL',
  'FACEBOOK',
  'INSTAGRAM',
  'GOOGLE',
  'WHATSAPP',
  'TIKTOK',
  'YOUTUBE',
  'PUBLICIDAD',
  'PROMOCION',
  'CAMPANA',
]);

function labelTitle(value) {
  const s = String(value || '').trim();
  if (!s) return '(sin dato)';
  return s.replace(/\s+/g, ' ');
}

function isMarketingSubmedio(submedio) {
  const s = norm(submedio).replace(/[_-]+/g, ' ');
  if (!s) return false;
  if (MARKETING_SUBMEDIOS.has(s)) return true;
  return (
    s.includes('REDES')
    || s.includes('INTERNET')
    || s.includes('ANUNCIO')
    || s.includes('FACEBOOK')
    || s.includes('INSTAGRAM')
    || s.includes('GOOGLE')
    || s.includes('WEB')
    || s.includes('PUBLICIDAD')
    || s.includes('CAMPANA')
    || s.includes('PROMO')
  );
}

function bumpAgg(map, key, patch) {
  const k = key || '(sin dato)';
  if (!map[k]) {
    map[k] = {
      grupo: k,
      afluencia: 0,
      freshUp: 0,
      citas: 0,
      snv: 0,
      registros: 0,
      marketing: 0,
      organico: 0,
      compras: 0,
    };
  }
  const b = map[k];
  for (const [field, delta] of Object.entries(patch)) {
    b[field] = (b[field] || 0) + delta;
  }
}

function findAggByNorm(map, label) {
  const n = norm(label);
  if (!n) return null;
  for (const row of Object.values(map)) {
    if (norm(row.grupo) === n) return row;
  }
  return null;
}

function addComprasToMap(map, label, compras) {
  const n = Number(compras || 0);
  if (!n) return;
  const existing = findAggByNorm(map, label);
  if (existing) {
    existing.compras = (existing.compras || 0) + n;
    return;
  }
  bumpAgg(map, labelTitle(label), { compras: n });
}

function finalizeAgg(map, limit = 20) {
  return Object.values(map)
    .map((r) => ({
      ...r,
      conversionCompraPct: r.afluencia
        ? Math.round((Number(r.compras || 0) / Number(r.afluencia)) * 10000) / 100
        : (r.compras ? null : 0),
    }))
    .sort((a, b) => {
      const af = (b.afluencia || 0) - (a.afluencia || 0);
      if (af) return af;
      return (b.compras || 0) - (a.compras || 0);
    })
    .slice(0, limit);
}

function sortAgg(map, limit = 20) {
  return finalizeAgg(map, limit);
}

/**
 * Compras CRM (VIN) del periodo, atribuidas por medio / submedio / forma de contacto.
 */
function loadComprasPorCanal(d, fechaInicio, fechaFin) {
  if (!hasTable(d, 'crm_actividades')) {
    return { porMedio: [], porSubmedio: [], porFormaContacto: [], porMedioSubmedio: [], total: 0 };
  }

  const fechaExpr = 'COALESCE(fecha_factura, fecha_entrega, fecha_estatus, fecha_inicio_ciclo)';
  const total = Number(d.prepare(`
    SELECT COUNT(DISTINCT upper(trim(vin))) AS n
    FROM crm_actividades
    WHERE vin IS NOT NULL AND trim(vin) <> ''
      AND ${fechaExpr} >= ?
      AND ${fechaExpr} <= ?
  `).get(String(fechaInicio), String(fechaFin))?.n || 0);

  const rows = d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(medio_contacto), ''), '(sin dato)') AS medio,
      COALESCE(NULLIF(trim(submedio_contacto), ''), '(sin dato)') AS submedio,
      COALESCE(NULLIF(trim(forma_contacto), ''), '(sin dato)') AS forma,
      COUNT(DISTINCT upper(trim(vin))) AS compras
    FROM crm_actividades
    WHERE vin IS NOT NULL AND trim(vin) <> ''
      AND ${fechaExpr} >= ?
      AND ${fechaExpr} <= ?
    GROUP BY 1, 2, 3
  `).all(String(fechaInicio), String(fechaFin));

  const porMedio = {};
  const porSubmedio = {};
  const porFormaContacto = {};
  const porMedioSubmedio = {};

  for (const r of rows) {
    const compras = Number(r.compras || 0);
    if (!compras) continue;
    const medio = labelTitle(r.medio);
    const submedio = labelTitle(r.submedio);
    const forma = labelTitle(r.forma);
    const pair = `${medio} · ${submedio}`;
    porMedio[medio] = (porMedio[medio] || 0) + compras;
    porSubmedio[submedio] = (porSubmedio[submedio] || 0) + compras;
    porFormaContacto[forma] = (porFormaContacto[forma] || 0) + compras;
    porMedioSubmedio[pair] = (porMedioSubmedio[pair] || 0) + compras;
  }

  return {
    porMedio: Object.entries(porMedio).map(([grupo, compras]) => ({ grupo, compras })),
    porSubmedio: Object.entries(porSubmedio).map(([grupo, compras]) => ({ grupo, compras })),
    porFormaContacto: Object.entries(porFormaContacto).map(([grupo, compras]) => ({ grupo, compras })),
    porMedioSubmedio: Object.entries(porMedioSubmedio).map(([grupo, compras]) => ({ grupo, compras })),
    total,
  };
}

const COMPRA_LEAD_SQL_AF = `
  CASE WHEN (
    (vin_comprado IS NOT NULL AND trim(vin_comprado) <> '')
    OR EXISTS (
      SELECT 1 FROM crm_actividades a
      WHERE a.id_contacto = crm_leads.id_crm
        AND a.vin IS NOT NULL AND trim(a.vin) <> ''
    )
  ) THEN 1 ELSE 0 END
`;

/**
 * Marketing: origen del tráfico piso (medio/submedio) + campañas de leads activas.
 */
function buildMarketing(d, fechaInicio, fechaFin, traficoRows) {
  const porMedio = {};
  const porSubmedio = {};
  const porFormaContacto = {};
  const porMedioSubmedio = {};
  let afluenciaMarketing = 0;
  let afluenciaOrganico = 0;
  let afluenciaTotal = 0;

  for (const row of traficoRows) {
    if (!isNuevos(row.comentarios)) continue;
    const flags = classifyReconciliacion(row.reconciliacion);
    if (!flags.afluencia) continue;

    const medio = labelTitle(row.medio);
    const submedio = labelTitle(row.submedio);
    const forma = labelTitle(row.forma_contacto);
    const mkt = isMarketingSubmedio(row.submedio);
    const pair = `${medio} · ${submedio}`;

    afluenciaTotal += 1;
    if (mkt) afluenciaMarketing += 1;
    else afluenciaOrganico += 1;

    const patch = {
      afluencia: 1,
      freshUp: flags.freshUp ? 1 : 0,
      citas: flags.cita ? 1 : 0,
      snv: flags.snv ? 1 : 0,
      registros: 1,
      marketing: mkt ? 1 : 0,
      organico: mkt ? 0 : 1,
    };
    bumpAgg(porMedio, medio, patch);
    bumpAgg(porSubmedio, submedio, patch);
    bumpAgg(porFormaContacto, forma, patch);
    bumpAgg(porMedioSubmedio, pair, patch);
  }

  const comprasCanal = loadComprasPorCanal(d, fechaInicio, fechaFin);
  for (const r of comprasCanal.porMedio) addComprasToMap(porMedio, r.grupo, r.compras);
  for (const r of comprasCanal.porSubmedio) addComprasToMap(porSubmedio, r.grupo, r.compras);
  for (const r of comprasCanal.porFormaContacto) addComprasToMap(porFormaContacto, r.grupo, r.compras);
  for (const r of comprasCanal.porMedioSubmedio) addComprasToMap(porMedioSubmedio, r.grupo, r.compras);

  const pct = (n, den) => (den ? Math.round((n / den) * 10000) / 100 : 0);

  let campañasLeads = [];
  let porCanalLeads = [];
  let leadsSummary = {
    leads: 0,
    contactados: 0,
    citas: 0,
    cotizados: 0,
    compras: 0,
    campanasActivas: 0,
    campanasFuncionando: 0,
  };

  if (hasTable(d, 'crm_leads')) {
    const noDup = getLeadNotDuplicateSql();
    const totalesLeads = d.prepare(`
      SELECT
        COUNT(*) AS leads,
        SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
        SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
        SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
        SUM(${COMPRA_LEAD_SQL_AF}) AS compras,
        COUNT(DISTINCT COALESCE(NULLIF(trim(campana), ''), '(sin campaña)')) AS campanasActivas
      FROM crm_leads
      WHERE fecha_entrada IS NOT NULL
        AND fecha_entrada >= ?
        AND fecha_entrada <= ?
        AND (${noDup})
    `).get(String(fechaInicio), String(fechaFin));

    const rows = d.prepare(`
      SELECT
        COALESCE(NULLIF(trim(campana), ''), '(sin campaña)') AS campana,
        COALESCE(NULLIF(trim(canal), ''), '(sin canal)') AS canal,
        COUNT(*) AS leads,
        SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
        SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
        SUM(CASE WHEN cita_asistida = 'SI' THEN 1 ELSE 0 END) AS citasAsistidas,
        SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
        SUM(${COMPRA_LEAD_SQL_AF}) AS compras
      FROM crm_leads
      WHERE fecha_entrada IS NOT NULL
        AND fecha_entrada >= ?
        AND fecha_entrada <= ?
        AND (${noDup})
      GROUP BY campana, canal
      ORDER BY compras DESC, citas DESC, leads DESC
      LIMIT 40
    `).all(String(fechaInicio), String(fechaFin));

    campañasLeads = rows.map((r) => {
      const leads = Number(r.leads || 0);
      const contactados = Number(r.contactados || 0);
      const citas = Number(r.citas || 0);
      const compras = Number(r.compras || 0);
      const cotizados = Number(r.cotizados || 0);
      const citasAsistidas = Number(r.citasAsistidas || 0);
      const conversionContactoPct = pct(contactados, leads);
      const conversionCitaPct = pct(citas, leads);
      const conversionCompraPct = pct(compras, leads);
      const funcionando = compras >= 1 || citas >= 3 || (leads >= 20 && conversionCitaPct >= 3);
      const score = (compras * 100) + (citas * 10) + (citasAsistidas * 5) + contactados;
      return {
        campana: String(r.campana),
        canal: String(r.canal),
        leads,
        contactados,
        citas,
        citasAsistidas,
        cotizados,
        compras,
        conversionContactoPct,
        conversionCitaPct,
        conversionCompraPct,
        activa: true,
        funcionando,
        score,
        estado: funcionando ? (compras >= 1 ? 'Convierte' : 'Genera citas') : (leads >= 50 ? 'Alto volumen' : 'Baja respuesta'),
      };
    }).sort((a, b) => {
      if (b.funcionando !== a.funcionando) return b.funcionando ? 1 : -1;
      return b.score - a.score || b.leads - a.leads;
    });

    const canalMap = {};
    for (const c of campañasLeads) {
      if (!canalMap[c.canal]) {
        canalMap[c.canal] = {
          grupo: c.canal,
          leads: 0,
          contactados: 0,
          citas: 0,
          compras: 0,
          campanas: 0,
          funcionando: 0,
        };
      }
      const b = canalMap[c.canal];
      b.leads += c.leads;
      b.contactados += c.contactados;
      b.citas += c.citas;
      b.compras += c.compras;
      b.campanas += 1;
      if (c.funcionando) b.funcionando += 1;
    }
    porCanalLeads = Object.values(canalMap)
      .map((b) => ({
        ...b,
        conversionPct: pct(b.compras, b.leads),
      }))
      .sort((a, b) => b.leads - a.leads);

    leadsSummary = {
      leads: Number(totalesLeads?.leads || 0),
      contactados: Number(totalesLeads?.contactados || 0),
      citas: Number(totalesLeads?.citas || 0),
      cotizados: Number(totalesLeads?.cotizados || 0),
      compras: Number(totalesLeads?.compras || 0),
      campanasActivas: Number(totalesLeads?.campanasActivas || campañasLeads.length),
      campanasFuncionando: campañasLeads.filter((c) => c.funcionando).length,
    };
  }

  return {
    periodo: { fechaInicio, fechaFin },
    trafico: {
      summary: {
        afluenciaTotal,
        afluenciaMarketing,
        afluenciaOrganico,
        pctMarketing: pct(afluenciaMarketing, afluenciaTotal),
        pctOrganico: pct(afluenciaOrganico, afluenciaTotal),
        compras: comprasCanal.total,
        conversionCompraPct: pct(comprasCanal.total, afluenciaTotal),
      },
      porMedio: sortAgg(porMedio, 15),
      porSubmedio: sortAgg(porSubmedio, 25),
      porFormaContacto: sortAgg(porFormaContacto, 15),
      porMedioSubmedio: sortAgg(porMedioSubmedio, 25),
    },
    leads: {
      summary: leadsSummary,
      porCampana: campañasLeads,
      porCanal: porCanalLeads,
    },
    semantica: {
      trafico: 'Afluencia NUEVOS (Fresh up + Citas) atribuida por medio / submedio / forma de contacto',
      compras: 'Compras = VIN distintos en crm_actividades del periodo, atribuidos por medio_contacto / submedio_contacto / forma_contacto (mismo canal)',
      marketingVsOrganico: 'Marketing = submedios digitales/publicidad (redes, internet, anuncio, web…); resto = orgánico/cartera/recomendación',
      leads: 'Campañas con fecha_entrada en el periodo; “funcionando” = compras≥1 o citas≥3 o volumen con % cita ≥3%',
      sinCruce: 'No se cruza lead→piso por id_crm (dato no fiable en tráfico piso); las compras de canal vienen de ciclos CRM',
    },
  };
}


function getAfluenciaDashboard({ fechaInicio, fechaFin, limit = 300 } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }

  let d;
  try {
    d = getDb();
  } catch {
    throw Object.assign(new Error('Base CRM no disponible. Ejecute sync de Google Sheets.'), { status: 503 });
  }

  try {
    if (!hasTable(d, 'crm_trafico_piso')) {
      throw Object.assign(
        new Error('Tabla de tráfico piso no cargada. Ejecute: node backend/scripts/etl-crm-trafico-piso.js'),
        { status: 503 }
      );
    }

    const rows = d.prepare(`
      SELECT
        id, fuerza, centro_trabajo, mes_registro, fecha, hora_ingreso, asesor, cliente,
        genero, telefono, correo, auto_interes, forma_contacto, medio, submedio,
        comentarios, reconciliacion, id_crm, hostess, vin_venta
      FROM crm_trafico_piso
      WHERE fecha IS NOT NULL
        AND fecha >= ?
        AND fecha <= ?
      ORDER BY fecha DESC, id DESC
    `).all(String(fechaInicio), String(fechaFin));

    const summary = emptyBucket('General');
    delete summary.sucursal;
    const byKey = Object.fromEntries(SUCURSALES.map((s) => [s.key, emptyBucket(s.label)]));
    byKey.otras = emptyBucket('Otras');

    const detalle = [];
    const maxDetalle = Math.min(2000, Math.max(50, Number(limit) || 300));

    for (const row of rows) {
      // Solo unidad nueva (columna R / COMENTARIOS = NUEVOS)
      if (!isNuevos(row.comentarios)) continue;

      const flags = classifyReconciliacion(row.reconciliacion);
      const key = mapSucursalKey(row.centro_trabajo, row.fuerza);
      const buckets = [summary, byKey[key] || byKey.otras];

      for (const b of buckets) {
        b.registros += 1;
        if (flags.freshUp) b.freshUp += 1;
        if (flags.cita) b.citas += 1;
        if (flags.snv) b.snv += 1;
        if (flags.beBack) b.beBack += 1;
        if (flags.afluencia) b.afluenciaTotal += 1;
      }

      if (detalle.length < maxDetalle) {
        detalle.push({
          fecha: row.fecha,
          hora: row.hora_ingreso,
          sucursal: (byKey[key] || byKey.otras).sucursal,
          sucursalKey: key,
          fuerza: row.fuerza,
          centroTrabajo: row.centro_trabajo,
          asesor: row.asesor,
          cliente: row.cliente,
          telefono: row.telefono,
          autoInteres: row.auto_interes,
          formaContacto: row.forma_contacto,
          medio: row.medio,
          submedio: row.submedio,
          comentarios: row.comentarios,
          reconciliacion: row.reconciliacion,
          freshUp: flags.freshUp,
          cita: flags.cita,
          snv: flags.snv,
          beBack: flags.beBack,
          afluencia: flags.afluencia,
          idCrm: row.id_crm,
          hostess: row.hostess,
          vinVenta: row.vin_venta,
        });
      }
    }

    // Pruebas de manejo (hoja aparte)
    let pruebas = [];
    if (hasTable(d, 'crm_pruebas_manejo')) {
      pruebas = d.prepare(`
        SELECT
          id, fecha, fuerza_venta, centro_trabajo, ejecutivo_ventas, nombre_cliente,
          telefono, auto_interes, tipo_auto, vin, id_crm, hostess_registro
        FROM crm_pruebas_manejo
        WHERE fecha IS NOT NULL
          AND fecha >= ?
          AND fecha <= ?
        ORDER BY fecha DESC, id DESC
      `).all(String(fechaInicio), String(fechaFin));
    }

    summary.pruebasManejo = pruebas.length;
    for (const p of pruebas) {
      const key = mapSucursalKey(p.centro_trabajo, p.fuerza_venta);
      const b = byKey[key] || byKey.otras;
      b.pruebasManejo += 1;
    }

    const porSucursal = SUCURSALES.map((s) => byKey[s.key]);
    if (byKey.otras.registros > 0 || byKey.otras.pruebasManejo > 0) {
      porSucursal.push(byKey.otras);
    }

    const pruebasDetalle = pruebas.slice(0, maxDetalle).map((p) => {
      const key = mapSucursalKey(p.centro_trabajo, p.fuerza_venta);
      return {
        fecha: p.fecha,
        sucursal: (byKey[key] || byKey.otras).sucursal,
        sucursalKey: key,
        fuerza: p.fuerza_venta,
        centroTrabajo: p.centro_trabajo,
        ejecutivo: p.ejecutivo_ventas,
        cliente: p.nombre_cliente,
        telefono: p.telefono,
        autoInteres: p.auto_interes,
        tipoAuto: p.tipo_auto,
        vin: p.vin,
        idCrm: p.id_crm,
        hostess: p.hostess_registro,
      };
    });

    return {
      periodo: { fechaInicio, fechaFin },
      fuente: {
        trafico: 'crm_trafico_piso',
        pruebas: 'crm_pruebas_manejo',
        leads: 'crm_leads',
        hojaTrafico: 'Trafico piso',
        columnaTipo: 'T / Reconciliación',
        columnaSegmento: 'R / COMENTARIOS = NUEVOS',
      },
      summary,
      porSucursal,
      detalle,
      pruebasDetalle,
      comparativoYtd: buildComparativoYtd(d, fechaFin),
      marketing: buildMarketing(d, fechaInicio, fechaFin, rows),
      semantica: {
        alcance: 'Solo registros NUEVOS (columna R / COMENTARIOS)',
        afluenciaTotal: 'Fresh up + Citas (columna T), solo nuevos',
        freshUp: 'Reconciliación FRESH UP en nuevos',
        citas: 'Reconciliación CITA / CITA-SNV en nuevos',
        snv: 'Seguimiento a no vendidas (SNV / CITA-SNV) en nuevos',
        pruebasManejo: 'Registros de la hoja Prueba de manejo en el periodo',
        sucursales: 'Matriz (Serdan), Zacatelco y Cholula por centro/fuerza',
        comparativoYtd: 'Totales por trimestre del año de fechaFin vs mismo trimestre del año anterior',
        marketing: 'Origen de afluencia (medio/submedio) + campañas de leads activas/funcionando',
      },
    };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

module.exports = {
  getAfluenciaDashboard,
  mapSucursalKey,
  classifyReconciliacion,
  isNuevos,
  SUCURSALES,
};
