'use strict';
/** Pruebas del diagnóstico de maduración de leads (datos sintéticos, sin base CRM). */
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../scripts/diagnostico-maduracion-leads');

test('meseta: curva que ya no sube en los últimos 30 días se aplana', () => {
  const curva = [{ dia: 0, f: 0 }, { dia: 20, f: 0.05 }, { dia: 60, f: 0.09 }, { dia: 155, f: 0.095 }];
  const m = d.meseta(curva, 180);
  assert.equal(m.seAplana, true);
  assert.equal(m.nuncaCompraPct, 90.5);
});

test('meseta: curva que sigue subiendo al final no se aplana', () => {
  const curva = [{ dia: 0, f: 0 }, { dia: 100, f: 0.05 }, { dia: 170, f: 0.1 }];
  assert.equal(d.meseta(curva, 180).seAplana, false);
});

/** n leads por nivel con compras en los días dados; el resto sin compra hasta el día 180. */
function leads(nivel, n, diasCompra) {
  return Array.from({ length: n }, (_, i) => (i < diasCompra.length
    ? { nivel, t: diasCompra[i], event: 1 }
    : { nivel, t: 180, event: 0 }));
}

test('riesgos proporcionales: misma razón antes y después del día 30 se cumple', () => {
  const base = leads('A', 400, [...Array(20).fill(10), ...Array(20).fill(90)]);
  const otro = leads('B', 400, [...Array(40).fill(10), ...Array(40).fill(90)]);
  const r = d.riesgosProporcionales([...base, ...otro], 'nivel');
  assert.equal(r.base, 'A');
  assert.equal(r.evaluables, 1);
  assert.equal(r.violaciones, 0);
});

test('riesgos proporcionales: el que compra todo pronto y casi nada después no cumple', () => {
  const base = leads('A', 400, [...Array(20).fill(10), ...Array(20).fill(90)]);
  const otro = leads('B', 300, [...Array(40).fill(5), ...Array(5).fill(120)]);
  const r = d.riesgosProporcionales([...base, ...otro], 'nivel');
  assert.equal(r.violaciones, 1);
});

test('volumen por factor: "Sin dato" no cuenta como nivel legible', () => {
  const obs = [...leads('A', 50, Array(12).fill(5)), ...leads('Sin dato', 50, Array(15).fill(5)), ...leads('B', 50, Array(3).fill(5))];
  const v = d.volumenFactor(obs, 'nivel');
  assert.equal(v.niveles, 3);
  assert.equal(v.nivelesLegibles, 1);
  assert.equal(v.sinDatoPct, 33.3);
});

test('veredicto: mucha gente que nunca compra descarta Cox simple aunque sobren compras', () => {
  const m = {
    horizonte: 180,
    evento: { compras: 300, vinSinFecha: 0, coberturaFechaPct: 100 },
    curva: { nuncaCompraPct: 90, seAplana: true, subidaUltimos30: 0.2 },
    riesgosProporcionales: { fuente: { violaciones: 0, evaluables: 2 } },
    perdida: { conFechaPct: 10 },
    hitos: { citasConFechaPct: 95, pruebas: { disponible: true, cruzanPct: 60 }, solicitudes: { disponible: false } },
  };
  const v = Object.fromEntries(d.veredicto(m).map((x) => [x.modelo.split(' ')[0], x.estado]));
  assert.equal(v['Kaplan–Meier'], 'si');
  assert.equal(v.Cox, 'no_recomendado');
  assert.equal(v['Curación'], 'si');
  assert.equal(v.Riesgos, 'no');
  assert.equal(v.Variables, 'si');
});
