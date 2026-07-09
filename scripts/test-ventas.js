require('dotenv').config();

async function test() {
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const url = `${base}/api/ventas?fechaInicio=2026-01-01&fechaFin=2026-06-30`;
  console.log('Probando:', url);
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  console.log('OK:', data.resumen.totalVentas, 'ventas,', data.resumen.totalNotificacionesEntrega, 'SOFIA');
}

test().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
