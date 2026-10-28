'use strict';
/**
 * Un perfil de sucursal (Cholula) no debe dejar recortada la consulta de ventas de
 * toda la agencia: el núcleo de ventas se guarda en un caché que comparten todos.
 * Facturas sintéticas; sin SQL Server.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_HOST = '';
const db = require('../src/db');

// Facturas sintéticas: una de cada cinco con forma de pago de Cholula (CH…).
function facturas(inicio, fin) {
  const out = [];
  let n = 0;
  for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
    for (let i = 0; i < 3; i += 1) {
      n += 1;
      const fp = n % 5 === 0 ? 'CHCRE' : 'CRE';
      out.push({
        VTE_FECHDOCTO: new Date(d), VTE_DOCTO: `F${n}`, VENDEDOR: 'VENDEDOR UNO', VEH_ANMODELO: 2026,
        COL_DESCRIPCION: 'BLANCO', VEH_FECHSALIDA: new Date(d), VTE_SERIE: `SINTETICO${n}`, VEH_TIPOAUTO: 'AVEO',
        VEH_REPUVE: '', VEH_OBSERVACION: '', VEH_OBSERVS: '', VEH_UBICACION: 'PISO', VTE_IDCLIENTE: n,
        CLIENTE: `CLIENTE SINTETICO ${n}`, PER_SEXO: 'M', FORMAPAGO_ORIGINAL: fp, TIPOVENTA: 'GMF', PREVIAS: 0,
      });
    }
  }
  return out;
}

db.query = async (sql, params = {}) => {
  if (/FROM ADE_VTAFI/i.test(sql) && /VTE_TIPODOCTO/i.test(sql)) {
    const fechas = Object.values(params)
      .filter((v) => v instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(v)))
      .map((v) => new Date(v)).sort((a, b) => a - b);
    return facturas(fechas[0] || new Date('2026-09-01'), fechas.at(-1) || new Date('2026-09-30'));
  }
  return [];
};
db.getPool = async () => ({
  config: {},
  request() {
    const inputs = {};
    const req = {
      input(k, _t, v) { inputs[k] = v; return req; },
      async query(sql) { return { recordset: /AS cnt/.test(sql) ? [] : await db.query(sql, inputs) }; },
    };
    return req;
  },
});

const { getVentas } = require('../src/services/ventas');
const total = (d) => d.resumen?.totalVentas ?? d.kpis?.totalVentas;

test('consultar Cholula no recorta la consulta siguiente de toda la agencia', async () => {
  const periodo = { fechaInicio: '2026-09-01', fechaFin: '2026-09-30' };
  const antes = total(await getVentas(periodo));
  const cholula = total(await getVentas({ ...periodo, canal: 'CHOLULA' }));
  const despues = total(await getVentas(periodo));
  assert.ok(antes > 0, 'la agencia trae ventas');
  assert.ok(cholula > 0 && cholula < antes, `Cholula es una parte: ${cholula} de ${antes}`);
  assert.equal(despues, antes);
});

test('Cholula no recibe las entregas SOFIA de toda la agencia (ni del periodo anterior)', async () => {
  const periodo = { fechaInicio: '2026-09-01', fechaFin: '2026-09-30' };
  const agencia = await getVentas(periodo);
  const cholula = await getVentas({ ...periodo, canal: 'CHOLULA' });
  const entregas = (r) => Number(r.totalEntregasSinPrevias || 0) + Number(r.totalEntregasConPrevias || 0);
  assert.ok(entregas(agencia.resumen) > 0, 'la agencia trae entregas');
  assert.equal(entregas(cholula.resumen), 0);
  assert.equal(Number(cholula.comparativoPeriodo?.anterior?.totalNotificacionesEntrega || 0), 0);
  assert.ok((cholula.registros || []).every((r) => r.CANAL_VENTA === 'CHOLULA'));
});
