'use strict';
/**
 * Contabilidad con formato VECSA y cálculo de Balderrama. Datos sintéticos.
 * Lo que se vigila: que cada total sea la suma de sus partes, que el signo de
 * presentación sea el de la balanza y que lo que el estado no toma se señale.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../src/config/eeffSummaryConfig');
const f = require('../src/services/contabilidadFormatoService');

const casi = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

const { payloadSintetico } = require('./helpers/eeffSintetico');

test('cada total del estado es la suma de sus rubros, con costo y gastos en negativo', () => {
  const p = payloadSintetico();
  const er = f.armarEstado({ payload: p, fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  const t = er.totales;
  const edo = p.estadoFinanciero.summary;
  assert.equal(t.ventas, edo.ventasTotales);
  assert.equal(t.costo, -edo.costoTotal);
  assert.equal(t.gastos, -edo.sumaGastos);
  for (const [key, b] of Object.entries(er.bloques)) {
    const rubros = b.raices.map((fila) => er.filas.find((x) => x.fila === fila).importe);
    const total = er.filas.find((x) => x.fila === b.total).importe;
    casi(rubros.reduce((s, x) => s + x, 0), total, `rubros de ${key}`);
  }
  casi(t.ventas + t.costo, t.utilidadBruta, 'ventas − costo = utilidad bruta');
  casi(t.utilidadBruta + t.gastos, t.utilidadOperacion, 'utilidad bruta − gastos = utilidad de operación');
  casi(t.utilidadOperacion + t.resultadoFinanciero, t.utilidadNeta, 'operación + financiero = utilidad del periodo');
  const final = er.filas.filter((x) => x.final);
  assert.equal(final.length, 1);
  assert.equal(final[0].importe, t.utilidadNeta);
});

test('cada subtotal de autos nuevos suma sus cuentas (menudeo = sus sucursales)', () => {
  const er = f.armarEstado({ payload: payloadSintetico(), fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  const ing = er.filas.filter((x) => x.seccion === 'Ingresos');
  const iMenudeo = ing.findIndex((x) => x.concepto === 'Menudeo');
  const cuentas = [];
  for (let i = iMenudeo + 1; i < ing.length && ing[i].nivel === 'cuenta'; i += 1) cuentas.push(ing[i].importe);
  assert.equal(cuentas.length, cfg.MENUDEO_BRANCHES.length);
  casi(cuentas.reduce((s, x) => s + x, 0), ing[iMenudeo].importe, 'menudeo');
  assert.ok(ing[iMenudeo + 1].cuentas[0].endsWith('…'), 'las cuentas se muestran como prefijo');
});

test('las líneas de negocio suman la utilidad bruta', () => {
  const p = payloadSintetico();
  const er = f.armarEstado({ payload: p, fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  casi(er.lineas.reduce((s, l) => s + l.utilidad, 0), er.totales.utilidadBruta, 'líneas');
  assert.ok(er.lineas.every((l) => l.costo <= 0));
  const menudeo = er.lineas.find((l) => l.key === 'menudeo');
  assert.equal(menudeo.sucursales.length, cfg.MENUDEO_BRANCHES.length);
  casi(menudeo.sucursales.reduce((s, l) => s + l.utilidad, 0), menudeo.utilidad, 'sucursales de menudeo');
  const semis = er.lineas.find((l) => l.key === 'seminuevos');
  casi(semis.sucursales.reduce((s, l) => s + l.utilidad, 0), semis.utilidad, 'ramas de seminuevos');
  const ids = er.filtroSucursales.map((s) => s.id);
  assert.deepEqual(ids, [...cfg.MENUDEO_BRANCHES.map((b) => b.id), 'flotillas', 'intercambios']);
  const piso = er.filtroSucursales.find((s) => s.id === 'piso');
  const branch = p.ventas.menudeo.branches.find((b) => b.id === 'piso');
  assert.equal(piso.linea.utilidad, branch.utilidadBruta);
  assert.equal(piso.linea.ventas, branch.ventas);
});

test('los rubros de gasto suman el total; un GPO que el estado no toma se señala aparte', () => {
  const er = f.armarEstado({ payload: payloadSintetico({ conPostventaGeneral: 77 }), fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  casi(er.gastos.reduce((s, g) => s + g.importe, 0), er.totales.gastos, 'rubros de gasto');
  assert.ok(!er.gastos.some((g) => g.key === 'diferencia'), 'sin diferencia cuando cuadra');
  assert.deepEqual(er.gastosFueraDelEstado, [{ gpo: '730', label: 'GASTOS-POSTVENTA', importe: -77 }]);
});

test('si los departamentos no cuadran con el total, la diferencia queda visible', () => {
  const p = payloadSintetico();
  p.estadoFinanciero.gastosPorDepartamento[0].value += 50;
  const er = f.armarEstado({ payload: p, fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  const dif = er.gastos.find((g) => g.key === 'diferencia');
  assert.ok(dif);
  assert.equal(dif.importe, 50);
  casi(er.gastos.reduce((s, g) => s + g.importe, 0), er.totales.gastos, 'con diferencia también cuadra');
});

test('revisión de la balanza: cuenta sin renglón y cuenta tomada por la lista de su departamento', () => {
  const gpo = cfg.MENUDEO_BRANCHES[0].expenseGpo;
  const deDepto = require('../src/config/departmentExpenseMapping').getAccountsForGpo(gpo)[0];
  const r = f.revisarBalanza([
    { cuenta: '0400-0001-0001-0001', gpo: '411', importe: 1000 },
    { cuenta: '0499-0099-0001-0001', descripcion: 'OTROS INGRESOS', gpo: '499', importe: 250 },
    { cuenta: deDepto, gpo, importe: -80 },
    { cuenta: '0700-9999-0001-0001', gpo, importe: -5 },
    { cuenta: '0499-0098-0001-0001', gpo: '499', importe: 0 },
  ]);
  assert.deepEqual(r.sinRenglon.map((c) => c.cuenta), ['0499-0099-0001-0001', '0700-9999-0001-0001']);
  assert.equal(r.sinRenglon[0].descripcion, 'OTROS INGRESOS');
  assert.deepEqual(r.duplicadas, []);
});

test('año contra año: mismo tramo del año anterior, serie del año y el 29 de febrero', () => {
  assert.equal(f.restarUnAnio('2024-02-29'), '2023-02-28');
  const porMes = new Map();
  const mes = (y, m, ventas, neta) => porMes.set(`${y}-${String(m).padStart(2, '0')}`, f.totalesDeMes({
    ventasTotales: ventas, costoTotal: ventas * 0.8, utilidadBruta: ventas * 0.2, gastosOperacion: 10, gastosAdministracion: 5, sumaGastos: 15, utilidadOperacion: ventas * 0.2 - 15, utilidadFinanciera: 0, utilidad: neta,
  }));
  for (let m = 1; m <= 9; m += 1) { mes(2026, m, 1000 + m, 100 + m); mes(2025, m, 900 + m, 80 + m); }
  const c = f.armarComparativo(porMes, '2026-07-01', '2026-09-30');
  assert.equal(c.hayAnterior, true);
  const ventas = c.rubros.find((r) => r.key === 'ventas');
  assert.equal(ventas.actual, 1007 + 1008 + 1009);
  assert.equal(ventas.anterior, 907 + 908 + 909);
  assert.equal(c.cuadro.meses.length, 9);
  const neta = c.cuadro.filas.find((x) => x.key === 'utilidadNeta');
  assert.equal(neta.acumulado, [...Array(9)].reduce((s, _, i) => s + 101 + i, 0));
  const costo = c.cuadro.filas.find((x) => x.key === 'costo');
  assert.ok(costo.acumulado < 0, 'costo con signo del estado');
  assert.equal(f.armarSerie(porMes, '2026-09-30').length, 9);
});

test('balance: cuadra con la ecuación, el capital muestra aparte el resultado y concilia con el estado', () => {
  const bg = {
    available: true,
    labelCierre: 'septiembre 2026',
    sections: [
      { key: 'activoCirculante', label: 'Activo circulante', pertenece: 'ACTIVO', value: 700 },
      { key: 'activoFijo', label: 'Activo fijo', pertenece: 'ACTIVO', value: 300 },
      { key: 'pasivoCortoPlazo', label: 'Pasivo a corto plazo', pertenece: 'PASIVO', value: 500 },
      { key: 'pasivoLargoPlazo', label: 'Pasivo a largo plazo', pertenece: 'PASIVO', value: 100 },
      { key: 'capital', label: 'Capital', pertenece: 'CAPITAL', value: 400 },
    ],
    accountsBySection: {
      activoCirculante: [{ cuenta: '0100', label: 'Bancos', signedValue: 700, value: 700 }],
      activoFijo: [{ cuenta: '0200', label: 'Equipo', signedValue: 450, value: 450 }, { cuenta: '0250', label: 'Depreciación', signedValue: -150, value: 150 }],
      pasivoCortoPlazo: [{ cuenta: '0300', label: 'Proveedores', value: 500 }],
      pasivoLargoPlazo: [{ cuenta: '0340', label: 'Créditos', value: 100 }],
      capital: [{ cuenta: '0360', label: 'Capital social', value: 350 }, { cuenta: 'RESULTADO-EJERCICIO', label: 'Resultado', value: 50, synthetic: true }],
    },
    resultadoEjercicio: 50,
    resultadoPorPrefijo: [{ prefijo: '04', importe: 900 }, { prefijo: '06', importe: -850 }],
    totals: { activoTotal: 1000, pasivoTotal: 600, capital: 400, pasivoMasCapital: 1000, ecuacionDiferencia: 0 },
    liquidez: { razonCirculante: 1.4, pruebaAcida: 0.8, capitalTrabajo: 200 },
    estructura: { endeudamientoPct: 60 },
  };
  const b = f.construirBalance(bg, 48);
  assert.equal(b.cuadre.ok, true);
  const capital = b.secciones.find((s) => s.key === 'capital');
  assert.equal(capital.total, 350, 'el capital no repite el resultado');
  assert.equal(b.totales.capitalContable, 400);
  casi(b.totales.pasivo + b.totales.capital + b.totales.resultado, b.totales.activo, 'activo = pasivo + capital + resultado');
  const fijo = b.secciones.find((s) => s.key === 'activo').grupos.find((g) => g.grupo === 'activoFijo');
  assert.equal(fijo.mayores.find((m) => m.cuenta === '0250').importe, -150, 'la complementaria resta');
  assert.equal(b.conciliacion.diferencia, 2);
  assert.equal(b.indicadores.find((i) => i.key === 'liquidez').estado, 'ok');
  assert.equal(b.indicadores.find((i) => i.key === 'apalancamiento').valor, 1.5);

  const roto = f.construirBalance({ ...bg, totals: { ...bg.totals, ecuacionDiferencia: 37 } }, 50);
  assert.equal(roto.cuadre.ok, false);
  assert.equal(roto.cuadre.diferencia, 37);
});

test('punto de equilibrio de Balderrama con la forma de VECSA', () => {
  const eq = f.equilibrioDe({ summary: { ventas: 1000, margenContribucion: 300, margenContribucionPct: 30, gastosFijos: 240, puntoEquilibrio: 800, coberturaPct: 125 } });
  assert.deepEqual({ v: eq.ventasEquilibrio, h: eq.holgura, e: eq.gastosEstructura }, { v: 800, h: 200, e: -240 });
  assert.equal(f.equilibrioDe({ summary: { ventas: 0 } }), null);
});

test('alertas: rojo solo para lo grave; lo que el grupo compensa y la revisión de balanza van como aviso', () => {
  const { buildEstadoResultadosInsights } = require('../src/services/intelligentInsightsService');
  const base = f.armarEstado({ payload: payloadSintetico({ conPostventaGeneral: 40 }), fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  const sev = (er) => Object.fromEntries(buildEstadoResultadosInsights(er).map((a) => [a.id, a.severity]));

  const compensada = { ...base, lineas: base.lineas.map((l) => (l.key === 'intercambios' ? { ...l, utilidad: -5 } : l)) };
  assert.equal(sev(compensada)['er-linea-bajo-costo'], 'warning', 'intercambios bajo costo con autos nuevos en positivo');

  const grupoNegativo = { ...base, lineas: base.lineas.map((l) => (l.grupo === 'nuevos' ? { ...l, utilidad: -5 } : l)) };
  assert.equal(sev(grupoNegativo)['er-linea-bajo-costo'], 'critical');

  const perdida = { ...base, totales: { ...base.totales, utilidadNeta: -100 } };
  assert.equal(sev(perdida)['er-perdida'], 'critical');

  assert.equal(sev(base)['er-revision-balanza'], 'warning', 'GPO 730 fuera del estado');
  assert.ok(buildEstadoResultadosInsights(base).every((a) => a.kpiId), 'toda alerta va anclada a su tarjeta');
});

test('cuadre contra el libro: encuentra el renglón por nombre y compara costo y gastos sin signo', () => {
  const { leerLibro, comparar } = require('../scripts/cuadra-estado-resultados');
  const filas = [
    ['ESTADO DE RESULTADOS', '', ''],
    ['Total Ventas', 'x', 1000],
    ['Costo de Ventas', '', 800],
    ['UTILIDAD BRUTA', '', 200],
    ['Gastos Operación', '', 90],
    ['Gastos Administración', '', 30],
    ['Suma gastos', '', 120],
    ['Utilidad de Operación', '', 80],
    ['Utilidad', '', 75],
  ];
  const libro = leerLibro(filas);
  assert.equal(libro.costo.renglon, 3);
  const r = comparar(libro, {
    ventas: 1000, costo: -800, utilidadBruta: 200, gastosOperacion: -90, gastosAdministracion: -30, gastos: -120, utilidadOperacion: 80, utilidadNeta: 70,
  });
  const estado = Object.fromEntries(r.map((x) => [x.key, x.estado]));
  assert.equal(estado.costo, 'ok');
  assert.equal(estado.gastos, 'ok');
  assert.equal(estado.utilidadNeta, 'difiere');
  assert.equal(r.find((x) => x.key === 'utilidadNeta').diferencia, -5);
});
