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

const { periodoAnterior, nombreVisible, conTasas } = require('../src/services/monitoreoCholulaService');

test('el periodo anterior es el mes previo o los mismos días justo antes', () => {
  assert.deepEqual(periodoAnterior('2026-09-01', '2026-09-30'), { fechaInicio: '2026-08-01', fechaFin: '2026-08-31' });
  assert.deepEqual(periodoAnterior('2026-03-01', '2026-03-31'), { fechaInicio: '2026-02-01', fechaFin: '2026-02-28' });
  assert.deepEqual(periodoAnterior('2026-01-01', '2026-03-31'), { fechaInicio: '2025-10-01', fechaFin: '2025-12-31' });
  assert.deepEqual(periodoAnterior('2026-03-10', '2026-03-19'), { fechaInicio: '2026-02-28', fechaFin: '2026-03-09' });
});

test('los nombres en mayúsculas del DMS se muestran legibles', () => {
  assert.equal(nombreVisible('ORTEGA SALAS LUIS'), 'Ortega Salas Luis');
  assert.equal(nombreVisible('MARIA DE LA CRUZ'), 'Maria de la Cruz');
  assert.equal(nombreVisible('Ana López'), 'Ana López');
});

test('las tasas no se inventan cuando no hay base', () => {
  const sinBase = conTasas({ leads: 0, contactados: 0, citas: 0, comprasLead: 0, solicitudes: 3, solicitudesAprobadas: 1, ventas: 4, ventasAnterior: 0 });
  assert.equal(sinBase.pctContacto, null);
  assert.equal(sinBase.pctCierreLead, null);
  assert.equal(sinBase.variacionVentasPct, null);
  assert.equal(sinBase.pctAprobacion, 33.3);
  const conBase = conTasas({ leads: 8, contactados: 6, citas: 3, comprasLead: 1, solicitudes: 0, solicitudesAprobadas: 0, ventas: 3, ventasAnterior: 4 });
  assert.equal(conBase.pctContacto, 75);
  assert.equal(conBase.pctCita, 50);
  assert.equal(conBase.pctCierreLead, 12.5);
  assert.equal(conBase.variacionVentasPct, -25);
});
