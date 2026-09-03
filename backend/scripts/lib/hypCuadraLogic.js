/**
 * Lógica compartida cuadratura HyP vs cuentas 0470/0476/0477/0479.
 *
 * Reglas fiscales del periodo (fecha factura VTE_FECHDOCTO):
 *  · VTE_STATUS = I → ingreso positivo del mes
 *  · VTE_STATUS = C → reverso negativo del mes (cancelada en/ref. al periodo)
 *  · Facturas canceladas de otro mes no entran (ej. SRV000137175 mayo no afecta julio)
 *  · Refactura del mes: solo cuenta la vigente (ej. SRV000139208 julio)
 */

const CLASIFIC_A_CUENTA = {
  HP: '0470',
  VA: '0470',
  RE: '0477',
  PI: '0479',
  TTHP: '0476',
};

const CUENTAS = ['0470', '0476', '0477', '0479'];

const CUENTA_LABEL = {
  '0477': 'VENTA PARTES Y ACC. CARGADAS ORD H Y P',
  '0470': 'VENTA M.O. CLIENTES HOJ Y PINT',
  '0476': 'VENTA TOT TALLERES H Y P',
  '0479': 'VENTA PINTURA Y MATERIALES DE H Y P',
};

/** Externas + internas HyP */
const LETRAS_ASCII = ['A', 'F', 'V', 'Z', 'H', 'J'];
const LETRAS_ASCII_SQL = LETRAS_ASCII.map((l) => `'${l}'`).join(',');
const UNICODE_O_HYP = 211;

const ORDEN_LETRA_FILTER = `
  (
    LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1) IN (${LETRAS_ASCII_SQL})
    OR UNICODE(LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1)) = ${UNICODE_O_HYP}
  )`;

function ordenBaseWhere(alias = 'o') {
  const a = alias;
  return `
    ${a}.ORE_STATUS = 'I'
    AND ${ORDEN_LETRA_FILTER.replace(/o\./g, `${a}.`)}
    AND ${a}.ORE_FECHACIE IS NOT NULL AND LTRIM(RTRIM(${a}.ORE_FECHACIE)) <> ''
    AND CONVERT(DATE, ${a}.ORE_FECHACIE, 103) >= @fechaInicio
    AND CONVERT(DATE, ${a}.ORE_FECHACIE, 103) <= @fechaFin
    AND ${a}.ORE_NUMSERIE IS NOT NULL AND LTRIM(RTRIM(${a}.ORE_NUMSERIE)) <> ''
  `;
}

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyPorCuenta() {
  return { '0470': 0, '0476': 0, '0477': 0, '0479': 0 };
}

function signFromStatus(status) {
  return String(status || '').trim().toUpperCase() === 'C' ? -1 : 1;
}

function buildPorCuentaFromSubs(subsByCuenta, headerTotal) {
  const porCuentaSub = { ...emptyPorCuenta(), ...subsByCuenta };
  const subAll = CUENTAS.reduce((a, c) => a + porCuentaSub[c], 0);
  const total = Number(headerTotal || 0);
  const porCuentaConIva = emptyPorCuenta();
  for (const cuenta of CUENTAS) {
    porCuentaConIva[cuenta] = subAll > 0 && Math.abs(total) > 0
      ? (porCuentaSub[cuenta] / subAll) * total
      : (Math.abs(subAll) < 0.01 && Math.abs(total) > 0 ? total / CUENTAS.length : 0);
  }
  return { porCuentaSub, porCuentaConIva, importeConIva: total };
}

function mergePorCuenta(target, source, multiplier = 1) {
  for (const cuenta of CUENTAS) {
    target.porCuentaSub[cuenta] += source.porCuentaSub[cuenta] * multiplier;
    target.porCuentaConIva[cuenta] += source.porCuentaConIva[cuenta] * multiplier;
  }
  target.importeConIva += source.importeConIva * multiplier;
}

function montosDesdeFactura(fac, detRows) {
  const subsByCuenta = emptyPorCuenta();
  for (const r of detRows) {
    const cuenta = CLASIFIC_A_CUENTA[r.clasific];
    if (!cuenta) continue;
    subsByCuenta[cuenta] += Number(r.sub || 0);
  }
  return buildPorCuentaFromSubs(subsByCuenta, Number(fac.facTotal || 0));
}

async function facturasFiscalesPeriodo(query, fechaInicio, fechaFin) {
  const base = ordenBaseWhere('o');

  const headers = await query(`
    SELECT
      LTRIM(RTRIM(v.VTE_REFERENCIA1)) AS orden,
      v.VTE_DOCTO AS docto,
      v.VTE_STATUS AS facStatus,
      v.VTE_FECHDOCTO AS facFecha,
      v.VTE_TOTAL AS facTotal,
      v.VTE_MOTIVO AS facMotivo
    FROM ADE_VTAFI v
    INNER JOIN SER_ORDEN o ON LTRIM(RTRIM(v.VTE_REFERENCIA1)) = LTRIM(RTRIM(o.ORE_IDORDEN))
    WHERE ${base}
      AND v.VTE_STATUS IN ('I', 'C')
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) >= @fechaInicio
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) <= @fechaFin
    ORDER BY v.VTE_REFERENCIA1, v.VTE_FECHDOCTO, v.VTE_DOCTO
  `, { fechaInicio, fechaFin });

  const detalle = await query(`
    SELECT
      d.VTD_IDDOCTO AS docto,
      v.VTE_STATUS AS facStatus,
      UPPER(LTRIM(RTRIM(ISNULL(d.VTD_CLASIFIC, '')))) AS clasific,
      SUM(d.VTD_PRECIOUNITARIO * d.VTD_CANTIDAD) AS sub
    FROM ADE_VTAFIDET d
    INNER JOIN ADE_VTAFI v ON v.VTE_DOCTO = d.VTD_IDDOCTO
    INNER JOIN SER_ORDEN o ON LTRIM(RTRIM(v.VTE_REFERENCIA1)) = LTRIM(RTRIM(o.ORE_IDORDEN))
    WHERE ${base}
      AND v.VTE_STATUS IN ('I', 'C')
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) >= @fechaInicio
      AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) <= @fechaFin
    GROUP BY d.VTD_IDDOCTO, v.VTE_STATUS, UPPER(LTRIM(RTRIM(ISNULL(d.VTD_CLASIFIC, ''))))
  `, { fechaInicio, fechaFin });

  const detByDocto = new Map();
  for (const r of detalle) {
    if (!detByDocto.has(r.docto)) detByDocto.set(r.docto, []);
    detByDocto.get(r.docto).push(r);
  }

  const byOrden = new Map();
  for (const h of headers) {
    if (!byOrden.has(h.orden)) byOrden.set(h.orden, []);
    byOrden.get(h.orden).push(h);
  }

  return { byOrden, detByDocto, headers };
}

function calcularMontosOrden(facturas, detByDocto) {
  const net = {
    porCuentaSub: emptyPorCuenta(),
    porCuentaConIva: emptyPorCuenta(),
    importeConIva: 0,
  };
  const facturasVigentes = [];
  const facturasCanceladas = [];

  for (const fac of facturas) {
    const sign = signFromStatus(fac.facStatus);
    const part = montosDesdeFactura(fac, detByDocto.get(fac.docto) || []);
    mergePorCuenta(net, part, sign);

    const item = {
      docto: fac.docto,
      fecha: fac.facFecha,
      total: Number(fac.facTotal || 0),
      status: fac.facStatus,
      motivo: fac.facMotivo || '',
    };
    if (sign > 0) facturasVigentes.push(item);
    else facturasCanceladas.push(item);
  }

  const validaMonetaria = net.importeConIva > 0.01;
  const soloCancelada = facturasVigentes.length === 0 && facturasCanceladas.length > 0;

  return {
    ...net,
    facturasVigentes,
    facturasCanceladas,
    validaMonetaria,
    soloCancelada,
    estadoFiscal: soloCancelada
      ? 'cancelada_mes'
      : validaMonetaria
        ? 'valida'
        : facturas.length === 0
          ? 'sin_factura_mes'
          : 'neto_cero',
  };
}

async function ordenesHyPCuadra(query, fechaInicio, fechaFin) {
  const base = ordenBaseWhere('o');

  const rows = await query(`
    SELECT
      o.ORE_IDORDEN AS orden,
      LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1) AS letra,
      LTRIM(RTRIM(o.ORE_NUMSERIE)) AS serie,
      o.ORE_FECHACIE AS cierre,
      LTRIM(RTRIM(COALESCE(sg.PAR_DESCRIP1, ''))) AS aseguradora
    FROM SER_ORDEN o
    LEFT JOIN PNC_PARAMETR sg ON sg.PAR_TIPOPARA = 'SG' AND sg.PAR_IDENPARA = o.ORE_IDASEGURADORA
    WHERE ${base}
    ORDER BY o.ORE_FECHACIE, o.ORE_IDORDEN
  `, { fechaInicio, fechaFin });

  const { byOrden, detByDocto } = await facturasFiscalesPeriodo(query, fechaInicio, fechaFin);

  return rows.map((r) => {
    const facturas = byOrden.get(r.orden) || [];
    const montos = calcularMontosOrden(facturas, detByDocto);
    return {
      orden: r.orden,
      letra: r.letra,
      vin: normVin(r.serie),
      cierre: r.cierre,
      aseguradora: r.aseguradora || '',
      ...montos,
      fuente: facturas.length ? 'ADE_VTAFI' : 'sin_factura_mes',
    };
  });
}

function agregarPorVin(orders, soloValidas = false) {
  const map = new Map();
  for (const o of orders) {
    if (soloValidas && !o.validaMonetaria) continue;
    if (!map.has(o.vin)) {
      map.set(o.vin, {
        vin: o.vin,
        ordenes: [],
        importeConIva: 0,
        porCuentaSub: emptyPorCuenta(),
        porCuentaConIva: emptyPorCuenta(),
      });
    }
    const g = map.get(o.vin);
    g.ordenes.push(o.orden);
    g.importeConIva += o.importeConIva;
    for (const c of CUENTAS) {
      g.porCuentaSub[c] += o.porCuentaSub[c];
      g.porCuentaConIva[c] += o.porCuentaConIva[c];
    }
  }
  return [...map.values()].map((g) => ({ ...g, numOrdenes: g.ordenes.length }));
}

function sumPorCuenta(orders, field) {
  const out = emptyPorCuenta();
  for (const o of orders) {
    for (const c of CUENTAS) out[c] += o[field][c];
  }
  out.total = CUENTAS.reduce((a, c) => a + out[c], 0);
  return out;
}

async function contpaqPorCuenta(query, fechaInicio, fechaFin) {
  const start = new Date(`${fechaInicio}T12:00:00`);
  const year = start.getFullYear();
  const monthStart = start.getMonth() + 1;
  const monthEnd = new Date(`${fechaFin}T12:00:00`).getMonth() + 1;
  const table = `CON_CTAS01${year}`;
  const exists = await query(
    'SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @name',
    { name: table },
  );
  if (!exists.length) return { table, byPrefix: emptyPorCuenta(), total: 0 };

  const parts = [];
  for (let m = monthStart; m <= monthEnd; m++) {
    parts.push(`ISNULL(CTA_CARGO${m},0)-ISNULL(CTA_ABONO${m},0)`);
  }
  const mov = parts.join('+');
  const sign = `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END`;

  const rows = await query(`
    SELECT CTA_NUMCTA, SUM(${sign}) AS mov
    FROM [${table}]
    WHERE CTA_ACUMDET='DETA'
      AND (CTA_NUMCTA LIKE '0470%' OR CTA_NUMCTA LIKE '0476%' OR CTA_NUMCTA LIKE '0477%' OR CTA_NUMCTA LIKE '0479%')
    GROUP BY CTA_NUMCTA HAVING ABS(SUM(${sign})) > 0.01
  `);

  const byPrefix = emptyPorCuenta();
  let total = 0;
  for (const r of rows) {
    const p = String(r.CTA_NUMCTA).slice(0, 4);
    if (byPrefix[p] !== undefined) byPrefix[p] += Number(r.mov);
    total += Number(r.mov);
  }
  return { table, byPrefix, total };
}

module.exports = {
  CLASIFIC_A_CUENTA,
  CUENTAS,
  CUENTA_LABEL,
  ordenBaseWhere,
  normVin,
  fmt,
  emptyPorCuenta,
  ordenesHyPCuadra,
  agregarPorVin,
  sumPorCuenta,
  contpaqPorCuenta,
  calcularMontosOrden,
};
