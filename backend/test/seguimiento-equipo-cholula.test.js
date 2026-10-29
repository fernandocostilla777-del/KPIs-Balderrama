const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

// CRM y archivo de seguimiento sintéticos, aislados en una carpeta temporal.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seguimiento-equipo-'));
process.env.CRM_SQLITE_PATH = path.join(dir, 'crm.db');
process.env.SEGUIMIENTO_CLIENTES_PATH = path.join(dir, 'seguimiento.json');
process.env.DB_HOST = '';

const HOY = '2026-10-28';
const EQ1 = 'JUNCO CASTAÑEDA MAX JALIL';
const EQ2 = 'TELLEZ FLORES ADRIANA';
const AJENO = 'ROJAS ROBLES CINTHIA';

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
  cita_programada, cita_asistida, cotizacion) VALUES (?,?,?,?,?,?,?,?,?,?)`);
L.run('A1', 'CHOLULA', 'CHOLULA', 'ANA SINTETICA', '2026-09-10', 'SI', EQ1, 'SI', 'SI', 'SI');
L.run('A2', 'CHOLULA', 'CHOLULA', 'BETO SINTETICO', '2026-09-20', 'SI', EQ2, 'NO', null, 'NO');
// Entró en octubre: no puede aparecer en un corte de septiembre aunque su ciclo siga en cartera.
L.run('A3', 'CHOLULA', 'CHOLULA', 'CARLA DE OCTUBRE', '2026-10-05', 'SI', EQ1, 'NO', null, 'NO');
// El lead lo tiene alguien fuera del equipo, pero su último ciclo es de un asesor del equipo.
L.run('A4', 'CHOLULA', 'CHOLULA', 'DANIEL CICLO', '2026-09-15', 'SI', AJENO, 'NO', null, 'NO');
L.run('A5', 'CHOLULA', 'CHOLULA', 'ELSA AJENA', '2026-09-15', 'SI', AJENO, 'NO', null, 'NO');

const A = db.prepare(`INSERT INTO crm_actividades (id_contacto, nombre_contacto, id_ciclo, estatus, fecha_estatus, tipo_actividad,
  fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad, resultado_actividad, vendedor) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
// A1: dos compromisos sin respuesta (el más antiguo vencido manda) y uno cumplido a tiempo.
A.run('A1', 'ANA SINTETICA', 'C-A1', 'Ofrecimiento', '2026-10-01', 'LLAMADA', '2026-10-01', '2026-10-10', null, 'Confirmar firma', EQ1);
A.run('A1', 'ANA SINTETICA', 'C-A1', 'Ofrecimiento', '2026-10-02', 'LLAMADA', '2026-10-02', '2026-10-20', null, 'Enviar cotización', EQ1);
A.run('A1', 'ANA SINTETICA', 'C-A1', 'Ofrecimiento', '2026-10-03', 'CITA', '2026-10-03', '2026-10-15', '2026-10-15', 'Vino a prueba', EQ1);
// A2: compromiso para hoy y una respuesta vieja (de otro ciclo) que no cuenta.
A.run('A2', 'BETO SINTETICO', 'C-A2', 'Prospección', '2026-10-20', 'WHATSAPP', '2026-10-20', HOY, null, 'Mandar fotos', EQ2);
A.run('A2', 'BETO SINTETICO', 'C-A2', 'Prospección', '2026-10-21', 'LLAMADA', '2026-10-21', '2026-10-22', '2025-01-01', 'Llamar', EQ2);
// A3: ciclo en cartera, lead de octubre.
A.run('A3', 'CARLA DE OCTUBRE', 'C-A3', 'Neg. Caliente', '2026-10-06', 'LLAMADA', '2026-10-06', '2026-10-07', '2026-10-07', 'Llamó', EQ1);
// A4: el último ciclo es de un asesor del equipo.
A.run('A4', 'DANIEL CICLO', 'C-A4', 'Ofrecimiento', '2026-10-01', 'LLAMADA', '2026-10-01', '2026-10-03', '2026-10-04', 'Cotizó', EQ2);
// A2: estatus posterior al corte de septiembre; en septiembre seguía en Prospección.
A.run('A2', 'BETO SINTETICO', 'C-A2b', 'Perdido', '2026-10-25', 'LLAMADA', '2026-10-25', '2026-10-25', '2026-10-25', 'Ya compró', EQ2);
A.run('A2', 'BETO SINTETICO', 'C-A2b', 'Prospección', '2026-09-22', 'LLAMADA', '2026-09-22', '2026-09-23', '2026-09-23', 'Interesado', EQ2);
db.close();

const m = require('../src/services/monitoreoCholulaService');

test('el corte nunca pasa de hoy ni trae clientes que entraron después', async () => {
  assert.equal(m.corteCartera('2026-10-31', HOY), HOY);
  assert.equal(m.corteCartera('2026-09-30', HOY), '2026-09-30');
  const sep = await m.getCarteraCholula({ fechaFin: '2026-09-30', hoy: HOY });
  assert.equal(sep.fechaCorte, '2026-09-30');
  assert.equal(sep.clientes.some((c) => c.idCrm === 'A3'), false);
  assert.equal(sep.clientes.every((c) => c.fechaEntrada <= '2026-09-30'), true);
  // El estatus del ciclo es el que tenía al corte, no el de hoy.
  const beto = sep.clientes.find((c) => c.idCrm === 'A2');
  assert.equal(beto.cartera?.estatus, 'Prospección');
  const oct = await m.getCarteraCholula({ fechaFin: '2026-10-31', hoy: HOY });
  assert.equal(oct.fechaCorte, HOY);
  assert.equal(oct.clientes.some((c) => c.idCrm === 'A3'), true);
});

test('el compromiso del asesor es el vencido más antiguo; una respuesta vieja no lo cumple', async () => {
  const c = await m.getCarteraCholula({ fechaFin: '2026-10-31', hoy: HOY });
  const ana = c.clientes.find((x) => x.idCrm === 'A1');
  assert.equal(ana.compromiso.fecha, '2026-10-10');
  assert.equal(ana.compromiso.vencido, true);
  assert.equal(ana.compromiso.comentario, 'Confirmar firma');
  const e = m.estadoCompromiso({ fecha: '2026-10-22', respuesta: '2025-01-01', creada: '2026-10-21' }, HOY);
  assert.equal(e.cumplida, false);
  assert.equal(e.vencida, true);
  const antes = m.estadoCompromiso({ fecha: '2026-10-22', respuesta: '2026-10-21', creada: '2026-10-20' }, HOY);
  assert.equal(antes.cumplida, true, 'hecha antes de su fecha cuenta como cumplida');
  assert.equal(antes.aTiempo, true);
});

test('se puede etiquetar a un cliente cuyo ciclo es de un asesor del equipo', () => {
  const r = m.etiquetarClienteCholula('A4', { etiqueta: 'caliente', autor: 'gerente' });
  assert.equal(r.etiqueta.etiqueta, 'caliente');
  assert.throws(() => m.etiquetarClienteCholula('A5', { etiqueta: 'frio' }), (err) => err.status === 404);
});

test('el gerente programa una revisión con fecha y queda en la cartera, la agenda y el equipo', async () => {
  assert.throws(() => m.programarRevisionCholula('A1', { fecha: '2026-10-01', que: 'firma', hoy: HOY }), /fecha pasada/);
  assert.throws(() => m.programarRevisionCholula('A1', { fecha: '2026-10-30', que: 'nada', hoy: HOY }), /Indica qué/);
  assert.throws(() => m.programarRevisionCholula('A1', { fecha: '2026-10-30', que: 'otro', hoy: HOY }), /escribe qué/);
  assert.throws(() => m.programarRevisionCholula('A5', { fecha: '2026-10-30', que: 'firma', hoy: HOY }), (err) => err.status === 404);
  const { revision } = m.programarRevisionCholula('A1', { fecha: '2026-10-30', que: 'firma', nota: '¿Ya firmó?', autor: 'gerente', hoy: HOY });
  assert.equal(revision.queLabel, 'Fecha de firma');

  const c = await m.getCarteraCholula({ fechaFin: '2026-10-31', hoy: HOY });
  const ana = c.clientes.find((x) => x.idCrm === 'A1');
  assert.equal(ana.revision.fecha, '2026-10-30');
  assert.equal(ana.revision.nota, '¿Ya firmó?');
  assert.equal(c.resumen.conRevision, 1);

  const cal = m.getCalendarioCholula({ mes: '2026-10', hoy: HOY });
  assert.equal(cal.revisiones.length, 1);
  assert.equal(cal.revisiones[0].cliente, 'Ana Sintetica');

  const eq = await m.getEquipoCholula({ hoy: HOY });
  const junco = eq.vendedores.find((v) => /Junco/i.test(v.vendedor));
  assert.equal(junco.revisiones, 1);

  m.cerrarRevisionCholula(revision.id, { estado: 'lista', autor: 'gerente' });
  const d = await m.getCarteraCholula({ fechaFin: '2026-10-31', hoy: HOY });
  assert.equal(d.clientes.find((x) => x.idCrm === 'A1').revision, null);
  assert.throws(() => m.cerrarRevisionCholula(revision.id, { estado: 'borrada' }), /Estado no válido/);
});

test('equipo hoy mide a tiempo, vencidos y para hoy por asesor', async () => {
  const eq = await m.getEquipoCholula({ hoy: HOY });
  const junco = eq.vendedores.find((v) => /Junco/i.test(v.vendedor));
  // A1: 10 oct y 20 oct vencidos, 15 oct a tiempo; A3: 7 oct a tiempo.
  assert.equal(junco.compromisos, 4);
  assert.equal(junco.aTiempo, 2);
  assert.equal(junco.vencidas, 2);
  assert.equal(junco.pctATiempo, 50);
  const tellez = eq.vendedores.find((v) => /Tellez/i.test(v.vendedor));
  assert.equal(tellez.paraHoy, 1);
  assert.equal(tellez.vencidas, 1, 'la respuesta vieja no cumple el compromiso del 22 oct');
  assert.equal(eq.vendedores.some((v) => /Rojas/i.test(v.vendedor)), false);
});

test('lo que no es del equipo se informa aparte', async () => {
  const t = await m.getMonitoreoCholula({ fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
  assert.equal(t.fueraEquipo.leads, 2);
  assert.equal(t.vendedores.some((v) => /Rojas/i.test(v.vendedor)), false);
});

test('la agenda con nombres de clientes no se publica en la réplica de la nube', () => {
  const { esRutaExcluida } = require('../src/services/cloudReplica/replicaKey');
  assert.equal(esRutaExcluida('/ventas/monitoreo-cholula/calendario'), true);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
