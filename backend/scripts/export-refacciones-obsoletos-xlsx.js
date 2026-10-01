/**
 * Excel de refacciones obsoletas: existencia > 0 y ≥90 días sin venta
 * (o sin fecha de última venta). Excluye HyP (grupo 32 / almacén ALM8).
 *
 * Uso: node scripts/export-refacciones-obsoletos-xlsx.js [rutaSalida]
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { query } = require('../src/db');

const HOY = new Date().toISOString().slice(0, 10);
const OUT = process.argv[2]
  || path.join(__dirname, '../data', `refacciones-obsoletos-${HOY}.xlsx`);

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function bucketDias(dias) {
  const d = Number(dias);
  if (!Number.isFinite(d) || d >= 9999) return 'Sin venta registrada';
  if (d >= 365) return '365 días o más';
  if (d >= 180) return '180 a 364 días';
  return '90 a 179 días';
}

async function loadObsoletos() {
  return query(`
    SELECT
      LTRIM(RTRIM(a.ALM_IDPARTE)) AS parte,
      LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, ''))) AS descripcion,
      LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
      LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, ''))) AS grupo,
      LTRIM(RTRIM(ISNULL(g.PAR_DESCRIP1, ''))) AS grupoLabel,
      LTRIM(RTRIM(ISNULL(p.PTS_LINEA, ''))) AS linea,
      LTRIM(RTRIM(ISNULL(a.ALM_CLASIFICA, ''))) AS clasifica,
      CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) AS existencia,
      CAST(ISNULL(a.ALM_APARTADA, 0) AS float) AS apartada,
      CAST(ISNULL(a.ALM_CTOPROM, 0) AS float) AS costoPromedio,
      CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) * CAST(ISNULL(a.ALM_CTOPROM, 0) AS float) AS costo,
      a.ALM_FECHULTVEN AS ultimaVenta,
      a.ALM_FECHULCOM AS ultimaCompra,
      CASE
        WHEN a.ALM_FECHULTVEN IS NULL OR LTRIM(RTRIM(a.ALM_FECHULTVEN)) = '' THEN 9999
        WHEN LEN(RTRIM(a.ALM_FECHULTVEN)) = 10
          THEN DATEDIFF(day, CONVERT(datetime, a.ALM_FECHULTVEN, 103), GETDATE())
        ELSE 9999
      END AS diasSinVenta
    FROM PAR_ALMACEN a
    LEFT JOIN PAR_PARTES p
      ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(a.ALM_IDPARTE))
    LEFT JOIN PNC_PARAMETR g
      ON g.PAR_TIPOPARA IN ('GP', 'GS')
     AND LTRIM(RTRIM(g.PAR_IDENPARA)) = LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, '')))
    WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
      AND ISNULL(a.ALM_EXISTEN, 0) > 0
      AND UPPER(LTRIM(RTRIM(a.ALM_IDALMA))) <> 'ALM8'
      AND LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, ''))) <> '32'
      AND (
        a.ALM_FECHULTVEN IS NULL OR LTRIM(RTRIM(a.ALM_FECHULTVEN)) = ''
        OR (LEN(RTRIM(a.ALM_FECHULTVEN)) = 10
            AND CONVERT(datetime, a.ALM_FECHULTVEN, 103) < DATEADD(day, -90, GETDATE()))
      )
    ORDER BY
      CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) * CAST(ISNULL(a.ALM_CTOPROM, 0) AS float) DESC
  `);
}

function acumular(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, { corte: labelFn(r, key), lineas: 0, existencia: 0, costo: 0 });
    const g = map.get(key);
    g.lineas += 1;
    g.existencia += Number(r.existencia) || 0;
    g.costo += Number(r.costo) || 0;
  }
  return [...map.values()].sort((a, b) => b.costo - a.costo);
}

function filaResumen(g) {
  return {
    Corte: g.corte,
    Líneas: g.lineas,
    Existencia: round2(g.existencia),
    'Costo inmovilizado': round2(g.costo),
  };
}

function resumen(rows) {
  const total = {
    corte: 'TOTAL refacciones obsoletas',
    lineas: rows.length,
    existencia: rows.reduce((s, r) => s + (Number(r.existencia) || 0), 0),
    costo: rows.reduce((s, r) => s + (Number(r.costo) || 0), 0),
  };
  const ordenDias = ['90 a 179 días', '180 a 364 días', '365 días o más', 'Sin venta registrada'];
  const porDias = acumular(rows, (r) => bucketDias(r.diasSinVenta), (r) => bucketDias(r.diasSinVenta));
  porDias.sort((a, b) => ordenDias.indexOf(a.corte) - ordenDias.indexOf(b.corte));
  const porAlmacen = acumular(rows, (r) => r.almacen || '—', (r, k) => `Almacén ${k}`);
  return [
    filaResumen(total),
    { Corte: '— Por antigüedad —', Líneas: '', Existencia: '', 'Costo inmovilizado': '' },
    ...porDias.map(filaResumen),
    { Corte: '— Por almacén —', Líneas: '', Existencia: '', 'Costo inmovilizado': '' },
    ...porAlmacen.map(filaResumen),
  ];
}

(async () => {
  const raw = await loadObsoletos();
  const rows = (raw || []).map((r) => ({
    Parte: String(r.parte || '').trim(),
    Descripción: String(r.descripcion || '').trim() || 'Sin descripción',
    Almacén: String(r.almacen || '').trim(),
    Grupo: String(r.grupo || '').trim(),
    'Grupo nombre': String(r.grupoLabel || '').trim(),
    Línea: String(r.linea || '').trim(),
    Clasificación: String(r.clasifica || '').trim(),
    Existencia: round2(r.existencia),
    Apartada: round2(r.apartada),
    'Costo promedio': round2(r.costoPromedio),
    'Costo inmovilizado': round2(r.costo),
    'Última venta': r.ultimaVenta ? String(r.ultimaVenta).trim() : '',
    'Días sin venta': Number(r.diasSinVenta) >= 9999 ? null : Number(r.diasSinVenta),
    Antigüedad: bucketDias(r.diasSinVenta),
    'Última compra': r.ultimaCompra ? String(r.ultimaCompra).trim() : '',
  }));

  const wb = XLSX.utils.book_new();
  const wsRes = XLSX.utils.json_to_sheet(resumen(raw || []));
  wsRes['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 16 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen');

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 18 }, { wch: 42 }, { wch: 10 }, { wch: 8 }, { wch: 28 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 },
    { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Obsoletos');

  XLSX.writeFile(wb, OUT);
  const costo = rows.reduce((s, r) => s + r['Costo inmovilizado'], 0);
  console.log(JSON.stringify({
    archivo: OUT,
    lineas: rows.length,
    costo: round2(costo),
  }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
