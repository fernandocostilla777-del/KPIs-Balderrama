const test = require('node:test');
const assert = require('node:assert/strict');
const { MODOS, seleccionar, estadoConPrueba } = require('../src/services/conexionOrigen');

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

test('estadoConPrueba avisa si ninguna base responde', async () => {
  const data = await estadoConPrueba({
    probar: async () => {
      throw new Error('rechazado');
    },
  });
  assert.equal(data.algunaAlcanzable, false);
  assert.equal(data.conectado, false);
  assert.match(data.aviso || '', /ninguna base/i);
  const local = data.opciones.find((o) => o.id === 'local');
  assert.equal(local.alcanzable, false);
});

test('estadoConPrueba marca alcanzable cuando responde', async () => {
  const data = await estadoConPrueba({
    probar: async () => {},
  });
  assert.equal(data.algunaAlcanzable, true);
  assert.equal(data.aviso, null);
  assert.equal(data.opciones.find((o) => o.id === 'local').alcanzable, true);
  assert.equal(data.opciones.find((o) => o.id === 'nube').alcanzable, false);
});
