require('dotenv').config({ override: true });
const { getListaPreciosFicha } = require('../src/services/listaPreciosService');
const { getInventory } = require('../src/services/inventoryService');

(async () => {
  const inv = await getInventory({ planPisoPeriod: 'all' });
  const units = inv.inventoryTable || [];

  const aveo = units.filter((u) => /AVEO/i.test(u.familia || '') || /AVEO/i.test(u.tipoAuto || ''));
  const byTipo = {};
  for (const u of aveo) {
    const k = u.tipoAuto || '(sin)';
    if (!byTipo[k]) byTipo[k] = { total: 0, DIS: 0, FIS: 0, SEP: 0, other: {} };
    byTipo[k].total += 1;
    if (u.situacion === 'DIS' || u.situacion === 'FIS' || u.situacion === 'SEP') byTipo[k][u.situacion] += 1;
    else byTipo[k].other[u.situacion] = (byTipo[k].other[u.situacion] || 0) + 1;
  }

  console.log('=== INVENTARIO DMS AVEO (por tipoAuto) ===');
  Object.entries(byTipo)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([k, v]) => {
      console.log(
        `${v.total} DIS=${v.DIS} FIS=${v.FIS} SEP=${v.SEP} other=${JSON.stringify(v.other)} | ${k}`,
      );
    });

  const ficha = await getListaPreciosFicha({
    section: 'administracion',
    modelo: 'AVEO HB',
    soloConStock: '0',
  });

  console.log('\n=== LISTA PRECIOS AVEO HB ===');
  for (const v of ficha.modelos[0].versions) {
    console.log(
      `${v.version} paq=${v.paquete} msrp=${v.msrp} | total=${v.stockTotal} disp=${v.stockDisponible} apart=${v.stockApartadas} raw=${(v.inventario || []).length}`,
    );
    (v.inventario || []).slice(0, 4).forEach((u) => {
      console.log(`  ${u.situacion} score=${u.matchScore} | ${u.tipoAuto} | ${String(u.serie || '').slice(-8)}`);
    });
  }

  // Cruce: unidades DMS paq C / LT PLUS vs versión LT Plus del catálogo
  const vLt = ficha.modelos[0].versions.find((x) => x.version === 'LT Plus');
  const matchedSeries = new Set((vLt?.inventario || []).map((u) => u.serie));
  const dmsPaqC = aveo.filter((u) => /PAQ\s*"?C"?|LT\s*PLUS/i.test(u.tipoAuto || ''));
  const missing = dmsPaqC.filter((u) => !matchedSeries.has(u.serie));
  const extra = (vLt?.inventario || []).filter((u) => !dmsPaqC.some((d) => d.serie === u.serie));

  console.log('\n=== CHECK LT Plus ===');
  console.log('DMS paq C / LT PLUS:', dmsPaqC.length);
  console.log('Ficha LT Plus matched:', matchedSeries.size);
  console.log('En DMS y no en ficha:', missing.length);
  missing.slice(0, 10).forEach((u) => console.log('  miss', u.situacion, u.tipoAuto));
  console.log('En ficha y no en filtro DMS paqC:', extra.length);
  extra.slice(0, 10).forEach((u) => console.log('  extra', u.situacion, u.tipoAuto, 'score', u.matchScore));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
