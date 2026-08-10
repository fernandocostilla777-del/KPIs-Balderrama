const { query } = require('../db');

const STATUS_LABELS = {
  I: 'Facturada',
  C: 'Cancelada',
  A: 'Activa',
  T: 'En taller',
  D: 'Detenida',
  P: 'Pendiente',
};

const OPEN_STATUSES = new Set(['A', 'T', 'D', 'P']);

/** Letras HyP cuyo ciclo se calcula solo con ORE_FECHACIE (cierre real). */
const HYP_CICLO_LETRAS = new Set(['A', 'F', 'H', 'J', 'V', 'Z', 'Ó']);

/** Nomenclaturas del acumulado diario mes en curso (excl. canceladas) */
const NOMENCLATURA_MES_CURSO = ['N', 'D', 'Q', 'C', 'X', 'Y'];

const TIPO_POR_LETRA = {
  V: 'Aseguradora Body 31',
  A: 'Aseguradoras',
  F: 'Aseguradoras particulares',
  E: 'Empleados',
  '\u00C1': 'Flotilla',
  G: 'Garantías',
  I: 'Interna',
  J: 'Interna HYP',
  '\u00D3': 'Interna nuevos HYP',
  M: 'Interna seminuevos',
  H: 'Interna seminuevos HYP',
  O: 'Interna ventas',
  N: 'Normal',
  Y: 'Normal Cholula',
  Q: 'Normal Zacatelco',
  Z: 'Particulares Body 31',
  S: 'Previas',
  R: 'Reclamaciones',
  D: 'Reparación',
  X: 'Reparación Cholula',
  C: 'Reparación Zacatelco',
};

function mapTipoPorLetra(orden) {
  const letra = String(orden || '').trim().charAt(0).toUpperCase();
  if (!letra) return { letra: '', tipo: 'Sin clasificar' };
  return {
    letra,
    tipo: TIPO_POR_LETRA[letra] || `Tipo ${letra}`,
  };
}

function mapTipoOrden(orden, tpoOrden, tipservicio) {
  const porLetra = mapTipoPorLetra(orden);
  const t = String(tpoOrden || '').trim();
  if (t) return t;
  const tip = String(tipservicio || '').trim();
  if (tip) return tip;
  return porLetra.tipo;
}

function buildDateClause(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return { clause: '', params: {} };
  return {
    clause: `AND CONVERT(DATE, o.ORE_FECHAORD, 103) >= @fechaInicio AND CONVERT(DATE, o.ORE_FECHAORD, 103) <= @fechaFin`,
    params: { fechaInicio, fechaFin },
  };
}

function parseDateDMY(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapStatus(code) {
  const key = String(code || '').trim().toUpperCase();
  return STATUS_LABELS[key] || key || 'Sin estatus';
}

function statusGroup(code) {
  const s = String(code || '').trim().toUpperCase();
  if (s === 'I') return 'Facturada';
  if (s === 'C') return 'Cancelada';
  if (OPEN_STATUSES.has(s)) return 'Abierta';
  return 'Otro';
}

function calcSemaforo(dias, isOpen) {
  if (!isOpen) return 'Cerrada';
  if (dias <= 30) return 'Verde';
  if (dias <= 60) return 'Amarillo';
  return 'Rojo';
}

function calcAntiguedadBucket(dias, isOpen) {
  if (!isOpen) return 'Cerrada';
  if (dias <= 30) return '0-30';
  if (dias <= 60) return '31-60';
  if (dias <= 90) return '61-90';
  if (dias <= 120) return '91-120';
  return '+120';
}

function mapRow(row, { snapshot = false } = {}) {
  const status = String(row.status || '').trim().toUpperCase();
  const isOpen = snapshot || OPEN_STATUSES.has(status);
  const isFacturada = status === 'I';
  const ingresoDate = parseDateDMY(row.ingreso);
  const promesaDate = parseDateDMY(row.promesa);
  const cierreDate = parseDateDMY(row.cierre);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dias = Number(row.dias);
  if (snapshot && ingresoDate) {
    dias = Math.max(0, Math.round((today - ingresoDate) / 86400000));
  } else if (!Number.isFinite(dias) && ingresoDate) {
    const end = cierreDate || today;
    dias = Math.max(0, Math.round((end - ingresoDate) / 86400000));
  } else {
    dias = Math.max(0, dias || 0);
  }

  const { letra: letraOrden, tipo: tipoPorLetra } = mapTipoPorLetra(row.orden);

  // Ciclo real de taller: ingreso → cierre (ORE_FECHACIE).
  // Para HyP A/F/H/J/V/Z/Ó solo se calcula si hay ORE_FECHACIE (no se inventa).
  let diasCiclo = null;
  if (ingresoDate && cierreDate) {
    diasCiclo = Math.max(0, Math.round((cierreDate - ingresoDate) / 86400000));
  } else if (!isOpen && ingresoDate && !HYP_CICLO_LETRAS.has(letraOrden)) {
    diasCiclo = dias;
  }

  let diasVsPromesa = null;
  if (promesaDate) {
    const ref = cierreDate || (isOpen ? today : null);
    if (ref) {
      diasVsPromesa = Math.round((ref - promesaDate) / 86400000);
    }
  }

  const importeFac = Number(row.importeFac || 0);
  const importeTcx = Number(row.importeTcx || 0);
  const importeDet = Number(row.importeDetSub || 0) + Number(row.importeDetIva || 0);
  const importe = importeFac > 0 ? importeFac : (importeDet > 0 ? importeDet : importeTcx);
  const importeFacturado = isFacturada ? importe : 0;
  const importeAbierto = isOpen
    ? (importeDet > 0 ? importeDet : (importeTcx > 0 ? importeTcx : importeFac))
    : 0;

  const nombre = String(row.nombre || '').trim();
  const serie = String(row.serie || '').trim();
  const incompleto = !ingresoDate || !nombre || !serie;
  const promesaVencida = isOpen && promesaDate && promesaDate < today;
  const critica = isOpen && dias > 60;
  const semaforo = calcSemaforo(dias, isOpen);
  const antiguedad = calcAntiguedadBucket(dias, isOpen);
  const excluido = incompleto || status === 'C';
  const refaccionesLineas = Math.max(0, Number(row.refaccionesLineas ?? row.RefaccionesLineas ?? 0));
  // "Cargadas" = hay líneas RE en el detalle de la orden
  const conRefacciones = refaccionesLineas > 0;

  return {
    orden: row.orden,
    nombre,
    factura: row.factura || null,
    telefono: row.telefono || '',
    celular: row.celular || '',
    status,
    statusLabel: mapStatus(status),
    statusGroup: statusGroup(status),
    auto: row.auto || '',
    modelo: row.modelo || '',
    serie,
    ingreso: row.ingreso || '',
    ingresoDate: ingresoDate ? ingresoDate.toISOString().slice(0, 10) : null,
    cierre: row.cierre || '',
    cierreDate: cierreDate ? cierreDate.toISOString().slice(0, 10) : null,
    promesa: row.promesa || '',
    promesaDate: promesaDate ? promesaDate.toISOString().slice(0, 10) : null,
    dias,
    diasCiclo,
    diasVsPromesa,
    importe,
    importeFacturado,
    importeAbierto,
    aseguradora: row.aseguradora || '',
    correo: row.correo || '',
    asesor: row.asesor || 'Sin asesor',
    tipoOrden: mapTipoOrden(row.orden, row.tipoOrden, row.tipoServicio),
    letraOrden,
    tipoPorLetra,
    semaforo,
    antiguedad,
    promesaVencida,
    critica,
    incompleto,
    excluido,
    refaccionesLineas,
    conRefacciones,
    sinImporte: importe <= 0,
    sinAseguradora: !String(row.aseguradora || '').trim(),
    abiertaSinPromesa: isOpen && !promesaDate,
    sinFechaIngreso: !ingresoDate,
  };
}

async function loadOrders({ fechaInicio, fechaFin } = {}) {
  const { clause, params } = buildDateClause(fechaInicio, fechaFin);

  const rows = await query(`
    SELECT
      o.ORE_IDORDEN AS orden,
      LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS nombre,
      COALESCE(NULLIF(LTRIM(RTRIM(o.ORE_DOCTO)), ''), fac.factura) AS factura,
      LTRIM(RTRIM(c.PER_TELEFONO1)) AS telefono,
      LTRIM(RTRIM(c.PER_TELCELULAR)) AS celular,
      o.ORE_STATUS AS status,
      LTRIM(RTRIM(ISNULL(o.ORE_MARCA, ''))) AS auto,
      LTRIM(RTRIM(COALESCE(NULLIF(v.VEH_TIPOAUTO, ''), fac.autoFac, ''))) AS modelo,
      LTRIM(RTRIM(o.ORE_NUMSERIE)) AS serie,
      o.ORE_FECHAORD AS ingreso,
      o.ORE_FECHACIE AS cierre,
      o.ORE_FECHAPROM AS promesa,
      o.ORE_TPOORDEN AS tipoOrden,
      o.ORE_TIPSERVICIO AS tipoServicio,
      CASE
        WHEN o.ORE_FECHACIE IS NOT NULL AND LTRIM(RTRIM(o.ORE_FECHACIE)) <> ''
        THEN DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CONVERT(DATE, o.ORE_FECHACIE, 103))
        ELSE DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CAST(GETDATE() AS DATE))
      END AS dias,
      ISNULL(fac.importe, 0) AS importeFac,
      ISNULL(tcx.importe, 0) AS importeTcx,
      ISNULL(det.subtotal, 0) AS importeDetSub,
      ISNULL(det.iva, 0) AS importeDetIva,
      ISNULL(det.refaccionesLineas, 0) AS refaccionesLineas,
      LTRIM(RTRIM(COALESCE(fac.asegFac, sg.PAR_DESCRIP1, ''))) AS aseguradora,
      LTRIM(RTRIM(c.PER_EMAIL)) AS correo,
      LTRIM(RTRIM(COALESCE(asr.PAR_DESCRIP1, o.ORE_IDASESOR, ''))) AS asesor
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
    LEFT JOIN SER_VEHICULO v ON v.VEH_NUMSERIE = o.ORE_NUMSERIE
    LEFT JOIN (
      SELECT fos_idorden,
        MAX(fos_docto) AS factura,
        MAX(fos_qctipoauto) AS autoFac,
        SUM(fos_total) AS importe,
        MAX(NULLIF(LTRIM(RTRIM(fos_aseguradora)), '')) AS asegFac
      FROM SER_FACORDEN
      GROUP BY fos_idorden
    ) fac ON fac.fos_idorden = o.ORE_IDORDEN
    LEFT JOIN (
      SELECT TCX_IDORDEN AS fos_idorden, SUM(TCX_TOTAL) AS importe
      FROM SER_ORDTOTCXP
      WHERE TCX_STATUS IN ('T', 'A')
      GROUP BY TCX_IDORDEN
    ) tcx ON tcx.fos_idorden = o.ORE_IDORDEN
    LEFT JOIN (
      SELECT ORD_IDORDEN AS idorden,
        SUM(ORD_SUBTOTAL) AS subtotal,
        SUM(ORD_IVATOT) AS iva,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(ORD_CLASIFIC, '')))) = 'RE' THEN 1 ELSE 0 END) AS refaccionesLineas
      FROM SER_ORDENDET
      GROUP BY ORD_IDORDEN
    ) det ON det.idorden = o.ORE_IDORDEN
    LEFT JOIN PNC_PARAMETR sg ON sg.PAR_TIPOPARA = 'SG' AND sg.PAR_IDENPARA = o.ORE_IDASEGURADORA
    LEFT JOIN PNC_PARAMETR asr ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
    WHERE o.ORE_FECHAORD IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
    ${clause}
    ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC, o.ORE_IDORDEN DESC
  `, params);

  return rows.map((row) => mapRow(row));
}

const OPEN_SNAPSHOT_SQL = `
  SELECT
    o.ORE_IDORDEN AS orden,
    LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS nombre,
    COALESCE(NULLIF(LTRIM(RTRIM(o.ORE_DOCTO)), ''), fac.factura) AS factura,
    LTRIM(RTRIM(c.PER_TELEFONO1)) AS telefono,
    LTRIM(RTRIM(c.PER_TELCELULAR)) AS celular,
    o.ORE_STATUS AS status,
    LTRIM(RTRIM(ISNULL(o.ORE_MARCA, ''))) AS auto,
    LTRIM(RTRIM(COALESCE(NULLIF(v.VEH_TIPOAUTO, ''), fac.autoFac, ''))) AS modelo,
    LTRIM(RTRIM(o.ORE_NUMSERIE)) AS serie,
    o.ORE_FECHAORD AS ingreso,
    o.ORE_FECHACIE AS cierre,
    o.ORE_FECHAPROM AS promesa,
    o.ORE_TPOORDEN AS tipoOrden,
    o.ORE_TIPSERVICIO AS tipoServicio,
    DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) AS dias,
    ISNULL(fac.importe, 0) AS importeFac,
    ISNULL(tcx.importe, 0) AS importeTcx,
    ISNULL(det.subtotal, 0) AS importeDetSub,
    ISNULL(det.iva, 0) AS importeDetIva,
    ISNULL(det.refaccionesLineas, 0) AS refaccionesLineas,
    LTRIM(RTRIM(COALESCE(fac.asegFac, sg.PAR_DESCRIP1, ''))) AS aseguradora,
    LTRIM(RTRIM(c.PER_EMAIL)) AS correo,
    LTRIM(RTRIM(COALESCE(asr.PAR_DESCRIP1, o.ORE_IDASESOR, ''))) AS asesor
  FROM SER_ORDEN o
  LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
  LEFT JOIN SER_VEHICULO v ON v.VEH_NUMSERIE = o.ORE_NUMSERIE
  LEFT JOIN (
    SELECT fos_idorden,
      MAX(fos_docto) AS factura,
      MAX(fos_qctipoauto) AS autoFac,
      SUM(fos_total) AS importe,
      MAX(NULLIF(LTRIM(RTRIM(fos_aseguradora)), '')) AS asegFac
    FROM SER_FACORDEN
    GROUP BY fos_idorden
  ) fac ON fac.fos_idorden = o.ORE_IDORDEN
  LEFT JOIN (
    SELECT TCX_IDORDEN AS fos_idorden, SUM(TCX_TOTAL) AS importe
    FROM SER_ORDTOTCXP
    WHERE TCX_STATUS IN ('T', 'A')
    GROUP BY TCX_IDORDEN
  ) tcx ON tcx.fos_idorden = o.ORE_IDORDEN
  LEFT JOIN (
    SELECT ORD_IDORDEN AS idorden,
      SUM(ORD_SUBTOTAL) AS subtotal,
      SUM(ORD_IVATOT) AS iva,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(ORD_CLASIFIC, '')))) = 'RE' THEN 1 ELSE 0 END) AS refaccionesLineas
    FROM SER_ORDENDET
    GROUP BY ORD_IDORDEN
  ) det ON det.idorden = o.ORE_IDORDEN
  LEFT JOIN PNC_PARAMETR sg ON sg.PAR_TIPOPARA = 'SG' AND sg.PAR_IDENPARA = o.ORE_IDASEGURADORA
  LEFT JOIN PNC_PARAMETR asr ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
  WHERE o.ORE_FECHAORD IS NOT NULL
    AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
    AND o.ORE_STATUS IN ('A', 'T', 'D', 'P')
  ORDER BY DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) DESC
`;

async function loadOpenSnapshot() {
  const rows = await query(OPEN_SNAPSHOT_SQL);
  return rows.map((row) => mapRow(row, { snapshot: true }));
}

function classifyDetBucket(clasific) {
  const c = String(clasific || '').trim().toUpperCase();
  if (c === 'RE') return 'refacciones';
  if (c.startsWith('MO')) return 'manoObra';
  // HP = hojalatería, PI = pintura/pulido/lavado, TTHP = trabajos terceros HyP
  if (c === 'HP' || c === 'PI' || c === 'TTHP' || c.startsWith('HP') || c.startsWith('PI')) return 'hyp';
  if (c === 'VA') return 'valuacion';
  return 'otros';
}

/** Flujo operativo típico HyP (orden de etapas). */
const PROCESO_ETAPAS = [
  { id: 'desarme', label: 'Desarme', order: 1, re: /DESARM/i },
  { id: 'hojalateria', label: 'Hojalatería', order: 2, re: /HOJAL/i },
  { id: 'pintura', label: 'Pintura', order: 3, re: /PINT/i },
  { id: 'armado', label: 'Armado', order: 4, re: /ARMAD/i },
  { id: 'pulido', label: 'Pulido', order: 5, re: /PULID/i },
  { id: 'lavado', label: 'Lavado', order: 6, re: /LAVAD/i },
];

const LINE_STATUS_LABELS = {
  T: 'Terminado',
  S: 'Pendiente',
  A: 'Activo',
  X: 'Cancelado',
  P: 'Pendiente',
};

function matchProcesoEtapa(descripcion) {
  const d = String(descripcion || '');
  if (!d.trim()) return null;
  // Pulido antes que Pintura para no capturar "descontaminacion de pintura" como pulido vía PINT
  // (pulido no contiene PINT; pintura no contiene PULID normalmente)
  for (const etapa of PROCESO_ETAPAS) {
    if (etapa.id === 'pintura' && /PULID/i.test(d)) continue;
    if (etapa.re.test(d)) return etapa;
  }
  return null;
}

/**
 * Infiere proceso HyP desde líneas SER_ORDENDET (MO HOJALATERIA, MO PINTURA, PULIDO…).
 * ORD_STATUS: T=terminado (suele traer fecha fin), S=pendiente.
 */
function buildProcesoTaller(lines) {
  const byId = new Map();

  for (const line of lines || []) {
    const st = String(line.status || '').trim().toUpperCase();
    if (st === 'X') continue;
    const etapa = matchProcesoEtapa(line.descripcion);
    if (!etapa) continue;

    if (!byId.has(etapa.id)) {
      byId.set(etapa.id, {
        id: etapa.id,
        label: etapa.label,
        order: etapa.order,
        statuses: [],
        fechaFin: '',
        mecanico: '',
        descripcion: line.descripcion || '',
        lineas: 0,
      });
    }
    const row = byId.get(etapa.id);
    row.lineas += 1;
    row.statuses.push(st || 'S');
    if (line.descripcion) row.descripcion = line.descripcion;
    if (st === 'T' && line.fechaFin) row.fechaFin = line.fechaFin;
    if (line.mecanico) row.mecanico = line.mecanico;
  }

  const etapas = [...byId.values()]
    .map((row) => {
      const pendiente = row.statuses.some((s) => s === 'S' || s === 'A' || s === 'P');
      const status = pendiente ? (row.statuses.find((s) => s === 'S' || s === 'A' || s === 'P') || 'S') : 'T';
      return {
        id: row.id,
        label: row.label,
        order: row.order,
        status,
        statusLabel: LINE_STATUS_LABELS[status] || status,
        fechaFin: status === 'T' ? row.fechaFin : '',
        mecanico: row.mecanico,
        descripcion: row.descripcion,
        lineas: row.lineas,
        done: status === 'T',
        current: false,
      };
    })
    .sort((a, b) => a.order - b.order);

  if (!etapas.length) {
    return {
      disponible: false,
      actual: null,
      actualLabel: null,
      ultimaTerminada: null,
      siguiente: null,
      resumen: 'Sin líneas de proceso (hojalatería / pintura / pulido / etc.)',
      etapas: [],
      fuente: 'SER_ORDENDET',
    };
  }

  const terminadas = etapas.filter((e) => e.done);
  const pendientes = etapas.filter((e) => !e.done);
  const ultimaTerminada = terminadas.length ? terminadas[terminadas.length - 1] : null;
  const siguiente = pendientes.length ? pendientes[0] : null;
  const actual = siguiente || ultimaTerminada;
  if (siguiente) {
    const idx = etapas.findIndex((e) => e.id === siguiente.id);
    if (idx >= 0) etapas[idx].current = true;
  }

  let resumen = '';
  if (siguiente && ultimaTerminada) {
    resumen = `${siguiente.label} (pendiente) · última terminada: ${ultimaTerminada.label}`;
  } else if (siguiente) {
    resumen = `En ${siguiente.label}`;
  } else if (ultimaTerminada) {
    resumen = `Proceso completo hasta ${ultimaTerminada.label}`;
  }

  return {
    disponible: true,
    actual: actual ? actual.id : null,
    actualLabel: actual ? actual.label : null,
    ultimaTerminada: ultimaTerminada
      ? { id: ultimaTerminada.id, label: ultimaTerminada.label, fechaFin: ultimaTerminada.fechaFin }
      : null,
    siguiente: siguiente
      ? { id: siguiente.id, label: siguiente.label, status: siguiente.status }
      : null,
    resumen,
    etapas,
    fuente: 'SER_ORDENDET',
  };
}

function bucketLabel(bucket) {
  return ({
    refacciones: 'Refacciones',
    manoObra: 'Mano de obra',
    hyp: 'HYP / Pintura',
    valuacion: 'Valuación',
    otros: 'Otros',
  })[bucket] || 'Otros';
}

function lineAmounts(row) {
  const subtotal = Number(row.subtotal || 0);
  const ivaAmt = Number(row.ivaAmount || 0);
  const ivaRate = Number(row.ivaRate || 0);
  let iva = ivaAmt;
  if (iva <= 0 && ivaRate > 0 && ivaRate <= 100 && subtotal > 0) {
    iva = Math.round(subtotal * ivaRate) / 100;
  }
  return {
    subtotal,
    iva,
    total: subtotal + iva,
    ivaRate: ivaRate > 0 && ivaRate <= 100 ? ivaRate : null,
  };
}

async function loadOrderDetail(ordenId) {
  const id = String(ordenId || '').trim();
  if (!id) {
    const err = new Error('Orden requerida');
    err.status = 400;
    throw err;
  }

  const headerRows = await query(`
    SELECT
      o.ORE_IDORDEN AS orden,
      LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS nombre,
      COALESCE(NULLIF(LTRIM(RTRIM(o.ORE_DOCTO)), ''), fac.factura) AS factura,
      LTRIM(RTRIM(c.PER_TELEFONO1)) AS telefono,
      LTRIM(RTRIM(c.PER_TELCELULAR)) AS celular,
      o.ORE_STATUS AS status,
      LTRIM(RTRIM(ISNULL(o.ORE_MARCA, ''))) AS auto,
      LTRIM(RTRIM(COALESCE(NULLIF(v.VEH_TIPOAUTO, ''), fac.autoFac, ''))) AS modelo,
      LTRIM(RTRIM(o.ORE_NUMSERIE)) AS serie,
      o.ORE_FECHAORD AS ingreso,
      o.ORE_FECHACIE AS cierre,
      o.ORE_FECHAPROM AS promesa,
      o.ORE_TPOORDEN AS tipoOrden,
      o.ORE_TIPSERVICIO AS tipoServicio,
      DATEDIFF(day, CONVERT(DATE, o.ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) AS dias,
      ISNULL(fac.importe, 0) AS importeFac,
      ISNULL(tcx.importe, 0) AS importeTcx,
      ISNULL(det.subtotal, 0) AS importeDetSub,
      ISNULL(det.iva, 0) AS importeDetIva,
      LTRIM(RTRIM(COALESCE(fac.asegFac, sg.PAR_DESCRIP1, ''))) AS aseguradora,
      LTRIM(RTRIM(c.PER_EMAIL)) AS correo,
      LTRIM(RTRIM(COALESCE(asr.PAR_DESCRIP1, o.ORE_IDASESOR, ''))) AS asesor
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
    LEFT JOIN SER_VEHICULO v ON v.VEH_NUMSERIE = o.ORE_NUMSERIE
    LEFT JOIN (
      SELECT fos_idorden,
        MAX(fos_docto) AS factura,
        MAX(fos_qctipoauto) AS autoFac,
        SUM(fos_total) AS importe,
        MAX(NULLIF(LTRIM(RTRIM(fos_aseguradora)), '')) AS asegFac
      FROM SER_FACORDEN
      GROUP BY fos_idorden
    ) fac ON fac.fos_idorden = o.ORE_IDORDEN
    LEFT JOIN (
      SELECT TCX_IDORDEN AS fos_idorden, SUM(TCX_TOTAL) AS importe
      FROM SER_ORDTOTCXP
      WHERE TCX_STATUS IN ('T', 'A')
      GROUP BY TCX_IDORDEN
    ) tcx ON tcx.fos_idorden = o.ORE_IDORDEN
    LEFT JOIN (
      SELECT ORD_IDORDEN AS idorden,
        SUM(ORD_SUBTOTAL) AS subtotal,
        SUM(CASE
          WHEN ISNULL(ORD_IVA, 0) > 0 THEN ORD_IVA
          WHEN ISNULL(ORD_IVATOT, 0) > 0 AND ISNULL(ORD_IVATOT, 0) <= 100
            THEN ROUND(ORD_SUBTOTAL * ORD_IVATOT / 100.0, 2)
          ELSE ISNULL(ORD_IVATOT, 0)
        END) AS iva
      FROM SER_ORDENDET
      GROUP BY ORD_IDORDEN
    ) det ON det.idorden = o.ORE_IDORDEN
    LEFT JOIN PNC_PARAMETR sg ON sg.PAR_TIPOPARA = 'SG' AND sg.PAR_IDENPARA = o.ORE_IDASEGURADORA
    LEFT JOIN PNC_PARAMETR asr ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
    WHERE o.ORE_IDORDEN = @orden
  `, { orden: id });

  if (!headerRows.length) {
    const err = new Error(`Orden ${id} no encontrada`);
    err.status = 404;
    throw err;
  }

  const header = mapRow(headerRows[0], {
    snapshot: ['A', 'T', 'D', 'P'].includes(String(headerRows[0].status || '').trim().toUpperCase()),
  });

  const detailRows = await query(`
    SELECT
      ORD_CONSE AS conse,
      LTRIM(RTRIM(ISNULL(ORD_CODIGO, ''))) AS codigo,
      LTRIM(RTRIM(ISNULL(ORD_DESCRIP, ''))) AS descripcion,
      LTRIM(RTRIM(ISNULL(ORD_CLASIFIC, ''))) AS clasific,
      ISNULL(ORD_CANTIDAD, 0) AS cantidad,
      ISNULL(ORD_CANTSURT, 0) AS surtido,
      ISNULL(ORD_SURTIDO, 0) AS surtidoFlag,
      ISNULL(ORD_PRECUNITARIO, 0) AS precio,
      ISNULL(ORD_SUBTOTAL, 0) AS subtotal,
      ISNULL(ORD_IVA, 0) AS ivaAmount,
      ISNULL(ORD_IVATOT, 0) AS ivaRate,
      ISNULL(ORD_COSTO, 0) AS costo,
      LTRIM(RTRIM(ISNULL(ORD_STATUS, ''))) AS status,
      LTRIM(RTRIM(ISNULL(ORD_MECANICO, ''))) AS mecanico,
      LTRIM(RTRIM(ISNULL(ORD_FECHSUR, ''))) AS fechaSurtido,
      LTRIM(RTRIM(ISNULL(ORD_FECHAFIN, ''))) AS fechaFin,
      LTRIM(RTRIM(ISNULL(ord_comentarios, ''))) AS comentarios,
      LTRIM(RTRIM(ISNULL(ord_observaciones, ''))) AS observaciones
    FROM SER_ORDENDET
    WHERE ORD_IDORDEN = @orden
    ORDER BY ORD_CONSE
  `, { orden: id });

  const lines = detailRows.map((row) => {
    const bucket = classifyDetBucket(row.clasific);
    const amounts = lineAmounts(row);
    return {
      conse: Number(row.conse || 0),
      codigo: row.codigo || '',
      descripcion: row.descripcion || '',
      clasific: row.clasific || '',
      bucket,
      bucketLabel: bucketLabel(bucket),
      cantidad: Number(row.cantidad || 0),
      surtido: Number(row.surtido || 0),
      precio: Number(row.precio || 0),
      subtotal: amounts.subtotal,
      iva: amounts.iva,
      ivaRate: amounts.ivaRate,
      total: amounts.total,
      costo: Number(row.costo || 0),
      status: row.status || '',
      statusLabel: LINE_STATUS_LABELS[String(row.status || '').trim().toUpperCase()] || row.status || '',
      mecanico: row.mecanico || '',
      fechaSurtido: row.fechaSurtido || '',
      fechaFin: row.fechaFin || '',
      comentarios: row.comentarios || '',
      observaciones: row.observaciones || '',
    };
  });

  const proceso = buildProcesoTaller(lines);

  const cargo = {
    refacciones: { label: 'Refacciones', lineas: 0, subtotal: 0, iva: 0, total: 0 },
    manoObra: { label: 'Mano de obra', lineas: 0, subtotal: 0, iva: 0, total: 0 },
    hyp: { label: 'HYP / Pintura', lineas: 0, subtotal: 0, iva: 0, total: 0 },
    valuacion: { label: 'Valuación', lineas: 0, subtotal: 0, iva: 0, total: 0 },
    otros: { label: 'Otros', lineas: 0, subtotal: 0, iva: 0, total: 0 },
  };

  for (const line of lines) {
    const bucket = cargo[line.bucket] || cargo.otros;
    bucket.lineas += 1;
    bucket.subtotal += line.subtotal;
    bucket.iva += line.iva;
    bucket.total += line.total;
  }

  // Siempre incluir Mano de obra en el desglose (aunque venga en 0).
  const cargoOrder = ['manoObra', 'refacciones', 'hyp', 'valuacion', 'otros'];
  const cargoList = cargoOrder
    .map((key) => cargo[key])
    .filter((b) => b.label === 'Mano de obra' || (b.lineas > 0 && (b.total > 0 || b.subtotal > 0)))
    .map((b) => ({
      ...b,
      subtotal: Math.round(b.subtotal * 100) / 100,
      iva: Math.round(b.iva * 100) / 100,
      total: Math.round(b.total * 100) / 100,
    }));

  const refacciones = lines.filter((l) => l.bucket === 'refacciones');
  const manoObra = lines.filter((l) => l.bucket === 'manoObra');
  const hyp = lines.filter((l) => l.bucket === 'hyp');
  const lineTotals = lines.reduce(
    (acc, l) => ({
      lineas: acc.lineas + 1,
      subtotal: acc.subtotal + l.subtotal,
      iva: acc.iva + l.iva,
      total: acc.total + l.total,
    }),
    { lineas: 0, subtotal: 0, iva: 0, total: 0 },
  );
  const totals = {
    lineas: lineTotals.lineas,
    subtotal: Math.round(lineTotals.subtotal * 100) / 100,
    iva: Math.round(lineTotals.iva * 100) / 100,
    total: Math.round(lineTotals.total * 100) / 100,
    refacciones: refacciones.length,
    manoObra: manoObra.length,
    hyp: hyp.length,
  };

  // Montos del detalle por número de orden (SER_ORDENDET), no por factura.
  if (totals.total > 0) {
    header.importe = totals.total;
    if (header.status === 'I') {
      header.importeFacturado = totals.total;
      header.importeAbierto = 0;
    } else if (['A', 'T', 'D', 'P'].includes(header.status)) {
      header.importeAbierto = totals.total;
    }
  }

  return {
    orden: header,
    cargo: cargoList,
    totals,
    proceso,
    refacciones,
    manoObra,
    hyp,
    lineas: lines,
  };
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso) {
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return String(iso || '');
  return `${d}/${m}/${y}`;
}

function normalizeSqlDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return toIsoDate(parsed);
  return '';
}

function emptyDayRow(fecha) {
  const row = { fecha, fechaLabel: formatDisplayDate(fecha), total: 0 };
  for (const L of NOMENCLATURA_MES_CURSO) row[L] = 0;
  return row;
}

/**
 * Acumulado por día del mes en curso: conteo de órdenes por nomenclatura
 * N, D, Q, C, X, Y. Excluye canceladas (ORE_STATUS = C).
 */
async function loadMesCursoNomenclatura(asOf = new Date()) {
  const now = asOf instanceof Date ? asOf : new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = new Date(year, month, now.getDate());
  const fechaInicio = toIsoDate(new Date(year, month, 1));
  const fechaFin = toIsoDate(today);

  // Reutiliza la carga validada de órdenes (misma conversión de fechas que el dashboard)
  const orders = await loadOrders({ fechaInicio, fechaFin });
  const byDate = new Map();

  for (const r of orders) {
    if (String(r.status || '').toUpperCase() === 'C') continue;
    const letra = String(r.letraOrden || '').toUpperCase();
    if (!NOMENCLATURA_MES_CURSO.includes(letra)) continue;

    // Preferir fecha local parseada del string dd/mm/yyyy (evita desfase UTC de toISOString)
    const fecha = (() => {
      const fromIngreso = parseDateDMY(r.ingreso);
      if (fromIngreso) return toIsoDate(fromIngreso);
      return normalizeSqlDate(r.ingresoDate);
    })();
    if (!fecha || fecha < fechaInicio || fecha > fechaFin) continue;

    if (!byDate.has(fecha)) byDate.set(fecha, emptyDayRow(fecha));
    const day = byDate.get(fecha);
    day[letra] += 1;
    day.total += 1;
  }

  const days = [];
  let acum = 0;
  const lastDay = today.getDate();
  for (let d = 1; d <= lastDay; d += 1) {
    const iso = toIsoDate(new Date(year, month, d));
    const row = byDate.get(iso) || emptyDayRow(iso);
    acum += row.total;
    days.push({ ...row, acumulado: acum });
  }

  const totals = { fecha: null, fechaLabel: 'Total', acumulado: acum, total: 0 };
  for (const L of NOMENCLATURA_MES_CURSO) {
    totals[L] = days.reduce((s, r) => s + (r[L] || 0), 0);
  }
  totals.total = days.reduce((s, r) => s + (r.total || 0), 0);

  const labels = {};
  for (const L of NOMENCLATURA_MES_CURSO) {
    labels[L] = TIPO_POR_LETRA[L] || L;
  }

  return {
    periodo: { fechaInicio, fechaFin, label: `${formatDisplayDate(fechaInicio)} — ${formatDisplayDate(fechaFin)}` },
    letras: NOMENCLATURA_MES_CURSO.slice(),
    labels,
    days,
    totals,
  };
}

module.exports = {
  loadOrders,
  loadOpenSnapshot,
  loadOrderDetail,
  loadMesCursoNomenclatura,
  buildProcesoTaller,
  mapRow,
  mapTipoPorLetra,
  TIPO_POR_LETRA,
  NOMENCLATURA_MES_CURSO,
  STATUS_LABELS,
  OPEN_STATUSES,
  PROCESO_ETAPAS,
};
