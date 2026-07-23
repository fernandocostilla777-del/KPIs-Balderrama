const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../frontend/public');
const pages = [
  'index.html',
  'inventory.html',
  'forecast.html',
  'post-sales.html',
  'seguimiento.html',
  'sales.html',
  'contabilidad.html',
];

const tag = '<script src="/js/kpi-insights.js?v=2"></script>';

for (const f of pages) {
  const p = path.join(root, f);
  let s = fs.readFileSync(p, 'utf8');
  if (/kpi-insights\.js/.test(s)) {
    s = s.replace(/\/js\/kpi-insights\.js\?v=\d+/g, '/js/kpi-insights.js?v=2');
    fs.writeFileSync(p, s, 'utf8');
    console.log('bump', f);
    continue;
  }
  if (!/assistant-bubble\.js/.test(s)) {
    console.log('skip', f);
    continue;
  }
  s = s.replace(
    /(<script src="\/js\/assistant-bubble\.js[^"]*"><\/script>)/,
    `${tag}\n$1`
  );
  fs.writeFileSync(p, s, 'utf8');
  console.log('add', f);
}
