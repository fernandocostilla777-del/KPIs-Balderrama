'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collapsePorCanal } = require('../src/services/ytd-comparativo');

test('el YTD de Cholula suma solo facturas CH y deja fuera el resto', () => {
  const rows = [
    { anio: 2026, mes: 1, cnt: 2, FORMAPAGO_ORIGINAL: 'CHCRE', VENDEDOR: 'ALVARADO MARTINEZ VERONICA' },
    { anio: 2026, mes: 1, cnt: 5, FORMAPAGO_ORIGINAL: 'PISO', VENDEDOR: 'OTRO VENDEDOR' },
    { anio: 2026, mes: 2, cnt: 1, FORMAPAGO_ORIGINAL: 'CHCON', VENDEDOR: 'BOLIVAR OLAIZ SIMON' },
    { anio: 2025, mes: 1, cnt: 3, FORMAPAGO_ORIGINAL: 'CH', VENDEDOR: 'REYES AGUILAR LAURA VIVIANA' },
  ];
  const out = collapsePorCanal(rows, 'CHOLULA');
  const ene = out.find((r) => r.anio === 2026 && r.mes === 1);
  const feb = out.find((r) => r.anio === 2026 && r.mes === 2);
  const prev = out.find((r) => r.anio === 2025 && r.mes === 1);
  assert.equal(ene.cnt, 2);
  assert.equal(feb.cnt, 1);
  assert.equal(prev.cnt, 3);
  assert.equal(out.length, 3);
});
