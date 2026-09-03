/**
 * Cuadre de Órdenes HyP
 * ======================
 * Nombre canónico del módulo: **cuadreOrdenesHyp**
 *
 * Cruza pólizas Contpaq (MOVDET VS/DVS, cuentas 0470/0476/0477/0479) con
 * facturas DMS (SRV/S000) por orden y docto, validando montos sin IVA y
 * produciendo matriz orden/factura/VIN + totales por cuenta.
 *
 * Uso:
 *   const { consultarCuadreOrdenesHyp } = require('./cuadreOrdenesHyp');
 *   const data = await consultarCuadreOrdenesHyp({ fechaInicio, fechaFin });
 *
 * API: GET /api/post-sales/hyp/cuadre-ordenes?fechaInicio=&fechaFin=
 *      (alias legacy: /api/post-sales/hyp/cuadre)
 *
 * CLI:
 *   node scripts/consulta-hyp-cuadre.js YYYY-MM-DD YYYY-MM-DD
 *   node scripts/export-hyp-cuadre-xlsx.js YYYY-MM-DD YYYY-MM-DD
 *
 * SQL SSMS: backend/data/consulta-hyp-vins-montos.sql
 */

const hypCuadreService = require('../hypCuadreService');
const hypMovdetMatch = require('../../../scripts/lib/hypMovdetMatch');
const hypCuadreQueries = require('../../../scripts/lib/hypCuadreQueries');
const hypCuadraLogic = require('../../../scripts/lib/hypCuadraLogic');

const MODULO = 'cuadreOrdenesHyp';
const CUENTAS_ORDENES_HYP = hypCuadreService.CUENTAS;

module.exports = {
  MODULO,
  CUENTAS_ORDENES_HYP,
  CUENTAS: CUENTAS_ORDENES_HYP,
  CUENTA_LABEL: hypCuadraLogic.CUENTA_LABEL,

  /** Cuadre completo Contpaq ↔ DMS para el periodo */
  consultarCuadreOrdenesHyp: hypCuadreService.consultarCuadreHyp,
  /** @deprecated Usar consultarCuadreOrdenesHyp */
  consultarCuadreHyp: hypCuadreService.consultarCuadreHyp,

  buildTextoReporte: hypCuadreService.buildTextoReporte,
  generarConsultas: hypCuadreService.generarConsultas,

  cuadreFromMovdet: hypMovdetMatch.cuadreFromMovdet,
  emptyPorCuenta: hypMovdetMatch.emptyPorCuenta,
  sqlMatrizPorFactura: hypCuadreQueries.sqlMatrizPorFactura,
  sqlMovdetHyp: hypCuadreQueries.sqlMovdetHyp,
  sqlVinsUnicosMes: hypCuadreQueries.sqlVinsUnicosMes,

  ARCHIVOS: {
    servicio: 'src/services/hypCuadreService.js',
    match: 'scripts/lib/hypMovdetMatch.js',
    queries: 'scripts/lib/hypCuadreQueries.js',
    logica: 'scripts/lib/hypCuadraLogic.js',
    sqlSsms: 'data/consulta-hyp-vins-montos.sql',
    scriptConsulta: 'scripts/consulta-hyp-cuadre.js',
    scriptExcel: 'scripts/export-hyp-cuadre-xlsx.js',
  },
};
