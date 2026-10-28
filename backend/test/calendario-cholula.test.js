const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(os.tmpdir(), `calendario-cholula-${process.pid}.db`);
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE crm_actividades (
    id_contacto TEXT,
    nombre_contacto TEXT,
    fecha_prog_actividad TEXT,
    fecha_resp_actividad TEXT,
    resultado_actividad TEXT,
    tipo_actividad TEXT,
    vendedor TEXT
  );
`);
const ins = db.prepare(`
  INSERT INTO crm_actividades
    (id_contacto, nombre_contacto, fecha_prog_actividad, fecha_resp_actividad, resultado_actividad, tipo_actividad, vendedor)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
ins.run('1', 'MARIA', '2026-10-15', '2026-10-15', 'Viene el sabado', 'Llamada', 'Simon Bolivar Olaiz');
ins.run('1', 'MARIA', '2026-10-15', '2026-10-15', 'Viene el sabado', 'Llamada', 'Simon Bolivar Olaiz');
ins.run('2', 'PEDRO', '2026-10-20', '2025-01-01', '', 'Cita', 'Eduardo Bardesi Zamora');
ins.run('3', 'LUIS', '2026-10-08', '2026-10-08', 'Otro equipo', 'Llamada', 'ROJAS ROBLES CINTHIA');
ins.run('4', 'ANA', '2026-11-02', '2026-11-02', 'Noviembre', 'Llamada', 'Simon Bolivar Olaiz');
db.close();

const { getCalendarioCholula } = require('../src/services/monitoreoCholulaService');

test('el calendario de Cholula toma el comentario y la fecha de cumplimiento del equipo', () => {
  const r = getCalendarioCholula({ mes: '2026-10', dbPath });
  assert.equal(r.mes, '2026-10');
  assert.equal(r.sucursal, 'Cholula');
  assert.equal(r.total, 2);
  assert.equal(r.pendientes, 1);
  const maria = r.eventos.find((e) => e.cliente === 'MARIA');
  assert.equal(maria.fecha, '2026-10-15');
  assert.equal(maria.comentario, 'Viene el sabado');
  assert.equal(maria.cumplida, true);
  assert.equal(maria.vendedor, 'Simon Bolivar Olaiz');
  const pedro = r.eventos.find((e) => e.cliente === 'PEDRO');
  assert.equal(pedro.comentario, 'Cita');
  assert.equal(pedro.cumplida, false);
  assert.equal(r.eventos.some((e) => e.cliente === 'LUIS'), false);
  const nov = getCalendarioCholula({ mes: '2026-11', dbPath });
  assert.equal(nov.total, 1);
  assert.equal(nov.eventos[0].comentario, 'Noviembre');
  assert.throws(() => getCalendarioCholula({ mes: 'octubre', dbPath }), (err) => err.status === 400);
});

test.after(() => {
  try { fs.unlinkSync(dbPath); } catch (_) { /* el archivo temporal ya no esta */ }
});
