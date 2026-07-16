const { loadMesCursoNomenclatura, loadOrders } = require('../src/services/postSalesLoad');

(async () => {
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const fi = `${y}-${m}-01`;
    const ff = `${y}-${m}-${d}`;
    console.log('range', fi, ff);

    const orders = await loadOrders({ fechaInicio: fi, fechaFin: ff });
    const letters = new Set(['N', 'D', 'Q', 'C', 'X', 'Y']);
    const filtered = orders.filter((r) => r.status !== 'C' && letters.has(String(r.letraOrden || '').toUpperCase()));
    console.log('orders month', orders.length, 'filtered N..Y', filtered.length);
    console.log('sample letras', [...new Set(orders.map((r) => r.letraOrden))].slice(0, 20));
    console.log('sample status', [...new Set(orders.map((r) => r.status))].slice(0, 20));
    console.log('sample ingresoDate', orders.slice(0, 5).map((r) => ({ orden: r.orden, ingresoDate: r.ingresoDate, letra: r.letraOrden, status: r.status })));

    const data = await loadMesCursoNomenclatura();
    console.log('mesCurso total', data.totals);
    console.log('days with data', data.days.filter((x) => x.total > 0).length);
    console.log('sample days', data.days.filter((x) => x.total > 0).slice(0, 5));
  } catch (err) {
    console.error('FAIL', err.message);
    console.error(err);
    process.exit(1);
  }
  process.exit(0);
})();
