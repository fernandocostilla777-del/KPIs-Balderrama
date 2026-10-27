'use strict';
/** Financiamiento no trae sucursal: un perfil de sucursal recibe 403 en todas sus rutas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/routes/api');

function correr(url, role) {
  return new Promise((resolve) => {
    const req = { method: 'GET', url, originalUrl: url, path: url.split('?')[0], query: {}, params: {}, headers: {}, session: { username: 'x', role } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      setHeader() {}, getHeader() {}, end() { resolve({ status: this.statusCode }); },
    };
    router.handle(req, res, () => resolve({ status: 'siguiente' }));
  });
}

test('Cholula recibe 403 en financiamiento y sus subrutas', async () => {
  for (const url of ['/ventas/financiamiento?fechaInicio=2026-09-01&fechaFin=2026-09-30', '/ventas/financiamiento/gerentes', '/ventas/financiamiento/factura/F1', '/ventas/financiamiento/notas']) {
    const r = await correr(url, 'cholula');
    assert.equal(r.status, 403, url);
  }
});

test('Dirección sí pasa el filtro de financiamiento', async () => {
  // Sin fechas la ruta responde 400: llegó a la ruta, no la frenó el bloqueo.
  const r = await correr('/ventas/financiamiento', 'direccion');
  assert.equal(r.status, 400);
});
