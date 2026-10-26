'use strict';
/**
 * Guardas del frontend: filtros que conservan la vista y CSS que no se come reglas.
 *
 * 1. Consultar fechas no debe borrar la pestaña (?tab= en Contabilidad, #hash en
 *    Ventas y Postventa) ni otros parámetros de la URL.
 * 2. dashboard.css no debe tener llaves sobrantes: el navegador descarta la regla
 *    que sigue a una "}" suelta (así se perdió .analytics-block del Resumen).
 * 3. Cada .css/.js propio lleva la misma ?v= en todas las páginas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', '..', 'frontend', 'public');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');

function cargarSyncDateParams(href) {
  const src = read('js/shared.js').replace(/\r\n/g, '\n');
  const inicio = src.indexOf('function syncDateParamsToUrl');
  assert.ok(inicio >= 0, 'syncDateParamsToUrl no existe en shared.js');
  const fin = src.indexOf('\n}\n', inicio) + 2;
  const ctx = { URL, URLSearchParams, location: new URL(href), history: { state: null } };
  ctx.history.replaceState = (_s, _t, next) => { ctx.location = new URL(next, ctx.location); };
  vm.createContext(ctx);
  vm.runInContext(src.slice(inicio, fin), ctx);
  return ctx;
}

test('consultar fechas conserva ?tab= de Contabilidad', () => {
  const ctx = cargarSyncDateParams('http://x/contabilidad.html?tab=eeff');
  ctx.syncDateParamsToUrl('2026-09-01', '2026-09-30');
  assert.equal(ctx.location.searchParams.get('tab'), 'eeff');
  assert.equal(ctx.location.searchParams.get('fechaInicio'), '2026-09-01');
  assert.equal(ctx.location.searchParams.get('fechaFin'), '2026-09-30');
});

test('consultar fechas conserva el #hash de la pestaña (Ventas, Postventa)', () => {
  for (const h of ['#financiamiento', '#hyp', '#refacciones']) {
    const ctx = cargarSyncDateParams(`http://x/pagina.html${h}`);
    ctx.syncDateParamsToUrl('2026-09-01', '2026-09-30');
    assert.equal(ctx.location.hash, h);
  }
});

test('consultar fechas reemplaza el periodo anterior sin duplicarlo', () => {
  const ctx = cargarSyncDateParams('http://x/p.html?fechaInicio=2026-01-01&fechaFin=2026-01-31&tab=balance');
  ctx.syncDateParamsToUrl('2026-09-01', '');
  assert.deepEqual(ctx.location.searchParams.getAll('fechaInicio'), ['2026-09-01']);
  assert.equal(ctx.location.searchParams.has('fechaFin'), false);
  assert.equal(ctx.location.searchParams.get('tab'), 'balance');
});

test('dashboard.css no tiene llaves sobrantes ni bloques sin cerrar', () => {
  const css = read('css/dashboard.css')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let profundidad = 0;
  let linea = 1;
  const sobrantes = [];
  for (const ch of css) {
    if (ch === '\n') linea += 1;
    else if (ch === '{') profundidad += 1;
    else if (ch === '}') {
      if (profundidad === 0) sobrantes.push(linea);
      else profundidad -= 1;
    }
  }
  assert.deepEqual(sobrantes, [], `"}" sobrante en líneas ${sobrantes.join(', ')}: la regla siguiente se pierde`);
  assert.equal(profundidad, 0, 'hay un bloque { sin cerrar (probablemente un @media)');
});

test('cada .css/.js propio usa la misma ?v= en todas las páginas', () => {
  const versiones = {};
  for (const f of fs.readdirSync(PUB).filter((n) => n.endsWith('.html'))) {
    for (const m of read(f).matchAll(/(?:src|href)="(\/(?:js|css)\/[^"?]+)\?v=([^"]+)"/g)) {
      (versiones[m[1]] ||= new Set()).add(m[2]);
    }
  }
  const disparejas = Object.entries(versiones)
    .filter(([, v]) => v.size > 1)
    .map(([a, v]) => `${a}: ${[...v].join(', ')}`);
  assert.deepEqual(disparejas, [], 'versiones distintas por página: algunas sirven el archivo viejo del caché');
});
