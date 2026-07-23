const { query } = require('../db');

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clean(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

/**
 * Movimientos de dinero aplicados a una factura (CXC_PAGANT / DET / PagosCajaDet),
 * más titular (nombre/tel/correo), entrega SOFIA y timbrado CFDI.
 */
async function getFacturaMovimientos(docto) {
  const id = String(docto || '').trim();
  if (!id) {
    throw Object.assign(new Error('Factura requerida.'), { status: 400 });
  }

  const facturas = await query(`
    SELECT TOP 1
      RTRIM(f.VTE_DOCTO) AS factura,
      f.VTE_FECHDOCTO AS fecha,
      RTRIM(f.VTE_TIPODOCTO) AS tipoDocto,
      RTRIM(f.VTE_STATUS) AS status,
      RTRIM(f.VTE_FORMAPAGO) AS formaPago,
      RTRIM(f.VTE_SERIE) AS serie,
      f.VTE_IDCLIENTE AS idCliente,
      f.VTE_TOTAL AS total,
      f.VTE_VTABRUT AS subtotal,
      f.VTE_IVA AS iva,
      LTRIM(RTRIM(
        ISNULL(cli.PER_NOMRAZON, '') + ' ' +
        ISNULL(cli.PER_PATERNO, '') + ' ' +
        ISNULL(cli.PER_MATERNO, '')
      )) AS cliente,
      RTRIM(ISNULL(cli.PER_RFC, '')) AS rfc,
      RTRIM(ISNULL(cli.PER_TELEFONO1, '')) AS telefono,
      RTRIM(ISNULL(cli.per_telcelular, '')) AS celular,
      RTRIM(ISNULL(cli.PER_EMAIL, '')) AS correo,
      RTRIM(ISNULL(cli.PER_EMAIL2, '')) AS correo2,
      sof.SOF_FechAct AS sofiaFechaEntrega,
      sof.SOF_HoraAct AS sofiaHoraEntrega,
      RTRIM(ISNULL(sof.SOF_Estatus, '')) AS sofiaEstatus,
      RTRIM(ISNULL(sof.SOF_Resultado, '')) AS sofiaResultado,
      sof.SOF_FechFact AS sofiaFechaFactura,
      RTRIM(ISNULL(sof.SOF_VIN, '')) AS sofiaVin,
      CASE WHEN sof.SOF_Factura IS NOT NULL THEN 1 ELSE 0 END AS enSofia,
      RTRIM(ISNULL(cfdi.CFI_UUID, '')) AS uuidCfdi,
      cfdi.CFI_FechadeTimbrado AS fechaTimbrado,
      RTRIM(ISNULL(cfdi.CFI_Resultado, '')) AS cfdiResultado
    FROM ADE_VTAFI f
    LEFT JOIN PER_PERSONAS cli ON cli.PER_IDPERSONA = f.VTE_IDCLIENTE
    OUTER APPLY (
      SELECT TOP 1
        s.SOF_Factura,
        s.SOF_FechAct,
        s.SOF_HoraAct,
        s.SOF_Estatus,
        s.SOF_Resultado,
        s.SOF_FechFact,
        s.SOF_VIN
      FROM SOF_Venta_Cancel_DEMO s
      WHERE RTRIM(s.SOF_Factura) = RTRIM(f.VTE_DOCTO)
        AND UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA'
        AND UPPER(LTRIM(RTRIM(s.SOF_Resultado))) = 'EXITO'
      ORDER BY s.SOF_FechAct DESC, s.SOF_HoraAct DESC
    ) sof
    OUTER APPLY (
      SELECT TOP 1
        c.CFI_UUID,
        c.CFI_FechadeTimbrado,
        c.CFI_Resultado
      FROM ADE_CFDI c
      WHERE RTRIM(c.CFI_REFERENCIA) = RTRIM(f.VTE_DOCTO)
        AND c.CFI_UUID IS NOT NULL
        AND LTRIM(RTRIM(c.CFI_UUID)) <> ''
      ORDER BY c.CFI_FechadeTimbrado DESC, c.CFI_CONSECUTIVO DESC
    ) cfdi
    WHERE RTRIM(f.VTE_DOCTO) = @docto
      AND f.VTE_TIPODOCTO = 'A'
    ORDER BY CASE WHEN f.VTE_STATUS = 'I' THEN 0 ELSE 1 END
  `, { docto: id });

  const factura = facturas[0] || null;
  if (!factura) {
    throw Object.assign(new Error(`Factura ${id} no encontrada.`), { status: 404 });
  }

  const movimientos = await query(`
    SELECT
      p.PAM_FECHOPE AS fecha,
      p.PAM_HORAOPE AS hora,
      RTRIM(p.PAM_TIPODOCTO) AS tipoDocto,
      RTRIM(p.PAM_IDDOCTO) AS folioPago,
      RTRIM(ISNULL(d.PAD_TIPOPAGO, p.PAM_CONCEPTO)) AS tipoPago,
      ISNULL(d.PAD_IMPORTE, p.PAM_IMPORTEMON) AS importe,
      RTRIM(ISNULL(d.PAD_REFERENCIA, p.PAM_REFERENCIA)) AS referencia,
      RTRIM(ISNULL(d.PAD_BANCO, '')) AS banco,
      RTRIM(ISNULL(p.PAM_CARTERA, '')) AS cartera,
      c.xmd_NumParcialidad AS parcialidad,
      c.xmd_ImpSaldoAnt AS saldoAnterior,
      c.xmd_ImpPagado AS importeCfdi,
      c.xmd_ImpSaldoInsoluto AS saldoInsoluto
    FROM CXC_PAGANT p
    LEFT JOIN CXC_PAGANTDET d
      ON d.PAD_CONSPAGO = p.PAM_CONSCARTERA
    LEFT JOIN CXC_PagosCajaDet c
      ON RTRIM(c.xmd_factura) = @docto
     AND RTRIM(c.xmd_noPago) = RTRIM(p.PAM_IDDOCTO)
    WHERE RTRIM(p.PAM_DOCAFECTADO) = @docto
    ORDER BY p.PAM_FECHOPE, p.PAM_HORAOPE, p.PAM_RENGLON
  `, { docto: id });

  const totalFactura = round2(factura.total);
  const totalAplicado = round2(movimientos.reduce((s, m) => s + Number(m.importe || 0), 0));
  const lastSaldo = movimientos.length
    ? movimientos.map((m) => m.saldoInsoluto).filter((v) => v != null && v !== '').pop()
    : null;
  const saldo = lastSaldo != null && lastSaldo !== ''
    ? round2(lastSaldo)
    : round2(Math.max(0, totalFactura - totalAplicado));

  const enSofia = Number(factura.enSofia) === 1;
  const uuidCfdi = clean(factura.uuidCfdi);
  const telefono = clean(factura.celular) || clean(factura.telefono);
  const correo = clean(factura.correo) || clean(factura.correo2);

  return {
    factura: {
      factura: clean(factura.factura),
      fecha: factura.fecha,
      tipoDocto: clean(factura.tipoDocto),
      status: clean(factura.status),
      formaPago: clean(factura.formaPago),
      serie: clean(factura.serie),
      idCliente: factura.idCliente,
      total: totalFactura,
      subtotal: round2(factura.subtotal),
      iva: round2(factura.iva),
      cliente: clean(factura.cliente),
      rfc: clean(factura.rfc),
      telefono,
      celular: clean(factura.celular),
      telefonoFijo: clean(factura.telefono),
      correo,
      correo2: clean(factura.correo2),
    },
    sofia: {
      enSofia,
      label: enSofia ? 'Timbrada / reportada en SOFIA' : 'Sin entrega en SOFIA',
      fechaEntrega: factura.sofiaFechaEntrega || null,
      horaEntrega: clean(factura.sofiaHoraEntrega),
      estatus: clean(factura.sofiaEstatus),
      resultado: clean(factura.sofiaResultado),
      fechaFactura: factura.sofiaFechaFactura || null,
      vin: clean(factura.sofiaVin),
    },
    cfdi: {
      timbrado: Boolean(uuidCfdi),
      uuid: uuidCfdi,
      fechaTimbrado: factura.fechaTimbrado || null,
      resultado: clean(factura.cfdiResultado),
      label: uuidCfdi ? 'CFDI timbrado' : 'Sin UUID CFDI',
    },
    movimientos: movimientos.map((m) => ({
      ...m,
      importe: round2(m.importe),
      saldoAnterior: m.saldoAnterior != null ? round2(m.saldoAnterior) : null,
      importeCfdi: m.importeCfdi != null ? round2(m.importeCfdi) : null,
      saldoInsoluto: m.saldoInsoluto != null ? round2(m.saldoInsoluto) : null,
    })),
    resumen: {
      totalFactura,
      totalAplicado,
      saldo,
      cantidadMovimientos: movimientos.length,
      tieneMovimientos: movimientos.length > 0,
      enSofia,
      cfdiTimbrado: Boolean(uuidCfdi),
    },
  };
}

module.exports = { getFacturaMovimientos };
