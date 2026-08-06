/**
 * Inventario de autos seminuevos (stock vivo).
 * Fuente: SER_VEHICULO con VEH_SITUACION = 'SFIS'
 * Días desde VEH_SFECADQUI (fecha de adquisición del usado).
 */
const { query } = require('../db');

const AGEING_DAYS = 60;
const AGEING_CRITICAL_DAYS = 90;

const MARCA_LABELS = {
  CHE: 'Chevrolet',
  FRD: 'Ford',
  NIS: 'Nissan',
  TOY: 'Toyota',
  HND: 'Honda',
  BMW: 'BMW',
  VOL: 'Volkswagen',
  REN: 'Renault',
  KIA: 'Kia',
  MG: 'MG',
  SUZUK: 'Suzuki',
  ACURA: 'Acura',
  MAZDA: 'Mazda',
  LANDROVER: 'Land Rover',
};

function clean(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseDmY(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function marcaLabel(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return 'Sin marca';
  return MARCA_LABELS[key] || key;
}

function ageingBucket(days) {
  if (days == null || Number.isNaN(days)) return 'sinFecha';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function mapUnit(row, today) {
  const fecAdq = parseDmY(row.fechaAdquisicion);
  const fecCtrl = row.fechaAltaControl ? new Date(row.fechaAltaControl) : null;
  const entrada = fecAdq || (fecCtrl && !Number.isNaN(fecCtrl.getTime()) ? fecCtrl : null);
  const daysInStock = entrada
    ? Math.max(0, Math.round((today - new Date(entrada.getFullYear(), entrada.getMonth(), entrada.getDate())) / 86400000))
    : null;

  const marcaCode = clean(row.marcaCode);
  const precioToma = round2(row.precioToma);
  const precioVentaIva = round2(row.precioVentaIva);
  const precioCompraGuia = round2(row.precioCompraGuia);
  const precioVentaGuia = round2(row.precioVentaGuia);
  const importeAdquisicion = precioToma > 0 ? precioToma : round2(row.importeAdquisicion);
  const importeVenta = precioVentaIva > 0 ? precioVentaIva : round2(row.importeVenta);

  return {
    vin: clean(row.vin),
    modelo: clean(row.modelo) || 'Sin modelo',
    anio: clean(row.anio),
    marcaCode,
    marca: marcaLabel(marcaCode),
    situacion: 'SFIS',
    situacionLabel: 'Físico seminuevo',
    ubicacion: clean(row.ubicacion),
    noInventario: row.noInventario != null ? Number(row.noInventario) : null,
    km: row.km != null && row.km !== '' ? Number(row.km) : null,
    tomaUsn: String(row.tomaUsn || '').trim().toUpperCase() === 'SI',
    /** Precio de toma / costo de adquisición USN */
    precioToma,
    /** Precio de venta IVA incluido (lista) */
    precioVentaIva,
    /** Precio compra según guía */
    precioCompraGuia,
    /** Precio venta según guía */
    precioVentaGuia,
    importeAdquisicion,
    importeVenta,
    margenEstimado: round2(importeVenta - importeAdquisicion),
    margenVsGuia: round2(importeVenta - precioCompraGuia),
    fechaAdquisicion: clean(row.fechaAdquisicion),
    fechaOperacion: clean(row.fechaOperacion),
    fechaAltaControl: row.fechaAltaControl
      ? new Date(row.fechaAltaControl).toISOString().slice(0, 10)
      : null,
    daysInStock,
    ageingBucket: ageingBucket(daysInStock),
    envejecida: daysInStock != null && daysInStock >= AGEING_DAYS,
    critica: daysInStock != null && daysInStock >= AGEING_CRITICAL_DAYS,
    color: clean(row.colorExterior) || 'Sin color',
  };
}

async function loadSeminuevosUnits() {
  const rows = await query(`
    SELECT
      LTRIM(RTRIM(v.VEH_NUMSERIE)) AS vin,
      LTRIM(RTRIM(ISNULL(NULLIF(v.VEH_STIPOAUTO, ''), v.VEH_TIPOAUTO))) AS modelo,
      LTRIM(RTRIM(ISNULL(v.VEH_ANMODELO, ''))) AS anio,
      LTRIM(RTRIM(ISNULL(v.VEH_SMARCA, ''))) AS marcaCode,
      LTRIM(RTRIM(v.VEH_SITUACION)) AS situacion,
      LTRIM(RTRIM(ISNULL(v.VEH_UBICACION, ''))) AS ubicacion,
      v.VEH_NOINVENTA AS noInventario,
      v.VEH_KILOMETR AS km,
      LTRIM(RTRIM(ISNULL(v.VEH_TOMAUSN, ''))) AS tomaUsn,
      ISNULL(v.VEH_TOMAIMPADQUI, 0) AS precioToma,
      ISNULL(v.VEH_TOMAIMPADQUI, 0) AS importeAdquisicion,
      ISNULL(v.VEH_TOMAIMPVEHICULO, 0) AS importeVenta,
      ISNULL(v.VEH_SIMPPVTA, 0) AS precioVentaIva,
      ISNULL(v.VEH_PCOMPGUIA, 0) AS precioCompraGuia,
      ISNULL(v.VEH_PVENTGUIA, 0) AS precioVentaGuia,
      v.VEH_SFECADQUI AS fechaAdquisicion,
      v.VEH_FECHOPE AS fechaOperacion,
      LTRIM(RTRIM(ISNULL(v.VEH_COLOEXTE, ''))) AS colorExterior,
      ctrl.FechaAltaInventario AS fechaAltaControl
    FROM SER_VEHICULO v
    LEFT JOIN ControlVehiculoSeminuevos ctrl
      ON RTRIM(ctrl.VIN) = RTRIM(v.VEH_NUMSERIE)
    WHERE LTRIM(RTRIM(v.VEH_SITUACION)) = 'SFIS'
    ORDER BY
      CASE
        WHEN v.VEH_SFECADQUI IS NOT NULL AND LTRIM(RTRIM(v.VEH_SFECADQUI)) <> ''
          THEN CONVERT(DATE, v.VEH_SFECADQUI, 103)
        ELSE CAST('1900-01-01' AS DATE)
      END ASC,
      v.VEH_NUMSERIE
  `);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (rows || []).map((row) => mapUnit(row, today));
}

function summarize(units) {
  const withDays = units.filter((u) => u.daysInStock != null);
  const sumAdq = round2(units.reduce((s, u) => s + Number(u.precioToma || u.importeAdquisicion || 0), 0));
  const sumVenta = round2(units.reduce((s, u) => s + Number(u.precioVentaIva || u.importeVenta || 0), 0));
  const sumGuiaCompra = round2(units.reduce((s, u) => s + Number(u.precioCompraGuia || 0), 0));
  const sumGuiaVenta = round2(units.reduce((s, u) => s + Number(u.precioVentaGuia || 0), 0));
  const daysProm = withDays.length
    ? Math.round(withDays.reduce((s, u) => s + u.daysInStock, 0) / withDays.length)
    : 0;

  const byBucket = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, sinFecha: 0 };
  for (const u of units) byBucket[u.ageingBucket] = (byBucket[u.ageingBucket] || 0) + 1;

  const marcaMap = new Map();
  for (const u of units) {
    const key = u.marca || 'Sin marca';
    const cur = marcaMap.get(key) || {
      marca: key,
      unidades: 0,
      valorAdquisicion: 0,
      valorVenta: 0,
      diasSum: 0,
      diasN: 0,
    };
    cur.unidades += 1;
    cur.valorAdquisicion += Number(u.importeAdquisicion || 0);
    cur.valorVenta += Number(u.importeVenta || 0);
    if (u.daysInStock != null) {
      cur.diasSum += u.daysInStock;
      cur.diasN += 1;
    }
    marcaMap.set(key, cur);
  }

  const byMarca = [...marcaMap.values()]
    .map((m) => ({
      marca: m.marca,
      unidades: m.unidades,
      valorAdquisicion: round2(m.valorAdquisicion),
      valorVenta: round2(m.valorVenta),
      diasPromedio: m.diasN ? Math.round(m.diasSum / m.diasN) : null,
    }))
    .sort((a, b) => b.unidades - a.unidades || b.valorAdquisicion - a.valorAdquisicion);

  const modeloMap = new Map();
  for (const u of units) {
    const key = `${u.modelo || 'Sin modelo'}|${u.anio || ''}`;
    const cur = modeloMap.get(key) || {
      modelo: u.modelo || 'Sin modelo',
      anio: u.anio,
      unidades: 0,
      valorAdquisicion: 0,
      valorVenta: 0,
    };
    cur.unidades += 1;
    cur.valorAdquisicion += Number(u.importeAdquisicion || 0);
    cur.valorVenta += Number(u.importeVenta || 0);
    modeloMap.set(key, cur);
  }

  const byModelo = [...modeloMap.values()]
    .map((m) => ({
      ...m,
      valorAdquisicion: round2(m.valorAdquisicion),
      valorVenta: round2(m.valorVenta),
    }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, 20);

  return {
    totalUnits: units.length,
    valorAdquisicion: sumAdq,
    valorVenta: sumVenta,
    valorCompraGuia: sumGuiaCompra,
    valorVentaGuia: sumGuiaVenta,
    margenEstimado: round2(sumVenta - sumAdq),
    ticketPromAdq: units.length ? round2(sumAdq / units.length) : 0,
    ticketPromVenta: units.length ? round2(sumVenta / units.length) : 0,
    diasPromedio: daysProm,
    conFechaAdquisicion: withDays.length,
    envejecidas: units.filter((u) => u.envejecida).length,
    criticas: units.filter((u) => u.critica).length,
    ageing: byBucket,
    byMarca,
    byModelo,
  };
}

/**
 * Rotación histórica: facturas ADE_VTAFI tipo U (seminuevos)
 * días = factura − fecha adquisición (VEH_SFECADQUI).
 */
async function loadRotacionHistorica({ meses = 12 } = {}) {
  const months = Math.max(1, Math.min(36, Number(meses) || 12));
  const rows = await query(`
    SELECT
      LTRIM(RTRIM(fv.VTE_DOCTO)) AS factura,
      fv.VTE_FECHDOCTO AS fechaFactura,
      LTRIM(RTRIM(fv.VTE_SERIE)) AS vin,
      ISNULL(fv.VTE_TOTAL, 0) AS importeFactura,
      v.VEH_SFECADQUI AS fechaAdquisicion,
      LTRIM(RTRIM(ISNULL(NULLIF(v.VEH_STIPOAUTO, ''), v.VEH_TIPOAUTO))) AS modelo,
      LTRIM(RTRIM(ISNULL(v.VEH_SMARCA, ''))) AS marcaCode,
      LTRIM(RTRIM(ISNULL(v.VEH_ANMODELO, ''))) AS anio,
      LTRIM(RTRIM(ISNULL(v.VEH_COLOEXTE, ''))) AS colorExterior,
      LTRIM(RTRIM(ISNULL(v.VEH_UBICACION, ''))) AS ubicacion,
      ISNULL(v.VEH_SIMPPVTA, 0) AS precioVentaIva,
      ISNULL(v.VEH_TOMAIMPADQUI, 0) AS precioToma,
      ISNULL(v.VEH_PCOMPGUIA, 0) AS precioCompraGuia,
      ISNULL(v.VEH_PVENTGUIA, 0) AS precioVentaGuia,
      DATEDIFF(
        DAY,
        CONVERT(DATE, v.VEH_SFECADQUI, 103),
        CONVERT(DATE, fv.VTE_FECHDOCTO, 103)
      ) AS diasRotacion
    FROM ADE_VTAFI fv
    INNER JOIN SER_VEHICULO v
      ON UPPER(LTRIM(RTRIM(v.VEH_NUMSERIE))) = UPPER(LTRIM(RTRIM(fv.VTE_SERIE)))
    WHERE fv.VTE_STATUS = 'I'
      AND fv.VTE_TIPODOCTO = 'U'
      AND CONVERT(DATE, fv.VTE_FECHDOCTO, 103) >= DATEADD(month, -${months}, GETDATE())
      AND v.VEH_SFECADQUI IS NOT NULL
      AND LTRIM(RTRIM(v.VEH_SFECADQUI)) <> ''
    ORDER BY CONVERT(DATE, fv.VTE_FECHDOCTO, 103) DESC
  `);

  const facturas = (rows || [])
    .map((row) => {
      const dias = row.diasRotacion != null ? Number(row.diasRotacion) : null;
      if (dias == null || Number.isNaN(dias) || dias < 0 || dias > 2000) return null;
      const importe = round2(row.importeFactura);
      const precioVentaIva = round2(row.precioVentaIva) || importe;
      const precioToma = round2(row.precioToma);
      const precioCompraGuia = round2(row.precioCompraGuia);
      const marcaCode = clean(row.marcaCode);
      return {
        kind: 'factura',
        factura: clean(row.factura),
        fechaFactura: clean(row.fechaFactura),
        vin: clean(row.vin),
        modelo: clean(row.modelo) || 'Sin modelo',
        carline: clean(row.modelo) || 'Sin modelo',
        anio: clean(row.anio),
        marcaCode,
        marca: marcaLabel(marcaCode),
        color: clean(row.colorExterior) || 'Sin color',
        ubicacion: clean(row.ubicacion),
        fechaAdquisicion: clean(row.fechaAdquisicion),
        diasRotacion: dias,
        /** Alias para reutilizar UI de rotación */
        daysInStock: dias,
        precioVentaIva,
        importeFactura: importe,
        precioToma,
        precioCompraGuia,
        precioVentaGuia: round2(row.precioVentaGuia),
        margenEstimado: round2(precioVentaIva - precioToma),
        margenVsGuia: round2(precioVentaIva - precioCompraGuia),
        situacion: 'U',
        situacionLabel: 'Facturada (histórico)',
        envejecida: dias >= AGEING_DAYS,
        critica: dias >= AGEING_CRITICAL_DAYS,
        ageingBucket: ageingBucket(dias),
      };
    })
    .filter(Boolean);

  const withDays = facturas;
  const diasProm = withDays.length
    ? Math.round(withDays.reduce((s, f) => s + f.diasRotacion, 0) / withDays.length)
    : 0;
  const sumImporte = round2(facturas.reduce((s, f) => s + Number(f.importeFactura || 0), 0));

  return {
    meses: months,
    fuente: 'ADE_VTAFI · VTE_TIPODOCTO = U',
    criterioDias: 'VEH_SFECADQUI → VTE_FECHDOCTO',
    totalFacturas: facturas.length,
    diasPromedio: diasProm,
    importeTotal: sumImporte,
    ticketPromedio: facturas.length ? round2(sumImporte / facturas.length) : 0,
    envejecidas: facturas.filter((f) => f.envejecida).length,
    facturas,
  };
}

function emptyRotacion(meses = 12, error = null) {
  return {
    meses: Math.max(1, Math.min(36, Number(meses) || 12)),
    fuente: 'ADE_VTAFI · VTE_TIPODOCTO = U',
    criterioDias: 'VEH_SFECADQUI → VTE_FECHDOCTO',
    totalFacturas: 0,
    diasPromedio: 0,
    importeTotal: 0,
    ticketPromedio: 0,
    envejecidas: 0,
    facturas: [],
    ...(error ? { error: String(error) } : {}),
  };
}

async function getInventorySeminuevos({ mesesRotacion = 12 } = {}) {
  const months = Math.max(1, Math.min(36, Number(mesesRotacion) || 12));
  const [unitsResult, rotResult] = await Promise.allSettled([
    loadSeminuevosUnits(),
    loadRotacionHistorica({ meses: months }),
  ]);

  if (unitsResult.status === 'rejected') {
    throw unitsResult.reason;
  }

  const units = unitsResult.value || [];
  const rotacionHistorica = rotResult.status === 'fulfilled'
    ? rotResult.value
    : emptyRotacion(months, rotResult.reason?.message || rotResult.reason);

  if (rotResult.status === 'rejected') {
    console.error('[seminuevos] rotación histórica:', rotResult.reason?.message || rotResult.reason);
  }

  return {
    criterio: {
      situacion: 'SFIS · Físico seminuevo',
      fuente: 'SER_VEHICULO',
      diasDesde: 'VEH_SFECADQUI (adquisición)',
      valorAdq: 'VEH_TOMAIMPADQUI (precio de toma)',
      valorVenta: 'VEH_SIMPPVTA (precio venta IVA incluido)',
      compraGuia: 'VEH_PCOMPGUIA',
      ventaGuia: 'VEH_PVENTGUIA',
      envejecida: `${AGEING_DAYS}+ días`,
      critica: `${AGEING_CRITICAL_DAYS}+ días`,
      rotacion: 'Facturas históricas U · días adquisición → factura',
    },
    summary: summarize(units),
    units,
    rotacionHistorica,
  };
}

module.exports = {
  getInventorySeminuevos,
  loadRotacionHistorica,
  AGEING_DAYS,
  AGEING_CRITICAL_DAYS,
};
