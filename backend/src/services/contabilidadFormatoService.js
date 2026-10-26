'use strict';
/**
 * Contabilidad con el formato de KPIs-VECSA y el cálculo de Balderrama.
 *
 * Las cifras salen de lo que ya calcula Balderrama, alineado al EEFF SUMMARY de
 * Contraloría (eeffSummaryService, balanceGeneralService, breakEvenService y el
 * EEFF mensual). Aquí solo se ordenan como en VECSA: renglones con rubro,
 * subtotal y cuenta, serie del año, año contra año, utilidad por línea, gastos
 * por departamento, revisión de la balanza y balance con conciliación.
 *
 * Signo de presentación (como la balanza): ingresos en positivo; costo y gastos
 * en negativo. Los importes son los mismos que en el EEFF; solo cambia el signo
 * con que se muestran costo y gastos.
 */
const cfg = require('../config/eeffSummaryConfig');
const { getAccountsForGpo, getDepartmentByGpo } = require('../config/departmentExpenseMapping');

const NOMBRE_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function pct(numerador, denominador) {
  const d = Number(denominador) || 0;
  if (Math.abs(d) < 0.5) return null;
  return Math.round(((Number(numerador) || 0) / d) * 1000) / 10;
}

function variacionPct(actual, anterior) {
  const b = Number(anterior) || 0;
  if (Math.abs(b) < 0.5) return null;
  return Math.round((((Number(actual) || 0) - b) / Math.abs(b)) * 1000) / 10;
}

/** '0400-0001-%' → '0400-0001-…' para «Ver cuentas». */
function cuentaTexto(patron) {
  return String(patron).replace(/%$/, '…');
}

const gpoTexto = (gpo) => `GPO ${gpo}`;

// ── Estado de resultados ────────────────────────────────────────────────────

/**
 * Renglones del estado en el orden de VECSA. `fila` es un número consecutivo:
 * la pantalla agrupa por rangos de filas para el detalle de cada total.
 */
function construirFilas(payload) {
  const filas = [];
  let n = 0;
  const add = (seccion, nivel, concepto, importe, cuentas = [], extra = {}) => {
    n += 10;
    const fila = { fila: n, seccion, nivel, concepto, importe: redondear(importe), cuentas, ...extra };
    filas.push(fila);
    return fila;
  };

  const v = payload?.ventas || {};
  const pv = payload?.postventa || {};
  const sn = payload?.seminuevos || {};
  const edo = payload?.estadoFinanciero?.summary || {};
  const menudeoDefs = new Map(cfg.MENUDEO_BRANCHES.map((b) => [b.id, b]));
  const semiDefs = new Map(cfg.SEMINUEVOS_BRANCHES.map((b) => [b.id, b]));
  const pvDefs = new Map(cfg.POSTVENTA_SECTIONS.map((s) => [s.id, s]));
  const menudeo = v.menudeo?.branches || [];
  const flot = v.flotillas?.summary || {};
  const inter = v.intercambios?.summary || {};
  const semis = sn.branches || [];
  const pvSecciones = pv.sections || [];

  const bloques = {};
  const raices = (key) => { bloques[key] = { raices: [] }; return bloques[key]; };

  // Ingresos
  let b = raices('ventas');
  b.raices.push(add('Ingresos', 'rubro', 'VENTAS AUTOS NUEVOS', v.totalVentasAutos?.summary?.ventas).fila);
  add('Ingresos', 'subtotal', 'Menudeo', v.menudeo?.summary?.ventas);
  menudeo.forEach((r) => add('Ingresos', 'cuenta', r.label, r.ventas, (menudeoDefs.get(r.id)?.revenuePrefixes || []).map(cuentaTexto)));
  add('Ingresos', 'subtotal', 'Flotillas', flot.ventas, cfg.FLOTILLAS_BRANCH.revenuePrefixes.map(cuentaTexto));
  add('Ingresos', 'subtotal', 'Intercambios', inter.ventas, cfg.INTERCAMBIOS_BRANCH.revenuePrefixes.map(cuentaTexto));
  b.raices.push(add('Ingresos', 'rubro', 'VENTAS SEMINUEVOS', sn.summary?.ventas).fila);
  semis.forEach((r) => add('Ingresos', 'cuenta', r.label, r.ventas, (semiDefs.get(r.id)?.revenuePrefixes || []).map(cuentaTexto)));
  b.raices.push(add('Ingresos', 'rubro', 'VENTAS POSTVENTA', pv.summary?.ventas).fila);
  pvSecciones.forEach((s) => add('Ingresos', 'cuenta', s.label, s.ventas, (pvDefs.get(s.id)?.revenuePrefixes || []).map(cuentaTexto)));
  b.total = add('Ingresos', 'total', 'TOTAL VENTAS', edo.ventasTotales).fila;

  // Costo de ventas (negativo)
  b = raices('costo');
  b.raices.push(add('Costo de ventas', 'rubro', 'COSTO AUTOS NUEVOS', -num(v.totalVentasAutos?.summary?.costo)).fila);
  add('Costo de ventas', 'subtotal', 'Menudeo', -num(v.menudeo?.summary?.costo));
  menudeo.forEach((r) => add('Costo de ventas', 'cuenta', r.label, -num(r.costo), (menudeoDefs.get(r.id)?.costPrefixes || []).map(cuentaTexto)));
  add('Costo de ventas', 'subtotal', 'Flotillas', -num(flot.costo), cfg.FLOTILLAS_BRANCH.costPrefixes.map(cuentaTexto));
  add('Costo de ventas', 'subtotal', 'Intercambios', -num(inter.costo), cfg.INTERCAMBIOS_BRANCH.costPrefixes.map(cuentaTexto));
  b.raices.push(add('Costo de ventas', 'rubro', 'COSTO SEMINUEVOS', -num(sn.summary?.costo)).fila);
  semis.forEach((r) => add('Costo de ventas', 'cuenta', r.label, -num(r.costo), (semiDefs.get(r.id)?.costPrefixes || []).map(cuentaTexto)));
  b.raices.push(add('Costo de ventas', 'rubro', 'COSTO POSTVENTA', -num(pv.summary?.costo)).fila);
  pvSecciones.forEach((s) => add('Costo de ventas', 'cuenta', s.label, -num(s.costo), (pvDefs.get(s.id)?.costPrefixes || []).map(cuentaTexto)));
  b.total = add('Costo de ventas', 'total', 'COSTO DE VENTAS', -num(edo.costoTotal)).fila;

  // Utilidad bruta por línea
  b = raices('utilidadBruta');
  b.raices.push(add('Utilidad bruta', 'rubro', 'UTILIDAD BRUTA AUTOS NUEVOS', v.totalVentasAutos?.summary?.utilidadBruta).fila);
  add('Utilidad bruta', 'cuenta', 'Menudeo', v.menudeo?.summary?.utilidadBruta);
  add('Utilidad bruta', 'cuenta', 'Flotillas', flot.utilidadBruta);
  add('Utilidad bruta', 'cuenta', 'Intercambios', inter.utilidadBruta);
  b.raices.push(add('Utilidad bruta', 'rubro', 'UTILIDAD BRUTA SEMINUEVOS', sn.summary?.utilidadBruta).fila);
  b.raices.push(add('Utilidad bruta', 'rubro', 'UTILIDAD BRUTA POSTVENTA', pv.summary?.utilidadBruta).fila);
  pvSecciones.forEach((s) => add('Utilidad bruta', 'cuenta', s.label, s.utilidadBruta));
  b.total = add('Utilidad bruta', 'total', 'UTILIDAD BRUTA', edo.utilidadBruta).fila;

  // Gastos (negativo): operación por línea y administración
  b = raices('gastos');
  b.raices.push(add('Gastos', 'rubro', 'GASTOS DE OPERACIÓN', -num(edo.gastosOperacion)).fila);
  add('Gastos', 'subtotal', 'Autos nuevos', -num(v.totalVentasAutos?.summary?.gastos));
  [...menudeo, { ...flot, id: 'flotillas', label: 'Flotillas' }, { ...inter, id: 'intercambios', label: 'Intercambios' }]
    .forEach((r) => {
      const def = menudeoDefs.get(r.id) || (r.id === 'flotillas' ? cfg.FLOTILLAS_BRANCH : cfg.INTERCAMBIOS_BRANCH);
      add('Gastos', 'cuenta', r.label, -num(r.gastos), def?.expenseGpo ? [gpoTexto(def.expenseGpo)] : []);
    });
  add('Gastos', 'subtotal', 'Seminuevos', -num(sn.summary?.gastos), [gpoTexto('720')]);
  add('Gastos', 'subtotal', 'PostVenta', -num(pv.summary?.gastos));
  pvSecciones.forEach((s) => add('Gastos', 'cuenta', s.label, -num(s.gastos), pvDefs.get(s.id)?.expenseGpo ? [gpoTexto(pvDefs.get(s.id).expenseGpo)] : []));
  b.raices.push(add('Gastos', 'rubro', 'GASTOS DE ADMINISTRACIÓN', -num(edo.gastosAdministracion), cfg.ADMIN_GROUPS.map(gpoTexto)).fila);
  b.total = add('Gastos', 'total', 'TOTAL DE GASTOS', -num(edo.sumaGastos)).fila;

  // Resultado
  add('Resultado', 'total', 'UTILIDAD DE OPERACIÓN', edo.utilidadOperacion);
  add('Resultado', 'rubro', 'PRODUCTOS FINANCIEROS', edo.productosFinancieros, cfg.FINANCIAL_PRODUCT_GROUPS.map(gpoTexto));
  add('Resultado', 'rubro', 'GASTOS FINANCIEROS', -num(edo.gastosFinancieros),
    [...cfg.FINANCIAL_EXPENSE_ADD.map(gpoTexto), ...cfg.FINANCIAL_EXPENSE_SUB.map((g) => `menos ${gpoTexto(g)}`)]);
  add('Resultado', 'total', 'UTILIDAD DEL PERIODO', edo.utilidad, [], { final: true });

  return { filas, bloques };
}

function totalesDe(edo) {
  return {
    ventas: redondear(edo.ventasTotales),
    costo: redondear(-num(edo.costoTotal)),
    utilidadBruta: redondear(edo.utilidadBruta),
    gastosOperacion: redondear(-num(edo.gastosOperacion)),
    gastosAdministracion: redondear(-num(edo.gastosAdministracion)),
    gastos: redondear(-num(edo.sumaGastos)),
    utilidadOperacion: redondear(edo.utilidadOperacion),
    resultadoFinanciero: redondear(edo.utilidadFinanciera),
    utilidadNeta: redondear(edo.utilidad),
  };
}

/** Utilidad bruta por línea de negocio; la suma es la utilidad bruta de la agencia. */
function lineasDe(payload) {
  const v = payload?.ventas || {};
  const pv = payload?.postventa || {};
  const sn = payload?.seminuevos || {};
  const linea = (key, label, grupo, r) => ({
    key,
    label,
    grupo,
    ventas: redondear(r?.ventas),
    costo: redondear(-num(r?.costo)),
    utilidad: redondear(r?.utilidadBruta),
    margenPct: pct(r?.utilidadBruta, r?.ventas),
  });
  return [
    linea('menudeo', 'Menudeo', 'nuevos', v.menudeo?.summary),
    linea('flotillas', 'Flotillas', 'nuevos', v.flotillas?.summary),
    linea('intercambios', 'Intercambios', 'nuevos', v.intercambios?.summary),
    linea('seminuevos', 'Seminuevos', 'usados', sn.summary),
    ...(pv.sections || []).map((s) => linea(s.id, s.label, 'posventa', s)),
  ];
}

/** GPO de gastos que toma el estado de resultados (las líneas de negocio y administración). */
function gposEnEstado() {
  return new Set([
    ...[...cfg.MENUDEO_BRANCHES, cfg.FLOTILLAS_BRANCH, cfg.INTERCAMBIOS_BRANCH].map((b) => b.expenseGpo),
    '720',
    ...cfg.POSTVENTA_SECTIONS.map((s) => s.expenseGpo),
  ].filter(Boolean).map(String));
}

/**
 * Gastos por departamento (GPO) más administración.
 * - Los departamentos con gasto que el estado no toma se devuelven aparte
 *   (`gastosFueraDelEstado`), no se suman.
 * - Si los rubros no cuadran con el total del estado, la diferencia sale como rubro.
 */
function gastosDe(payload, totales) {
  const edo = payload?.estadoFinanciero || {};
  const ub = totales.utilidadBruta;
  const enEstado = gposEnEstado();
  const rubro = (key, label, importe, cuentas = []) => ({
    key,
    label,
    variable: false,
    importe: redondear(importe),
    pctUtilidadBruta: pct(-importe, ub),
    pctVentas: pct(-importe, totales.ventas),
    cuentas,
    principales: [],
  });
  const conGasto = (edo.gastosPorDepartamento || []).filter((d) => Math.abs(num(d.value)) >= 0.005);
  const etiqueta = (d) => d.label || getDepartmentByGpo(d.gpoCont)?.label || gpoTexto(d.gpoCont);
  const deptos = conGasto
    .filter((d) => enEstado.has(String(d.gpoCont)))
    .map((d) => rubro(`gpo_${d.gpoCont}`, etiqueta(d), -num(d.value), [gpoTexto(d.gpoCont)]));
  deptos.push(rubro('administracion', 'Administración', -num(edo.summary?.gastosAdministracion), cfg.ADMIN_GROUPS.map(gpoTexto)));
  const suma = deptos.reduce((s, g) => s + g.importe, 0);
  const diferencia = redondear(totales.gastos - suma);
  if (Math.abs(diferencia) >= 1) {
    deptos.push(rubro('diferencia', 'Diferencia contra el total de gastos', diferencia));
  }
  const fuera = conGasto
    .filter((d) => !enEstado.has(String(d.gpoCont)))
    .map((d) => ({ gpo: String(d.gpoCont), label: etiqueta(d), importe: redondear(-num(d.value)) }));
  return { rubros: deptos.sort((a, b) => a.importe - b.importe), fuera };
}

/** Punto de equilibrio de Balderrama (breakEvenService) con la forma de VECSA. */
function equilibrioDe(pe) {
  const s = pe?.summary;
  if (!s || !num(s.ventas)) return null;
  const ventasEquilibrio = s.puntoEquilibrio == null ? null : redondear(s.puntoEquilibrio);
  return {
    ventas: redondear(s.ventas),
    contribucion: redondear(s.margenContribucion),
    margenContribucionPct: s.margenContribucionPct == null ? null : Math.round(num(s.margenContribucionPct) * 10) / 10,
    gastosEstructura: redondear(-num(s.gastosFijos)),
    ventasEquilibrio,
    coberturaPct: s.coberturaPct == null ? null : Math.round(num(s.coberturaPct) * 10) / 10,
    holgura: ventasEquilibrio == null ? null : redondear(num(s.ventas) - ventasEquilibrio),
    nota: 'Punto de equilibrio operativo de Balderrama: margen de contribución después de costos variables y gastos fijos de la agencia.',
  };
}

// ── Serie y año contra año (EEFF mensual) ───────────────────────────────────

const CUADRO = [
  { key: 'ventas', label: 'Ventas', nivel: 'rubro' },
  { key: 'costo', label: 'Costo de ventas', nivel: 'rubro' },
  { key: 'utilidadBruta', label: 'Utilidad bruta', nivel: 'total' },
  { key: 'gastosOperacion', label: 'Gastos de operación', nivel: 'detalle' },
  { key: 'gastosAdministracion', label: 'Gastos de administración', nivel: 'detalle' },
  { key: 'gastos', label: 'Total de gastos', nivel: 'total' },
  { key: 'utilidadOperacion', label: 'Utilidad de operación', nivel: 'total' },
  { key: 'resultadoFinanciero', label: 'Resultado financiero', nivel: 'detalle' },
  { key: 'utilidadNeta', label: 'Utilidad del periodo', nivel: 'resultado' },
];
const CUADRO_SIEMPRE = new Set(['ventas', 'costo', 'utilidadBruta', 'gastos', 'utilidadNeta']);
const RUBROS_ANIO = ['ventas', 'utilidadBruta', 'gastos', 'utilidadNeta'];

/** pnl aplanado del EEFF mensual → totales con el signo de presentación. */
function totalesDeMes(pnl) {
  if (!pnl) return null;
  return totalesDe({
    ventasTotales: pnl.ventasTotales,
    costoTotal: pnl.costoTotal,
    utilidadBruta: pnl.utilidadBruta,
    gastosOperacion: pnl.gastosOperacion,
    gastosAdministracion: pnl.gastosAdministracion,
    sumaGastos: pnl.sumaGastos,
    utilidadOperacion: pnl.utilidadOperacion,
    utilidadFinanciera: pnl.utilidadFinanciera,
    utilidad: pnl.utilidad,
  });
}

function vacio() {
  return Object.fromEntries(CUADRO.map((d) => [d.key, 0]));
}

function sumar(lista) {
  const out = vacio();
  for (const t of lista) for (const k of Object.keys(out)) out[k] += num(t?.[k]);
  for (const k of Object.keys(out)) out[k] = redondear(out[k]);
  return out;
}

/** El mismo día del año anterior. El 29 de febrero cae en el 28. */
function restarUnAnio(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const ult = new Date(y - 1, m, 0).getDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
}

/**
 * @param {Map<string, object>} porMes 'YYYY-MM' → totales (totalesDeMes)
 */
function armarSerie(porMes, fechaFin) {
  const [anio, mesFin] = String(fechaFin).split('-').map(Number);
  const serie = [];
  for (let m = 1; m <= mesFin; m += 1) {
    const key = `${anio}-${String(m).padStart(2, '0')}`;
    const t = porMes.get(key);
    if (t) serie.push({ mes: key, etiqueta: `${NOMBRE_MES[m - 1]} ${anio}`, totales: t });
  }
  return serie;
}

function tramo(porMes, fechaInicio, fechaFin) {
  const ini = String(fechaInicio).slice(0, 7);
  const fin = String(fechaFin).slice(0, 7);
  return sumar([...porMes.entries()].filter(([k]) => k >= ini && k <= fin).map(([, t]) => t));
}

function armarComparativo(porMes, fechaInicio, fechaFin) {
  const [anio, mesFin] = String(fechaFin).split('-').map(Number);
  const anioAnterior = anio - 1;
  const periodoAnterior = { fechaInicio: restarUnAnio(fechaInicio), fechaFin: restarUnAnio(fechaFin) };
  const actual = tramo(porMes, fechaInicio, fechaFin);
  const anterior = tramo(porMes, periodoAnterior.fechaInicio, periodoAnterior.fechaFin);
  const hayAnterior = RUBROS_ANIO.some((k) => Math.abs(anterior[k]) > 0.5);
  const meses = [];
  for (let m = 1; m <= mesFin; m += 1) {
    const mm = String(m).padStart(2, '0');
    meses.push({
      mes: mm,
      etiqueta: NOMBRE_MES[m - 1],
      actual: porMes.get(`${anio}-${mm}`) || vacio(),
      anterior: porMes.get(`${anioAnterior}-${mm}`) || vacio(),
    });
  }
  const label = Object.fromEntries(CUADRO.map((d) => [d.key, d.label]));
  const filas = CUADRO.map((def) => {
    const valores = meses.map((m) => redondear(m.actual[def.key]));
    const anteriores = meses.map((m) => redondear(m.anterior[def.key]));
    const acumulado = redondear(valores.reduce((s, x) => s + x, 0));
    const acumuladoAnterior = redondear(anteriores.reduce((s, x) => s + x, 0));
    return {
      key: def.key,
      label: def.label,
      nivel: def.nivel,
      meses: valores,
      acumulado,
      acumuladoAnterior,
      diferencia: redondear(acumulado - acumuladoAnterior),
      variacionPct: variacionPct(acumulado, acumuladoAnterior),
    };
  }).filter((f) => CUADRO_SIEMPRE.has(f.key)
    || Math.abs(f.acumulado) >= 0.5 || Math.abs(f.acumuladoAnterior) >= 0.5 || f.meses.some((x) => Math.abs(x) >= 0.5));
  return {
    anio,
    anioAnterior,
    periodoAnterior,
    hayAnterior,
    metrica: 'utilidadNeta',
    metricaLabel: 'Utilidad del periodo',
    rubros: RUBROS_ANIO.map((key) => ({
      key,
      label: label[key],
      actual: actual[key],
      anterior: anterior[key],
      diferencia: redondear(actual[key] - anterior[key]),
      variacionPct: variacionPct(actual[key], anterior[key]),
    })),
    meses: meses.map((m) => ({ mes: m.mes, etiqueta: m.etiqueta, actual: redondear(m.actual.utilidadNeta), anterior: redondear(m.anterior.utilidadNeta) })),
    cuadro: { meses: meses.map((m) => ({ mes: m.mes, etiqueta: m.etiqueta })), filas },
  };
}

// ── Revisión de la balanza ──────────────────────────────────────────────────

const likeRe = (patron) => new RegExp(`^${String(patron).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`);

/** Reglas con que el EEFF toma cada cuenta de resultados, por renglón. */
function reglasDelEstado() {
  const reglas = [];
  const porPrefijo = (concepto, patrones) => patrones.forEach((p) => reglas.push({ concepto, prueba: (c) => likeRe(p).test(c.cuenta) }));
  const porGpo = (concepto, gpo) => {
    const lista = new Set(getAccountsForGpo(gpo) || []);
    reglas.push({
      concepto,
      prueba: lista.size
        ? (c) => String(c.gpo) === String(gpo) && lista.has(c.cuenta)
        : (c) => String(c.gpo) === String(gpo),
    });
  };
  const porGrupos = (concepto, grupos) => {
    const set = new Set(grupos.map(String));
    reglas.push({ concepto, prueba: (c) => set.has(String(c.gpo)) });
  };
  [...cfg.MENUDEO_BRANCHES, cfg.FLOTILLAS_BRANCH, cfg.INTERCAMBIOS_BRANCH].forEach((bdef) => {
    porPrefijo(`Ventas ${bdef.label}`, bdef.revenuePrefixes);
    porPrefijo(`Costo ${bdef.label}`, bdef.costPrefixes);
    if (bdef.expenseGpo) porGpo(`Gastos ${bdef.label}`, bdef.expenseGpo);
  });
  cfg.SEMINUEVOS_BRANCHES.forEach((bdef) => {
    porPrefijo(`Ventas ${bdef.label}`, bdef.revenuePrefixes);
    porPrefijo(`Costo ${bdef.label}`, bdef.costPrefixes);
  });
  porGpo('Gastos Seminuevos', '720');
  cfg.POSTVENTA_SECTIONS.forEach((s) => {
    porPrefijo(`Ventas ${s.label}`, s.revenuePrefixes);
    porPrefijo(`Costo ${s.label}`, s.costPrefixes);
    if (s.expenseGpo) porGpo(`Gastos ${s.label}`, s.expenseGpo);
  });
  cfg.ADMIN_GROUPS.forEach((g) => porGpo('Gastos de administración', g));
  porGrupos('Productos financieros', cfg.FINANCIAL_PRODUCT_GROUPS);
  porGrupos('Gastos financieros', [...cfg.FINANCIAL_EXPENSE_ADD, ...cfg.FINANCIAL_EXPENSE_SUB]);
  return reglas;
}

/**
 * @param {Array<{cuenta, descripcion, gpo, importe}>} cuentas cuentas de detalle de
 *   resultados (04, 06, 07, 08, 09) con movimiento en el periodo, importe con signo de balanza.
 */
function revisarBalanza(cuentas, reglas = reglasDelEstado()) {
  const sinRenglon = [];
  const duplicadas = [];
  for (const c of cuentas) {
    if (Math.abs(num(c.importe)) < 0.005) continue;
    const toma = [...new Set(reglas.filter((r) => r.prueba(c)).map((r) => r.concepto))];
    if (!toma.length) sinRenglon.push({ cuenta: c.cuenta, descripcion: c.descripcion || '', importe: redondear(c.importe) });
    else if (toma.length > 1) duplicadas.push({ cuenta: c.cuenta, importe: redondear(c.importe), filas: toma.map((concepto) => ({ fila: '', concepto })) });
  }
  sinRenglon.sort((a, b) => Math.abs(b.importe) - Math.abs(a.importe));
  return { sinRenglon, duplicadas };
}

// ── Balance General ─────────────────────────────────────────────────────────

function estadoIndicador(v, { min = null, max = null, critico = null } = {}) {
  if (v == null || !Number.isFinite(Number(v))) return 'sin-dato';
  if (critico && critico(v)) return 'critico';
  if (min != null && v < min) return 'revisar';
  if (max != null && v > max) return 'revisar';
  return 'ok';
}

const ratio = (a, b) => (Math.abs(Number(b) || 0) < 0.5 ? null : Math.round((num(a) / num(b)) * 100) / 100);

/**
 * Balance de Balderrama (balanceGeneralService) con la forma de VECSA.
 * @param {object} bg payload de getBalanceGeneral
 * @param {number|null} erUtilidad utilidad del estado de resultados de enero al corte
 */
function construirBalance(bg, erUtilidad = null) {
  if (!bg?.available) return { disponible: false, nota: 'No hay balanza para el corte.' };
  const secs = new Map((bg.sections || []).map((s) => [s.key, s]));
  const cuentas = bg.accountsBySection || {};
  const grupo = (key) => {
    const s = secs.get(key);
    if (!s) return null;
    const lista = (cuentas[key] || []).filter((a) => !a.synthetic && Math.abs(num(a.value)) > 0.005);
    const valor = (a) => (s.pertenece === 'ACTIVO' ? num(a.signedValue) : num(a.value));
    return {
      grupo: key,
      concepto: s.label,
      total: redondear(key === 'capital' ? lista.reduce((t, a) => t + valor(a), 0) : s.value),
      mayores: lista.map((a) => ({ cuenta: a.cuenta, concepto: a.label, importe: redondear(valor(a)), detalle: [], cuentas: 0 })),
    };
  };
  const seccion = (key, label, grupos) => {
    const gs = grupos.map(grupo).filter(Boolean);
    return { key, label, total: redondear(gs.reduce((t, g) => t + g.total, 0)), grupos: gs };
  };
  const activo = seccion('activo', 'Activo', ['activoCirculante', 'activoFijo', 'activoDiferido']);
  const pasivo = seccion('pasivo', 'Pasivo', ['pasivoCortoPlazo', 'pasivoLargoPlazo']);
  const capital = seccion('capital', 'Capital', ['capital']);
  const resultado = redondear(bg.resultadoEjercicio || 0);
  const t = bg.totals || {};
  const capitalContable = redondear(t.capital);
  const pasivoMasCapital = redondear(t.pasivoMasCapital);
  const diferencia = redondear(t.ecuacionDiferencia ?? (num(t.activoTotal) - pasivoMasCapital));
  const liq = bg.liquidez || {};
  const est = bg.estructura || {};
  const activoCirculante = secs.get('activoCirculante')?.value ?? null;
  const pasivoCorto = secs.get('pasivoCortoPlazo')?.value ?? null;

  const indicadores = [
    {
      key: 'liquidez', label: 'Liquidez', valor: liq.razonCirculante ?? ratio(activoCirculante, pasivoCorto), unidad: 'veces',
      formula: 'Activo circulante ÷ pasivo a corto plazo', referencia: 'Agencia: 1.10 – 1.60',
      estado: estadoIndicador(liq.razonCirculante ?? ratio(activoCirculante, pasivoCorto), { min: 1.1, max: 1.6, critico: (v) => v < 1 }),
    },
    {
      key: 'pruebaAcida', label: 'Prueba ácida', valor: liq.pruebaAcida ?? null, unidad: 'veces',
      formula: '(Efectivo + cuentas por cobrar) ÷ pasivo a corto plazo', referencia: 'Agencia: 0.70 o más',
      estado: estadoIndicador(liq.pruebaAcida, { min: 0.7 }),
    },
    {
      key: 'capitalTrabajo', label: 'Capital de trabajo', valor: liq.capitalTrabajo ?? null, unidad: 'pesos',
      formula: 'Activo circulante − pasivo a corto plazo', referencia: 'Positivo',
      estado: liq.capitalTrabajo == null ? 'sin-dato' : (liq.capitalTrabajo < 0 ? 'critico' : 'ok'),
    },
    {
      key: 'endeudamiento', label: 'Endeudamiento', valor: est.endeudamientoPct ?? pct(t.pasivoTotal, t.activoTotal), unidad: '%',
      formula: 'Pasivo total ÷ activo total', referencia: 'Agencia: 60 % – 80 %',
      estado: estadoIndicador(est.endeudamientoPct ?? pct(t.pasivoTotal, t.activoTotal), { min: 60, max: 80, critico: (v) => v > 95 }),
    },
    {
      key: 'apalancamiento', label: 'Pasivo / capital', valor: capitalContable > 0 ? ratio(t.pasivoTotal, capitalContable) : null, unidad: 'veces',
      formula: 'Pasivo total ÷ capital contable (con el resultado del ejercicio)', referencia: 'Agencia: 4.0 o menos',
      estado: capitalContable <= 0 ? 'critico' : estadoIndicador(ratio(t.pasivoTotal, capitalContable), { max: 4 }),
    },
  ];

  return {
    disponible: true,
    corte: bg.labelCierre || bg.asOf,
    nota: 'Saldos al cierre con la fórmula de Contpaq por naturaleza (cuentas de mayor). Las complementarias, como la depreciación acumulada, restan dentro de su grupo.',
    secciones: [activo, pasivo, capital],
    totales: {
      activo: redondear(t.activoTotal),
      pasivo: redondear(t.pasivoTotal),
      capital: redondear(capitalContable - resultado),
      resultado,
      capitalContable,
      pasivoMasCapital,
      activoCirculante,
      pasivoCorto,
    },
    cuadre: { diferencia, ok: Math.abs(diferencia) < 1 },
    indicadores,
    conciliacion: {
      balanza: resultado,
      estadoResultados: erUtilidad == null ? null : redondear(erUtilidad),
      diferencia: erUtilidad == null ? null : redondear(resultado - erUtilidad),
      porPrefijo: (bg.resultadoPorPrefijo || []).map((p) => ({ ...p, enEstado: true })),
    },
  };
}

// ── Servicios (con base de datos) ───────────────────────────────────────────

async function cuentasDeResultados(fechaInicio, fechaFin) {
  const { query } = require('../db');
  const [y1, m1] = String(fechaInicio).split('-').map(Number);
  const [y2, m2] = String(fechaFin).split('-').map(Number);
  const acumulado = new Map();
  for (let y = y1; y <= y2; y += 1) {
    const desde = y === y1 ? m1 : 1;
    const hasta = y === y2 ? m2 : 12;
    const tabla = `CON_CTAS01${y}`;
    // eslint-disable-next-line no-await-in-loop
    const existe = await query('SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @t', { t: tabla });
    if (!existe.length) continue;
    const mov = [];
    for (let m = desde; m <= hasta; m += 1) mov.push(`ISNULL(CTA_ABONO${m}, 0) - ISNULL(CTA_CARGO${m}, 0)`);
    // eslint-disable-next-line no-await-in-loop
    const filas = await query(`
      SELECT RTRIM(CTA_NUMCTA) AS cuenta, MAX(CTA_DESCRIPCION) AS descripcion, MAX(CTA_GPOCONT) AS gpo,
             SUM(${mov.join(' + ')}) AS importe
      FROM [${tabla}]
      WHERE CTA_ACUMDET = 'DETA' AND LEFT(RTRIM(CTA_NUMCTA), 2) IN ('04', '06', '07', '08', '09')
      GROUP BY RTRIM(CTA_NUMCTA)
    `);
    for (const f of filas) {
      const prev = acumulado.get(f.cuenta);
      acumulado.set(f.cuenta, {
        cuenta: f.cuenta,
        descripcion: f.descripcion || prev?.descripcion || '',
        gpo: f.gpo ?? prev?.gpo,
        importe: num(prev?.importe) + num(f.importe),
      });
    }
  }
  return [...acumulado.values()];
}

async function mesesDelEstado(fechaInicio, fechaFin) {
  const store = require('./eeffMensualStore');
  const [anio, mesFin] = String(fechaFin).split('-').map(Number);
  const [anioIni, mesIni] = String(fechaInicio).split('-').map(Number);
  const lista = [];
  const pedir = (y, m) => { if (!lista.some((x) => x.year === y && x.mes === m)) lista.push({ year: y, mes: m }); };
  for (let m = 1; m <= mesFin; m += 1) { pedir(anio, m); pedir(anio - 1, m); }
  // Periodo que empieza en otro año: también sus meses y los del año anterior.
  for (let y = anioIni; y < anio; y += 1) {
    for (let m = (y === anioIni ? mesIni : 1); m <= 12; m += 1) { pedir(y, m); pedir(y - 1, m); }
  }
  const meses = await store.getEeffMeses(lista);
  const porMes = new Map();
  for (const m of meses) {
    if (m?.available && m.pnl) porMes.set(m.key, totalesDeMes(m.pnl));
  }
  return porMes;
}

async function getEstadoResultadosFormato({ fechaInicio, fechaFin }) {
  if (!fechaInicio || !fechaFin) throw new Error('fechaInicio y fechaFin son obligatorios');
  const { getEeffSummary } = require('./eeffSummaryService');
  const { getPuntoEquilibrio } = require('./breakEvenService');
  const [payload, porMes, pe, cuentas] = await Promise.all([
    getEeffSummary({ fechaInicio, fechaFin }),
    mesesDelEstado(fechaInicio, fechaFin).catch((err) => { console.error('[contabilidad-formato] meses:', err.message); return new Map(); }),
    getPuntoEquilibrio({ fechaInicio, fechaFin }).catch(() => null),
    cuentasDeResultados(fechaInicio, fechaFin).catch((err) => { console.error('[contabilidad-formato] revisión:', err.message); return null; }),
  ]);
  return armarEstado({ payload, porMes, pe, cuentas, fechaInicio, fechaFin });
}

/** Parte pura: recibe lo ya calculado y arma la respuesta (la usan las pruebas). */
function armarEstado({ payload, porMes = new Map(), pe = null, cuentas = null, fechaInicio, fechaFin }) {
  const disponible = Boolean(payload?.available);
  const edo = payload?.estadoFinanciero?.summary || {};
  const { filas, bloques } = construirFilas(payload);
  const totales = totalesDe(edo);
  const revision = cuentas ? revisarBalanza(cuentas) : { sinRenglon: [], duplicadas: [] };
  const gastos = gastosDe(payload, totales);
  return {
    fechaInicio,
    fechaFin,
    fuente: 'CON_CTAS · EEFF SUMMARY',
    disponible,
    nota: disponible
      ? 'Estado de resultados de la balanza con el mapeo del EEFF SUMMARY de Contraloría. Los gastos de administración son de toda la agencia.'
      : 'No hay balanza para el periodo.',
    totales,
    margenes: {
      brutoPct: pct(totales.utilidadBruta, totales.ventas),
      operacionPct: pct(totales.utilidadOperacion, totales.ventas),
      netoPct: pct(totales.utilidadNeta, totales.ventas),
    },
    filas: filas.map((f) => ({ ...f, pctVentas: pct(f.importe, totales.ventas) })),
    bloques,
    lineas: lineasDe(payload),
    gastos: gastos.rubros,
    gastosFueraDelEstado: gastos.fuera,
    equilibrio: equilibrioDe(pe),
    serie: armarSerie(porMes, fechaFin),
    comparativo: porMes.size ? armarComparativo(porMes, fechaInicio, fechaFin) : null,
    revisionDisponible: Boolean(cuentas),
    cuentasSinRenglon: revision.sinRenglon,
    cuentasDuplicadas: revision.duplicadas,
  };
}

async function getBalanceFormato({ fechaFin }) {
  if (!fechaFin) throw new Error('fechaFin es obligatoria');
  const { getBalanceGeneral } = require('./balanceGeneralService');
  const [anio] = String(fechaFin).split('-');
  const [bg, porMes] = await Promise.all([
    getBalanceGeneral({ fechaFin, includeComparativo: false }),
    mesesDelEstado(`${anio}-01-01`, fechaFin).catch(() => new Map()),
  ]);
  // Utilidad del estado de resultados de enero al mes del corte del balance.
  const mesCorte = Number(bg?.month) || Number(String(fechaFin).split('-')[1]);
  const keys = [];
  for (let m = 1; m <= mesCorte; m += 1) keys.push(`${anio}-${String(m).padStart(2, '0')}`);
  const completos = keys.every((k) => porMes.has(k));
  const erUtilidad = completos ? keys.reduce((s, k) => s + num(porMes.get(k).utilidadNeta), 0) : null;
  return construirBalance(bg, erUtilidad);
}

module.exports = {
  getEstadoResultadosFormato,
  getBalanceFormato,
  armarEstado,
  construirFilas,
  totalesDe,
  totalesDeMes,
  lineasDe,
  gastosDe,
  gposEnEstado,
  equilibrioDe,
  armarSerie,
  armarComparativo,
  restarUnAnio,
  reglasDelEstado,
  revisarBalanza,
  construirBalance,
  likeRe,
};
