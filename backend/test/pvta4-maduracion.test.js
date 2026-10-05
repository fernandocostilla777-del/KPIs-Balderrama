'use strict';
/**
 * P-VTA-4 · Tiempo de Maduración Comercial — reglas por contacto con datos sintéticos.
 * Casos del documento: recompra, mismo ciclo con dos VIN, ciclos reabiertos,
 * cliente de cartera con lead reciente, exclusiones por fecha y prospectos perdidos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { clasificarContactoMaduracion, PVTA4 } = require('../src/services/crmCiclosService');

const HOY = '2026-10-02';
const ciclo = (over = {}) => ({
  idCiclo: 'c1', fic: null, crea: null, ult: null, estatus: null, vendedor: null, ff: null, producto: null, unidades: 0, ...over,
});
const contacto = (over = {}) => ({ id: '1', nombre: 'Prueba', ciclos: [], leads: [], huellas: [], ...over });

test('venta simple: llegada = primera huella del ciclo, origen sin clasificar', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2026-08-01', ff: '2026-08-21', unidades: 1 })],
    huellas: [{ fecha: '2026-08-01', fuente: 'ciclo' }, { fecha: '2026-08-05', fuente: 'solicitud' }],
  }), HOY);
  assert.equal(r.ventas.length, 1);
  assert.equal(r.ventas[0].llegada, '2026-08-01');
  assert.equal(r.ventas[0].dias, 20);
  assert.equal(r.ventas[0].origen, 'sin_clasificar');
  assert.equal(r.ventas[0].excluida, null);
  assert.equal(r.activo, null);
  assert.equal(r.perdido, null);
});

test('lead: la llegada es el lead aunque el ciclo se haya abierto después', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2026-07-10', ff: '2026-08-01' })],
    leads: [{ fecha: '2026-06-01', canal: 'FBABP', campana: 'enganche' }],
    huellas: [{ fecha: '2026-06-01', fuente: 'lead' }, { fecha: '2026-07-10', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas[0].llegada, '2026-06-01');
  assert.equal(r.ventas[0].llegadaFuente, 'lead');
  assert.equal(r.ventas[0].dias, 61);
  assert.equal(r.ventas[0].origen, 'lead');
  assert.equal(r.ventas[0].canal, 'FBABP');
});

test('recompra: la segunda venta no hereda días de la primera y es cartera', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2024-01-05', ff: '2024-02-01' }),
      ciclo({ idCiclo: 'b', fic: '2026-06-01', ff: '2026-07-01' }),
    ],
    leads: [{ fecha: '2026-05-20', canal: 'GMMX', campana: 'retención' }],
    huellas: [
      { fecha: '2024-01-05', fuente: 'ciclo' },
      { fecha: '2026-05-20', fuente: 'lead' },
      { fecha: '2026-06-01', fuente: 'ciclo' },
    ],
  }), HOY);
  assert.equal(r.ventas.length, 2);
  const [primera, segunda] = r.ventas;
  assert.equal(primera.dias, 27);
  assert.equal(primera.origen, 'sin_clasificar');
  assert.equal(segunda.llegada, '2026-05-20');
  assert.equal(segunda.dias, 42);
  // Tiene compra previa dentro de 48 meses: cartera gana sobre el lead reciente.
  assert.equal(segunda.origen, 'cartera');
  assert.equal(segunda.compraPrevia, '2024-02-01');
});

test('recompra con compra previa fuera del plazo de cartera se clasifica por lead', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2019-01-05', ff: '2019-02-01' }),
      ciclo({ idCiclo: 'b', fic: '2026-06-01', ff: '2026-07-01' }),
    ],
    leads: [{ fecha: '2026-05-20', canal: 'GMMX', campana: 'x' }],
    huellas: [{ fecha: '2019-01-05', fuente: 'ciclo' }, { fecha: '2026-05-20', fuente: 'lead' }, { fecha: '2026-06-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas[1].origen, 'lead');
});

test('segundo ciclo abierto antes de facturar el primero arranca en su propio inicio', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2026-03-01', ff: '2026-04-01' }),
      ciclo({ idCiclo: 'b', fic: '2026-03-20', ff: '2026-06-01' }),
    ],
    huellas: [{ fecha: '2026-03-01', fuente: 'ciclo' }, { fecha: '2026-03-20', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 2);
  assert.equal(r.ventas[1].llegada, '2026-03-20');
  assert.equal(r.ventas[1].dias, 73);
});

test('compras casi simultáneas (≤ 7 días) cuentan como una venta con sus unidades', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2026-05-01', ff: '2026-05-20', unidades: 1 }),
      ciclo({ idCiclo: 'b', fic: '2026-05-02', ff: '2026-05-24', unidades: 2 }),
    ],
    huellas: [{ fecha: '2026-05-01', fuente: 'ciclo' }, { fecha: '2026-05-02', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 1);
  assert.equal(r.ventas[0].unidades, 3);
  assert.equal(r.ventas[0].fechaFactura, '2026-05-20');
});

test('mismo ciclo con dos VIN es una sola venta', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2026-05-01', ff: '2026-05-20', unidades: 2 })],
    huellas: [{ fecha: '2026-05-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 1);
  assert.equal(r.ventas[0].unidades, 2);
});

test('ciclos reabiertos sin compra intermedia alargan la venta y se cuentan', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2026-01-10', estatus: 'Lead Caducado', ult: '2026-02-01' }),
      ciclo({ idCiclo: 'b', fic: '2026-04-10', estatus: 'Lead Caducado', ult: '2026-05-01' }),
      ciclo({ idCiclo: 'c', fic: '2026-07-10', ff: '2026-08-01' }),
    ],
    huellas: [{ fecha: '2026-01-10', fuente: 'ciclo' }, { fecha: '2026-04-10', fuente: 'ciclo' }, { fecha: '2026-07-10', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 1);
  assert.equal(r.ventas[0].llegada, '2026-01-10');
  assert.equal(r.ventas[0].ciclosHastaCerrar, 3);
});

test('exclusiones: duración negativa, mayor a 24 meses y sin llegada', () => {
  const neg = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: null, ff: '2026-05-01' })],
    huellas: [{ fecha: '2026-06-01', fuente: 'prueba' }],
  }), HOY);
  // Única huella posterior a la factura: no hay llegada válida.
  assert.equal(neg.ventas[0].excluida, 'sin fecha de llegada');

  const larga = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2023-01-01', ff: '2026-05-01' })],
    huellas: [{ fecha: '2023-01-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(larga.ventas[0].excluida, 'mayor a 24 meses');
  assert.equal(larga.ventas[0].dias, null);

  const futura = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2026-09-01', ff: '2027-01-01' })],
    huellas: [{ fecha: '2026-09-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(futura.ventas.length, 0, 'facturas futuras no se cuentan');
});

test('prospecto activo: ciclo en cartera activa con actividad reciente, edad desde la llegada', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2026-08-15', estatus: 'Neg. Caliente', ult: '2026-09-28', vendedor: 'Ana' })],
    leads: [{ fecha: '2026-08-10', canal: 'GMMX', campana: 'c' }],
    huellas: [{ fecha: '2026-08-10', fuente: 'lead' }, { fecha: '2026-08-15', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 0);
  assert.ok(r.activo);
  assert.equal(r.activo.edad, 53);
  assert.equal(r.activo.origen, 'lead');
  assert.equal(r.activo.vendedor, 'Ana');
  assert.equal(r.perdido, null);
});

test('prospecto perdido: sin actividad en 180 días o estatus fuera de cartera activa', () => {
  const viejo = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2025-06-01', estatus: 'Prospección', ult: '2025-09-01' })],
    huellas: [{ fecha: '2025-06-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(viejo.activo, null);
  assert.ok(viejo.perdido);
  assert.equal(viejo.perdido.edadAlPerder, 92);

  const descartado = clasificarContactoMaduracion(contacto({
    ciclos: [ciclo({ fic: '2026-09-01', estatus: 'Descartado', ult: '2026-09-20' })],
    huellas: [{ fecha: '2026-09-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(descartado.activo, null);
  assert.ok(descartado.perdido);
});

test('cliente con compra y ciclo nuevo posterior queda activo como cartera', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2024-05-01', ff: '2024-05-20' }),
      ciclo({ idCiclo: 'b', fic: '2026-09-01', estatus: 'Ofrecimiento', ult: '2026-09-25' }),
    ],
    huellas: [{ fecha: '2024-05-01', fuente: 'ciclo' }, { fecha: '2026-09-01', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 1);
  assert.ok(r.activo);
  assert.equal(r.activo.origen, 'cartera');
  assert.equal(r.activo.llegada, '2026-09-01');
});

test('un ciclo descartado sin seguimiento no adelanta la llegada de la venta', () => {
  // El contacto tuvo un ciclo en 2024 que se cerró el mismo día y la venta
  // real nació con el ciclo de septiembre: la maduración se mide desde este.
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'viejo', fic: '2024-11-26', ult: '2024-11-26', estatus: 'Descartado' }),
      ciclo({ idCiclo: 'venta', fic: '2026-09-14', ult: '2026-09-22', estatus: 'Postventa', ff: '2026-09-22' }),
    ],
    huellas: [{ fecha: '2026-09-14', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas.length, 1);
  assert.equal(r.ventas[0].llegada, '2026-09-14');
  assert.equal(r.ventas[0].dias, 8);
});

test('un ciclo descartado que sí tuvo seguimiento sigue contando como llegada', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2026-06-01', ult: '2026-08-15', ultReal: '2026-08-15', estatus: 'Descartado' }),
      ciclo({ idCiclo: 'b', fic: '2026-08-20', ult: '2026-09-10', ultReal: '2026-09-10', estatus: 'Postventa', ff: '2026-09-10' }),
    ],
    huellas: [{ fecha: '2026-06-01', fuente: 'ciclo' }, { fecha: '2026-08-20', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas[0].llegada, '2026-06-01');
  assert.equal(r.ventas[0].dias, 101);
});

test('un ciclo en prospección con una sola actividad el día del alta no cuenta como llegada', () => {
  const r = clasificarContactoMaduracion(contacto({
    ciclos: [
      ciclo({ idCiclo: 'a', fic: '2026-05-19', ult: '2026-05-19', ultReal: '2026-05-19', estatus: 'Prospección' }),
      ciclo({ idCiclo: 'b', fic: '2026-09-25', ult: '2026-09-30', ultReal: '2026-09-30', estatus: 'Postventa', ff: '2026-09-30' }),
    ],
    huellas: [{ fecha: '2026-09-25', fuente: 'ciclo' }],
  }), HOY);
  assert.equal(r.ventas[0].llegada, '2026-09-25');
  assert.equal(r.ventas[0].dias, 5);
});

test('parámetros por confirmar quedan expuestos', () => {
  assert.equal(PVTA4.agrupaCompraDias, 7);
  assert.equal(PVTA4.carteraMeses, 48);
  assert.equal(PVTA4.perdidoDias, 180);
  assert.equal(PVTA4.maxMaduracionDias, 730);
});
