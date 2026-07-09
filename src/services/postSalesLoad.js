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
  const { letra: letraOrden, tipo: tipoPorLetra } = mapTipoPorLetra(row.orden);

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
    promesa: row.promesa || '',
    promesaDate: promesaDate ? promesaDate.toISOString().slice(0, 10) : null,
    dias,
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
        SUM(ORD_IVATOT) AS iva
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
      SUM(ORD_IVATOT) AS iva
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

module.exports = {
  loadOrders,
  loadOpenSnapshot,
  mapRow,
  mapTipoPorLetra,
  TIPO_POR_LETRA,
  STATUS_LABELS,
  OPEN_STATUSES,
};
