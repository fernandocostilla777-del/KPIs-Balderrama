const test = require('node:test');
const assert = require('node:assert/strict');
const { ventanaAnioPlanta } = require('../src/config/campanasConversion');

test('septiembre 2026 cierra el anio oct 2025 a sep 2026', () => {
  const v = ventanaAnioPlanta('2026-09-30');
  assert.equal(v.desde, '2025-10-01');
  assert.equal(v.hasta, '2026-09-30');
  assert.deepEqual(v.meses.slice(0, 3), ['2025-10', '2025-11', '2025-12']);
  assert.deepEqual(v.meses.slice(-2), ['2026-08', '2026-09']);
  assert.equal(v.meses.length, 12);
});

test('octubre 2026 abre el anio siguiente', () => {
  const v = ventanaAnioPlanta('2026-10-26');
  assert.equal(v.desde, '2026-10-01');
  assert.equal(v.hasta, '2027-09-30');
  assert.equal(v.meses[0], '2026-10');
  assert.equal(v.meses[11], '2027-09');
});