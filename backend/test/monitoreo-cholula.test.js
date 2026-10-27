const test = require('node:test');
const assert = require('node:assert/strict');
const { fusionar, mismoNombre, personTokenKey } = require('../src/services/monitoreoCholulaService');

test('une el nombre del DMS con el del CRM aunque el orden cambie', () => {
  const grupos = fusionar([
    {
      key: 'a',
      vendedor: 'PEREZ LOPEZ JUAN',
      aliases: ['PEREZ LOPEZ JUAN'],
      ventas: 2,
      ventasRetail: 2,
      ventasFlotilla: 0,
      leads: 0,
      contactados: 0,
      citas: 0,
      citasAsistidas: 0,
      cotizaciones: 0,
      comprasLead: 0,
      pruebas: 0,
      solicitudes: 0,
      solicitudesAprobadas: 0,
      visitas: 0,
      seguimientos: 0,
    },
    {
      key: 'b',
      vendedor: 'Juan Perez Lopez',
      aliases: ['JUAN PEREZ LOPEZ'],
      ventas: 0,
      ventasRetail: 0,
      ventasFlotilla: 0,
      leads: 4,
      contactados: 3,
      citas: 1,
      citasAsistidas: 1,
      cotizaciones: 1,
      comprasLead: 1,
      pruebas: 2,
      solicitudes: 1,
      solicitudesAprobadas: 1,
      visitas: 5,
      seguimientos: 6,
    },
  ]);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].ventas, 2);
  assert.equal(grupos[0].leads, 4);
  assert.equal(grupos[0].pruebas, 2);
  assert.ok(grupos[0].aliases.includes('PEREZ LOPEZ JUAN'));
  assert.ok(grupos[0].aliases.includes('JUAN PEREZ LOPEZ'));
});

test('no mezcla a dos personas que solo comparten un apellido', () => {
  assert.equal(mismoNombre('PEREZ JUAN', 'PEREZ ANA'), false);
  assert.equal(personTokenKey('García López Ana'), personTokenKey('ANA GARCIA LOPEZ'));
});

test('el perfil Cholula queda acotado a su sucursal y a Ventas', () => {
  const { ROLE_DEFAULTS, getRole } = require('../src/auth/roles');
  const { alcanceDeRol, filtrarFilasCanal, sqlCrmSucursal } = require('../src/auth/alcanceSucursal');
  const perfil = alcanceDeRol('cholula');
  assert.equal(perfil.canalVenta, 'CHOLULA');
  assert.equal(ROLE_DEFAULTS.cholula.alcanceSucursal, 'cholula');
  assert.ok(ROLE_DEFAULTS.cholula.pages.includes('sales'));
  assert.ok(ROLE_DEFAULTS.cholula.pages.includes('inventory'));
  assert.ok(getRole('cholula').apiPrefixes.includes('/inventory'));
  assert.equal(getRole('cholula').homePath, '/sales.html');
  assert.equal(getRole('cholula').alcanceSucursal, 'cholula');
  assert.deepEqual(
    filtrarFilasCanal([
      { CANAL_VENTA: 'CHOLULA', VTE_DOCTO: '1' },
      { CANAL_VENTA: 'PISO', VTE_DOCTO: '2' },
    ], 'CHOLULA').map((r) => r.VTE_DOCTO),
    ['1'],
  );
  const sql = sqlCrmSucursal("CHOLULA' OR 1=1");
  assert.equal(sql.params[0].includes("'"), false);
  assert.match(sql.params[0], /^[A-Z0-9 ]+$/);
});
