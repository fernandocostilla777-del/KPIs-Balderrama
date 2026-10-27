/**
 * Tiempo a compra de un lead (Kaplan–Meier; factores por grupo, sin modelo paramétrico).
 * La ventana es de 12 meses hasta fechaFin, independiente del mes consultado.
 * No devuelve datos personales.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  getLeadNotDuplicateSql,
  compraLeadSql,
  fechaCompraLeadSql,
} = require('./crmCiclosService');

const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
const HORIZONTE = 180;
const MIN_COMPRAS_FACTORES = 40;
const MIN_COMPRAS_CURVA = 15;
const MIN_COMPRAS_NIVEL = 5;
const MIN_COMPRAS_RAPIDEZ = 10;
const MAX_NIVELES_FACTOR = 6;
const BOOT_REPS = 400;
const LANDMARK_DIA = 14;
const HORIZONTE_HITO = 90;
const MIN_LEADS_HITO = 20;
const Z95 = 1.959963984540054;

const cache = new Map();

function diasEntre(desde, hasta) {
  const a = Date.parse(`${String(desde).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(hasta).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function sumarMeses(iso, meses) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const destino = m - 1 + meses;
  // El día se ajusta al último del mes destino: 29/02/2028 - 12 meses = 28/02/2027, no 01/03/2027.
  const ultimo = new Date(Date.UTC(y, destino + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, destino, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/**
 * IC 95 % de S(t) en escala log(-log S) (Kalbfleisch–Prentice). acum = suma de Greenwood.
 * Con F pequeño el IC lineal tiene cobertura menor al 95 % y hay que recortarlo en [0, 1].
 */
function icLogLog(S, acum) {
  if (!(S > 0)) return [0, 0];
  if (!(S < 1) || !(acum > 0)) return [S, S];
  const se = Math.sqrt(acum) / Math.abs(Math.log(S));
  const factor = Math.exp(Z95 * se);
  return [Math.pow(S, factor), Math.pow(S, 1 / factor)];
}

function grupoFuente(tipo) {
  const c = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  if (!c) return 'Sin fuente';
  if ((c.includes('VISITA') && c.includes('PISO')) || c === 'PISO') return 'Visita a piso';
  if (c.includes('CARTERA')) return 'Cartera';
  if (c.includes('BASEDEDATOS') || c.includes('BASEDEDATO')) return 'Base de datos';
  if (c.includes('DIGITAL') || c.includes('INTERNET') || c.includes('WEB') || c === 'LEAD' || c.startsWith('LEADS')) return 'Lead digital';
  if (c.includes('TELEFON') || c.includes('LLAMADA')) return 'Teléfono';
  // Cualquier otra fuente de la hoja STREGA se muestra con su nombre (el factor junta las chicas en «Otras»).
  const limpio = String(tipo).replace(/\s+/g, ' ').trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}

function nivelTexto(valor, vacio = 'Sin dato') {
  const s = String(valor || '').replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim();
  return s || vacio;
}

/**
 * Arma el tiempo observado. compraDia null = sin compra fechada.
 * corte = último día que se observa. horizonte = tope del modelo (180).
 */
function armarObservaciones(filas, { corte, horizonte = HORIZONTE } = {}) {
  const obs = [];
  let excluidos = 0;
  for (const f of filas) {
    const entrada = String(f.entrada || '').slice(0, 10);
    const diasCorte = diasEntre(entrada, corte);
    if (diasCorte == null || diasCorte < 0) {
      excluidos += 1;
      continue;
    }
    const compraDia = f.compraDia == null ? null : Number(f.compraDia);
    // Compra anterior a la entrada: dato inconsistente, fuera. Compra muy tardía (p. ej. día 400):
    // el lead estuvo en riesgo los 180 días sin comprar, así que se queda como censurado.
    if (compraDia != null && (!Number.isFinite(compraDia) || compraDia < 0)) {
      excluidos += 1;
      continue;
    }
    const censura = Math.min(diasCorte, horizonte);
    let event = 0;
    let t = censura;
    if (compraDia != null && compraDia <= horizonte && compraDia <= diasCorte) {
      event = 1;
      t = compraDia;
    }
    obs.push({
      t: Math.max(0, t),
      event,
      fuente: f.fuente || grupoFuente(f.tipo),
      forma: nivelTexto(f.forma),
      estrena: nivelTexto(f.estrena),
    });
  }
  return { obs, excluidos };
}

function kaplanMeier(observations) {
  const rows = (observations || [])
    .map((o) => ({ t: Number(o.t), event: o.event ? 1 : 0 }))
    .filter((o) => Number.isFinite(o.t) && o.t >= 0)
    .sort((a, b) => a.t - b.t || b.event - a.event);

  const n0 = rows.length;
  let atRisk = n0;
  let S = 1;
  let acum = 0;
  const curve = [{ dia: 0, s: 1, f: 0, li: 0, ls: 0 }];
  let i = 0;
  while (i < rows.length) {
    const t = rows[i].t;
    let d = 0;
    let c = 0;
    while (i < rows.length && rows[i].t === t) {
      if (rows[i].event) d += 1;
      else c += 1;
      i += 1;
    }
    if (d > 0 && atRisk > 0) {
      const ni = atRisk;
      S *= 1 - d / ni;
      if (ni > d) acum += d / (ni * (ni - d));
      const [sLi, sLs] = icLogLog(S, acum);
      curve.push({
        dia: t,
        s: S,
        f: 1 - S,
        li: 1 - sLs,
        ls: 1 - sLi,
      });
    }
    atRisk -= d + c;
  }
  return curve;
}

function fEnDia(curve, dia) {
  let f = 0;
  for (const p of curve) {
    if (p.dia <= dia) f = p.f;
    else break;
  }
  return f;
}

function diaCuantilCompras(observations, p) {
  const times = (observations || [])
    .filter((o) => o.event)
    .map((o) => Number(o.t))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (!times.length) return null;
  const i = Math.max(0, Math.ceil(p * times.length) - 1);
  return times[Math.min(i, times.length - 1)];
}

/**
 * Día en que ya ocurrió la fracción p de las compras que el modelo espera al horizonte.
 * Se lee de Kaplan–Meier: F(t) >= p · F(horizonte). Así los leads recientes, que todavía
 * no alcanzan a mostrar compras tardías, no acortan el resultado (el cuantil de los
 * tiempos observados sí lo hace).
 */
function diaCuantilKm(curve, p, horizonte = HORIZONTE) {
  const fH = fEnDia(curve, horizonte);
  if (!(fH > 0)) return null;
  const meta = p * fH - 1e-12;
  for (const punto of curve) {
    if (punto.dia > horizonte) break;
    if (punto.f >= meta) return punto.dia;
  }
  return null;
}

function tiempoCompra(observations, horizonte = HORIZONTE) {
  const curve = kaplanMeier(observations);
  const f90 = fEnDia(curve, 90);
  const fH = fEnDia(curve, horizonte);
  const pctDespues90 = fH > 0 ? Math.round(((fH - f90) / fH) * 1000) / 10 : null;
  return {
    t50: diaCuantilKm(curve, 0.5, horizonte),
    t80: diaCuantilKm(curve, 0.8, horizonte),
    pctDespues90,
    curve,
  };
}

function puntosCurva(curve) {
  return curve.map((p) => ({
    dia: p.dia,
    f: Math.round(p.f * 10000) / 10000,
    li: Math.round(p.li * 10000) / 10000,
    ls: Math.round(p.ls * 10000) / 10000,
  }));
}

/**
 * Kaplan–Meier rápido sobre observaciones ya ordenadas, con pesos (para el bootstrap).
 * Devuelve F(horizonte), su error estándar (Greenwood) y el día en que ya ocurrió la
 * mitad de las compras esperadas al horizonte (F(t) >= 0.5 · F(horizonte)).
 */
function prepararKm(obs) {
  const rows = (obs || [])
    .map((o) => ({ t: Number(o.t), e: o.event ? 1 : 0 }))
    .filter((o) => Number.isFinite(o.t) && o.t >= 0)
    .sort((x, y) => x.t - y.t || y.e - x.e);
  const n = rows.length;
  const t = new Float64Array(n);
  const e = new Uint8Array(n);
  rows.forEach((r, i) => {
    t[i] = r.t;
    e[i] = r.e;
  });
  return { n, t, e, compras: rows.reduce((acc, r) => acc + r.e, 0) };
}

function resumenKm(prep, horizonte = HORIZONTE, w = null) {
  const { n, t, e } = prep;
  let atRisk = 0;
  for (let i = 0; i < n; i += 1) atRisk += w ? w[i] : 1;
  let S = 1;
  let acum = 0;
  const dias = [];
  const fs = [];
  let i = 0;
  while (i < n) {
    const dia = t[i];
    let d = 0;
    let c = 0;
    while (i < n && t[i] === dia) {
      const wi = w ? w[i] : 1;
      if (e[i]) d += wi;
      else c += wi;
      i += 1;
    }
    if (d > 0 && atRisk > 0 && dia <= horizonte) {
      S *= 1 - d / atRisk;
      if (atRisk > d) acum += d / (atRisk * (atRisk - d));
      dias.push(dia);
      fs.push(1 - S);
    }
    atRisk -= d + c;
  }
  const fH = 1 - S;
  let mitad = null;
  if (fH > 0) {
    const meta = 0.5 * fH - 1e-12;
    for (let k = 0; k < fs.length; k += 1) {
      if (fs[k] >= meta) {
        mitad = dias[k];
        break;
      }
    }
  }
  return { fH, seH: S * Math.sqrt(Math.max(0, acum)), acum, mitad };
}

/** Generador fijo: el bootstrap da el mismo resultado en cada consulta. */
function generador(semilla = 20260419) {
  let x = semilla >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Días a la mitad de las compras en B remuestreos (con reemplazo) del grupo. */
function mitadesBootstrap(prep, horizonte, reps, rnd) {
  const out = new Float64Array(reps);
  const w = new Float64Array(prep.n);
  for (let r = 0; r < reps; r += 1) {
    w.fill(0);
    for (let k = 0; k < prep.n; k += 1) w[Math.floor(rnd() * prep.n)] += 1;
    const m = resumenKm(prep, horizonte, w).mitad;
    out[r] = m == null ? NaN : m;
  }
  return out;
}

function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const pos = (ordenados.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (pos - lo);
}

const NO_ACCIONABLES = new Set(['Sin dato', 'Otros', 'Otras', 'Sin fuente']);

/**
 * Compara cada nivel de un campo contra su base, en dos preguntas que se miden por separado
 * y sin extrapolar más allá de lo observado:
 *  - ¿Compra más?  % que compra dentro del horizonte (Kaplan–Meier), razón nivel/base con
 *    intervalo por método delta sobre Greenwood.
 *  - ¿Más rápido?  Entre los que compran, día en que ya ocurrió la mitad de sus compras;
 *    razón nivel/base con intervalo bootstrap percentil.
 * "Sin dato", "Otros" y "Otras" no se muestran ni sirven de base: no son accionables.
 */
function factoresDeCampo(obs, {
  factor, campo, tipo, basePreferida = null, desplazamiento = 0, horizonte = HORIZONTE,
} = {}) {
  const comprasTot = obs.filter((o) => o.event).length;
  if (comprasTot < MIN_COMPRAS_FACTORES) return [];

  const grupos = new Map();
  for (const o of obs) {
    const nivel = o[campo];
    if (NO_ACCIONABLES.has(nivel)) continue;
    if (!grupos.has(nivel)) grupos.set(nivel, []);
    grupos.get(nivel).push(o);
  }
  const comprasDe = (lista) => lista.reduce((acc, o) => acc + (o.event ? 1 : 0), 0);
  const validos = [...grupos.entries()].filter(([, lista]) => comprasDe(lista) >= MIN_COMPRAS_NIVEL);
  if (validos.length < 2) return [];

  let base = basePreferida && validos.some(([n]) => n === basePreferida) ? basePreferida : null;
  if (!base) base = validos.slice().sort((x, y) => y[1].length - x[1].length)[0][0];
  const prepBase = prepararKm(grupos.get(base));
  const kmBase = resumenKm(prepBase, horizonte);
  const elegidos = validos
    .filter(([n]) => n !== base)
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, MAX_NIVELES_FACTOR);

  const rnd = generador();
  const bootBase = prepBase.compras >= MIN_COMPRAS_RAPIDEZ
    ? mitadesBootstrap(prepBase, horizonte, BOOT_REPS, rnd)
    : null;
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const fuera = (par) => !!(par && (par[1] < 1 || par[0] > 1));
  const dia = (m) => (m == null ? null : m + desplazamiento);
  // Medio día de corrección en el cociente: una mitad en el día 0 (compra el mismo día de
  // la entrada) daría log(0) = -∞ en el bootstrap o una división entre 0.
  const diaCociente = (m) => dia(m) + 0.5;

  return elegidos.map(([nivel, lista]) => {
    const prep = prepararKm(lista);
    const km = resumenKm(prep, horizonte);

    let razonCompra = null;
    let ic95Compra = null;
    if (km.fH > 0 && kmBase.fH > 0) {
      razonCompra = km.fH / kmBase.fH;
      const se = Math.sqrt((km.seH / km.fH) ** 2 + (kmBase.seH / kmBase.fH) ** 2);
      ic95Compra = [razonCompra * Math.exp(-Z95 * se), razonCompra * Math.exp(Z95 * se)];
    }

    let cocienteTiempo = null;
    let ic95 = null;
    if (bootBase && prep.compras >= MIN_COMPRAS_RAPIDEZ && km.mitad != null && kmBase.mitad != null) {
      cocienteTiempo = diaCociente(km.mitad) / diaCociente(kmBase.mitad);
      const boot = mitadesBootstrap(prep, horizonte, BOOT_REPS, rnd);
      const logs = [];
      for (let r = 0; r < BOOT_REPS; r += 1) {
        if (Number.isFinite(boot[r]) && Number.isFinite(bootBase[r])) {
          logs.push(Math.log(diaCociente(boot[r]) / diaCociente(bootBase[r])));
        }
      }
      if (logs.length >= BOOT_REPS * 0.8) {
        logs.sort((x, y) => x - y);
        ic95 = [Math.exp(percentil(logs, 0.025)), Math.exp(percentil(logs, 0.975))];
      }
    }

    return {
      factor,
      nivel,
      base,
      tipo,
      leads: lista.length,
      compras: prep.compras,
      // ¿Compra más? % que compra dentro del horizonte, nivel contra base.
      probCompra: { nivel: r1(km.fH * 100), base: r1(kmBase.fH * 100) },
      razonCompra: razonCompra == null ? null : r2(razonCompra),
      ic95Compra: ic95Compra ? ic95Compra.map(r2) : null,
      concluyenteCompra: fuera(ic95Compra),
      // ¿Más rápido? Día (desde la entrada) en que ya ocurrió la mitad de sus compras.
      diaMitad: { nivel: dia(km.mitad), base: dia(kmBase.mitad) },
      cocienteTiempo: cocienteTiempo == null ? null : r2(cocienteTiempo),
      ic95: ic95 ? ic95.map(r2) : null,
      concluyente: fuera(ic95),
    };
  });
}

const HITOS = [
  { clave: 'cita', campo: 'citaDia', etiqueta: 'Cita asistida' },
  { clave: 'prueba', campo: 'pruebaDia', etiqueta: 'Prueba de manejo' },
  { clave: 'solicitud', campo: 'solicitudDia', etiqueta: 'Solicitud de crédito' },
];

function mediana(nums) {
  if (!nums.length) return null;
  const v = nums.slice().sort((x, y) => x - y);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

/**
 * Compra después de cada hito, con el reloj arrancando el día del hito.
 *  - Entra quien alcanzó el hito antes del corte y no había comprado antes del hito.
 *  - Compra = factura dentro de los `horizonte` días siguientes; si el lead todavía no
 *    cumple esos días al corte, se censura (Kaplan–Meier), así los hitos recientes no
 *    bajan el porcentaje.
 *  - Referencia: leads que al día 14 seguían sin comprar y sin cita, prueba ni solicitud;
 *    su reloj arranca el día 14.
 * filas: { entrada, compraDia, citaDia, pruebaDia, solicitudDia } (días desde la entrada).
 */
function medirHitos(filas, { corte, horizonte = HORIZONTE_HITO, disponibles = {} } = {}) {
  const validas = [];
  for (const f of filas || []) {
    const dc = diasEntre(String(f.entrada || '').slice(0, 10), corte);
    if (dc == null || dc < 0) continue;
    const c = f.compraDia == null ? null : Number(f.compraDia);
    if (c != null && (!Number.isFinite(c) || c < 0)) continue;
    validas.push({ ...f, compraDia: c, dc });
  }
  const desde = (f, inicio) => {
    const censura = Math.min(f.dc - inicio, horizonte);
    if (f.compraDia != null && f.compraDia - inicio <= censura) return { t: f.compraDia - inicio, event: 1 };
    return { t: censura, event: 0 };
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const resumir = (base, lista, extra = {}) => {
    const prep = prepararKm(lista);
    const km = resumenKm(prep, horizonte);
    const suficiente = lista.length >= MIN_LEADS_HITO;
    const mismoDia = lista.filter((o) => o.event && o.t === 0).length;
    const [sLo, sHi] = icLogLog(1 - km.fH, km.acum);
    // F(0) de Kaplan–Meier = compras del mismo día / leads (al día 0 todos están en riesgo).
    const f0 = lista.length ? mismoDia / lista.length : 0;
    const fProsp = f0 < 1 ? Math.max(0, (km.fH - f0) / (1 - f0)) : 0;
    return {
      ...base,
      leads: lista.length,
      compras: prep.compras,
      suficiente,
      pct: suficiente ? r1(km.fH * 100) : null,
      ic95: suficiente ? [r1((1 - sHi) * 100), r1((1 - sLo) * 100)] : null,
      // Compra en los días 1 a 90 entre quienes no compraron el mismo día del hito
      // (separa el registro administrativo del mismo trámite).
      pctProspectivo: suficiente ? r1(fProsp * 100) : null,
      // Entre los que compran: días desde el hito hasta que ya ocurrió la mitad de sus compras.
      diaMitad: suficiente && prep.compras >= 3 ? km.mitad : null,
      mismoDia,
      pctMismoDia: prep.compras ? r1((mismoDia / prep.compras) * 100) : null,
      ...extra,
    };
  };

  const referencia = [];
  for (const f of validas) {
    if (f.dc < LANDMARK_DIA) continue;
    if (f.compraDia != null && f.compraDia < LANDMARK_DIA) continue;
    if (HITOS.some((h) => f[h.campo] != null && f[h.campo] <= LANDMARK_DIA)) continue;
    referencia.push(desde(f, LANDMARK_DIA));
  }
  const out = [resumir(
    { clave: 'referencia', etiqueta: `Sin cita, prueba ni solicitud al día ${LANDMARK_DIA}` },
    referencia,
    { diasAlHito: LANDMARK_DIA },
  )];

  for (const h of HITOS) {
    const lista = [];
    const dias = [];
    let compraronAntes = 0;
    for (const f of validas) {
      const d = f[h.campo] == null ? null : Number(f[h.campo]);
      if (d == null || !Number.isFinite(d) || d < 0 || d > f.dc) continue;
      if (f.compraDia != null && f.compraDia < d) {
        compraronAntes += 1;
        continue;
      }
      lista.push(desde(f, d));
      dias.push(d);
    }
    out.push(resumir({ clave: h.clave, etiqueta: h.etiqueta }, lista, {
      diasAlHito: mediana(dias),
      compraronAntes,
      sinDatos: disponibles[h.clave] === false,
    }));
  }
  return out;
}

function etiquetaNivel(v) {
  const t = String(v || '');
  return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

/** Sujeto en lenguaje natural para cada factor: ["Los leads de Visita a piso", "Lead digital"]. */
function sujetoFactor(f) {
  const n = etiquetaNivel(f.nivel);
  const b = etiquetaNivel(f.base);
  if (f.factor === 'forma_compra') return [`Los que pagan a ${n.toLowerCase()}`, `los de ${b.toLowerCase()}`];
  if (f.factor === 'cuando_estrena') return [`Los que dicen que estrenan "${n.toLowerCase()}"`, `"${b.toLowerCase()}"`];
  return [`Los leads de ${n}`, b];
}

function elegirDestacados(factores) {
  const utiles = (factores || []).filter((f) => !NO_ACCIONABLES.has(f.nivel));
  const compra = utiles
    .filter((f) => f.concluyenteCompra && f.razonCompra > 0)
    .sort((a, b) => Math.abs(Math.log(b.razonCompra)) - Math.abs(Math.log(a.razonCompra)))[0] || null;
  const rapidez = utiles
    .filter((f) => f.concluyente && f.cocienteTiempo > 0)
    .sort((a, b) => Math.abs(Math.log(b.cocienteTiempo)) - Math.abs(Math.log(a.cocienteTiempo)))[0] || null;
  return { compra, rapidez, hayUtiles: utiles.length > 0 };
}

function redactarHallazgos(tiempo, factores) {
  if (tiempo.t50 == null) return 'Todavía no hay compras con fecha en esta ventana.';
  const partes = [];
  const { compra, rapidez, hayUtiles } = elegirDestacados(factores);
  if (compra) {
    const [quien, contra] = sujetoFactor(compra);
    partes.push(`${quien} compran ${compra.probCompra.nivel} % en sus primeros ${HORIZONTE} días, contra ${compra.probCompra.base} % de ${contra}.`);
  }
  if (rapidez) {
    const [quien, contra] = sujetoFactor(rapidez);
    partes.push(`Entre los que compran, ${quien.charAt(0).toLowerCase() + quien.slice(1)} llegan a la mitad de sus compras el día ${rapidez.diaMitad.nivel}, contra el día ${rapidez.diaMitad.base} de ${contra}.`);
  } else if (hayUtiles) {
    partes.push('Ningún factor cambia la rapidez de forma concluyente con el volumen actual.');
  }
  return partes.join(' ');
}

function construirRespuesta(filas, {
  corte, horizonte = HORIZONTE, desde, hasta, cobertura = null,
} = {}) {
  const { obs, excluidos } = armarObservaciones(filas, { corte, horizonte });
  const compras = obs.filter((o) => o.event).length;
  const tiempo = tiempoCompra(obs, horizonte);
  const avisos = [];
  const vacio = (campo) => obs.filter((o) => o[campo] === 'Sin dato').length;
  const pctVacio = (campo) => (obs.length ? Math.round((vacio(campo) / obs.length) * 1000) / 10 : 0);
  if (pctVacio('forma') >= 20) avisos.push(`"Forma de compra" viene vacía en ${Math.round(pctVacio('forma'))} % de los leads`);
  if (pctVacio('estrena') >= 20) avisos.push(`"Cuándo estrena" viene vacío en ${Math.round(pctVacio('estrena'))} % de los leads`);

  const porFuente = new Map();
  for (const o of obs) {
    if (!porFuente.has(o.fuente)) porFuente.set(o.fuente, []);
    porFuente.get(o.fuente).push(o);
  }
  const curvas = [...porFuente.entries()]
    .map(([grupo, lista]) => ({
      grupo,
      compras: lista.filter((o) => o.event).length,
      puntos: puntosCurva(kaplanMeier(lista)),
    }))
    .filter((c) => c.compras >= MIN_COMPRAS_CURVA);

  let factores = [];
  if (compras < MIN_COMPRAS_FACTORES) {
    avisos.push(`Hay ${compras} compras con fecha; hacen falta al menos ${MIN_COMPRAS_FACTORES} para estimar factores.`);
  } else {
    factores = [
      ...factoresDeCampo(obs, { factor: 'fuente', campo: 'fuente', tipo: 'al_entrar', basePreferida: 'Lead digital', horizonte }),
      ...factoresDeCampo(obs, { factor: 'forma_compra', campo: 'forma', tipo: 'al_entrar', horizonte }),
      ...factoresDeCampo(obs, { factor: 'cuando_estrena', campo: 'estrena', tipo: 'al_entrar', horizonte }),
    ];
  }

  return {
    ventana: { desde, hasta, horizonteDias: horizonte },
    muestra: {
      leads: obs.length,
      compras,
      censurados: obs.length - compras,
      excluidos,
    },
    tiempo: {
      t50: tiempo.t50,
      t80: tiempo.t80,
      pctDespues90: tiempo.pctDespues90,
    },
    // Curva de todos los leads: referencia contra la que se leen las curvas por fuente.
    curvaGeneral: puntosCurva(tiempo.curve),
    curvas,
    factores,
    // Después de cada hito (cita, prueba, solicitud): reloj desde el día del hito.
    hitos: {
      horizonteDias: HORIZONTE_HITO,
      filas: medirHitos(filas, {
        corte,
        disponibles: {
          cita: true,
          prueba: cobertura ? cobertura.pruebas.disponible : true,
          solicitud: cobertura ? cobertura.solicitudes.disponible : true,
        },
      }),
      cobertura,
    },
    hallazgos: redactarHallazgos(tiempo, factores),
    destacados: (() => {
      const d = elegirDestacados(factores);
      const clave = (f) => (f ? `${f.factor}|${f.nivel}` : null);
      return { compra: clave(d.compra), rapidez: clave(d.rapidez) };
    })(),
    avisos,
    metodo: `Kaplan–Meier. Por factor, cada nivel contra su base: % que compra en ${horizonte} días (intervalo por Greenwood) y día en que ya ocurrió la mitad de sus compras (intervalo bootstrap, ${BOOT_REPS} remuestreos). Después de cada hito (cita, prueba, solicitud), % que compra en ${HORIZONTE_HITO} días con el reloj desde el hito.`,
  };
}

/** Primera fecha del hito en o después de la entrada (las anteriores son de otro ciclo). */
function primeraDesde(fechas, entrada) {
  if (!fechas) return null;
  for (const f of fechas) if (f >= entrada) return f;
  return null;
}

function leerFilas({ desde, hasta, crmTexto = null }) {
  if (!fs.existsSync(DB_PATH)) {
    throw Object.assign(new Error('Tabla de leads no cargada.'), { status: 503 });
  }
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const where = [
      getLeadNotDuplicateSql(),
      `fecha_entrada IS NOT NULL AND trim(fecha_entrada) <> ''`,
      'substr(fecha_entrada, 1, 10) >= ?',
      'substr(fecha_entrada, 1, 10) <= ?',
    ];
    const params = [desde, hasta];
    const alcance = require('../auth/alcanceSucursal').sqlCrmSucursal(crmTexto);
    if (alcance) {
      where.push(alcance.sql);
      params.push(...alcance.params);
    }
    const rows = db.prepare(`
      SELECT
        id_crm AS idCrm,
        substr(fecha_entrada, 1, 10) AS entrada,
        tipo,
        forma_compra AS forma,
        cuando_estrena AS estrena,
        upper(trim(COALESCE(cita_asistida, ''))) AS cita,
        substr(fecha_cita, 1, 10) AS fechaCita,
        (${compraLeadSql()}) AS conCompra,
        (${fechaCompraLeadSql()}) AS fechaCompra
      FROM crm_leads
      WHERE ${where.join(' AND ')}
    `).all(...params);

    const hay = (tabla) => !!db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(tabla);
    // id_crm -> fechas ordenadas del hito
    const leerFechas = (sql) => {
      const m = new Map();
      for (const r of db.prepare(sql).all()) {
        const k = String(r.idCrm).trim();
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r.fecha);
      }
      return m;
    };
    const tienePruebas = hay('crm_pruebas_manejo');
    const tieneSolicitudes = hay('crm_solicitudes');
    const pruebas = tienePruebas ? leerFechas(`
      SELECT trim(id_crm) AS idCrm, substr(fecha, 1, 10) AS fecha
      FROM crm_pruebas_manejo
      WHERE id_crm IS NOT NULL AND trim(id_crm) <> '' AND fecha IS NOT NULL AND trim(fecha) <> ''
      ORDER BY fecha
    `) : new Map();
    const solicitudes = tieneSolicitudes ? leerFechas(`
      SELECT trim(id_crm) AS idCrm, substr(fecha_solicitud, 1, 10) AS fecha
      FROM crm_solicitudes
      WHERE id_crm IS NOT NULL AND trim(id_crm) <> '' AND fecha_solicitud IS NOT NULL AND trim(fecha_solicitud) <> ''
      ORDER BY fecha
    `) : new Map();

    // Cobertura: cuántos registros del hito en la ventana cruzan con un lead por ID CRM.
    const idsLeads = new Set(rows.map((r) => String(r.idCrm || '').trim()).filter(Boolean));
    const contar = (tabla, campoFecha) => {
      const extra = alcance
        ? ` AND trim(id_crm) IN (
            SELECT trim(id_crm) FROM crm_leads
            WHERE id_crm IS NOT NULL AND trim(id_crm) <> ''
              AND ${alcance.sql}
          )`
        : '';
      const extraParams = alcance ? alcance.params : [];
      const tot = db.prepare(`
        SELECT COUNT(*) AS n FROM ${tabla}
        WHERE substr(${campoFecha}, 1, 10) >= ? AND substr(${campoFecha}, 1, 10) <= ?
        ${extra}
      `).get(desde, hasta, ...extraParams).n;
      const ids = db.prepare(`
        SELECT trim(id_crm) AS id FROM ${tabla}
        WHERE substr(${campoFecha}, 1, 10) >= ? AND substr(${campoFecha}, 1, 10) <= ?
          AND id_crm IS NOT NULL AND trim(id_crm) <> ''
          ${extra}
      `).all(desde, hasta, ...extraParams);
      return { disponible: true, registros: tot, conLead: ids.filter((r) => idsLeads.has(r.id)).length };
    };
    const citasSinFecha = rows.filter((r) => r.cita === 'SI' && !r.fechaCita).length;
    const cobertura = {
      citas: { disponible: true, asistidas: rows.filter((r) => r.cita === 'SI').length, sinFecha: citasSinFecha },
      pruebas: tienePruebas ? contar('crm_pruebas_manejo', 'fecha') : { disponible: false },
      solicitudes: tieneSolicitudes ? contar('crm_solicitudes', 'fecha_solicitud') : { disponible: false },
    };

    const filas = rows.map((r) => {
      const entrada = r.entrada;
      const compraDia = r.conCompra && r.fechaCompra ? diasEntre(entrada, String(r.fechaCompra).slice(0, 10)) : null;
      const id = String(r.idCrm || '').trim();
      const fechaCita = r.cita === 'SI' && r.fechaCita && r.fechaCita >= entrada ? r.fechaCita : null;
      const fechaPrueba = primeraDesde(pruebas.get(id), entrada);
      const fechaSolicitud = primeraDesde(solicitudes.get(id), entrada);
      return {
        entrada,
        tipo: r.tipo,
        fuente: grupoFuente(r.tipo),
        forma: r.forma,
        estrena: r.estrena,
        compraDia: Number.isFinite(compraDia) ? compraDia : null,
        citaDia: fechaCita ? diasEntre(entrada, fechaCita) : null,
        pruebaDia: fechaPrueba ? diasEntre(entrada, fechaPrueba) : null,
        solicitudDia: fechaSolicitud ? diasEntre(entrada, fechaSolicitud) : null,
      };
    });
    return { filas, cobertura };
  } finally {
    db.close();
  }
}

/**
 * El corte nunca puede ser posterior a hoy: si el periodo consultado termina en el futuro
 * (mes en curso), los leads sin compra quedarían "observados" días que todavía no pasan
 * y la probabilidad de compra saldría más baja de lo real.
 */
function corteEfectivo(fechaFin, hoy = new Date().toISOString().slice(0, 10)) {
  const ff = String(fechaFin || hoy).slice(0, 10);
  return ff > hoy ? hoy : ff;
}

function getSupervivencia({ fechaFin, horizonte = HORIZONTE, crmTexto = null } = {}) {
  const hasta = corteEfectivo(fechaFin);
  const desde = sumarMeses(hasta, -12);
  const h = Math.max(30, Math.min(365, Number(horizonte) || HORIZONTE));
  const clave = `${desde}|${hasta}|${h}|${crmTexto || ''}`;
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.payload;
  const { filas, cobertura } = leerFilas({ desde, hasta, crmTexto });
  const payload = construirRespuesta(filas, {
    corte: hasta, horizonte: h, desde, hasta, cobertura,
  });
  cache.set(clave, { at: Date.now(), payload });
  return payload;
}

module.exports = {
  HORIZONTE,
  MIN_COMPRAS_FACTORES,
  kaplanMeier,
  diaCuantilCompras,
  armarObservaciones,
  tiempoCompra,
  prepararKm,
  resumenKm,
  factoresDeCampo,
  diaCuantilKm,
  corteEfectivo,
  elegirDestacados,
  construirRespuesta,
  medirHitos,
  primeraDesde,
  sumarMeses,
  icLogLog,
  HORIZONTE_HITO,
  getSupervivencia,
  grupoFuente,
};
