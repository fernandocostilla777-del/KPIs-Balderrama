const { loadOrders, loadOpenSnapshot, loadMesCursoNomenclatura } = require('./postSalesLoad');

async function getPostSales({ fechaInicio, fechaFin } = {}) {
  const [records, openSnapshot, mesCursoResult] = await Promise.all([
    loadOrders({ fechaInicio, fechaFin }),
    loadOpenSnapshot(),
    loadMesCursoNomenclatura().catch((err) => {
      console.error('[post-sales] mesCursoNomenclatura:', err.message);
      return null;
    }),
  ]);

  return {
    filtros: { fechaInicio, fechaFin },
    fuente: 'SER_ORDEN',
    records,
    openSnapshot,
    mesCursoNomenclatura: mesCursoResult,
    total: records.length,
    openTotal: openSnapshot.length,
  };
}

module.exports = { getPostSales };
