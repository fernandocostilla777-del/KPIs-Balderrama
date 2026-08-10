const fs = require('fs');
const path = require('path');
const { query } = require('../db');

const PLANS_JSON = path.join(__dirname, '../../data/planes-chevrolet-ago-my26.json');
const FICHAS_JSON = path.join(__dirname, '../../data/fichas-tecnicas-chevrolet.json');
const BENCHMARK_JSON = path.join(__dirname, '../../data/benchmarking-competidores-2026.json');
const INVENTORY_SITUATIONS = `('FIS', 'DIS', 'PED', 'PEN', 'SEP', 'DEMO', 'TRAN')`;

let benchmarkCache = null;

function loadBenchmarking() {
  if (benchmarkCache) return benchmarkCache;
  try {
    if (!fs.existsSync(BENCHMARK_JSON)) {
      benchmarkCache = { meta: null, byModelo: {} };
      return benchmarkCache;
    }
    benchmarkCache = JSON.parse(fs.readFileSync(BENCHMARK_JSON, 'utf8'));
  } catch {
    benchmarkCache = { meta: null, byModelo: {} };
  }
  return benchmarkCache;
}

function moneyMxLabel(n) {
  const v = Math.round(Number(n) || 0);
  if (!v) return null;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(v);
}

/**
 * Comparativo comercial vs rivales directos MX (año en curso).
 * Precio Chevrolet = MSRP guía; Oferta = precio final desde planes de la versión.
 */
function buildBenchmarkingForModelo(modeloNombre, versions = []) {
  const pack = loadBenchmarking();
  const entry = pack.byModelo?.[modeloNombre];
  if (!entry) return null;

  const msrps = versions.map((v) => Number(v.msrp) || 0).filter((n) => n > 0);
  const preciosFinal = versions
    .map((v) => Number(v.summary?.precioFinalDesde) || Number(v.msrp) || 0)
    .filter((n) => n > 0);
  const msrpMin = msrps.length ? Math.min(...msrps) : null;
  const ofertaDesde = preciosFinal.length ? Math.min(...preciosFinal) : msrpMin;
  const descuento = msrpMin != null && ofertaDesde != null ? Math.max(0, msrpMin - ofertaDesde) : 0;

  const nuestro = {
    marca: 'Chevrolet',
    modelo: modeloNombre,
    esNuestro: true,
    precio: moneyMxLabel(msrpMin) || 'Consultar',
    precioValor: msrpMin,
    oferta: descuento > 0
      ? `Desde ${moneyMxLabel(ofertaDesde)} (−${moneyMxLabel(descuento)} vs lista)`
      : (moneyMxLabel(ofertaDesde) ? `Desde ${moneyMxLabel(ofertaDesde)}` : 'Según guía vigente'),
    tecnologia: entry.nuestroResumen?.tecnologia || '—',
    seguridad: entry.nuestroResumen?.seguridad || '—',
    rendimiento: entry.nuestroResumen?.rendimiento || '—',
  };

  const filas = [
    nuestro,
    ...(entry.competidores || []).map((c) => ({
      marca: c.marca,
      modelo: c.modelo,
      esNuestro: false,
      precio: moneyMxLabel(c.precioListaDesde) || 'Consultar',
      precioValor: c.precioListaDesde || null,
      oferta: c.ofertaVigente || '—',
      tecnologia: c.tecnologia || '—',
      seguridad: c.seguridad || '—',
      rendimiento: c.rendimiento || '—',
    })),
  ];

  return {
    segmento: entry.segmento || null,
    criterio: entry.criterio || null,
    actualizado: pack.meta?.actualizado || null,
    anio: pack.meta?.anio || 2026,
    metodologia: pack.meta?.metodologia || null,
    filas,
  };
}

const SITUACION_LABELS = {
  FIS: 'Físico',
  DIS: 'Disponible',
  PED: 'Pedido',
  PEN: 'Pendiente',
  SEP: 'Apartada',
  DEMO: 'Demo',
  TRAN: 'Tránsito',
};

const CARROCERIA_BY_MODELO = {
  'AVEO HB': 'Hatchback',
  'AVEO NB': 'Sedán',
  'SPARK EUV': 'Crossover',
  ONIX: 'Sedán',
  'CAPTIVA HIBRIDA': 'SUV',
  CAPTIVA: 'SUV',
  'GROOVE NG': 'SUV',
  TRACKER: 'SUV',
  TRAX: 'SUV',
  'EQUINOX EV': 'SUV',
  'BLAZER EV': 'SUV',
  TRAVERSE: 'SUV',
  TAHOE: 'SUV',
  SUBURBAN: 'SUV',
  'S10 MAX': 'Pick up',
  MONTANA: 'Pick up',
  COLORADO: 'Pick up',
  SILVERADO: 'Pick up',
  'TORNADO VAN': 'Van',
  EXPRESS: 'Van',
  'EXPRESS MAX EV': 'Van',
};

let cachedPlans = null;
let cachedPlansAt = 0;
let cachedFichas = null;
let cachedFichasAt = 0;

function loadFichasTecnicas() {
  const mtime = fs.existsSync(FICHAS_JSON) ? fs.statSync(FICHAS_JSON).mtimeMs : 0;
  if (cachedFichas && cachedFichasAt === mtime) return cachedFichas;
  try {
    if (fs.existsSync(FICHAS_JSON)) {
      cachedFichas = JSON.parse(fs.readFileSync(FICHAS_JSON, 'utf8'));
      cachedFichasAt = mtime;
      return cachedFichas;
    }
  } catch {
    /* ignore */
  }
  cachedFichas = {};
  cachedFichasAt = mtime;
  return cachedFichas;
}

function normalizeKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function loadPlansCatalog() {
  const mtime = fs.existsSync(PLANS_JSON) ? fs.statSync(PLANS_JSON).mtimeMs : 0;
  if (cachedPlans && cachedPlansAt === mtime) return cachedPlans;
  if (!fs.existsSync(PLANS_JSON)) {
    throw Object.assign(new Error('Catálogo de planes no encontrado. Ejecute scripts/parse-planes-pdf.js'), { status: 503 });
  }
  cachedPlans = JSON.parse(fs.readFileSync(PLANS_JSON, 'utf8'));
  cachedPlansAt = mtime;
  return cachedPlans;
}

function invalidatePlansCache() {
  cachedPlans = null;
  cachedPlansAt = 0;
}

function extractPaqueteFromTipoAuto(tipoAuto) {
  const t = String(tipoAuto || '');
  const m = t.match(/PAQ\s*["']?\s*([A-Z0-9])\s*["']?/i)
    || t.match(/\bPAQUETE\s*["']?\s*([A-Z0-9])/i);
  return m ? m[1].toUpperCase() : null;
}

function scoreVersionMatch(tipoAuto, planVersion) {
  const unit = normalizeKey(tipoAuto);
  const ver = normalizeKey(planVersion);
  if (!unit || !ver) return 0;
  if (unit === ver) return 100;
  if (unit.includes(ver)) return 90;

  const verTokens = ver.split(' ').filter((t) => t.length > 1 && !['AT', 'MT', 'TA', 'RC', 'CC'].includes(t));
  if (!verTokens.length) return 0;
  const hits = verTokens.filter((t) => unit.includes(t)).length;
  const ratio = hits / verTokens.length;
  if (ratio >= 1) return 80;
  if (ratio >= 0.6) return 55;
  if (hits >= 2) return 40;
  return 0;
}

function inferLineaFromUnit(familia, tipoAuto) {
  const fam = normalizeKey(familia);
  const tipo = normalizeKey(tipoAuto);
  if (fam.includes('AVEO') || tipo.includes('AVEO')) {
    // DMS: 5 PTAS = hatchback (HB), 4 PTAS = sedán (NB)
    if (tipo.includes('5 PTAS') || tipo.includes('5P') || tipo.includes('HATCH') || /\bHB\b/.test(tipo)) {
      return 'AVEO HB';
    }
    if (tipo.includes('4 PTAS') || tipo.includes('4P') || tipo.includes('SEDAN') || /\bNB\b/.test(tipo)) {
      return 'AVEO NB';
    }
    // Paquetes A/B/C/G suelen ser HB; D/E/F NB en MY26
    const paq = extractPaqueteFromTipoAuto(tipoAuto);
    if (paq && 'ABCG'.includes(paq)) return 'AVEO HB';
    if (paq && 'DEF'.includes(paq)) return 'AVEO NB';
    return null;
  }
  if (fam.includes('SPARK') || tipo.includes('SPARK') || tipo.includes('ACTIV')) return 'SPARK EUV';
  if (fam.includes('ONIX') || tipo.includes('ONIX')) return 'ONIX';
  if ((fam.includes('CAPTIVA') || tipo.includes('CAPTIVA')) && (tipo.includes('HIB') || tipo.includes('HYB'))) {
    return 'CAPTIVA HIBRIDA';
  }
  if (fam.includes('CAPTIVA') || tipo.includes('CAPTIVA')) return 'CAPTIVA';
  if (fam.includes('GROOVE') || tipo.includes('GROOVE')) return 'GROOVE NG';
  if (fam.includes('TRACKER') || tipo.includes('TRACKER')) return 'TRACKER';
  if (fam.includes('TRAX') || tipo.includes('TRAX')) return 'TRAX';
  if (fam.includes('EQUINOX') || tipo.includes('EQUINOX')) return 'EQUINOX EV';
  if (fam.includes('BLAZER') || tipo.includes('BLAZER')) return 'BLAZER EV';
  if (fam.includes('TRAVERSE') || tipo.includes('TRAVERSE')) return 'TRAVERSE';
  if (fam.includes('TAHOE') || tipo.includes('TAHOE')) return 'TAHOE';
  if (fam.includes('SUBURBAN') || tipo.includes('SUBURBAN')) return 'SUBURBAN';
  if (fam.includes('S10') || tipo.includes('S10')) return 'S10 MAX';
  if (fam.includes('MONTANA') || tipo.includes('MONTANA')) return 'MONTANA';
  if (fam.includes('COLORADO') || tipo.includes('COLORADO')) return 'COLORADO';
  if (fam.includes('SILVERADO') || fam.includes('CHEYENNE') || tipo.includes('SILVERADO') || tipo.includes('CHEYENNE')) {
    return 'SILVERADO';
  }
  if (fam.includes('TORNADO') || tipo.includes('TORNADO')) return 'TORNADO VAN';
  if (tipo.includes('EXPRESS MAX') || fam.includes('EXPRESS MAX')) return 'EXPRESS MAX EV';
  if (fam.includes('EXPRESS') || tipo.includes('EXPRESS')) return 'EXPRESS';
  return fam || null;
}

async function loadInventoryUnits() {
  const rows = await query(`
    SELECT
      SER_VEHICULO.VEH_TIPOAUTO,
      UNI_CATALOGO.UNC_FAMILIA,
      UNI_CATALOGO.UNC_PRECLISTA,
      UNI_CATALOGO.UNC_PrecListaPub,
      SER_VEHICULO.VEH_NOINVENTA,
      SER_VEHICULO.VEH_CATALOGO,
      SER_VEHICULO.VEH_ANMODELO,
      SER_VEHICULO.VEH_NUMSERIE,
      SER_VEHICULO.VEH_COLOEXTE,
      E.COL_DESCRIPCION AS COLOR_EXT,
      SER_VEHICULO.VEH_UBICACION,
      SER_VEHICULO.VEH_SITUACION,
      SER_VEHICULO.VEH_FECREMISION
    FROM SER_VEHICULO
    INNER JOIN UNI_CATACOLOR AS E
      ON E.COL_CATALOGO = SER_VEHICULO.VEH_CATALOGO
      AND E.COL_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND E.COL_TIPO = 'EXTERIOR'
      AND SER_VEHICULO.VEH_COLOEXTE = E.COL_CLAVE
    INNER JOIN UNI_CATALOGO
      ON UNI_CATALOGO.UNC_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND UNI_CATALOGO.UNC_IDCATALOGO = SER_VEHICULO.VEH_CATALOGO
    WHERE SER_VEHICULO.VEH_SITUACION IN ${INVENTORY_SITUATIONS}
    ORDER BY UNI_CATALOGO.UNC_FAMILIA, SER_VEHICULO.VEH_TIPOAUTO
  `);

  return rows.map((r) => {
    const familia = String(r.UNC_FAMILIA || '').trim();
    const tipoAuto = String(r.VEH_TIPOAUTO || '').trim();
    const precioLista = Number(r.UNC_PrecListaPub || r.UNC_PRECLISTA || 0) || 0;
    const situacion = String(r.VEH_SITUACION || '').trim().toUpperCase();
    return {
      marca: 'Chevrolet',
      familia,
      tipoAuto,
      paqueteDms: extractPaqueteFromTipoAuto(tipoAuto),
      lineaPlan: inferLineaFromUnit(familia, tipoAuto),
      anModelo: String(r.VEH_ANMODELO || '').trim(),
      catalogo: String(r.VEH_CATALOGO || '').trim(),
      noInventario: r.VEH_NOINVENTA,
      serie: String(r.VEH_NUMSERIE || '').trim(),
      colorExterior: String(r.COLOR_EXT || r.VEH_COLOEXTE || '').trim(),
      ubicacion: String(r.VEH_UBICACION || '').trim(),
      situacion,
      situacionLabel: SITUACION_LABELS[situacion] || situacion,
      precioLista,
      precioListaPub: Number(r.UNC_PrecListaPub || 0) || 0,
      precioListaDist: Number(r.UNC_PRECLISTA || 0) || 0,
    };
  });
}

function bestPlanMatchForUnit(unit, planRows) {
  let best = null;
  let bestScore = 0;
  const unitPaq = extractPaqueteFromTipoAuto(unit.tipoAuto);

  for (const plan of planRows) {
    // No cruzar HB con NB (ni otras líneas distintas)
    if (unit.lineaPlan && plan.modelo && normalizeKey(unit.lineaPlan) !== normalizeKey(plan.modelo)) {
      continue;
    }

    let score = scoreVersionMatch(unit.tipoAuto, plan.version);

    if (unit.lineaPlan && plan.modelo && normalizeKey(unit.lineaPlan) === normalizeKey(plan.modelo)) {
      score += 40;
    }

    // Paquete DMS (PAQ "A") vs paquete del plan: señal más fiable
    if (unitPaq && plan.paquete) {
      if (unitPaq === String(plan.paquete).toUpperCase()) score += 80;
      else score -= 100; // distinto paquete → casi seguro otra versión
    }

    if (unit.precioLista > 0 && plan.msrp > 0) {
      const delta = Math.abs(unit.precioLista - plan.msrp);
      if (delta === 0) score += 40;
      else if (delta <= 500) score += 25;
      else if (delta <= 5000) score += 10;
      else if (delta > 30000) score -= 25;
    }

    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
  }

  // Exigir match sólido (paquete o versión + línea)
  if (!best || bestScore < 70) return null;
  return { plan: best, score: bestScore };
}

function uniqueVersions(planRows) {
  const map = new Map();
  for (const r of planRows) {
    const key = `${r.modelo}|${r.paquete}|${r.version}|${r.msrp}`;
    if (!map.has(key)) {
      map.set(key, {
        modelo: r.modelo,
        paquete: r.paquete,
        version: r.version,
        anio: r.anio,
        msrp: r.msrp,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    String(a.modelo).localeCompare(String(b.modelo), 'es')
    || a.msrp - b.msrp
    || String(a.version).localeCompare(String(b.version), 'es'));
}

/**
 * @param {{ section?: string, tipoPago?: string, modelo?: string, q?: string, soloConStock?: boolean }} filters
 */
async function getListaPrecios(filters = {}) {
  const catalog = loadPlansCatalog();
  const sectionId = filters.section === 'bono-toma-cuenta' ? 'bono-toma-cuenta' : 'administracion';
  const section = catalog.sections[sectionId];
  if (!section) {
    throw Object.assign(new Error('Sección de planes inválida'), { status: 400 });
  }

  let planRows = section.rows || [];
  const tipoPago = String(filters.tipoPago || '').trim().toUpperCase();
  const modelo = String(filters.modelo || '').trim();
  const q = normalizeKey(filters.q || '');
  const soloConStock = filters.soloConStock !== false && filters.soloConStock !== '0' && filters.soloConStock !== 'false';

  if (tipoPago) {
    planRows = planRows.filter((r) => r.tipoPago === tipoPago);
  }
  if (modelo) {
    planRows = planRows.filter((r) => normalizeKey(r.modelo) === normalizeKey(modelo));
  }
  if (q) {
    planRows = planRows.filter((r) => normalizeKey(`${r.modelo} ${r.version} ${r.tipoPago} ${r.codigoGmf}`).includes(q));
  }

  const units = await loadInventoryUnits();
  // Solo unidades realmente disponibles; SEP (apartadas) no cuentan para stock ni colores.
  const availableSituations = new Set(['DIS', 'FIS']);

  // Agrupar planes por versión (mismo modelo/paquete/versión/msrp) con opciones de pago
  const versionGroups = new Map();
  for (const plan of planRows) {
    const key = `${plan.modelo}|${plan.paquete}|${plan.version}|${plan.msrp}`;
    if (!versionGroups.has(key)) {
      versionGroups.set(key, {
        modelo: plan.modelo,
        paquete: plan.paquete,
        version: plan.version,
        anio: plan.anio,
        msrp: plan.msrp,
        planes: [],
        inventario: [],
      });
    }
    versionGroups.get(key).planes.push({
      tipoPago: plan.tipoPago,
      letraPago: plan.letraPago,
      codigoGmm: plan.codigoGmm,
      codigoGmf: plan.codigoGmf,
      bonificacion: plan.bonificacion,
      descuento: plan.descuento,
      precioFinal: plan.precioFinal,
      seguroGratis: plan.seguroGratis,
      tasaGmf: plan.tasaGmf,
      enganche: plan.enganche,
      ceroCxaGmf: plan.ceroCxaGmf,
      otros: plan.otros,
    });
  }

  // Cruzar inventario: cada unidad se asigna a su mejor versión del catálogo filtrado
  const allSectionRows = section.rows || [];
  const versionPool = uniqueVersions(
    (tipoPago || modelo || q)
      ? allSectionRows.filter((r) => {
        if (modelo && normalizeKey(r.modelo) !== normalizeKey(modelo)) return false;
        if (q && !normalizeKey(`${r.modelo} ${r.version}`).includes(q)) return false;
        return true;
      })
      : allSectionRows,
  );

  for (const unit of units) {
    if (soloConStock && !availableSituations.has(unit.situacion) && unit.situacion !== 'DEMO' && unit.situacion !== 'PED' && unit.situacion !== 'TRAN' && unit.situacion !== 'PEN') {
      continue;
    }
    const match = bestPlanMatchForUnit(unit, versionPool.map((v) => ({
      ...v,
      // dummy fields for scorer
      modelo: v.modelo,
      version: v.version,
      msrp: v.msrp,
    })));
    if (!match) continue;

    const key = `${match.plan.modelo}|${match.plan.paquete}|${match.plan.version}|${match.plan.msrp}`;
    const group = versionGroups.get(key);
    if (!group) continue;

    // Si hay filtro de tipo de pago, el grupo ya está filtrado; adjuntar plan seleccionado
    const planSeleccionado = tipoPago
      ? group.planes.find((p) => p.tipoPago === tipoPago) || group.planes[0]
      : group.planes[0];

    group.inventario.push({
      ...unit,
      matchScore: match.score,
      planAplicado: planSeleccionado || null,
      precioFinalPlan: planSeleccionado?.precioFinal ?? null,
      bonificacionPlan: planSeleccionado?.bonificacion ?? null,
      descuentoPlan: planSeleccionado?.descuento ?? null,
      ahorroVsMsrp: planSeleccionado
        ? Math.max(0, (match.plan.msrp || 0) - (planSeleccionado.precioFinal || 0))
        : null,
    });
  }

  let items = [...versionGroups.values()].map((g) => ({
    ...g,
    stock: g.inventario.filter((u) => availableSituations.has(u.situacion)).length,
    stockDisponible: g.inventario.filter((u) => availableSituations.has(u.situacion)).length,
  }));

  if (soloConStock) {
    items = items.filter((g) => g.stockDisponible > 0);
  }

  items.sort((a, b) =>
    String(a.modelo).localeCompare(String(b.modelo), 'es')
    || a.msrp - b.msrp
    || String(a.version).localeCompare(String(b.version), 'es'));

  // Unidades planas para tabla inventario × plan
  const inventarioCruzado = items.flatMap((g) => g.inventario.map((u) => ({
    modelo: g.modelo,
    paquete: g.paquete,
    version: g.version,
    anio: g.anio,
    msrp: g.msrp,
    ...u,
  })));

  const precios = inventarioCruzado.map((u) => u.precioFinalPlan || u.msrp).filter((n) => n > 0);

  return {
    meta: {
      sourceFile: catalog.sourceFile,
      vigencia: catalog.vigencia,
      section: sectionId,
      sectionLabel: section.label,
      sectionNote: section.note || null,
      tipoPago: tipoPago || null,
      modelo: modelo || null,
      parsedAt: catalog.parsedAt,
    },
    catalog: {
      modelos: catalog.catalog.modelos,
      tiposPago: catalog.catalog.tiposPago,
      sections: [
        { id: 'administracion', label: catalog.sections.administracion.label },
        { id: 'bono-toma-cuenta', label: catalog.sections['bono-toma-cuenta'].label },
      ],
    },
    kpis: {
      versiones: items.length,
      unidades: inventarioCruzado.length,
      conPlan: inventarioCruzado.filter((u) => u.planAplicado).length,
      modelos: new Set(items.map((i) => i.modelo)).size,
      precioMin: precios.length ? Math.min(...precios) : null,
      precioMax: precios.length ? Math.max(...precios) : null,
    },
    versions: items,
    inventario: inventarioCruzado,
  };
}

function inferTransmision(version) {
  const v = normalizeKey(version);
  if (v.includes('CVT')) return 'CVT';
  // Aveo LT Plus (y similares) son CVT aunque el nombre no diga AT/CVT
  if (v.includes('PLUS') && !v.includes('MANUAL') && !v.includes(' MT')) return 'CVT';
  if (v.includes(' AT') || v.endsWith(' AT') || v.includes('/ AT') || v.includes('AUTOM') || v.includes(' TA ')) {
    return 'Automática';
  }
  if (v.includes(' MT') || v.includes('/ MT') || v.includes('MANUAL')) return 'Manual';
  return '—';
}

function buildVersionSummary(planes, sectionId) {
  const list = planes || [];
  const msrp = list[0] ? null : null; // filled by caller
  const descuentos = list.map((p) => {
    if (sectionId === 'bono-toma-cuenta') {
      return Math.max(Number(p.descuento) || 0, Number(p.bonificacion) || 0);
    }
    // admin: customer-facing discount ≈ msrp - precioFinal; bonificacion is dealer share
    return Math.max(0, (Number(p._msrp) || 0) - (Number(p.precioFinal) || 0)) || (Number(p.descuento) || 0);
  }).filter((n) => n > 0);

  const precios = list.map((p) => Number(p.precioFinal) || 0).filter((n) => n > 0);
  const seguros = list.map((p) => p.seguroGratis).filter(Boolean);
  const tasas = list
    .map((p) => p.tasaGmf)
    .filter((t) => t && /%/.test(t) && !/Factor/i.test(t))
    .map((t) => String(t).replace(/[^\d.]/g, ''))
    .filter(Boolean)
    .map(Number)
    .filter((n) => n > 0);
  const extractFactorPct = (text) => {
    const s = String(text || '');
    // "Factor 1.85%" / "Factor de Arrendamiento: 1.85%" / "1.85% Factor"
    const m = s.match(/Factor[^%\d]*([\d]+(?:\.\d+)?)\s*%/i)
      || s.match(/([\d]+(?:\.\d+)?)\s*%\s*(?:Factor|Arrend)/i);
    return m ? `${m[1]}%` : null;
  };

  const factores = [];
  for (const p of list) {
    const fromTasa = extractFactorPct(p.tasaGmf) || extractFactorPct(p.tasaFactor);
    const fromOtros = extractFactorPct(p.otros) || extractFactorPct(p.raw);
    if (fromTasa) factores.push(fromTasa);
    else if (fromOtros) factores.push(fromOtros);
  }

  const leasingPlanes = list.filter((p) => /LEASING/i.test(p.tipoPago || p.nombre || ''));
  const leasingPrecios = leasingPlanes
    .map((p) => Number(p.precioFinal) || 0)
    .filter((n) => n > 0);
  const leasingSample = leasingPlanes[0] || null;

  return {
    descuentoMaximo: descuentos.length ? Math.max(...descuentos) : 0,
    precioFinalDesde: precios.length ? Math.min(...precios) : null,
    seguroGratis: seguros[0] || null,
    tasaGmfDesde: tasas.length ? `${Math.min(...tasas).toFixed(2)}%` : null,
    leasingFactor: factores[0] || null,
    leasingPrecioDesde: leasingPrecios.length ? Math.min(...leasingPrecios) : null,
    leasingBeneficio: leasingSample
      ? (leasingSample.beneficio || 'Opción para empresa')
      : null,
    leasingEnganche: leasingSample?.enganche || null,
    leasingCodigoGmf: leasingSample?.codigoGmf || null,
  };
}

function colorSwatch(name) {
  const n = normalizeKey(name);
  if (n.includes('BLANC') || n.includes('SUMMIT') || n.includes('WHITE') || n.includes('POLAR')) {
    return { hex: '#f8fafc', border: '#cbd5e1' };
  }
  if (n.includes('PLATA') || n.includes('SILVER') || n.includes('PLATIN') || n.includes('GRIS') || n.includes('GRAY') || n.includes('ACERO')) {
    return { hex: '#c0c6ce', border: '#94a3b8' };
  }
  if (n.includes('NEGR') || n.includes('BLACK') || n.includes('NOCHE') || n.includes('ONIX')) {
    return { hex: '#1e293b', border: '#0f172a' };
  }
  if (n.includes('AZUL') || n.includes('BLUE') || n.includes('OCEANO') || n.includes('COBALTO')) {
    return { hex: '#2563eb', border: '#1d4ed8' };
  }
  if (n.includes('ROJO') || n.includes('RED') || n.includes('CEREZA')) {
    return { hex: '#dc2626', border: '#b91c1c' };
  }
  if (n.includes('VERDE') || n.includes('GREEN')) return { hex: '#059669', border: '#047857' };
  if (n.includes('AMARILL') || n.includes('YELLOW') || n.includes('HELLO')) return { hex: '#eab308', border: '#ca8a04' };
  if (n.includes('NARANJ') || n.includes('ORANGE')) return { hex: '#f97316', border: '#ea580c' };
  return { hex: '#e2e8f0', border: '#94a3b8' };
}

function colorKey(name) {
  // Compat: swatch + label original de inventario
  const label = String(name || '').trim() || 'Sin color';
  return { label, ...colorSwatch(label) };
}

function scoreFichaVersionMatch(planVersion, excelVersion) {
  const a = normalizeKey(planVersion);
  const b = normalizeKey(excelVersion);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 88;
  const aliases = [
    ['LS MT', 'LS MANUAL'],
    ['LS AT', 'LS AUTOMATICA'],
    ['LT MT', 'LT MANUAL'],
    ['LT AT', 'LT AUTOMATICA'],
    ['BLACK EDITION', 'LT TM BLACK EDITION'],
    ['LT 5', 'LT 5 PASAJEROS'],
    ['LT 7', 'LT 7 PASAJEROS'],
    ['ACTIV BI TONO', 'ACTIV BITONO'],
    ['CARGO LS', 'LS MANUAL'],
    ['SWB LT', 'VERSION CORTA'],
    ['LWB LT', 'VERSION LARGA'],
    ['CREW CAB', 'DOBLE CABINA'],
    ['WT V8 4X2 RC', 'CABINA REGULAR 4X2'],
    ['WT V8 4X4 RC', 'CABINA REGULAR 4X4'],
    ['CUSTOM 4X4 CC', 'CUSTOM'],
    ['HIGH COUNTRY 6 2L', 'HIGH COUNTRY'],
    ['ZR2 BISON 4X4', 'ZR2 BISON'],
    ['ZR2 4X4', 'ZR2'],
    ['Z71 4X4', 'Z71'],
  ];
  for (const [x, y] of aliases) {
    if ((a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))) return 86;
  }
  const aTok = a.split(' ').filter((t) => t.length > 1);
  const bTok = b.split(' ').filter((t) => t.length > 1);
  if (!aTok.length || !bTok.length) return 0;
  const hits = aTok.filter((t) => bTok.includes(t)).length;
  const ratio = hits / Math.max(aTok.length, bTok.length);
  if (ratio >= 0.75) return 70;
  if (ratio >= 0.5) return 50;
  return 0;
}

function resolveFichaVersionEntry(entry, versionLabel) {
  const by = entry?.byVersion || {};
  if (!versionLabel) return entry?.default || null;
  if (by[versionLabel]) return by[versionLabel];

  const nk = normalizeKey(versionLabel);
  for (const [k, v] of Object.entries(by)) {
    if (normalizeKey(k) === nk) return v;
  }

  let best = null;
  let bestScore = 0;
  let bestKeyLen = 0;
  for (const [k, v] of Object.entries(by)) {
    const score = Math.max(
      scoreFichaVersionMatch(versionLabel, k),
      scoreFichaVersionMatch(versionLabel, v.excelVersion || k)
    );
    const keyLen = normalizeKey(v.excelVersion || k).length;
    // Preferir coincidencias más específicas (LT Plus > LT Manual)
    if (score > bestScore || (score === bestScore && score >= 70 && keyLen > bestKeyLen)) {
      bestScore = score;
      best = v;
      bestKeyLen = keyLen;
    }
  }
  // Umbral alto para no confundir LT Plus con LT Manual
  if (bestScore >= 70) return best;
  return entry?.default || null;
}

function applyTransmisionHint(desempeno, transmision) {
  const items = [...(desempeno || [])];
  const idx = items.findIndex((r) => /transmisi/i.test(r.label));
  if (idx < 0) return items;
  const current = String(items[idx].value || '').trim();
  // Nunca pisar un valor de ficha oficial (CVT, Manual 6 vel., etc.)
  if (current && !/^—$|^-$/i.test(current)) return items;
  if (!transmision || transmision === '—') return items;
  items[idx] = { ...items[idx], value: transmision };
  return items;
}

function buildFichaTecnica(modelo, versionLabel, paquete, anio, msrp) {
  const fichas = loadFichasTecnicas();
  const entry = fichas[modelo];
  const transmision = inferTransmision(versionLabel);
  const resolved = resolveFichaVersionEntry(entry, versionLabel);

  if (resolved && (resolved.desempeno || resolved.seguridad || resolved.confort)) {
    const desempeno = applyTransmisionHint(resolved.desempeno || [], transmision);

    const secciones = [
      { id: 'desempeno', titulo: 'Desempeño', items: desempeno },
      { id: 'seguridad', titulo: 'Seguridad', items: resolved.seguridad || [] },
      { id: 'confort', titulo: 'Confort y tecnología', items: resolved.confort || [] },
    ];
    if ((resolved.diferencial || []).length) {
      secciones.push({
        id: 'diferencial',
        titulo: 'Equipamiento de la versión',
        items: resolved.diferencial,
      });
    }

    return {
      carroceria: entry.carroceria || CARROCERIA_BY_MODELO[modelo] || null,
      excelModelo: resolved.excelModelo || entry.excelModelo || null,
      excelVersion: resolved.excelVersion || versionLabel || null,
      fuente: resolved.fuente || null,
      secciones,
    };
  }

  // Compat: estructura antigua (default + overrides parciales)
  if (entry?.default) {
    const override = entry.byVersion?.[versionLabel] || {};
    const hasFullOverride = Array.isArray(override.desempeno) && override.desempeno.length;
    const desempeno = applyTransmisionHint(
      hasFullOverride ? override.desempeno : (entry.default.desempeno || []),
      transmision
    );
    return {
      carroceria: entry.carroceria || CARROCERIA_BY_MODELO[modelo] || null,
      secciones: [
        { id: 'desempeno', titulo: 'Desempeño', items: desempeno },
        { id: 'seguridad', titulo: 'Seguridad', items: override.seguridad || entry.default.seguridad || [] },
        { id: 'confort', titulo: 'Confort y tecnología', items: override.confort || entry.default.confort || [] },
      ],
    };
  }

  return {
    carroceria: CARROCERIA_BY_MODELO[modelo] || null,
    secciones: [
      {
        id: 'desempeno',
        titulo: 'Desempeño',
        items: [
          { label: 'Transmisión', value: transmision },
          { label: 'Tracción', value: '—' },
          { label: 'Paquete', value: paquete || '—' },
          { label: 'Año modelo', value: anio || '—' },
        ],
      },
      {
        id: 'resumen',
        titulo: 'Versión',
        items: [
          { label: 'Versión', value: versionLabel || '—' },
          { label: 'Precio de Venta GMMX', value: msrp ? `$${Number(msrp).toLocaleString('es-MX')}` : '—' },
          { label: 'Fuente', value: 'Planes Chevrolet MY26' },
        ],
      },
    ],
  };
}

function planDisplayMeta(p, msrp, sectionId) {
  const tipo = String(p.tipoPago || '').toUpperCase();
  const gmm = String(p.codigoGmm || '').toUpperCase();
  const desc = sectionId === 'bono-toma-cuenta'
    ? (Number(p.descuento) || 0)
    : Math.max(0, (Number(msrp) || 0) - (Number(p.precioFinal) || 0));
  const pct = msrp > 0 && desc > 0 ? Math.round((desc / msrp) * 10000) / 100 : 0;

  let nombre = p.tipoPago;
  let beneficio = '—';

  if (tipo.includes('LEASING')) {
    nombre = 'Leasing';
    beneficio = 'Opción para empresa';
  } else if (tipo === 'CONTADO' || (tipo.includes('CONTADO') && !tipo.includes('SEGURO'))) {
    nombre = 'Contado';
    beneficio = 'Sin financiamiento';
  } else if (tipo.includes('CONTADO CON SEGURO')) {
    nombre = 'Contado con seguro';
    beneficio = 'Pago de contado';
  } else if (tipo.includes('TASA TRADICIONAL')) {
    nombre = 'GMF tasa tradicional';
    beneficio = 'Financiamiento tradicional';
  } else if (tipo.includes('GMF') && gmm === 'BFC') {
    nombre = 'GMF tasa subsidiada';
    beneficio = 'Enganche preferente';
  } else if (tipo.includes('GMF TASA SUBSIDIADA CON SEGURO')) {
    nombre = desc > 0 && pct < 14 ? 'GMF tasa estándar' : 'GMF tasa subsidiada con seguro';
    beneficio = 'Financiamiento tradicional';
  } else if (tipo.includes('GMF TASA SUBSIDIADA')) {
    nombre = 'GMF tasa subsidiada';
    beneficio = 'Mejor precio final';
  }

  let tasaFactor = '—';
  if (p.tasaGmf) {
    if (/Factor/i.test(p.tasaGmf)) {
      tasaFactor = String(p.tasaGmf).replace(/Factor\s*/i, '').trim();
    } else {
      tasaFactor = p.tasaGmf;
    }
  } else if (p.enganche) {
    tasaFactor = p.enganche;
  }

  return {
    nombre,
    beneficio,
    descuentoMostrador: desc,
    descuentoPct: pct,
    tasaFactor,
  };
}

function enrichPlanes(planes, msrp, sectionId) {
  const list = (planes || []).map((p) => {
    const meta = planDisplayMeta(p, msrp, sectionId);
    return {
      ...p,
      ...meta,
      _msrp: msrp,
    };
  });

  const bestPrice = Math.min(...list.map((p) => Number(p.precioFinal) || Infinity));
  const candidates = list.filter((p) => Number(p.precioFinal) === bestPrice && bestPrice < Infinity);
  const preferred = candidates.find((p) => /GMF/i.test(p.tipoPago) && !/BFC/i.test(p.codigoGmm || ''))
    || candidates.find((p) => /GMF/i.test(p.tipoPago))
    || candidates[0];
  const preferredKey = preferred
    ? `${preferred.tipoPago}|${preferred.codigoGmm}|${preferred.codigoGmf}|${preferred.precioFinal}`
    : null;

  return list
    .map((p) => {
      const key = `${p.tipoPago}|${p.codigoGmm}|${p.codigoGmf}|${p.precioFinal}`;
      const recomendado = Boolean(preferredKey && key === preferredKey);
      return {
        ...p,
        recomendado,
        beneficio: recomendado ? 'Mejor precio final' : p.beneficio,
      };
    })
    .sort((a, b) => {
      if (a.recomendado !== b.recomendado) return a.recomendado ? -1 : 1;
      return (Number(a.precioFinal) || 0) - (Number(b.precioFinal) || 0);
    });
}

function enrichVersionGroup(g, sectionId) {
  const inventario = g.inventario || [];
  const disp = inventario.filter((u) => u.situacion === 'DIS' || u.situacion === 'FIS').length;
  const apartadas = inventario.filter((u) => u.situacion === 'SEP' || u.isApartada).length;
  // Existencia visible = solo disponibles (DIS/FIS). Apartadas no cuentan ni en colores.
  const stockTotal = disp;

  const colorMap = new Map();
  for (const u of inventario.filter((x) => x.situacion === 'DIS' || x.situacion === 'FIS')) {
    const nombreInventario = String(u.colorExterior || '').trim() || 'Sin color';
    const swatch = colorSwatch(nombreInventario);
    const key = nombreInventario.toUpperCase();
    if (!colorMap.has(key)) {
      colorMap.set(key, {
        label: nombreInventario,
        nombreInventario,
        hex: swatch.hex,
        border: swatch.border,
        unidades: 0,
        disponibles: 0,
        apartadas: 0,
      });
    }
    const row = colorMap.get(key);
    row.unidades += 1;
    row.disponibles += 1;
  }
  const colores = [...colorMap.values()]
    .map((c) => ({
      ...c,
      estado: c.unidades <= 1 ? 'Pocas unidades' : 'Disponible',
      estadoTone: c.unidades <= 1 ? 'warn' : 'ok',
    }))
    .sort((a, b) => b.unidades - a.unidades);

  const planes = enrichPlanes(g.planes || [], g.msrp, sectionId);
  const summaryBase = buildVersionSummary(planes, sectionId);
  const descMax = Math.max(0, ...planes.map((p) => p.descuentoMostrador || 0));
  const descPctMax = g.msrp > 0 && descMax > 0 ? Math.round((descMax / g.msrp) * 10000) / 100 : 0;
  const ficha = buildFichaTecnica(g.modelo, g.version, g.paquete, g.anio, g.msrp);

  // Extraer factor / datos leasing de planes si summary no los trajo
  let leasingFactor = summaryBase.leasingFactor;
  let leasingPrecioDesde = summaryBase.leasingPrecioDesde;
  let leasingBeneficio = summaryBase.leasingBeneficio;
  let leasingEnganche = summaryBase.leasingEnganche;
  let leasingCodigoGmf = summaryBase.leasingCodigoGmf;

  const leasePlanes = planes.filter((p) => /LEASING/i.test(p.tipoPago || p.nombre || ''));
  if (!leasingFactor) {
    const leaseWithPct = leasePlanes.find((p) => p.tasaFactor && /[\d.]+\s*%/.test(p.tasaFactor));
    if (leaseWithPct) leasingFactor = String(leaseWithPct.tasaFactor).match(/([\d.]+%)/)?.[1] || leaseWithPct.tasaFactor;
  }
  if (!leasingPrecioDesde && leasePlanes.length) {
    const preciosLease = leasePlanes.map((p) => Number(p.precioFinal) || 0).filter((n) => n > 0);
    if (preciosLease.length) leasingPrecioDesde = Math.min(...preciosLease);
  }
  if (!leasingBeneficio && leasePlanes[0]) {
    leasingBeneficio = leasePlanes[0].beneficio || 'Opción para empresa';
  }
  if (!leasingEnganche && leasePlanes[0]?.enganche) leasingEnganche = leasePlanes[0].enganche;
  if (!leasingCodigoGmf && leasePlanes[0]?.codigoGmf) leasingCodigoGmf = leasePlanes[0].codigoGmf;

  return {
    ...g,
    carroceria: ficha.carroceria || CARROCERIA_BY_MODELO[g.modelo] || null,
    stock: disp,
    stockTotal,
    stockDisponible: disp,
    stockApartadas: apartadas,
    colores,
    planes,
    summary: {
      msrp: g.msrp,
      descuentoMaximo: descMax || summaryBase.descuentoMaximo,
      descuentoPct: descPctMax,
      precioFinalDesde: summaryBase.precioFinalDesde ?? g.msrp,
      seguroGratis: summaryBase.seguroGratis,
      tasaGmfDesde: summaryBase.tasaGmfDesde,
      leasingFactor,
      leasingPrecioDesde,
      leasingBeneficio,
      leasingEnganche,
      leasingCodigoGmf,
      mejorPrecio: true,
    },
    fichaTecnica: ficha,
  };
}

/**
 * Vista ficha (formato guía visual): modelos → versiones → planes + existencia.
 */
async function getListaPreciosFicha(filters = {}) {
  const base = await getListaPrecios({
    ...filters,
    tipoPago: '', // ficha necesita todos los planes de la versión
    soloConStock: filters.soloConStock,
    modelo: filters.modelo || '',
  });

  // Regenerar groups con TODOS los planes de la sección (sin filtrar tipoPago)
  const catalog = loadPlansCatalog();
  const sectionId = base.meta.section;
  const section = catalog.sections[sectionId];
  let planRows = section.rows || [];
  const modeloFilter = String(filters.modelo || '').trim();
  if (modeloFilter) {
    planRows = planRows.filter((r) => normalizeKey(r.modelo) === normalizeKey(modeloFilter));
  }

  const versionGroups = new Map();
  for (const plan of planRows) {
    const key = `${plan.modelo}|${plan.paquete}|${plan.version}|${plan.msrp}`;
    if (!versionGroups.has(key)) {
      versionGroups.set(key, {
        modelo: plan.modelo,
        paquete: plan.paquete,
        version: plan.version,
        anio: plan.anio,
        msrp: plan.msrp,
        planes: [],
        inventario: [],
      });
    }
    versionGroups.get(key).planes.push({
      tipoPago: plan.tipoPago,
      letraPago: plan.letraPago,
      codigoGmm: plan.codigoGmm,
      codigoGmf: plan.codigoGmf,
      bonificacion: plan.bonificacion,
      descuento: plan.descuento,
      precioFinal: plan.precioFinal,
      seguroGratis: plan.seguroGratis,
      tasaGmf: plan.tasaGmf,
      enganche: plan.enganche,
      ceroCxaGmf: plan.ceroCxaGmf,
      otros: plan.otros,
    });
  }

  // Reusar inventario cruzado de base (ya matcheado)
  for (const u of base.inventario || []) {
    const key = `${u.modelo}|${u.paquete}|${u.version}|${u.msrp}`;
    const g = versionGroups.get(key);
    if (!g) continue;
    // evitar duplicar si ya vino
    if (!g.inventario.some((x) => x.serie === u.serie && x.noInventario === u.noInventario)) {
      g.inventario.push(u);
    }
  }

  // Si soloConStock, aún mostrar versiones sin stock cuando se pide modelo explícito
  const soloConStock = filters.soloConStock !== false && filters.soloConStock !== '0' && filters.soloConStock !== 'false';

  const byModelo = new Map();
  for (const g of versionGroups.values()) {
    const enriched = enrichVersionGroup(g, sectionId);
    if (soloConStock && !modeloFilter && enriched.stockDisponible === 0) continue;
    if (!byModelo.has(enriched.modelo)) {
      byModelo.set(enriched.modelo, {
        modelo: enriched.modelo,
        anio: enriched.anio || '2026',
        carroceria: enriched.carroceria || CARROCERIA_BY_MODELO[enriched.modelo] || null,
        titulo: `Chevrolet ${enriched.modelo} ${enriched.anio || '2026'}`,
        versions: [],
      });
    }
    byModelo.get(enriched.modelo).versions.push(enriched);
  }

  const { attachImageUrls } = require('./listaPreciosImagesService');

  const modelos = attachImageUrls(
    [...byModelo.values()]
      .map((m) => {
        m.versions.sort((a, b) => a.msrp - b.msrp || String(a.version).localeCompare(String(b.version), 'es'));
        const seguros = m.versions.map((v) => v.summary?.seguroGratis).filter(Boolean);
        m.badgeSeguro = seguros[0] || null;
        m.stockTotal = m.versions.reduce((s, v) => s + (v.stockDisponible || 0), 0);
        m.benchmarking = buildBenchmarkingForModelo(m.modelo, m.versions);
        return m;
      })
      .sort((a, b) => String(a.modelo).localeCompare(String(b.modelo), 'es')),
  );

  return {
    meta: base.meta,
    catalog: base.catalog,
    kpis: base.kpis,
    modelos,
  };
}

module.exports = {
  getListaPrecios,
  getListaPreciosFicha,
  loadPlansCatalog,
  invalidatePlansCache,
  loadBenchmarking,
};
