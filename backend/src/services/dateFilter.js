function buildDateRangeClause(fechaInicio, fechaFin, column = 'fecha_factura') {
  if (!fechaInicio || !fechaFin) {
    return { clause: '', params: {} };
  }
  return {
    clause: `AND CAST(${column} AS DATE) >= @fechaInicio AND CAST(${column} AS DATE) <= @fechaFin`,
    params: { fechaInicio, fechaFin },
  };
}

module.exports = { buildDateRangeClause };
