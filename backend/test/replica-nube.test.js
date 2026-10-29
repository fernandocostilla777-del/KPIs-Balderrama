'use strict';
/**
 * Réplica en la nube (adaptada de KPIs-VECSA).
 *
 * Las unitarias corren siempre. La de punta a punta levanta la ruta real de
 * cloud-api contra un PostgreSQL de pruebas: CRM_PG_URL_TEST=postgresql://… npm test
 * (necesita `npm install` en cloud-api; si no, se omite). Datos sintéticos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const dataSource = require('../src/services/dataSource');
const replicaKey = require('../src/services/cloudReplica/replicaKey');
const { createReplicaMiddleware } = require('../src/services/cloudReplica/replicaMiddleware');
const publisher = require('../src/services/cloudReplica/replicaPublisher');

const CLOUD = path.join(__dirname, '..', '..', 'cloud-api');

function conEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

// ── Claves y exclusiones ────────────────────────────────────────────────────

test('la consulta se normaliza: orden fijo y sin parámetros que solo rompen caché', () => {
  assert.equal(
    replicaKey.normalizeQuery('fechaFin=2026-09-30&fresh=1&fechaInicio=2026-09-01&_=123'),
    'fechaFin=2026-09-30&fechaInicio=2026-09-01',
  );
  assert.equal(replicaKey.normalizeRoute('/ventas/'), '/ventas');
});

test('las vistas de un cliente individual no se publican', () => {
  assert.ok(replicaKey.esRutaExcluida('/seguimiento-360/cliente/123'));
  assert.ok(replicaKey.esRutaExcluida('/seguimiento-360/expediente/9'));
  assert.ok(replicaKey.esRutaExcluida('/crm/contactos'));
  assert.ok(replicaKey.esRutaExcluida('/post-sales/orden/A1'));
  assert.ok(!replicaKey.esRutaExcluida('/seguimiento-360/cartera'));
  assert.ok(!replicaKey.esRutaExcluida('/ventas'));
});

test('la nube y el backend excluyen exactamente las mismas rutas', () => {
  const src = require('node:fs').readFileSync(path.join(CLOUD, 'src/services/desktopCacheStore.js'), 'utf8');
  const bloque = src.slice(src.indexOf('PREFIJOS_EXCLUIDOS = ['), src.indexOf('];', src.indexOf('PREFIJOS_EXCLUIDOS = [')));
  const enNube = [...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(enNube, replicaKey.PREFIJOS_EXCLUIDOS);
});

test('las vistas iniciales usan mes actual y anterior completos, como el frontend', () => {
  const r = publisher.monthRanges(new Date(2026, 9, 26));
  assert.deepEqual(r, [
    { fechaInicio: '2026-10-01', fechaFin: '2026-10-31' },
    { fechaInicio: '2026-09-01', fechaFin: '2026-09-30' },
  ]);
  const items = publisher.seedItems(new Date(2026, 9, 26));
  assert.ok(items.some((i) => i.ruta === '/overview' && i.consulta === 'fechaFin=2026-10-31&fechaInicio=2026-10-01'));
  assert.ok(items.some((i) => i.ruta === '/inventory' && i.consulta === 'planPisoPeriod=all'));
  assert.ok(items.every((i) => !replicaKey.esRutaExcluida(i.ruta)));
});

// ── Origen de datos ─────────────────────────────────────────────────────────

test('sin llave de lectura no hay modo nube, aunque SQL Server no responda', () => conEnv(
  { DATA_SOURCE: 'auto', CLOUD_SYNC_URL: 'https://nube.test', CLOUD_READ_API_KEY: undefined, CLOUD_READ_URL: undefined },
  async () => {
    dataSource._reset();
    assert.equal(await dataSource.refresh({ probe: async () => ({ ok: false, reason: 'caído' }) }), 'sql');
  },
));

test('con llave: SQL Server caído → réplica; SQL Server arriba → SQL Server', () => conEnv(
  { DATA_SOURCE: 'auto', CLOUD_SYNC_URL: 'https://nube.test', CLOUD_READ_API_KEY: 'k' },
  async () => {
    dataSource._reset();
    assert.equal(await dataSource.refresh({ probe: async () => ({ ok: false, reason: 'caído' }) }), 'cloud');
    assert.equal(await dataSource.refresh({ probe: async () => ({ ok: true, reason: 'ok' }) }), 'sql');
    dataSource._reset();
  },
));

// ── Middleware ──────────────────────────────────────────────────────────────

function fakeReq(url, method = 'GET', headers = {}) {
  const [p] = url.split('?');
  return { method, path: p, originalUrl: url, headers };
}

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.type = () => res;
  res.send = (b) => { res.body = b; return res; };
  return res;
}

async function enModoNube(fn) {
  return conEnv({ DATA_SOURCE: 'cloud', CLOUD_SYNC_URL: 'https://nube.test', CLOUD_READ_API_KEY: 'k' }, async () => {
    dataSource._reset();
    await dataSource.refresh();
    try { await fn(); } finally { dataSource._reset(); }
  });
}

test('modo nube: una vista publicada se responde desde la réplica con la llave de lectura', () => enModoNube(async () => {
  let pedido = null;
  const mw = createReplicaMiddleware({
    fetchImpl: async (url, opts) => {
      pedido = { url, opts };
      return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json', 'x-replica-generado': '2026-10-26T10:00:00Z' } });
    },
  });
  const res = fakeRes();
  let siguio = false;
  await mw(fakeReq('/ventas?fechaInicio=2026-10-01&fechaFin=2026-10-31&fresh=1'), res, () => { siguio = true; });
  assert.equal(siguio, false);
  assert.equal(res.body, '{"ok":1}');
  assert.equal(res.headers['x-data-source'], 'cloud');
  assert.equal(pedido.opts.headers['X-Read-Key'], 'k');
  assert.match(pedido.url, /ruta=%2Fventas&consulta=fechaFin%3D2026-10-31%26fechaInicio%3D2026-10-01$/);
}));

test('modo nube: pendiente, sin nube, escrituras y vistas de cliente se resuelven en local', () => enModoNube(async () => {
  let llamadas = 0;
  const casos = [
    { mw: createReplicaMiddleware({ fetchImpl: async () => { llamadas += 1; return new Response('{}', { status: 503 }); } }), req: fakeReq('/ventas') },
    { mw: createReplicaMiddleware({ fetchImpl: async () => { llamadas += 1; throw new Error('sin red'); } }), req: fakeReq('/ventas') },
    { mw: createReplicaMiddleware({ fetchImpl: async () => { llamadas += 1; return new Response('{}'); } }), req: fakeReq('/ventas', 'POST') },
    { mw: createReplicaMiddleware({ fetchImpl: async () => { llamadas += 1; return new Response('{}'); } }), req: fakeReq('/seguimiento-360/cliente/7') },
    { mw: createReplicaMiddleware({ fetchImpl: async () => { llamadas += 1; return new Response('{}'); } }), req: fakeReq('/ai/status') },
  ];
  for (const c of casos) {
    let siguio = false;
    await c.mw(c.req, fakeRes(), () => { siguio = true; }); // eslint-disable-line no-await-in-loop
    assert.equal(siguio, true, `${c.req.method} ${c.req.originalUrl} debía resolverse en local`);
  }
  assert.equal(llamadas, 2, 'POST, vistas de cliente e IA no deben consultar la nube');
}));

test('modo SQL Server: el middleware no interviene', async () => {
  dataSource._reset();
  let siguio = false;
  await createReplicaMiddleware({ fetchImpl: async () => { throw new Error('no'); } })(fakeReq('/ventas'), fakeRes(), () => { siguio = true; });
  assert.equal(siguio, true);
});

// ── Punta a punta con la ruta real de la nube ───────────────────────────────

let cloudDeps = true;
try { require.resolve('express', { paths: [CLOUD] }); require.resolve('pg', { paths: [CLOUD] }); } catch { cloudDeps = false; }
const PG_URL = process.env.CRM_PG_URL_TEST;
const conNube = {
  skip: !PG_URL ? 'define CRM_PG_URL_TEST para probar contra PostgreSQL'
    : (!cloudDeps ? 'falta npm install en cloud-api' : false),
};

test('publicar → pedir lo faltante → leer desde un backend sin SQL Server', conNube, async (t) => {
  process.env.DATABASE_URL = PG_URL;
  process.env.PG_SSL = 'false';
  process.env.CLOUD_SYNC_API_KEY = 'llave-publicar';
  process.env.CLOUD_READ_API_KEY = 'llave-leer';
  const express = require(require.resolve('express', { paths: [CLOUD] }));
  const { query, getPool } = require(path.join(CLOUD, 'src/db'));
  await query('DROP TABLE IF EXISTS desktop_cache');
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/desktop-cache', require(path.join(CLOUD, 'src/routes/desktopCache')));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); await getPool().end(); dataSource._reset(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  await conEnv({
    CLOUD_SYNC_ENABLED: 'true', CLOUD_SYNC_URL: base, DATA_SOURCE: 'auto', DB_HOST: undefined,
  }, async () => {
    // Llave equivocada: la nube no entrega nada.
    const malo = await fetch(`${base}/api/desktop-cache?ruta=/ventas&consulta=`, { headers: { 'X-Read-Key': 'otra' } });
    assert.equal(malo.status, 401);

    // 1) Un usuario sin SQL Server pide una vista que nadie ha publicado → local.
    process.env.DATA_SOURCE = 'cloud';
    dataSource._reset();
    await dataSource.refresh();
    const mw = createReplicaMiddleware();
    const consulta = 'fechaInicio=2026-09-01&fechaFin=2026-09-30';
    let local = false;
    await mw(fakeReq(`/ventas/afluencia?${consulta}`), fakeRes(), () => { local = true; });
    assert.equal(local, true);

    // 2) La oficina (con SQL Server) publica las vistas iniciales y la pedida.
    process.env.DATA_SOURCE = 'sql';
    dataSource._reset();
    const vistas = [];
    const r = await publisher.publish({
      reason: 'prueba',
      compute: async (item) => { vistas.push(item.ruta); return { status: 200, json: true, body: JSON.stringify({ ruta: item.ruta, consulta: item.consulta, unidades: 42 }) }; },
    });
    assert.equal(r.ok, true, r.error || r.reason);
    assert.ok(vistas.includes('/ventas/afluencia'), 'la vista pedida debe publicarse en el siguiente ciclo');
    assert.equal(r.errores, 0);

    // 3) Ahora el usuario sin SQL Server la recibe de la nube.
    process.env.DATA_SOURCE = 'cloud';
    dataSource._reset();
    await dataSource.refresh();
    const res = fakeRes();
    local = false;
    await mw(fakeReq(`/ventas/afluencia?${consulta}`), res, () => { local = true; });
    assert.equal(local, false);
    assert.equal(res.headers['x-data-source'], 'cloud');
    assert.equal(JSON.parse(res.body).unidades, 42);
    assert.ok(res.headers['x-replica-generado']);

    // 4) La nube rechaza publicar vistas de un cliente aunque se lo pidan.
    const sub = await fetch(`${base}/api/desktop-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'llave-publicar' },
      body: JSON.stringify({ entries: [{ ruta: '/seguimiento-360/cliente/1', consulta: '', status: 200, body: '{}' }] }),
    });
    assert.deepEqual(await sub.json(), { ok: true, guardadas: 0, rechazadas: 1 });
  });
});

test('modo nube: un perfil de sucursal no lee la réplica; sigue a SQL local con alcance', () => enModoNube(async () => {
  let llamadas = 0;
  const mw = createReplicaMiddleware({ fetchImpl: async () => { llamadas += 1; return new Response('{"agencia":1}'); } });
  const res = fakeRes();
  res.json = (b) => { res.body = b; return res; };
  let siguio = false;
  const req = { ...fakeReq('/ventas?fechaInicio=2026-10-01&fechaFin=2026-10-31'), session: { username: 'cholula', role: 'cholula' } };
  await mw(req, res, () => { siguio = true; });
  assert.equal(llamadas, 0, 'no debe pedir la réplica de toda la agencia');
  assert.equal(siguio, true, 'debe atender en local con filtro de sucursal');
  assert.equal(res.headers['x-data-source'], 'local-sucursal');
}));
