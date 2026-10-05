'use strict';
/**
 * Pruebas de las alertas inteligentes (intelligentInsightsService).
 * Ejecutar:  npm test --prefix backend   (usa node:test, sin dependencias extra)
 *
 * Cubren los umbrales que disparan alertas de Seguimiento 360 y las
 * garantías generales (forma de cada alerta, módulos sin datos, anclaje).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/intelligentInsightsService');
const { buildInsights, buildSeguimientoInsights, expectedPacePct } = svc;

const ids = (list) => list.map((i) => i.kpiId);
const byKpi = (list, kpiId) => list.find((i) => i.kpiId === kpiId);

/* ───────── Seguimiento 360 · cierres de taller (inicio) ───────── */

test('cierres: alerta cuando menos de 50% de clientes trae ID CRM', () => {
  const out = buildSeguimientoInsights({
    vista: 'cierres',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    totales: { ordenesCerradas: 38, clientes: 12, clientesConIdCrm: 5 },
  });
  const a = byKpi(out, 'kCierreCrm');
  assert.ok(a, 'debe existir la alerta de cierres sin ID CRM');
  assert.equal(a.severity, 'warning');
  assert.match(a.summary, /41\.7%/);
  assert.deepEqual({ ...a.metrics }, { ordenes: 38, clientes: 12, conCrm: 5, pct: 41.7 });
});

/* ───────── Seguimiento 360 · P-VTA-4 maduración (inicio) ───────── */

test('maduracion: cobertura < 100% dispara kCobertura; < 85% es crítica', () => {
  const base = {
    vista: 'maduracion',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    general: { n: 40, promedio: 30 },
    origenes: { cartera: { mezclaPct: 30 }, lead: { mezclaPct: 50 } },
  };
  const warn = buildSeguimientoInsights({
    ...base,
    cobertura: { aplica: true, pct: 90, faltante: 20, esperadas: 18, horizonteDias: 12, objetivo: 120, facturadas: 100, prospectosActivos: 300, prospectosMaduros: 120, prospectosNecesarios: 34 },
  });
  const a = byKpi(warn, 'kCobertura');
  assert.ok(a, 'debe existir la alerta de cobertura');
  assert.equal(a.severity, 'warning');
  assert.match(a.summary, /90%/);

  const crit = buildSeguimientoInsights({
    ...base,
    cobertura: { aplica: true, pct: 40, faltante: 20, esperadas: 8, horizonteDias: 12, objetivo: 120, facturadas: 100, prospectosActivos: 300 },
  });
  assert.equal(byKpi(crit, 'kCobertura').severity, 'critical');

  const cerrado = buildSeguimientoInsights({
    ...base,
    cobertura: { aplica: false, periodoCerrado: true, pct: null, faltante: 20 },
  });
  assert.equal(byKpi(cerrado, 'kCobertura'), undefined, 'periodo cerrado no alerta');
});

test('maduracion: alza del móvil 3 meses (+20%) dispara kMaduracion; cambio de mezcla dispara kMaduracionOrigen', () => {
  const out = buildSeguimientoInsights({
    vista: 'maduracion',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    general: { n: 40, promedio: 60 },
    movil3: { n: 120, promedio: 60 },
    historico: { n: 400, promedio: 45 },
    origenes: { cartera: { mezclaPct: 45 }, lead: { mezclaPct: 30 } },
    mezclaCarteraPrevia: 20,
    cobertura: { aplica: false },
  });
  const alza = byKpi(out, 'kMaduracion');
  assert.ok(alza, 'debe existir la alerta de maduración al alza');
  assert.equal(alza.metrics.variacionPct, 33.3);
  const mezcla = byKpi(out, 'kMaduracionOrigen');
  assert.ok(mezcla, 'debe existir la alerta de cambio de mezcla');
  assert.equal(mezcla.severity, 'info');

  const estable = buildSeguimientoInsights({
    vista: 'maduracion',
    general: { n: 40, promedio: 46 },
    movil3: { n: 120, promedio: 46 },
    historico: { n: 400, promedio: 45 },
    origenes: { cartera: { mezclaPct: 22 } },
    mezclaCarteraPrevia: 20,
    cobertura: { aplica: false },
  });
  assert.deepEqual(ids(estable), []);
});

test('cierres: sin alerta con 50% o más de cobertura', () => {
  const out = buildSeguimientoInsights({
    vista: 'cierres',
    totales: { ordenesCerradas: 20, clientes: 10, clientesConIdCrm: 5 },
  });
  assert.equal(out.length, 0);
});

test('cierres: sin alerta con menos de 5 clientes (muestra pequeña)', () => {
  const out = buildSeguimientoInsights({
    vista: 'cierres',
    totales: { ordenesCerradas: 4, clientes: 4, clientesConIdCrm: 0 },
  });
  assert.equal(out.length, 0);
});

test('cierres: anchorCrm mueve la alerta a otra tarjeta; por defecto kCierreCrm', () => {
  const base = { vista: 'cierres', totales: { clientes: 10, clientesConIdCrm: 1 } };
  assert.deepEqual(ids(buildSeguimientoInsights(base)), ['kCierreCrm']);
  assert.deepEqual(
    ids(buildSeguimientoInsights({ ...base, anchorCrm: 'emptyCardCrm' })),
    ['emptyCardCrm']
  );
});

/* ───────── Seguimiento 360 · vendedor ───────── */

test('vendedor: leads sin ventas en libro dispara kVendLibro', () => {
  const out = buildSeguimientoInsights({
    vista: 'vendedor',
    vendedor: 'Ana',
    totales: { leads: 12, solicitudes: 3, pruebas: 2 },
    comercial: { libroVentas: { unidades: 0 } },
  });
  assert.ok(byKpi(out, 'kVendLibro'));
});

test('vendedor: pruebas de manejo sin solicitudes dispara kVendPruebas', () => {
  const out = buildSeguimientoInsights({
    vista: 'vendedor',
    totales: { leads: 2, solicitudes: 0, pruebas: 6 },
    comercial: { libroVentas: { unidades: 5 } },
  });
  assert.ok(byKpi(out, 'kVendPruebas'));
});

test('vendedor: contratos con baja penetración de PVA dispara kVendPvas', () => {
  const out = buildSeguimientoInsights({
    vista: 'vendedor',
    totales: {},
    comercial: {
      libroVentas: { unidades: 6 },
      financiamiento: { contratos: 4, pvas: { promedioCantidadPvas: 0.2, penetracionPct: 50 } },
    },
  });
  assert.ok(byKpi(out, 'kVendPvas'));
});

test('vendedor: bajo retorno a taller (<25%) con cartera suficiente dispara kVendRetorno', () => {
  const out = buildSeguimientoInsights({
    vista: 'vendedor',
    totales: {},
    comercial: { retornoTaller: { tasaRetornoPct: 10, clientesConCompra: 20 } },
  });
  assert.ok(byKpi(out, 'kVendRetorno'));
});

test('vendedor: desempeño sano no genera alertas', () => {
  const out = buildSeguimientoInsights({
    vista: 'vendedor',
    totales: { leads: 20, solicitudes: 8, pruebas: 6 },
    comercial: {
      libroVentas: { unidades: 9 },
      financiamiento: { contratos: 5, pvas: { promedioCantidadPvas: 1.4, penetracionPct: 70 } },
      retornoTaller: { tasaRetornoPct: 60, clientesConCompra: 30 },
    },
  });
  assert.equal(out.length, 0);
});

/* ───────── Seguimiento 360 · cliente ───────── */

test('cliente: prueba de manejo sin compra ni solicitud dispara kPruebasManejo', () => {
  const out = buildSeguimientoInsights({
    vista: 'cliente',
    idContacto: 'C1',
    resumen: { totalPruebasManejo: 2, totalCompras: 0, totalSolicitudes: 0 },
  });
  const a = byKpi(out, 'kPruebasManejo');
  assert.ok(a);
  assert.equal(a.severity, 'info');
});

/* ───────── Garantías generales ───────── */

test('inventario: costo y cobertura anclan las tarjetas nuevas', () => {
  const out = buildInsights({
    module: 'inventario',
    summary: {
      ageingAlertsCount: 6,
      pct90: 40,
      antiguedadConcentrada: [{ carline: 'Onix', r90: 4, total: 6, pct90: 66.7 }],
      costoCandidatas: 2,
      costoAcumulado60: 120000,
      costoDiario60: 400,
      costoCandidatasDetalle: [{ vin: 'ABC123', carline: 'Onix', pctCosto: 45 }],
      coberturaQuiebre: ['Aveo'],
      coberturaSobrestock: ['Tahoe'],
      coberturaSinVentas: ['Express'],
      coberturaDias: 70,
      coberturaFuera: 2,
    },
  });
  const edad = byKpi(out, 'kpiAgeingAlerts');
  assert.ok(edad);
  assert.match(edad.summary, /Onix/);
  const costo = byKpi(out, 'kCostoInventario');
  assert.ok(costo);
  assert.equal(costo.id, 'inv-costo-piso');
  const cob = byKpi(out, 'kCobertura');
  assert.ok(cob);
  assert.equal(cob.id, 'inv-dias-venta');
  assert.match(cob.summary, /Aveo/);
  assert.match(cob.summary, /Tahoe/);
  assert.match(cob.summary, /sin ventas/);
});

test('módulo desconocido o vacío devuelve lista vacía', () => {
  assert.deepEqual(buildInsights({ module: 'no-existe' }), []);
  assert.deepEqual(buildInsights({}), []);
});

test('ningún módulo truena con payload vacío y cada alerta trae la forma esperada', () => {
  const modules = [
    'ventas', 'contabilidad', 'overview', 'inventario', 'forecast',
    'postventa', 'seguimiento', 'marketing',
  ];
  for (const module of modules) {
    let out;
    assert.doesNotThrow(() => { out = buildInsights({ module, roleId: 'administracion' }); }, module);
    assert.ok(Array.isArray(out), `${module} debe devolver arreglo`);
    for (const a of out) {
      assert.ok(a.kpiId, `${module}: alerta sin kpiId`);
      assert.ok(a.title, `${module}/${a.kpiId}: sin title`);
      assert.ok(Array.isArray(a.recommendations), `${module}/${a.kpiId}: recommendations debe ser arreglo`);
    }
  }
});

test('buildInsights conserva el anclaje y agrega semáforo con rol de administración', () => {
  const out = buildInsights({
    module: 'seguimiento',
    roleId: 'administracion',
    vista: 'cierres',
    anchorCrm: 'emptyCardCrm',
    totales: { clientes: 10, clientesConIdCrm: 2 },
  });
  const a = byKpi(out, 'emptyCardCrm');
  assert.ok(a, 'la alerta debe llegar al frontend con el ancla pedida');
  assert.ok(a.severity);
});

/* ───────── Utilidades de periodo ───────── */

test('expectedPacePct: fechas inválidas -> null; periodo pasado -> 100; futuro -> 0', () => {
  assert.equal(expectedPacePct(null, null), null);
  assert.equal(expectedPacePct('2026-10-31', '2026-10-01'), null);
  assert.equal(expectedPacePct('2020-01-01', '2020-01-31'), 100);
  assert.equal(expectedPacePct('2999-01-01', '2999-01-31'), 0);
});
