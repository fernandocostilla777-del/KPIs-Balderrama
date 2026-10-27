'use strict';
/** Afluencia de un perfil de sucursal: comparativo del año y marketing solo de su centro. CRM sintético en memoria. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { buildComparativoYtd, buildMarketing } = require('../src/services/afluenciaService');

function crmSintetico() {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE crm_trafico_piso (id INTEGER PRIMARY KEY, fuerza TEXT, centro_trabajo TEXT, fecha TEXT, medio TEXT,
      submedio TEXT, forma_contacto TEXT, comentarios TEXT, reconciliacion TEXT, id_crm TEXT, cliente TEXT, telefono TEXT,
      prueba_manejo_flag TEXT, solicitud_flag TEXT, vin_venta TEXT);
    CREATE TABLE crm_leads (id INTEGER PRIMARY KEY, id_crm TEXT, sucursal TEXT, fuerza_ventas TEXT, campana TEXT, canal TEXT,
      fecha_entrada TEXT, contacto TEXT, cita_programada TEXT, cita_asistida TEXT, cotizacion TEXT, vin_comprado TEXT,
      resultado TEXT, es_duplicado INTEGER DEFAULT 0);
    CREATE TABLE crm_actividades (id INTEGER PRIMARY KEY, id_contacto TEXT, vin TEXT, fecha_factura TEXT, fecha_entrega TEXT,
      fecha_estatus TEXT, fecha_inicio_ciclo TEXT, medio_contacto TEXT, submedio_contacto TEXT, forma_contacto TEXT);
  `);
  const t = d.prepare('INSERT INTO crm_trafico_piso (fuerza, centro_trabajo, fecha, medio, comentarios, reconciliacion, id_crm) VALUES (?,?,?,?,?,?,?)');
  const a = d.prepare('INSERT INTO crm_actividades (id_contacto, vin, fecha_factura, medio_contacto) VALUES (?,?,?,?)');
  const l = d.prepare("INSERT INTO crm_leads (id_crm, sucursal, fuerza_ventas, campana, fecha_entrada, contacto) VALUES (?,?,?,?,?, 'SI')");
  let n = 0;
  for (const [centro, cuantos] of [['CHOLULA', 4], ['MATRIZ SERDAN', 10], ['ZACATELCO', 6]]) {
    for (let i = 0; i < cuantos; i += 1) {
      n += 1;
      t.run(centro, centro, '2026-09-10', 'FACEBOOK', 'NUEVOS', 'FRESH UP', `T${n}`);
      l.run(`L${n}`, centro, centro, `Campaña ${centro}`, '2026-09-10');
      if (i % 2 === 0) a.run(`T${n}`, `VIN${n}`, '2026-09-20', 'FACEBOOK');
    }
  }
  return d;
}

test('comparativo del año: un perfil de sucursal solo recibe su centro', () => {
  const d = crmSintetico();
  const todos = buildComparativoYtd(d, '2026-09-30');
  const cholula = buildComparativoYtd(d, '2026-09-30', 'cholula');
  assert.ok(Object.keys(todos.porCentro).length > 1);
  assert.deepEqual(Object.keys(cholula.porCentro), ['cholula']);
  assert.deepEqual(cholula.centros.map((c) => c.key), ['cholula']);
  assert.deepEqual(cholula.trimestres, cholula.porCentro.cholula.trimestres);
});

test('marketing: el tráfico, las compras y las campañas de un perfil de sucursal son solo suyos', () => {
  const d = crmSintetico();
  const filas = d.prepare('SELECT * FROM crm_trafico_piso').all();
  const { sqlCrmSucursal } = require('../src/auth/alcanceSucursal');
  const crm = sqlCrmSucursal('CHOLULA');
  const cholula = buildMarketing(d, '2026-09-01', '2026-09-30', filas.filter((r) => r.centro_trabajo === 'CHOLULA'), { ...crm, crm, texto: 'CHOLULA' });
  const agencia = buildMarketing(d, '2026-09-01', '2026-09-30', filas, null);
  assert.equal(agencia.trafico.summary.compras, 10);
  assert.equal(cholula.trafico.summary.afluenciaTotal, 4);
  assert.equal(cholula.trafico.summary.compras, 2);
  const campanas = JSON.stringify(cholula.campanasLeads || cholula.leads || cholula);
  assert.ok(!campanas.includes('Campaña MATRIZ') && !campanas.includes('Campaña ZACATELCO'));
});
