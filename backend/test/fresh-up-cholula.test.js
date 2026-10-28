const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { sqlFreshUpNuevos } = require('../src/services/monitoreoCholulaService');

test('fresh up cuenta solo NUEVOS cuya reconciliacion contiene Fresh', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_trafico_piso (comentarios TEXT, reconciliacion TEXT)');
  const ins = db.prepare('INSERT INTO crm_trafico_piso (comentarios, reconciliacion) VALUES (?, ?)');
  ins.run('NUEVOS', 'FRESH UP');
  ins.run('NUVOS', 'FRESH-UP');
  ins.run('NUEVOS', 'CITA');
  ins.run('NUEVOS', 'CITA-SNV');
  ins.run('NUEVOS', 'SNV');
  ins.run('SEMINUEVOS', 'FRESH UP');
  ins.run('nuevos', 'fresh up');
  const n = db.prepare(`SELECT COUNT(*) AS n FROM crm_trafico_piso WHERE ${sqlFreshUpNuevos()}`).get().n;
  assert.equal(n, 3);
  db.close();
});
