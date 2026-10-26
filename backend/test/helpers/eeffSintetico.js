'use strict';
/** EEFF sintético con la misma forma que getEeffSummary de Balderrama (solo para pruebas y capturas). */
const cfg = require('../../src/config/eeffSummaryConfig');

function pnl(ventas, costo, gastos, admin = 0) {
  const utilidadBruta = ventas - costo;
  return { ventas, costo, utilidadBruta, gastos, gastosAdministracion: admin, sumaGastos: gastos + admin, utilidadOperacion: utilidadBruta - gastos - admin };
}
function agregar(rows) {
  const s = (k) => rows.reduce((t, r) => t + r[k], 0);
  return pnl(s('ventas'), s('costo'), s('gastos'), s('gastosAdministracion'));
}

/** EEFF sintético con la misma forma que getEeffSummary. */
function payloadSintetico({ conPostventaGeneral = 0 } = {}) {
  const branches = cfg.MENUDEO_BRANCHES.map((b, i) => ({ id: b.id, label: b.label, ...pnl(1000 + i * 100, 900 + i * 95, 40 + i) }));
  const flot = pnl(500, 470, 10);
  const inter = pnl(300, 290, 5);
  const menudeo = agregar(branches);
  const total = agregar([...branches, flot, inter]);
  const semis = cfg.SEMINUEVOS_BRANCHES.map((b, i) => ({ id: b.id, label: b.label, ...pnl(400 + i * 50, 350 + i * 40, 0) }));
  const semiSummary = { ...agregar(semis), gastos: 25 };
  semiSummary.sumaGastos = 25;
  semiSummary.utilidadOperacion = semiSummary.utilidadBruta - 25;
  const sections = cfg.POSTVENTA_SECTIONS.map((s, i) => ({ id: s.id, label: s.label, ...pnl(600 + i * 100, 300 + i * 40, 30 + i * 5) }));
  const pvSummary = agregar(sections);
  const adminTotal = 120;
  const ventasTotales = total.ventas + semiSummary.ventas + pvSummary.ventas;
  const costoTotal = total.costo + semiSummary.costo + pvSummary.costo;
  const gastosOperacion = total.gastos + semiSummary.gastos + pvSummary.gastos;
  const utilidadBruta = ventasTotales - costoTotal;
  const sumaGastos = gastosOperacion + adminTotal;
  const utilidadOperacion = utilidadBruta - sumaGastos;
  const productosFinancieros = 15;
  const gastosFinancieros = 22;
  const utilidadFinanciera = productosFinancieros - gastosFinancieros;
  const gpos = [
    ...cfg.MENUDEO_BRANCHES.map((b, i) => ({ gpoCont: b.expenseGpo, label: b.label, value: branches[i].gastos })),
    { gpoCont: cfg.FLOTILLAS_BRANCH.expenseGpo, label: 'Flotillas', value: flot.gastos },
    { gpoCont: cfg.INTERCAMBIOS_BRANCH.expenseGpo, label: 'Intercambios', value: inter.gastos },
    { gpoCont: '720', label: 'Seminuevos', value: semiSummary.gastos },
    ...cfg.POSTVENTA_SECTIONS.map((s, i) => ({ gpoCont: s.expenseGpo, label: s.label, value: sections[i].gastos })),
  ];
  if (conPostventaGeneral) gpos.push({ gpoCont: '730', label: 'GASTOS-POSTVENTA', value: conPostventaGeneral });
  return {
    available: true,
    ventas: {
      menudeo: { branches, summary: menudeo },
      flotillas: { summary: flot },
      intercambios: { summary: inter },
      totalVentasAutos: { summary: total },
    },
    seminuevos: { branches: semis, summary: semiSummary },
    postventa: { sections, summary: pvSummary },
    estadoFinanciero: {
      summary: {
        ventasTotales, costoTotal, utilidadBruta, gastosOperacion, gastosAdministracion: adminTotal, sumaGastos,
        utilidadOperacion, productosFinancieros, gastosFinancieros, utilidadFinanciera, utilidad: utilidadOperacion + utilidadFinanciera,
      },
      gastosPorDepartamento: gpos,
    },
  };
}

module.exports = { payloadSintetico };
