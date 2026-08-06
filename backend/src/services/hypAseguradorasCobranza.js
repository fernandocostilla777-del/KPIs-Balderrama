/**
 * Cobranza HyP · órdenes facturadas de aseguradoras.
 * Body 31 = folio V* · Matriz = folio A*
 * Pago = aplicaciones CXC (PagosCajaDet / PAGANT) sobre la factura de taller.
 */
const { query } = require('../db');
const { firstLetter, TIPO_POR_LETRA } = require('./postSalesOrderTypes');

const LETRAS_ASEG = new Set(['V', 'A']);
const EPS = 0.5; // tolerancia de centavos

function mapTipoPorLetra(orden) {
  const letra = firstLetter(orden);
  return {
    letra,
    tipo: TIPO_POR_LETRA[letra] || letra || 'Sin tipo',
  };
}

function parseDateInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Fecha invalida. Use formato YYYY-MM-DD.'), { status: 400 });
  }
  return value;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clean(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function segmentoFromLetra(letra) {
  if (letra === 'V') return 'body31';
  if (letra === 'A') return 'matriz';
  return 'otro';
}

function segmentoLabel(seg) {
  if (seg === 'body31') return 'Aseguradora Body 31';
  if (seg === 'matriz') return 'Aseguradoras (matriz)';
  return 'Otro';
}

function classifyPago({ importeFacturado, totalAplicado, tieneMovimientos }) {
  const imp = round2(importeFacturado);
  const pag = round2(totalAplicado);
  const saldo = round2(Math.max(0, imp - pag));

  if (!tieneMovimientos || pag <= 0) {
    return {
      pagoEstado: 'pendiente',
      pagoEstadoLabel: 'Pendiente de pago',
      totalAplicado: pag,
      saldo: imp,
    };
  }
  if (saldo <= EPS || pag + EPS >= imp) {
    return {
      pagoEstado: 'pagado',
      pagoEstadoLabel: 'Pagado',
      totalAplicado: pag,
      saldo: 0,
    };
  }
  return {
    pagoEstado: 'parcial',
    pagoEstadoLabel: 'Pago parcial / enviado',
    totalAplicado: pag,
    saldo,
  };
}

/**
 * Carga facturas de taller (ADE_VTAFI S*) de órdenes V/A facturadas (I) en el periodo (por cierre).
 * Una fila por factura CFDI; la orden va en VTE_REFERENCIA1.
 */
async function loadFacturadasAseguradoras({ fechaInicio, fechaFin }) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);

  const rows = await query(`
    SELECT
      o.ORE_IDORDEN AS orden,
      LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS nombre,
      RTRIM(vta.VTE_DOCTO) AS factura,
      o.ORE_STATUS AS status,
      LTRIM(RTRIM(ISNULL(o.ORE_MARCA, ''))) AS auto,
      LTRIM(RTRIM(ISNULL(veh.VEH_TIPOAUTO, ''))) AS modelo,
      LTRIM(RTRIM(o.ORE_NUMSERIE)) AS serie,
      o.ORE_FECHAORD AS ingreso,
      o.ORE_FECHACIE AS cierre,
      o.ORE_IDSINIESTRO AS siniestro,
      o.ORE_IDPOLIZA AS poliza,
      ISNULL(vta.VTE_TOTAL, 0) AS importeFac,
      LTRIM(RTRIM(ISNULL(sg.PAR_DESCRIP1, ''))) AS aseguradora,
      LTRIM(RTRIM(COALESCE(asr.PAR_DESCRIP1, o.ORE_IDASESOR, ''))) AS asesor,
      vta.VTE_FECHDOCTO AS fechaFactura,
      LTRIM(RTRIM(ISNULL(vta.VTE_TIPODOCTO, ''))) AS tipoDocto,
      LTRIM(RTRIM(ISNULL(vta.VTE_REFERENCIA2, ''))) AS formaPagoFac
    FROM SER_ORDEN o
    INNER JOIN ADE_VTAFI vta
      ON RTRIM(vta.VTE_REFERENCIA1) = RTRIM(o.ORE_IDORDEN)
      AND vta.VTE_TIPODOCTO LIKE 'S%'
      AND vta.VTE_STATUS = 'I'
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
    LEFT JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = o.ORE_NUMSERIE
    LEFT JOIN PNC_PARAMETR sg ON sg.PAR_TIPOPARA = 'SG' AND sg.PAR_IDENPARA = o.ORE_IDASEGURADORA
    LEFT JOIN PNC_PARAMETR asr ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
    WHERE o.ORE_STATUS = 'I'
      AND LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1) IN ('V', 'A')
      AND o.ORE_FECHACIE IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHACIE)) <> ''
      AND CONVERT(DATE, o.ORE_FECHACIE, 103) BETWEEN @fi AND @ff
    ORDER BY CONVERT(DATE, o.ORE_FECHACIE, 103) DESC, o.ORE_IDORDEN DESC, vta.VTE_DOCTO DESC
  `, { fi, ff });

  return (rows || []).map((row) => {
    const { letra, tipo } = mapTipoPorLetra(row.orden);
    const importeFacturado = round2(Number(row.importeFac || 0));
    const segmento = segmentoFromLetra(letra);
    return {
      orden: clean(row.orden),
      letraOrden: letra,
      tipoPorLetra: tipo,
      segmento,
      segmentoLabel: segmentoLabel(segmento),
      status: 'I',
      statusLabel: 'Facturada',
      factura: clean(row.factura),
      tipoDocto: clean(row.tipoDocto),
      formaPagoFac: clean(row.formaPagoFac),
      fechaFactura: clean(row.fechaFactura) || clean(row.cierre),
      ingreso: clean(row.ingreso),
      cierre: clean(row.cierre),
      nombre: clean(row.nombre),
      auto: clean(row.auto),
      modelo: clean(row.modelo),
      serie: clean(row.serie),
      siniestro: clean(row.siniestro),
      poliza: clean(row.poliza),
      aseguradora: clean(row.aseguradora) || 'Sin aseguradora',
      asesor: clean(row.asesor) || 'Sin asesor',
      importeFacturado,
    };
  }).filter((r) => LETRAS_ASEG.has(r.letraOrden) && r.factura);
}

/**
 * Agrega pagos CXC por lista de facturas (PagosCajaDet + PAGANT).
 */
async function loadPagosPorFacturas(facturas = []) {
  const ids = [...new Set(
    (facturas || []).map((f) => String(f || '').trim()).filter(Boolean)
  )];
  const map = new Map();
  if (!ids.length) return map;

  // Chunk para IN clause
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const params = {};
    const placeholders = chunk.map((id, idx) => {
      const key = `f${idx}`;
      params[key] = id;
      return `@${key}`;
    }).join(',');

    // PagosCajaDet: importe aplicado por factura
    try {
      const caja = await query(`
        SELECT
          RTRIM(xmd_factura) AS factura,
          SUM(ISNULL(xmd_ImpPagado, 0)) AS totalPagado,
          COUNT(*) AS movs,
          MIN(xmd_ImpSaldoInsoluto) AS minSaldo,
          MAX(xmd_noPago) AS ultimoPago
        FROM CXC_PagosCajaDet WITH (NOLOCK)
        WHERE RTRIM(xmd_factura) IN (${placeholders})
        GROUP BY RTRIM(xmd_factura)
      `, params);
      for (const row of caja || []) {
        const f = clean(row.factura);
        if (!f) continue;
        const prev = map.get(f) || { totalAplicado: 0, movimientos: 0, saldoInsoluto: null, foliosPago: [] };
        prev.totalAplicado = round2(prev.totalAplicado + Number(row.totalPagado || 0));
        prev.movimientos += Number(row.movs || 0);
        if (row.minSaldo != null && row.minSaldo !== '') {
          prev.saldoInsoluto = round2(row.minSaldo);
        }
        if (row.ultimoPago) prev.foliosPago.push(String(row.ultimoPago).trim());
        map.set(f, prev);
      }
    } catch (err) {
      console.warn('[hyp-cobranza] CXC_PagosCajaDet:', err.message);
    }

    // PAGANT: respaldo si no hubo PagosCajaDet
    try {
      const pagant = await query(`
        SELECT
          RTRIM(p.PAM_DOCAFECTADO) AS factura,
          SUM(ISNULL(d.PAD_IMPORTE, p.PAM_IMPORTEMON)) AS totalPagado,
          COUNT(*) AS movs
        FROM CXC_PAGANT p WITH (NOLOCK)
        LEFT JOIN CXC_PAGANTDET d WITH (NOLOCK)
          ON d.PAD_CONSPAGO = p.PAM_CONSCARTERA
        WHERE RTRIM(p.PAM_DOCAFECTADO) IN (${placeholders})
        GROUP BY RTRIM(p.PAM_DOCAFECTADO)
      `, params);
      for (const row of pagant || []) {
        const f = clean(row.factura);
        if (!f) continue;
        const prev = map.get(f) || { totalAplicado: 0, movimientos: 0, saldoInsoluto: null, foliosPago: [] };
        // Solo sumar PAGANT si aún no hay pagos de caja (evitar doble conteo)
        if (prev.movimientos === 0) {
          prev.totalAplicado = round2(Number(row.totalPagado || 0));
          prev.movimientos = Number(row.movs || 0);
        } else if (prev.totalAplicado <= 0 && Number(row.totalPagado || 0) > 0) {
          prev.totalAplicado = round2(Number(row.totalPagado || 0));
          prev.movimientos += Number(row.movs || 0);
        }
        map.set(f, prev);
      }
    } catch (err) {
      console.warn('[hyp-cobranza] CXC_PAGANT:', err.message);
    }
  }

  return map;
}

function enrichWithPago(order, pagoMap) {
  const factura = order.factura;
  const pago = (factura && pagoMap.get(factura)) || null;
  const totalAplicado = round2(pago?.totalAplicado || 0);
  const tieneMovimientos = Number(pago?.movimientos || 0) > 0 || totalAplicado > 0;
  const cls = classifyPago({
    importeFacturado: order.importeFacturado,
    totalAplicado,
    tieneMovimientos,
  });

  // Si CXC trae saldo insoluto explícito y hay movimiento, preferirlo cuando sea coherente
  let saldo = cls.saldo;
  let pagoEstado = cls.pagoEstado;
  let pagoEstadoLabel = cls.pagoEstadoLabel;
  if (tieneMovimientos && pago?.saldoInsoluto != null) {
    const s = round2(pago.saldoInsoluto);
    if (s <= EPS) {
      saldo = 0;
      pagoEstado = 'pagado';
      pagoEstadoLabel = 'Pagado';
    } else if (s > EPS && totalAplicado > 0) {
      saldo = s;
      pagoEstado = 'parcial';
      pagoEstadoLabel = 'Pago parcial / enviado';
    }
  }

  return {
    ...order,
    totalAplicado,
    saldo,
    pagoEstado,
    pagoEstadoLabel,
    movimientosCount: Number(pago?.movimientos || 0),
    foliosPago: pago?.foliosPago || [],
    enviadoAPago: tieneMovimientos,
  };
}

function summarize(rows = []) {
  const body31 = rows.filter((r) => r.segmento === 'body31');
  const matriz = rows.filter((r) => r.segmento === 'matriz');
  const pendientes = rows.filter((r) => r.pagoEstado === 'pendiente');
  const parciales = rows.filter((r) => r.pagoEstado === 'parcial');
  const pagados = rows.filter((r) => r.pagoEstado === 'pagado');
  const enviados = rows.filter((r) => r.enviadoAPago);

  const sumImp = (list) => round2(list.reduce((s, r) => s + Number(r.importeFacturado || 0), 0));
  const sumSaldo = (list) => round2(list.reduce((s, r) => s + Number(r.saldo || 0), 0));
  const sumPag = (list) => round2(list.reduce((s, r) => s + Number(r.totalAplicado || 0), 0));

  return {
    totalFacturadas: rows.length,
    importeFacturado: sumImp(rows),
    body31: {
      ordenes: body31.length,
      importe: sumImp(body31),
      pendientes: body31.filter((r) => r.pagoEstado === 'pendiente').length,
      pagadas: body31.filter((r) => r.pagoEstado === 'pagado').length,
      saldoPendiente: sumSaldo(body31.filter((r) => r.pagoEstado !== 'pagado')),
    },
    matriz: {
      ordenes: matriz.length,
      importe: sumImp(matriz),
      pendientes: matriz.filter((r) => r.pagoEstado === 'pendiente').length,
      pagadas: matriz.filter((r) => r.pagoEstado === 'pagado').length,
      saldoPendiente: sumSaldo(matriz.filter((r) => r.pagoEstado !== 'pagado')),
    },
    pendientePago: {
      ordenes: pendientes.length,
      importe: sumImp(pendientes),
      saldo: sumSaldo(pendientes),
    },
    enviadoParcial: {
      ordenes: parciales.length,
      importe: sumImp(parciales),
      pagado: sumPag(parciales),
      saldo: sumSaldo(parciales),
    },
    pagado: {
      ordenes: pagados.length,
      importe: sumImp(pagados),
      pagado: sumPag(pagados),
    },
    enviadoAPago: {
      ordenes: enviados.length,
      importe: sumImp(enviados),
    },
  };
}

async function getHypAseguradorasCobranza({ fechaInicio, fechaFin } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }

  const orders = await loadFacturadasAseguradoras({ fechaInicio, fechaFin });
  const pagoMap = await loadPagosPorFacturas(orders.map((o) => o.factura));
  const registros = orders.map((o) => enrichWithPago(o, pagoMap));
  const summary = summarize(registros);

  return {
    periodo: { fechaInicio, fechaFin },
    criterio: {
      body31: 'Folio V* · Aseguradora Body 31 (sucursal 31)',
      matriz: 'Folio A* · Aseguradoras (sucursal matriz)',
      facturada: 'ORE_STATUS = I + factura taller ADE_VTAFI (S*)',
      periodoPor: 'Fecha de cierre (ORE_FECHACIE)',
      pago: 'CXC_PagosCajaDet / CXC_PAGANT sobre VTE_DOCTO (SRV*)',
      enlace: 'ADE_VTAFI.VTE_REFERENCIA1 = ORE_IDORDEN',
    },
    summary,
    registros,
  };
}

module.exports = {
  getHypAseguradorasCobranza,
  classifyPago,
  segmentoFromLetra,
};
