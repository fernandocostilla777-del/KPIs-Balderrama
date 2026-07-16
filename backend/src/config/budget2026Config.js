const path = require('path');

const BUDGET_YEAR = 2026;

const DEFAULT_BUDGET_PATH = path.join(__dirname, '../../data/presupuesto-2026.xlsx');

/** Hoja RESUMEN — columna de importe presupuesto 2026 */
const RESUMEN_AMOUNT_COL = 2;

/** Hoja PRESUPUESTO FINANCIERO 2026 */
const FIN_LABEL_COL = 1;
const FIN_MONTH_START_COL = 4;
const FIN_MONTH_STEP = 5;
const FIN_ANNUAL_COL = 65;

/** Hoja FINANCIERO POSVENTA 2026 */
const PV_LABEL_COL = 1;
const PV_MONTH_START_COL = 3;
const PV_MONTH_STEP = 3;
const PV_ANNUAL_COL = 39;

const RESUMEN_LINES = {
  ventasMenudeo: 'VENTAS NUEVOS MENUDEO',
  ventasIntercambios: 'VENTAS INTERCAMBIOS',
  ventasFlotillas: 'VENTAS FLOTILLAS',
  ventasSeminuevos: 'VENTAS SEMINUEVOS',
  ventasAutos: 'TOTAL VENTAS AUTOS',
  ventasMoServicio: 'VENTAS MO SERVICIO',
  ventasMoBodys: 'VENTAS MO BODYS',
  ventasRefaccServicio: 'VENTAS REFACC SERVICIO',
  ventasRefaccBodys: 'VENTAS REFACC BODYS',
  ventasRefaccMayoreo: 'VENTAS REFACC MAYOREO Y MOS',
  ventasPostventa: 'TOTAL POSVENTA',
  ventasTotales: 'TOTAL VENTAS ABP',
  ubMenudeo: 'UB VENTAS NUEVOS MENUDEO',
  ubIntercambios: 'UB VENTAS INTERCAMBIOS',
  ubFlotillas: 'UB VENTAS FLOTILLAS',
  ubSeminuevos: 'UB VENTAS SEMINUEVOS',
  ubAutos: 'TOTAL UB VENTAS AUTOS',
  ubMoServicio: 'UB VENTAS MO SERVICIO',
  ubMoBodys: 'UB VENTAS MO BODYS',
  ubRefaccServicio: 'UB VENTAS REFACC SERVICIO',
  ubRefaccBodys: 'UB VENTAS REFACC BODYS',
  ubRefaccMayoreo: 'UB VENTAS REFACC MAYOREO Y MOS',
  ubPostventa: 'TOTAL UB POSVENTA',
  ubTotal: 'TOTAL UB  ABP',
  gastosVentasAutos: 'TOTAL GASTOS VENTAS AUTOS',
  gastosIntercambios: 'GASTOS INTERCAMBIOS',
  gastosFlotillas: 'GASTOS FLOTILLAS',
  gastosSeminuevos: 'GASTOS SEMINUEVOS',
  gastosDeptoServicio: 'GASTOS DEPTO SERVICIO',
  gastosDeptoBody: 'GASTOS DEPTO BODY',
  gastosDeptosRefacciones: 'GASTOS DEPTOS REFACCIONES',
  gastosOperativos: 'TOTAL GASTOS OPERATIVOS ABP',
  gastosAdministracion: 'GASTOS ADMINISTRACION',
  gastosOperativosYAdmin: 'TOTAL GASTOS OPERATIVOS Y ADMON',
};

/** Segunda aparición de TOTAL POSVENTA en RESUMEN = gastos postventa */
const RESUMEN_GASTOS_POSTVENTA_LABEL = 'TOTAL POSVENTA';
const RESUMEN_GASTOS_POSTVENTA_OCCURRENCE = 2;

const BRANCH_VENTAS_ROWS = {
  piso: 'VENTAS AUTOS PISO SERDAN',
  foraneos: 'VENTAS AUTOS FORANEOS SERDAN',
  suauto: 'VENTAS AUTOS SuAuto SERDAN',
  cholula: 'VENTAS AUTOS CHOLULA',
  zacatelco: 'VENTAS AUTOS ZACATELCO',
};

module.exports = {
  BUDGET_YEAR,
  DEFAULT_BUDGET_PATH,
  RESUMEN_AMOUNT_COL,
  FIN_LABEL_COL,
  FIN_MONTH_START_COL,
  FIN_MONTH_STEP,
  FIN_ANNUAL_COL,
  PV_LABEL_COL,
  PV_MONTH_START_COL,
  PV_MONTH_STEP,
  PV_ANNUAL_COL,
  RESUMEN_LINES,
  RESUMEN_GASTOS_POSTVENTA_LABEL,
  RESUMEN_GASTOS_POSTVENTA_OCCURRENCE,
  BRANCH_VENTAS_ROWS,
};
