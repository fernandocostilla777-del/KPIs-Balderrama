const test = require('node:test');
const assert = require('node:assert/strict');
const { MODOS, seleccionar } = require('../src/services/conexionOrigen');

test('las tres conexiones son local, remota y la nube', () => {
  assert.equal(MODOS.local.host, '192.168.0.2');
  assert.equal(MODOS.remota.host, '189.197.60.78');
  assert.equal(MODOS.nube.disponible, false);
  assert.equal(MODOS.nube.nota, 'Próximamente');
});

test('la nube no se puede activar', async () => {
  await assert.rejects(
    () => seleccionar('nube', { probar: async () => {} }),
    (err) => err.status === 400 && /próxima/i.test(err.message),
  );
});
