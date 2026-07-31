const { query } = require('../db');
const { getCanalVenta, getCanalLabel } = require('./canales-venta');
const {
  isHighEndQuery,
  isHighEndVehicle,
  highEndSqlLikeClauses,
  HIGH_END_CARLINES,
  normalizeModelText,
} = require('../config/highEndSegment');

function parseDateInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Fecha inválida. Use YYYY-MM-DD.');
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida.');
  return date;
}

function normalizeModeloTerm(value) {
  return normalizeModelText(value);
}

async function getVentasPorModelo({ modelo, fechaInicio, fechaFin, incluirFlotilla = true }) {
  const term = normalizeModeloTerm(modelo);
  if (!term || term.length < 2) {
    throw new Error('Indica el modelo a buscar (ej. Aveo, Onix) o “HIGH END”.');
  }

  parseDateInput(fechaInicio);
  parseDateInput(fechaFin);

  const highEnd = isHighEndQuery(term);
  const flotillaFilter = incluirFlotilla
    ? ''
    : `AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('FLOT', 'FLOTGMF')`;

  const modelFilter = highEnd
    ? `(
        ${highEndSqlLikeClauses('SER_VEHICULO.VEH_TIPOAUTO')}
        OR ${highEndSqlLikeClauses('UNI_CATALOGO.UNC_FAMILIA')}
      )`
    : `(
        UPPER(LTRIM(RTRIM(SER_VEHICULO.VEH_TIPOAUTO))) LIKE @likeTerm
        OR UPPER(LTRIM(RTRIM(SER_VEHICULO.VEH_ANMODELO))) LIKE @likeTerm
        OR UPPER(LTRIM(RTRIM(UNI_CATALOGO.UNC_FAMILIA))) LIKE @likeTerm
      )`;

  const params = highEnd
    ? { fechaInicio, fechaFin }
    : { fechaInicio, fechaFin, likeTerm: `%${term}%` };

  const rows = await query(`
    SELECT
      ADE_VTAFI.VTE_DOCTO,
      ADE_VTAFI.VTE_FECHDOCTO,
      ADE_VTAFI.VTE_SERIE,
      SER_VEHICULO.VEH_TIPOAUTO,
      SER_VEHICULO.VEH_ANMODELO,
      UNI_CATALOGO.UNC_FAMILIA,
      B.PER_PATERNO + ' ' + B.PER_MATERNO + ' ' + B.PER_NOMRAZON AS VENDEDOR,
      ADE_VTAFI.VTE_FORMAPAGO AS FORMAPAGO_ORIGINAL,
      CASE ADE_VTAFI.VTE_FORMAPAGO
        WHEN 'FLOT' THEN 'FLOTILLA'
        WHEN 'FLOTGMF' THEN 'FLOTILLA'
        ELSE 'RETAIL'
      END AS SEGMENTO
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    LEFT JOIN UNI_CATALOGO
      ON UNI_CATALOGO.UNC_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND UNI_CATALOGO.UNC_IDCATALOGO = SER_VEHICULO.VEH_CATALOGO
    INNER JOIN PER_PERSONAS AS B ON B.PER_IDPERSONA = SER_VEHICULO.VEH_VENDEDOR
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)
        BETWEEN @fechaInicio AND @fechaFin
      ${flotillaFilter}
      AND ${modelFilter}
    ORDER BY CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103) DESC
  `, params);

  const porVariante = {};
  const porMes = {};
  const porVendedor = {};
  const porSucursal = {};
  const porSucursalRetail = {};
  const porSucursalFlotilla = {};
  let retail = 0;
  let flotilla = 0;

  for (const row of rows) {
    const variante = String(row.VEH_TIPOAUTO || row.VEH_ANMODELO || 'Sin modelo').trim();
    porVariante[variante] = (porVariante[variante] || 0) + 1;

    const fecha = String(row.VTE_FECHDOCTO || '').trim();
    const parts = fecha.split('/');
    const mesKey = parts.length === 3 ? `${parts[2]}-${parts[1]}` : 'Sin fecha';
    porMes[mesKey] = (porMes[mesKey] || 0) + 1;

    const vend = String(row.VENDEDOR || 'Sin vendedor').trim();
    porVendedor[vend] = (porVendedor[vend] || 0) + 1;

    const canal = getCanalVenta(row.FORMAPAGO_ORIGINAL);
    const sucursalLabel = getCanalLabel(canal);
    porSucursal[sucursalLabel] = (porSucursal[sucursalLabel] || 0) + 1;

    if (row.SEGMENTO === 'FLOTILLA') {
      flotilla += 1;
      porSucursalFlotilla[sucursalLabel] = (porSucursalFlotilla[sucursalLabel] || 0) + 1;
    } else {
      retail += 1;
      if (canal !== 'FLOTILLAS' && canal !== 'PERDIDA') {
        porSucursalRetail[sucursalLabel] = (porSucursalRetail[sucursalLabel] || 0) + 1;
      }
    }
  }

  const toSorted = (obj) => Object.entries(obj)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const retailRows = rows.filter((row) => row.SEGMENTO !== 'FLOTILLA');
  const porDiaRetail = {};
  const porSucursalPorDia = {};
  for (const row of retailRows) {
    const canal = getCanalVenta(row.FORMAPAGO_ORIGINAL);
    if (canal === 'FLOTILLAS' || canal === 'PERDIDA') continue;
    const fecha = String(row.VTE_FECHDOCTO || 'Sin fecha').trim();
    const sucursal = getCanalLabel(canal);
    porDiaRetail[fecha] = (porDiaRetail[fecha] || 0) + 1;
    if (!porSucursalPorDia[fecha]) porSucursalPorDia[fecha] = {};
    porSucursalPorDia[fecha][sucursal] = (porSucursalPorDia[fecha][sucursal] || 0) + 1;
  }
  const retailDrilldown = {
    fechas: Object.entries(porDiaRetail)
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => {
        const [da, ma, ya] = a.label.split('/').map(Number);
        const [db, mb, yb] = b.label.split('/').map(Number);
        return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
      }),
    byFecha: Object.fromEntries(
      Object.entries(porSucursalPorDia).map(([fecha, map]) => [
        fecha,
        Object.entries(map).map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
      ]),
    ),
    periodo: toSorted(porSucursalRetail),
  };

  return {
    consulta: {
      modeloBuscado: modelo,
      terminoSql: term,
      segmento: highEnd ? 'HIGH_END' : null,
      highEndCarlines: highEnd ? HIGH_END_CARLINES : undefined,
      fechaInicio,
      fechaFin,
      incluirFlotilla,
    },
    razonamiento: highEnd
      ? [
        'HIGH END = canal de lujo Balderrama (no es forma de pago).',
        `Carlines: ${HIGH_END_CARLINES.join(', ')}.`,
        'Filtro por VEH_TIPOAUTO / UNC_FAMILIA que contengan esos nombres.',
      ]
      : [
        'ADE_VTAFI registra la factura de venta (tipo A, status I).',
        'SER_VEHICULO aporta VEH_TIPOAUTO (nombre comercial, ej. AVEO) vía VTE_SERIE.',
        'UNI_CATALOGO.UNC_FAMILIA cubre variantes de catálogo cuando el nombre difiere.',
      ],
    resumen: {
      unidadesVendidas: rows.length,
      retail,
      flotilla,
      variantesDistintas: Object.keys(porVariante).length,
    },
    porVariante: toSorted(porVariante).slice(0, 15),
    porMes: toSorted(porMes),
    porSucursal: toSorted(porSucursal),
    porSucursalRetail: toSorted(porSucursalRetail),
    porSucursalFlotilla: toSorted(porSucursalFlotilla),
    retailDrilldown,
    topVendedores: toSorted(porVendedor).slice(0, 10),
    muestra: rows.slice(0, 8).map((r) => ({
      fecha: r.VTE_FECHDOCTO,
      serie: r.VTE_SERIE,
      modelo: r.VEH_TIPOAUTO,
      catalogo: r.VEH_ANMODELO,
      segmento: r.SEGMENTO,
      highEnd: isHighEndVehicle({ tipoAuto: r.VEH_TIPOAUTO, familia: r.UNC_FAMILIA }),
      vendedor: r.VENDEDOR,
    })),
  };
}

module.exports = { getVentasPorModelo };
