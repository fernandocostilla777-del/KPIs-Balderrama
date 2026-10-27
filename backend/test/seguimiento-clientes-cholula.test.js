const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

// Base CRM y archivo de etiquetas sintéticos, aislados en una carpeta temporal.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartera-cholula-'));
process.env.CRM_SQLITE_PATH = path.join(dir, 'crm.db');
process.env.SEGUIMIENTO_CLIENTES_PATH = path.join(dir, 'seguimiento.json');

const db = new Database(process.env.CRM_SQLITE_PATH);
db.exec(`
  CREATE TABLE crm_leads (id INTEGER PRIMARY KEY, id_crm TEXT, sucursal TEXT, fuerza_ventas TEXT, nombre TEXT, telefono TEXT,
    campana TEXT, auto_interes TEXT, fecha_entrada TEXT, contacto TEXT, resultado TEXT, es_duplicado INTEGER DEFAULT 0,
    ejecutivo_asignado TEXT, cita_programada TEXT, cita_asistida TEXT, cotizacion TEXT, vin_comprado TEXT, fecha_factura TEXT,
    fecha_entrega TEXT, estatus_compra TEXT);
  CREATE TABLE crm_actividades (id INTEGER PRIMARY KEY, id_contacto TEXT, nombre_contacto TEXT, fecha_inicio_ciclo TEXT,
    estatus TEXT, fecha_estatus TEXT, tipo_actividad TEXT, fecha_crea_actividad TEXT, fecha_prog_actividad TEXT,
    fecha_resp_actividad TEXT, resultado_actividad TEXT, fecha_factura TEXT, vin TEXT, fecha_entrega TEXT, vendedor TEXT);
`);
const L = db.prepare(`INSERT INTO crm_leads (id_crm, sucursal, fuerza_ventas, nombre, fecha_entrada, contacto, ejecutivo_asignado,
  cita_programada, cita_asistida, cotizacion, vin_comprado, fecha_factura) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
L.run('C1', 'CHOLULA', 'CHOLULA', 'ANA PRUEBA UNO', '2026-09-20', 'SI', 'LUIS EJEMPLO', 'SI', 'SI', 'SI', null, null);
L.run('C2', 'CHOLULA', 'CHOLULA', 'BETO PRUEBA DOS', '2026-09-25', 'SI', 'LUIS EJEMPLO', 'NO', null, 'NO', null, null);
L.run('C3', 'CHOLULA', 'CHOLULA', 'CARLA PRUEBA TRES', '2026-08-01', 'NO', 'LUIS EJEMPLO', 'NO', null, 'NO', null, null);
L.run('C4', 'CHOLULA', 'CHOLULA', 'DIANA PRUEBA CUATRO', '2026-09-02', 'SI', 'LUIS EJEMPLO', 'SI', 'SI', 'SI', 'VIN1', '2026-09-10');
L.run('C5', 'CHOLULA', 'CHOLULA', 'EDGAR VIEJO', '2026-05-01', 'SI', 'LUIS EJEMPLO', 'NO', null, 'NO', null, null);
L.run('M1', 'MATRIZ', 'MATRIZ PISO', 'OTRA SUCURSAL', '2026-09-20', 'SI', 'VENDEDOR MATRIZ', 'NO', null, 'NO', null, null);
db.prepare('INSERT INTO crm_actividades (id_contacto, fecha_resp_actividad, vendedor) VALUES (?,?,?)').run('C2', '2026-09-26', 'LUIS EJEMPLO');
db.close();

const m = require('../src/services/monitoreoCholulaService');

test('la cartera solo trae leads vivos de Cholula y propone una etiqueta', async () => {
  const c = await m.getCarteraCholula({ fechaFin: '2026-09-30' });
  const ids = c.clientes.map((x) => x.idCrm).sort();
  assert.deepEqual(ids, ['C1', 'C2', 'C3', 'C4']);
  const por = Object.fromEntries(c.clientes.map((x) => [x.idCrm, x]));
  assert.equal(por.C1.etiqueta.clave, 'caliente');
  assert.equal(por.C1.etiqueta.origen, 'sugerida');
  assert.equal(por.C2.etiqueta.clave, 'seguimiento');
  assert.equal(por.C2.diasSinSeguimiento, 4);
  assert.equal(por.C3.etiqueta.clave, 'frio');
  assert.equal(por.C4.etiqueta.clave, 'compro');
  assert.equal(por.C4.etiqueta.origen, 'crm');
  assert.equal(por.C1.alertaSeguimiento, true, 'caliente sin seguimiento registrado');
  assert.equal(por.C2.alertaSeguimiento, false);
  assert.equal(por.C1.cliente, 'Ana Prueba Uno');
  assert.equal(c.resumen.total, 4);
});

test('el equipo pone la etiqueta y queda el historial', async () => {
  m.etiquetarClienteCholula('C3', { etiqueta: 'seguimiento', nota: 'Llamar el lunes', autor: 'cholula' });
  m.etiquetarClienteCholula('C3', { etiqueta: 'no_compra', motivo: 'otra_agencia', autor: 'cholula' });
  const c = await m.getCarteraCholula({ fechaFin: '2026-09-30' });
  const c3 = c.clientes.find((x) => x.idCrm === 'C3');
  assert.equal(c3.etiqueta.clave, 'no_compra');
  assert.equal(c3.etiqueta.origen, 'equipo');
  assert.equal(c3.etiqueta.motivoLabel, 'Compró en otra agencia');
  assert.equal(c3.historial.length, 2);
  assert.equal(c3.historial[1].nota, 'Llamar el lunes');
  // Quitar la etiqueta regresa a la sugerida.
  m.etiquetarClienteCholula('C3', { etiqueta: '', autor: 'cholula' });
  const d = await m.getCarteraCholula({ fechaFin: '2026-09-30' });
  assert.equal(d.clientes.find((x) => x.idCrm === 'C3').etiqueta.origen, 'sugerida');
});

test('la compra del CRM manda sobre la etiqueta del equipo', async () => {
  m.etiquetarClienteCholula('C4', { etiqueta: 'frio', autor: 'cholula' });
  const c = await m.getCarteraCholula({ fechaFin: '2026-09-30' });
  assert.equal(c.clientes.find((x) => x.idCrm === 'C4').etiqueta.clave, 'compro');
});

test('rechaza etiquetas no válidas y clientes de otra sucursal', () => {
  assert.throws(() => m.etiquetarClienteCholula('C1', { etiqueta: 'compro' }), /se pone solo/);
  assert.throws(() => m.etiquetarClienteCholula('C1', { etiqueta: 'no_compra' }), /por qué no va a comprar/);
  assert.throws(() => m.etiquetarClienteCholula('C1', { etiqueta: 'no_compra', motivo: 'otro' }), /nota breve/);
  assert.throws(() => m.etiquetarClienteCholula('C1', { etiqueta: 'urgente' }), /no válida/);
  assert.throws(() => m.etiquetarClienteCholula('M1', { etiqueta: 'frio' }), (e) => e.status === 404);
});

test('la cartera con nombres y teléfonos no se publica en la réplica de la nube', () => {
  const { esRutaExcluida } = require('../src/services/cloudReplica/replicaKey');
  assert.equal(esRutaExcluida('/ventas/monitoreo-cholula/clientes'), true);
  assert.equal(esRutaExcluida('/ventas/monitoreo-cholula'), false);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
