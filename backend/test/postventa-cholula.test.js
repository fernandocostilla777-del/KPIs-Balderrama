'use strict';
/**
 * PostVenta del perfil Cholula: solo Servicio de su taller (folios Y normal y X reparación).
 * Órdenes sintéticas; no se consulta el DMS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { acotarPorLetras, acotarMesCurso } = require('../src/services/postSalesService');
const router = require('../src/routes/api');
const { getRole } = require('../src/auth/roles');

const orden = (folio, status = 'I') => ({ orden: folio, letraOrden: folio.charAt(0), status, importe: 1000 });

function rawSintetico() {
  const records = [orden('Y1'), orden('X2', 'A'), orden('N3'), orden('D4'), orden('Q5'), orden('A6')];
  return {
    filtros: { fechaInicio: '2026-10-01', fechaFin: '2026-10-31' },
    records,
    recordsYtd: [...records, orden('Y7'), orden('C8')],
    openSnapshot: [orden('X2', 'A'), orden('N9', 'T'), orden('Y10', 'P')],
    mesCursoNomenclatura: {
      letras: ['N', 'D', 'Q', 'C', 'X', 'Y'],
      labels: { N: 'Normal', D: 'Reparación', Q: 'Normal Zacatelco', C: 'Reparación Zacatelco', X: 'Reparación Cholula', Y: 'Normal Cholula' },
      days: [
        { fecha: '2026-10-01', fechaLabel: '01/10/2026', N: 3, D: 2, Q: 1, C: 0, X: 1, Y: 2, total: 9, acumulado: 9 },
        { fecha: '2026-10-02', fechaLabel: '02/10/2026', N: 1, D: 0, Q: 0, C: 1, X: 0, Y: 1, total: 3, acumulado: 12 },
      ],
      totals: { N: 4, D: 2, Q: 1, C: 1, X: 1, Y: 3, total: 12, acumulado: 12 },
    },
    total: 6,
    openTotal: 3,
  };
}

test('acotar: periodo, año y abiertas de hoy solo con folios Y y X', () => {
  const r = acotarPorLetras(rawSintetico(), ['Y', 'X']);
  assert.deepEqual(r.records.map((x) => x.orden), ['Y1', 'X2']);
  assert.deepEqual(r.recordsYtd.map((x) => x.orden), ['Y1', 'X2', 'Y7']);
  assert.deepEqual(r.openSnapshot.map((x) => x.orden), ['X2', 'Y10']);
  assert.equal(r.total, 2);
  assert.equal(r.openTotal, 2);
  assert.deepEqual(r.alcance.letras, ['Y', 'X']);
});

test('acotar: el acumulado del mes queda con columnas Y, X y totales recalculados', () => {
  const mes = acotarPorLetras(rawSintetico(), ['Y', 'X']).mesCursoNomenclatura;
  assert.deepEqual(mes.letras, ['Y', 'X']);
  assert.deepEqual(Object.keys(mes.labels), ['Y', 'X']);
  assert.deepEqual(mes.days.map((d) => [d.total, d.acumulado]), [[3, 3], [1, 4]]);
  assert.equal(mes.days[0].N, undefined);
  assert.deepEqual({ Y: mes.totals.Y, X: mes.totals.X, total: mes.totals.total }, { Y: 3, X: 1, total: 4 });
});

test('sin letras no se toca la respuesta de la agencia', () => {
  const raw = rawSintetico();
  assert.equal(acotarPorLetras(raw, null), raw);
  assert.equal(acotarPorLetras(raw, []), raw);
  assert.equal(acotarMesCurso(null, ['Y']), null);
});

test('acotar no modifica los arreglos originales (pueden venir de caché)', () => {
  const raw = rawSintetico();
  acotarPorLetras(raw, ['Y', 'X']);
  assert.equal(raw.records.length, 6);
  assert.equal(raw.mesCursoNomenclatura.days[0].N, 3);
});

function correr(url, role) {
  return new Promise((resolve) => {
    const [path, qs] = url.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const req = { method: 'GET', url, originalUrl: url, path, query, params: {}, headers: {}, session: { username: 'x', role } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      setHeader() {}, getHeader() {}, end() { resolve({ status: this.statusCode }); },
    };
    router.handle(req, res, () => resolve({ status: 'siguiente' }));
  });
}

test('Cholula recibe 403 en HyP y Refacciones (son de toda la agencia)', async () => {
  const q = '?fechaInicio=2026-10-01&fechaFin=2026-10-31';
  for (const url of [
    `/post-sales/refacciones${q}`,
    `/post-sales/refacciones-pedidos${q}`,
    `/post-sales/hyp/aseguradoras-cobranza${q}`,
    `/post-sales/hyp/garantias-cobranza${q}`,
    `/post-sales/hyp/cuadre-ordenes${q}`,
  ]) {
    const r = await correr(url, 'cholula');
    assert.equal(r.status, 403, url);
  }
});

test('Cholula no abre el detalle de una orden de otro taller', async () => {
  for (const folio of ['N123', 'D55', 'A77']) {
    const r = await correr(`/post-sales/orden/${folio}`, 'cholula');
    assert.equal(r.status, 403, folio);
  }
});

test('Dirección pasa el bloqueo de Refacciones (sin fechas la ruta responde 400)', async () => {
  const r = await correr('/post-sales/refacciones', 'direccion');
  assert.equal(r.status, 400);
});

test('el perfil Cholula trae PostVenta en su menú y su prefijo de API', () => {
  const rol = getRole('cholula');
  assert.ok(rol.pages.includes('post-sales'));
  assert.ok(rol.apiPrefixes.includes('/post-sales'));
});
