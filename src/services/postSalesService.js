const { loadOrders, loadOpenSnapshot } = require('./postSalesLoad');

async function getPostSales({ fechaInicio, fechaFin } = {}) {
  const [records, openSnapshot] = await Promise.all([
    loadOrders({ fechaInicio, fechaFin }),
    loadOpenSnapshot(),
  ]);

  return {
    filtros: { fechaInicio, fechaFin },
    fuente: 'SER_ORDEN',
    records,
    openSnapshot,
    total: records.length,
    openTotal: openSnapshot.length,
  };
}

module.exports = { getPostSales };
