require('dotenv').config();

async function test() {
  const base = 'http://localhost:3000';
  for (const path of ['/api/health', '/api/overview?year=2013', '/api/sales?year=2013', '/api/inventory', '/api/post-sales?year=2013']) {
    try {
      const res = await fetch(base + path);
      const data = await res.json();
      console.log(path, res.status, JSON.stringify(data).slice(0, 120) + '...');
    } catch (e) {
      console.log(path, 'FAIL', e.message);
    }
  }
}

test();
