'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filtrarSofiaPorCanal } = require('../src/services/sofia-entregas');

test('Cholula se queda con las notificaciones cuya factura es CH', () => {
  const sofia = {
    registrosEntrega: [
      { FORMAPAGO_ORIGINAL: 'CHCRE', PREVIAS: 0, SOF_FechAct: '03/10/2026' },
      { FORMAPAGO_ORIGINAL: 'PISO', PREVIAS: 1, SOF_FechAct: '04/10/2026' },
      { FORMAPAGO_ORIGINAL: 'CHCON', PREVIAS: 2, SOF_FechAct: '11/10/2026' },
      { FORMAPAGO_ORIGINAL: '', PREVIAS: 0, SOF_FechAct: '12/10/2026' },
    ],
    entregasPorMes: [
      { key: '2026-10', label: 'Octubre 2026', count: 4 },
    ],
    totalNotificacionesEntrega: 4,
  };
  const out = filtrarSofiaPorCanal(sofia, 'CHOLULA');
  assert.equal(out.registrosEntrega.length, 2);
  assert.equal(out.totalNotificacionesEntrega, 2);
  assert.equal(out.totalEntregasSinPrevias, 1);
  assert.equal(out.totalEntregasConPrevias, 1);
  assert.equal(out.entregasPorMes[0].count, 2);
  assert.equal(sofia.registrosEntrega.length, 4);
});
