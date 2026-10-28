const test = require('node:test');
const assert = require('node:assert/strict');
const { PERFILES } = require('../src/auth/alcanceSucursal');
const { ROLE_DEFAULTS, canAccessPage, canAccessApi } = require('../src/auth/roles');
const { clausulaUbicacion } = require('../src/services/inventorySeminuevosService');

test('Cholula toma los seminuevos de la ubicacion O4 del DMS', () => {
  assert.equal(PERFILES.cholula.inventarioUbicacion, 'O4');
  assert.equal(clausulaUbicacion('v', 'O4'), " AND LTRIM(RTRIM(ISNULL(v.VEH_UBICACION, ''))) = 'O4'");
  assert.equal(clausulaUbicacion('v', ''), '');
  assert.throws(() => clausulaUbicacion('v', "O4' OR 1=1"), /no válida/);
});

test('Cholula no tiene el módulo de contabilidad', () => {
  assert.equal(ROLE_DEFAULTS.cholula.pages.includes('contabilidad'), false);
  assert.equal(canAccessPage('cholula', 'contabilidad'), false);
  assert.equal(canAccessApi('cholula', '/api/contabilidad'), false);
  assert.equal(canAccessApi('cholula', '/api/eeff'), false);
  assert.equal(canAccessPage('cholula', 'sales'), true);
});