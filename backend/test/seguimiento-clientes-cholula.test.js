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
  CREATE TABLE crm_actividades (id INTEGER PRIMARY KEY, id_contacto TEXT, nombre_contacto TEXT, id_ciclo TEXT, fecha_inicio_ciclo TEXT,
    estatus TEXT, fecha_estatus TEXT, tipo_actividad TEXT, fecha_crea_actividad TEXT, fecha_prog_actividad TEXT,
    fecha_resp_actividad TEXT, resultado_actividad TEXT, fecha_factura TEXT, vin TEXT, fecha_entrega TEXT, vendedor TEXT);
`);
const L = db.prepare(`INSERT INTO crm_leads (id_crm, sucursal, fuerza_ventas, nombre, fecha_entrada, contacto, ejecutivo_asignado,
  cita_programada, cita_asistida, cotizacion, vin_comprado, fecha_factura) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
L.run('C1', 'CHOLULA', 'CHOLULA', 'ANA PRUEBA UNO', '2026-09-20', 'SI', 'JUNCO CASTAÑEDA MAX JALIL', 'SI', 'SI', 'SI', null, null);
L.run('C2', 'CHOLULA', 'CHOLULA', 'BETO PRUEBA DOS', '2026-09-25', 'SI', 'ADRIANA TELLEZ FLORES', 'NO', null, 'NO', null, null);
L.run('C3', 'CHOLULA', 'CHOLULA', 'CARLA PRUEBA TRES', '2026-08-01', 'NO', 'ARENAS GARZON FREDY', 'NO', null, 'NO', null, null);
L.run('C4', 'CHOLULA', 'CHOLULA', 'DIANA PRUEBA CUATRO', '2026-09-02', 'SI', 'Laura Viviana Reyes Aguilar', 'SI', 'SI', 'SI', 'VIN1', '2026-09-10');
L.run('C5', 'CHOLULA', 'CHOLULA', 'EDGAR VIEJO', '2026-05-01', 'SI', 'JUNCO CASTAÑEDA MAX JALIL', 'NO', null, 'NO', null, null);
L.run('C6', 'CHOLULA', 'CHOLULA', 'FULANO AJENO', '2026-09-20', 'SI', 'ROJAS ROBLES CINTHIA', 'SI', 'NO', 'NO', null, null);
L.run('M1', 'MATRIZ', 'MATRIZ PISO', 'OTRA SUCURSAL', '2026-09-20', 'SI', 'VENDEDOR MATRIZ', 'NO', null, 'NO', null, null);
db.prepare('INSERT INTO crm_actividades (id_contacto, fecha_resp_actividad, vendedor) VALUES (?,?,?)').run('C2', '2026-09-26', 'LUIS EJEMPLO');
db.prepare(`INSERT INTO crm_actividades (id_contacto, nombre_contacto, id_ciclo, estatus, fecha_estatus, fecha_prog_actividad, vendedor)
  VALUES (?,?,?,?,?,?,?)`).run('C1', 'ANA PRUEBA UNO', 'CIC-1', 'Ofrecimiento', '2026-09-01', '2026-09-01', 'JUNCO CASTAÑEDA MAX JALIL');
db.prepare(`INSERT INTO crm_actividades (id_contacto, nombre_contacto, id_ciclo, estatus, fecha_estatus, fecha_prog_actividad, vendedor)
  VALUES (?,?,?,?,?,?,?)`).run('C5', 'EDGAR VIEJO', 'CIC-5', 'Neg. Caliente', '2026-09-15', '2026-10-02', 'JUNCO CASTAÑEDA MAX JALIL');
db.exec(`
  CREATE TABLE crm_solicitudes (
    id INTEGER PRIMARY KEY, no_solicitud TEXT, id_crm TEXT, financiera TEXT, fecha_solicitud TEXT,
    estatus TEXT, respuesta_financiera TEXT, unidad_paquete TEXT, fecha_aprobacion TEXT, num_contrato TEXT, enganche REAL
  );
`);
const S = db.prepare(`INSERT INTO crm_solicitudes (no_solicitud, id_crm, financiera, fecha_solicitud, estatus, respuesta_financiera, unidad_paquete, num_contrato, enganche)
  VALUES (?,?,?,?,?,?,?,?,?)`);
S.run('S-1', 'C1', 'GM Financial', '2026-09-22', 'APROBADA', 'Aprobada', 'ONIX', 'CT-9', 45000);
S.run('S-2', 'C2', 'BBVA', '2026-09-21', 'RECHAZADA', 'Score', 'AVEO', null, null);
S.run('S-3', 'OTRO', 'Banorte', '2026-09-20', 'APROBADA', '', 'TRACKER', null, null);
db.close();

const m = require('../src/services/monitoreoCholulaService');

test('la cartera solo trae leads vivos de Cholula y propone una etiqueta', async () => {
  const c = await m.getCarteraCholula({ fechaFin: '2026-09-30' });
  const ids = c.clientes.map((x) => x.idCrm).sort();
  assert.deepEqual(ids, ['C1', 'C2', 'C3', 'C4', 'C5']);
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
  assert.equal(por.C1.solicitudes.length, 1);
  assert.equal(por.C1.solicitudes[0].folio, 'S-1');
  assert.equal(por.C1.solicitudes[0].aprobada, true);
  assert.equal(por.C1.solicitudes[0].financiera, 'GM Financial');
  assert.equal(por.C1.pasos.credito, true);
  assert.equal(por.C2.solicitudes.length, 1);
  assert.equal(por.C2.solicitudes[0].aprobada, false);
  assert.equal(por.C3.solicitudes.length, 0);
  assert.equal(por.C1.origen, 'ambos');
  assert.equal(por.C1.cartera.estatus, 'Ofrecimiento');
  assert.equal(por.C1.cartera.gestionVigente, false);
  assert.equal(por.C5.origen, 'cartera');
  assert.equal(por.C5.cartera.estatus, 'Neg. Caliente');
  assert.equal(por.C5.cartera.gestionVigente, true);
  assert.equal(por.C2.cartera, null);
  assert.equal(c.resumen.total, 5);
  assert.equal(c.resumen.enCartera, 2);
  assert.equal(c.resumen.leads90, 4);
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

test('se puede actualizar solo la nota sin volver a elegir etiqueta', async () => {
  m.etiquetarClienteCholula('C3', { etiqueta: 'caliente', nota: 'Primera', autor: 'cholula' });
  m.etiquetarClienteCholula('C3', { etiqueta: '', nota: 'Nota revisada', autor: 'cholula' });
  const c = await m.getCarteraCholula({ fechaFin: '2026-09-30' });
  const c3 = c.clientes.find((x) => x.idCrm === 'C3');
  assert.equal(c3.etiqueta.clave, 'caliente');
  assert.equal(c3.etiqueta.nota, 'Nota revisada');
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
  assert.throws(() => m.etiquetarClienteCholula('C6', { etiqueta: 'frio' }), (e) => e.status === 404);
});

test('la cartera con nombres y teléfonos no se publica en la réplica de la nube', () => {
  const { esRutaExcluida } = require('../src/services/cloudReplica/replicaKey');
  assert.equal(esRutaExcluida('/ventas/monitoreo-cholula/clientes'), true);
  assert.equal(esRutaExcluida('/ventas/monitoreo-cholula'), false);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
