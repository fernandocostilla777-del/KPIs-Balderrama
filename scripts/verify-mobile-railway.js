/* Verifica endpoints móviles contra Railway (sin secretos en logs). */
const BASE = process.env.CLOUD_API_URL || 'https://kpis-balderrama-production.up.railway.app';

function credentialsFromEnv() {
  if (process.env.MOBILE_TEST_USER && process.env.MOBILE_TEST_PASS) {
    return { user: process.env.MOBILE_TEST_USER, pass: process.env.MOBILE_TEST_PASS };
  }
  if (process.env.MOBILE_USER && process.env.MOBILE_PASS) {
    return { user: process.env.MOBILE_USER, pass: process.env.MOBILE_PASS };
  }
  const raw = String(process.env.MOBILE_AUTH_USERS || '').trim();
  if (!raw) return { user: '', pass: '' };
  const first = raw.split(';')[0] || '';
  const [user, pass] = first.split(':');
  return { user: String(user || ''), pass: String(pass || '') };
}

const { user: USER, pass: PASS } = credentialsFromEnv();

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

function ok(label, cond, detail = '') {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return cond;
}

(async () => {
  console.log(`Base: ${BASE}`);
  let failed = 0;

  const health = await req('/api/health');
  if (!ok('GET /api/health', health.status === 200, `status=${health.status}`)) failed += 1;
  else console.log('     ', JSON.stringify(health.body).slice(0, 160));

  if (!USER || !PASS) {
    console.log('SKIP  login/metrics — define MOBILE_TEST_USER y MOBILE_TEST_PASS (o MOBILE_USER/PASS)');
    process.exit(failed ? 1 : 0);
  }

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!ok('POST /api/auth/login', login.status === 200 && login.body?.ok && login.body?.token, `status=${login.status}`)) {
    failed += 1;
    process.exit(1);
  }
  const token = login.body.token;
  const auth = { Authorization: `Bearer ${token}` };
  console.log('     user=', login.body.user?.username, 'role=', login.body.user?.role);

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  const q = `fechaInicio=${y}-${m}-01&fechaFin=${y}-${m}-${String(last).padStart(2, '0')}`;

  const checks = [
    ['GET /api/mobile/overview', `/api/mobile/overview?${q}`],
    ['GET /api/mobile/ventas', `/api/mobile/ventas?${q}`],
    ['GET metrics post-sales', `/api/mobile/metrics/post-sales?${q}&area=posventa`],
    ['GET metrics hyp', `/api/mobile/metrics/post-sales?${q}&area=hyp`],
    ['GET metrics servicio', `/api/mobile/metrics/post-sales?${q}&area=servicio`],
    ['GET ai/status', '/api/mobile/ai/status'],
  ];

  for (const [label, path] of checks) {
    const r = await req(path, { headers: auth });
    const pass = r.status === 200 && typeof r.body === 'object';
    if (!ok(label, pass, `status=${r.status}`)) failed += 1;
    else if (r.body?.kpis) {
      console.log('     kpis=', (r.body.kpis || []).map((k) => k.label).slice(0, 4).join(', '));
    } else if (r.body?.hero) {
      console.log('     hero=', r.body.hero?.label, r.body.hero?.value);
    } else if (r.body?.configured != null) {
      console.log('     ai configured=', r.body.configured, 'sections=', (r.body.sections || []).join(','));
    }
  }

  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('ERR', err.message);
  process.exit(1);
});
