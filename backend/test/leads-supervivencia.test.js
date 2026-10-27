const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/services/leadsSupervivenciaService');

test('Kaplan–Meier con un caso calculado a mano', () => {
  const curve = s.kaplanMeier([
    { t: 1, event: 1 },
    { t: 2, event: 0 },
    { t: 3, event: 1 },
    { t: 4, event: 0 },
  ]);
  const en = (dia) => curve.filter((p) => p.dia <= dia).at(-1);
  assert.equal(Math.round(en(1).s * 1000) / 1000, 0.75);
  assert.equal(Math.round(en(3).s * 1000) / 1000, 0.375);
});

test('un lead sin compra que entró hace 10 días se censura en el día 10', () => {
  const { obs } = s.armarObservaciones(
    [{ entrada: '2026-10-06', compraDia: null, fuente: 'Lead digital' }],
    { corte: '2026-10-16', horizonte: 180 },
  );
  assert.equal(obs.length, 1);
  assert.equal(obs[0].event, 0);
  assert.equal(obs[0].t, 10);
});

test('el tiempo negativo no entra al modelo y cuenta como excluido', () => {
  const res = s.construirRespuesta(
    [{ entrada: '2026-10-01', compraDia: -3, fuente: 'Lead digital', forma: 'Contado', estrena: 'Este mes' }],
    { corte: '2026-10-16', horizonte: 180, desde: '2025-10-16', hasta: '2026-10-16' },
  );
  assert.equal(res.muestra.leads, 0);
  assert.equal(res.muestra.excluidos, 1);
});

test('con menos de 40 compras no se estiman factores', () => {
  const filas = Array.from({ length: 30 }, (_, i) => ({
    entrada: '2026-01-01',
    compraDia: i < 10 ? 20 : null,
    fuente: 'Lead digital',
    forma: 'Contado',
    estrena: 'Este mes',
  }));
  const res = s.construirRespuesta(filas, {
    corte: '2026-10-16',
    horizonte: 180,
    desde: '2025-10-16',
    hasta: '2026-10-16',
  });
  assert.equal(res.factores.length, 0);
  assert.ok(res.avisos.some((a) => a.includes('40')));
});

test('las fuentes de la hoja STREGA se agrupan sin perder las que no están en la lista', () => {
  assert.equal(s.grupoFuente('VISITA A PISO'), 'Visita a piso');
  assert.equal(s.grupoFuente('Visita a Piso'), 'Visita a piso');
  assert.equal(s.grupoFuente('LEAD DIGITAL'), 'Lead digital');
  // Una fuente nueva de la hoja STREGA no se pierde en «Otras»: conserva su nombre.
  assert.equal(s.grupoFuente('EVENTO EN PLAZA'), 'Evento en plaza');
});

test('t50 sale de Kaplan–Meier y no se acorta por los leads recientes censurados', () => {
  // 10 leads viejos: compran en día 10 (5) y día 60 (5). 40 leads recientes censurados en día 20.
  const obs = [];
  for (let i = 0; i < 5; i += 1) obs.push({ t: 10, event: 1 }, { t: 60, event: 1 });
  for (let i = 0; i < 40; i += 1) obs.push({ t: 20, event: 0 });
  const r = s.tiempoCompra(obs, 180);
  // La mitad de las compras esperadas ocurre después del día 10 (la compra tardía pesa más
  // porque los censurados todavía pueden comprar): t50 = 60, no 10.
  assert.equal(r.t50, 60);
});

function generadorPrueba(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simular({ n = 4000, grupos, semilla = 5 }) {
  const rnd = generadorPrueba(semilla);
  const obs = [];
  for (let i = 0; i < n; i += 1) {
    const g = grupos[i % grupos.length];
    let t = 180;
    let event = 0;
    if (rnd() < g.p) {
      const dia = Math.floor(g.escala * -Math.log(rnd()));
      if (dia <= 180) {
        t = dia;
        event = 1;
      }
    }
    obs.push({ t, event, g: g.nombre });
  }
  return obs;
}

test('rapidez distinta con la misma probabilidad: solo "más rápido" es concluyente', () => {
  const obs = simular({ grupos: [{ nombre: 'Base', p: 0.03, escala: 40 }, { nombre: 'Rápido', p: 0.03, escala: 20 }] });
  const [f] = s.factoresDeCampo(obs, { factor: 'x', campo: 'g', tipo: 't', basePreferida: 'Base' });
  assert.equal(f.nivel, 'Rápido');
  assert.equal(f.concluyente, true);
  assert.ok(f.cocienteTiempo < 1);
  assert.equal(f.concluyenteCompra, false);
});

test('probabilidad distinta con la misma rapidez: solo "compra más" es concluyente', () => {
  const obs = simular({ grupos: [{ nombre: 'Base', p: 0.02, escala: 30 }, { nombre: 'Más', p: 0.07, escala: 30 }], semilla: 9 });
  const [f] = s.factoresDeCampo(obs, { factor: 'x', campo: 'g', tipo: 't', basePreferida: 'Base' });
  assert.equal(f.concluyenteCompra, true);
  assert.ok(f.probCompra.nivel > f.probCompra.base);
  assert.equal(f.concluyente, false);
});

test('una base que sube despacio y sin aplanarse no sale con 100 % de compra', () => {
  const rnd = generadorPrueba(1);
  const obs = [];
  for (let i = 0; i < 6000; i += 1) {
    const lento = i % 3 !== 0;
    let t = 180;
    let event = 0;
    if (rnd() < (lento ? 0.04 : 0.06)) {
      const dia = Math.floor(lento ? rnd() * 1400 : -20 * Math.log(rnd()));
      if (dia <= 180) {
        t = dia;
        event = 1;
      }
    }
    obs.push({ t, event, g: lento ? 'Lento' : 'Rápido' });
  }
  const [f] = s.factoresDeCampo(obs, { factor: 'x', campo: 'g', tipo: 't', basePreferida: 'Lento' });
  assert.ok(f.probCompra.base < 2, `base ${f.probCompra.base} %`);
  assert.ok(f.cocienteTiempo > 0.05 && f.cocienteTiempo < 1, `cociente ${f.cocienteTiempo}`);
});

test('"Sin dato" y "Otros" no aparecen como factor ni como base', () => {
  const obs = simular({
    grupos: [
      { nombre: 'Sin dato', p: 0.05, escala: 30 },
      { nombre: 'Otros', p: 0.05, escala: 30 },
      { nombre: 'Contado', p: 0.05, escala: 30 },
      { nombre: 'Crédito', p: 0.05, escala: 30 },
    ],
    n: 6000,
  });
  const fs = s.factoresDeCampo(obs, { factor: 'forma_compra', campo: 'g', tipo: 't' });
  assert.ok(fs.length >= 1);
  for (const f of fs) {
    assert.ok(!['Sin dato', 'Otros'].includes(f.nivel));
    assert.ok(!['Sin dato', 'Otros'].includes(f.base));
  }
});

test('el intervalo bootstrap es el mismo en cada consulta', () => {
  const obs = simular({ grupos: [{ nombre: 'Base', p: 0.03, escala: 40 }, { nombre: 'Otro', p: 0.03, escala: 30 }] });
  const a = s.factoresDeCampo(obs, { factor: 'x', campo: 'g', tipo: 't', basePreferida: 'Base' });
  const b = s.factoresDeCampo(obs, { factor: 'x', campo: 'g', tipo: 't', basePreferida: 'Base' });
  assert.deepEqual(a, b);
});

test('la etiqueta pierde el punto final de la hoja', () => {
  const { obs } = s.armarObservaciones(
    [{ entrada: '2026-01-01', compraDia: null, fuente: 'Lead digital', estrena: 'Antes de 3 meses.' }],
    { corte: '2026-03-01' },
  );
  assert.equal(obs[0].estrena, 'Antes de 3 meses');
});

test('el corte del modelo no pasa de hoy aunque el periodo termine en el futuro', () => {
  assert.equal(s.corteEfectivo('2026-10-31', '2026-10-19'), '2026-10-19');
  assert.equal(s.corteEfectivo('2026-09-30', '2026-10-19'), '2026-09-30');
});

test('hito: un hito reciente se censura, no cuenta como "no compró"', () => {
  const filas = [];
  // 40 pruebas viejas: 20 compran 5 días después, 20 no compran.
  for (let i = 0; i < 40; i += 1) {
    filas.push({ entrada: '2026-01-01', pruebaDia: 10, compraDia: i < 20 ? 15 : null });
  }
  // 40 pruebas de hace 3 días: todavía no alcanzan a comprar.
  for (let i = 0; i < 40; i += 1) filas.push({ entrada: '2026-09-27', pruebaDia: 1, compraDia: null });
  const prueba = s.medirHitos(filas, { corte: '2026-09-30' }).find((h) => h.clave === 'prueba');
  assert.equal(prueba.leads, 80);
  assert.equal(prueba.pct, 50); // el cálculo ingenuo daría 25 %
  assert.equal(prueba.diaMitad, 5);
});

test('hito: quien compró antes del hito no entra y se reporta aparte', () => {
  const filas = Array.from({ length: 30 }, (_, i) => ({ entrada: '2026-01-01', citaDia: 20, compraDia: i < 5 ? 10 : null }));
  const cita = s.medirHitos(filas, { corte: '2026-09-30' }).find((h) => h.clave === 'cita');
  assert.equal(cita.leads, 25);
  assert.equal(cita.compraronAntes, 5);
  assert.equal(cita.compras, 0);
});

test('hito: la referencia solo toma leads fríos al día 14', () => {
  const filas = [
    ...Array.from({ length: 30 }, () => ({ entrada: '2026-01-01', compraDia: null })),
    { entrada: '2026-01-01', citaDia: 5, compraDia: null },
    { entrada: '2026-01-01', compraDia: 8 },
    { entrada: '2026-09-25', compraDia: null },
  ];
  const ref = s.medirHitos(filas, { corte: '2026-09-30' })[0];
  assert.equal(ref.clave, 'referencia');
  assert.equal(ref.leads, 30);
});

test('hito: sin tabla cargada se marca, y la fecha anterior a la entrada no cuenta', () => {
  const h = s.medirHitos([{ entrada: '2026-01-01', compraDia: null }], {
    corte: '2026-09-30',
    disponibles: { prueba: false },
  });
  assert.equal(h.find((x) => x.clave === 'prueba').sinDatos, true);
  assert.equal(s.primeraDesde(['2025-11-02', '2026-02-10', '2026-03-01'], '2026-01-05'), '2026-02-10');
  assert.equal(s.primeraDesde(['2025-11-02'], '2026-01-05'), null);
});

test('un lead que compró después del día 365 no se excluye: cuenta como censurado en el horizonte', () => {
  const { obs, excluidos } = s.armarObservaciones(
    [
      { entrada: '2025-01-01', compraDia: 400, fuente: 'Lead digital' },
      { entrada: '2025-01-01', compraDia: 20, fuente: 'Lead digital' },
    ],
    { corte: '2026-06-01', horizonte: 180 },
  );
  assert.equal(excluidos, 0);
  assert.equal(obs.length, 2);
  assert.equal(obs[0].event, 0);
  assert.equal(obs[0].t, 180);
  assert.equal(obs[1].event, 1);
});

test('cociente de días con mitad en el día 0: finito, con intervalo y concluyente', () => {
  const obs = [];
  for (let i = 0; i < 200; i += 1) obs.push({ t: i < 20 ? 0 : 180, event: i < 20 ? 1 : 0, g: 'Piso' });
  for (let i = 0; i < 200; i += 1) obs.push({ t: i < 20 ? 30 : 180, event: i < 20 ? 1 : 0, g: 'Base' });
  const [f] = s.factoresDeCampo(obs, { factor: 'fuente', campo: 'g', tipo: 'al_entrar', basePreferida: 'Base' });
  assert.equal(f.diaMitad.nivel, 0);
  assert.equal(f.diaMitad.base, 30);
  assert.ok(Number.isFinite(f.cocienteTiempo) && f.cocienteTiempo > 0);
  assert.ok(Array.isArray(f.ic95) && f.ic95.every((v) => Number.isFinite(v) && v > 0));
  assert.equal(f.concluyente, true);
});

test('IC log-log: queda dentro de (0, 1), es asimétrico y contiene a S', () => {
  // 2 compras de 100 leads al día 10: S = 0.98, Greenwood = 1/(100·99) + 1/(99·98)
  const S = 0.98;
  const acum = 1 / (100 * 99) + 1 / (99 * 98);
  const [lo, hi] = s.icLogLog(S, acum);
  assert.ok(lo > 0 && lo < S && S < hi && hi < 1, `${lo} ${hi}`);
  assert.ok(Math.abs((S - lo) - (hi - S)) > 1e-4, 'debe ser asimétrico');
  assert.deepEqual(s.icLogLog(1, 0), [1, 1]);
});

test('sumarMeses no se pasa al mes siguiente en fin de mes ni en 29 de febrero', () => {
  assert.equal(s.sumarMeses('2028-02-29', -12), '2027-02-28');
  assert.equal(s.sumarMeses('2026-03-31', -1), '2026-02-28');
  assert.equal(s.sumarMeses('2026-10-19', -12), '2025-10-19');
});

test('hito: conversión sin las compras del mismo día', () => {
  // 100 leads con prueba: 30 compran el mismo día, 14 entre el día 1 y 90, 56 no compran.
  const filas = [];
  for (let i = 0; i < 100; i += 1) {
    const compraDia = i < 30 ? 10 : (i < 44 ? 20 : null);
    filas.push({ entrada: '2026-01-01', pruebaDia: 10, compraDia });
  }
  const p = s.medirHitos(filas, { corte: '2026-09-30' }).find((h) => h.clave === 'prueba');
  assert.equal(p.pct, 44);
  assert.equal(p.pctMismoDia, 68.2); // 30 de 44 compras
  assert.equal(p.pctProspectivo, 20); // 14 de los 70 que no compraron el día del hito
  assert.ok(p.ic95[0] < 44 && p.ic95[1] > 44);
});
