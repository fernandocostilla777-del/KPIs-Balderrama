'use strict';
/**
 * Contabilidad › Departamentos y presupuesto (eeff.js), con datos sintéticos:
 * - la tabla por departamento cuadra con la utilidad de operación de la agencia;
 * - en real contra presupuesto, gastar menos que el presupuesto se pinta a favor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { payloadSintetico } = require('./helpers/eeffSintetico');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'js', 'eeff.js'), 'utf8');

function cargarEeff() {
  const nada = () => null;
  const document = { getElementById: nada, querySelector: nada, querySelectorAll: () => [], addEventListener() {} };
  const window = { location: { search: '', href: 'http://localhost/contabilidad.html' }, history: { replaceState() {} } };
  const ctx = vm.createContext({ document, window, console, URL, URLSearchParams, Dashboard: {} });
  vm.runInContext(SRC, ctx);
  return ctx;
}

test('departamentos: la suma de los renglones es la utilidad de operación de la agencia', () => {
  const ctx = cargarEeff();
  const data = payloadSintetico();
  const { filas, total } = ctx.filasDepartamentos(data);
  const suma = filas.reduce((t, f) => t + f.utilidadOperacion, 0);
  assert.equal(Math.round(suma), Math.round(total.utilidadOperacion));
  // El sintético no prorratea la administración: debe aparecer como renglón, no esconderse.
  const ajuste = filas.find((f) => f.ajuste);
  assert.ok(ajuste, 'falta el renglón de administración sin prorratear');
  assert.equal(Math.round(ajuste.utilidadOperacion), -Math.round(data.estadoFinanciero.summary.gastosAdministracion));
  assert.equal(filas.filter((f) => !f.ajuste).map((f) => f.id).join(','), 'autosNuevos,seminuevos,postventa');
});

test('departamentos: sin diferencia no se agrega el renglón de ajuste', () => {
  const ctx = cargarEeff();
  const data = payloadSintetico();
  const e = data.estadoFinanciero.summary;
  const deptos = [data.ventas.totalVentasAutos.summary, data.seminuevos.summary, data.postventa.summary];
  e.utilidadOperacion = deptos.reduce((t, r) => t + r.utilidadOperacion, 0);
  const { filas } = ctx.filasDepartamentos(data);
  assert.equal(filas.some((f) => f.ajuste), false);
});

test('real contra presupuesto: en costos y gastos, quedar abajo del presupuesto es a favor', () => {
  const ctx = cargarEeff();
  assert.equal(ctx.favorClass(-100, ctx.esEgreso('costoTotal')), 'cell-positive');
  assert.equal(ctx.favorClass(100, ctx.esEgreso('sumaGastos')), 'cell-negative');
  assert.equal(ctx.favorClass(-100, ctx.esEgreso('x', 'gasto')), 'cell-positive');
  assert.equal(ctx.favorClass(-100, ctx.esEgreso('ventasTotales', 'ingreso')), 'cell-negative');
  assert.equal(ctx.favorClass(100, ctx.esEgreso('utilidadOperacion', 'resultado')), 'cell-positive');
  assert.equal(ctx.favorClass(0, false), '');
});

test('la comparativa conserva el grupo de cada renglón para pintar la variación', () => {
  const svc = require('../src/services/budget2026Service');
  const original = svc.getBudgetForPeriod;
  const data = payloadSintetico();
  data.estadoFinanciero.lines = [
    { key: 'ventasTotales', label: 'Total ventas', value: 100, group: 'ingreso' },
    { key: 'costoTotal', label: 'Costo de ventas', value: 80, group: 'costo' },
  ];
  delete require.cache[require.resolve('../src/services/eeffComparativaService')];
  svc.getBudgetForPeriod = () => ({
    available: true, mesesIncluidos: [1], factorPeriodo: 1 / 12,
    estadoFinanciero: { summary: {}, lines: [{ key: 'costoTotal', value: 90 }] },
    ventas: { menudeo: {}, flotillas: {}, intercambios: {}, totalVentasAutos: {} },
    postventa: { summary: {}, sections: [] },
  });
  try {
    const { buildEeffComparativa } = require('../src/services/eeffComparativaService');
    const cmp = buildEeffComparativa(data, '2026-01-01', '2026-01-31');
    const costo = cmp.estadoFinanciero.lines.find((l) => l.key === 'costoTotal');
    assert.equal(costo.group, 'costo');
    assert.equal(costo.variacion, -10);
  } finally {
    svc.getBudgetForPeriod = original;
    delete require.cache[require.resolve('../src/services/eeffComparativaService')];
  }
});
