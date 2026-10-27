'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getRolePermissionsPayload } = require('../src/auth/roles');

test('permisos por rol entrega el catálogo CRUD y conserva pages derivadas de leer', () => {
  const payload = getRolePermissionsPayload();
  assert.deepEqual(
    payload.actionCatalog.map((action) => action.id),
    ['crear', 'leer', 'actualizar', 'eliminar', 'asignar', 'exportar'],
  );

  for (const [roleId, config] of Object.entries(payload.byRole)) {
    const pages = Object.entries(config.actions)
      .filter(([, actions]) => actions.includes('leer'))
      .map(([pageId]) => pageId);
    assert.deepEqual(config.pages, pages, `${roleId}: pages debe derivarse de leer`);
  }
});

test('administración conserva la lectura del módulo Administración', () => {
  const admin = getRolePermissionsPayload().byRole.administracion;
  assert.ok(admin.actions.admin.includes('leer'));
});
