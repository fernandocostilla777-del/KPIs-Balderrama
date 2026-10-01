/**
 * Excel: compras mes a mes a planta GM + inventario actual
 * y cuánto hay que vender (a costo) para sostener 5.6 M/mes sin saturar.
 *
 * Uso: node scripts/export-compras-planta-gm-xlsx.js [metaMensual] [rutaSalida]
 * Ejemplo: node scripts/export-compras-planta-gm-xlsx.js 5600000
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { query } = require('../src/db');

const META_MENSUAL = Number(process.argv[2] || 5600000);
const OUT = process.argv[3]
  || path.join(__dirname, '../data', `compras-planta-gm-inventario-${new Date().toISOString().slice(0, 10)}.xlsx`);

const PROV_GM = 2;
const TIPO_COMPRA = '01';
const TIPO_DEV_COMPRA = '51';

const fechaOk = (a, col) => `
  ${a}.${col} IS NOT NULL
  AND LEN(RTRIM(${a}.${col})) = 10
  AND SUBSTRING(${a}.${col}, 3, 1) = '/'
  AND SUBSTRING(${a}.${col}, 6, 1) = '/'
  AND ISNUMERIC(SUBSTRING(${a}.${col}, 1, 2)) = 1
  AND ISNUMERIC(SUBSTRING(${a}.${col}, 4, 2)) = 1
  AND ISNUMERIC(SUBSTRING(${a}.${col}, 7, 4)) = 1
`;

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function money(n) {
  return round2(n);
}

async function getInventarioActual() {
  const rows = await query(`
    SELECT
      COUNT(*) AS lineas,
      SUM(CASE WHEN ISNULL(a.ALM_EXISTEN, 0) > 0 THEN 1 ELSE 0 END) AS conStock,
      SUM(CAST(ISNULL(a.ALM_EXISTEN, 0) AS float)) AS existencia,
      SUM(CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) * CAST(ISNULL(a.ALM_CTOPROM, 0) AS float)) AS costo,
      SUM(CAST(ISNULL(a.ALM_APARTADA, 0) AS float) * CAST(ISNULL(a.ALM_CTOPROM, 0) AS float)) AS costoApartado,
      COUNT(DISTINCT LTRIM(RTRIM(a.ALM_IDALMA))) AS almacenes
    FROM PAR_ALMACEN a
    WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
  `);
  const r = rows[0] || {};
  return {
    lineas: Number(r.lineas || 0),
    conStock: Number(r.conStock || 0),
    existencia: round2(r.existencia),
    costo: round2(r.costo),
    costoApartado: round2(r.costoApartado),
    almacenes: Number(r.almacenes || 0),
  };
}

async function getComprasMensuales() {
  return query(`
    SELECT
      CONVERT(char(7), CONVERT(datetime, m.Mov_Fecha, 103), 126) AS mes,
      COUNT(DISTINCT CASE WHEN RTRIM(m.Mov_TipoMov) = '${TIPO_COMPRA}' THEN m.Mov_Numero END) AS docsCompra,
      COUNT(DISTINCT CASE WHEN RTRIM(m.Mov_TipoMov) = '${TIPO_DEV_COMPRA}' THEN m.Mov_Numero END) AS docsDev,
      SUM(CASE WHEN RTRIM(m.Mov_TipoMov) = '${TIPO_COMPRA}'
        THEN CAST(ISNULL(d.Mod_Total, 0) AS float) ELSE 0 END) AS compra,
      SUM(CASE WHEN RTRIM(m.Mov_TipoMov) = '${TIPO_DEV_COMPRA}'
        THEN CAST(ISNULL(d.Mod_Total, 0) AS float) ELSE 0 END) AS devolucion,
      SUM(CASE WHEN RTRIM(m.Mov_TipoMov) = '${TIPO_COMPRA}'
        THEN CAST(ISNULL(d.Mod_Cantidad, 0) AS float) ELSE 0 END) AS piezasCompra,
      SUM(CASE WHEN RTRIM(m.Mov_TipoMov) = '${TIPO_DEV_COMPRA}'
        THEN CAST(ISNULL(d.Mod_Cantidad, 0) AS float) ELSE 0 END) AS piezasDev
    FROM PAR_MOVTOS m
    INNER JOIN PAR_MOVDET d
      ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
    WHERE CAST(ISNULL(m.Mov_Idpersona, 0) AS int) = ${PROV_GM}
      AND RTRIM(ISNULL(m.Mov_TipoMov, '')) IN ('${TIPO_COMPRA}', '${TIPO_DEV_COMPRA}')
      AND ${fechaOk('m', 'Mov_Fecha')}
      AND CONVERT(datetime, m.Mov_Fecha, 103) >= '2025-01-01'
    GROUP BY CONVERT(char(7), CONVERT(datetime, m.Mov_Fecha, 103), 126)
    ORDER BY mes
  `);
}

/**
 * Salida de inventario a costo (todas las líneas con cantidad < 0).
 * Aproxima el "consumo/venta" que libera cupo para comprar a planta.
 */
async function getSalidasCostoMensuales() {
  const costoUnit = `ISNULL(NULLIF(d.Mod_CunProm, 0), ISNULL(d.mod_ctopromact, 0))`;
  return query(`
    SELECT
      CONVERT(char(7), CONVERT(datetime, m.Mov_Fecha, 103), 126) AS mes,
      SUM(ABS(CAST(ISNULL(d.Mod_Cantidad, 0) AS float)) * CAST(${costoUnit} AS float)) AS salidaCosto,
      SUM(CASE
        WHEN RTRIM(ISNULL(m.Mov_TipoMov, '')) IN ('60','61','62','63','64','65','66','74','75','76','77','78','200')
        THEN ABS(CAST(ISNULL(d.Mod_Cantidad, 0) AS float)) * CAST(${costoUnit} AS float)
        ELSE 0 END) AS ventaCosto,
      SUM(CASE
        WHEN RTRIM(ISNULL(m.Mov_TipoMov, '')) IN ('80','81')
        THEN ABS(CAST(ISNULL(d.Mod_Cantidad, 0) AS float)) * CAST(${costoUnit} AS float)
        ELSE 0 END) AS surtidoTallerCosto,
      SUM(ABS(CAST(ISNULL(d.Mod_Cantidad, 0) AS float))) AS piezas
    FROM PAR_MOVTOS m
    INNER JOIN PAR_MOVDET d
      ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
    WHERE ${fechaOk('m', 'Mov_Fecha')}
      AND CONVERT(datetime, m.Mov_Fecha, 103) >= '2025-01-01'
      AND CAST(ISNULL(d.Mod_Cantidad, 0) AS float) < 0
    GROUP BY CONVERT(char(7), CONVERT(datetime, m.Mov_Fecha, 103), 126)
    ORDER BY mes
  `);
}

async function getTopPartesInventario(limit = 40) {
  return query(`
    SELECT TOP (${limit})
      LTRIM(RTRIM(a.ALM_IDPARTE)) AS parte,
      LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, ''))) AS descripcion,
      LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
      CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) AS existencia,
      CAST(ISNULL(a.ALM_CTOPROM, 0) AS float) AS costoPromedio,
      CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) * CAST(ISNULL(a.ALM_CTOPROM, 0) AS float) AS costo
    FROM PAR_ALMACEN a
    LEFT JOIN PAR_PARTES p
      ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(a.ALM_IDPARTE))
    WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
      AND ISNULL(a.ALM_EXISTEN, 0) > 0
    ORDER BY CAST(ISNULL(a.ALM_EXISTEN, 0) AS float) * CAST(ISNULL(a.ALM_CTOPROM, 0) AS float) DESC
  `);
}

function buildWorkbook({ inventario, compras, salidas, topPartes, meta }) {
  const wb = XLSX.utils.book_new();
  const invCosto = money(inventario.costo);
  const pctMetaSobreInv = invCosto > 0 ? round2((meta / invCosto) * 100) : null;
  const diasCobertura = meta > 0 ? round2(invCosto / (meta / 30)) : null;

  const salidasByMes = new Map(
    (salidas || []).map((r) => [String(r.mes || '').trim(), r]),
  );

  const mensualRows = (compras || []).map((r) => {
    const mes = String(r.mes || '').trim();
    const compra = money(r.compra);
    const devolucion = money(Math.abs(Number(r.devolucion || 0)));
    const neto = money(compra - devolucion);
    const sal = salidasByMes.get(mes) || {};
    const salidaCosto = money(sal.salidaCosto);
    const ventaCosto = money(sal.ventaCosto);
    const surtido = money(sal.surtidoTallerCosto);
    const gapVsMeta = money(neto - meta);
    const liberacionVsCompra = money(salidaCosto - neto);
    const faltanteParaMeta = money(Math.max(0, meta - salidaCosto));
    return {
      mes,
      docsCompra: Number(r.docsCompra || 0),
      compra,
      devolucion,
      compraNeta: neto,
      piezasNetas: round2(Number(r.piezasCompra || 0) + Number(r.piezasDev || 0)),
      salidaInventarioCosto: salidaCosto,
      ventaCosto,
      surtidoTallerCosto: surtido,
      compraVsMeta560: gapVsMeta,
      liberacionNeto: liberacionVsCompra,
      faltanteVentaParaSoportarMeta: faltanteParaMeta,
    };
  });

  const cerrados = mensualRows.filter((r) => r.mes < '2026-09');
  const avgCompraNeta = cerrados.length
    ? money(cerrados.reduce((s, r) => s + r.compraNeta, 0) / cerrados.length)
    : 0;
  const avgSalida = cerrados.length
    ? money(cerrados.reduce((s, r) => s + r.salidaInventarioCosto, 0) / cerrados.length)
    : 0;
  const avgVentaCosto = cerrados.length
    ? money(cerrados.reduce((s, r) => s + r.ventaCosto, 0) / cerrados.length)
    : 0;

  // --- Hoja Resumen ---
  const resumenAoA = [
    ['Compras a planta GM vs inventario — escenario sin saturar'],
    ['Generado', new Date().toLocaleString('es-MX')],
    ['Proveedor', '2 — GENERAL MOTORS DE MEXICO, S. DE R.L. DE C.V.'],
    ['Fuente compra', 'PAR_MOVTOS/PAR_MOVDET tipo 01 (COMPRAS PLANTA) − 51 (DEV)'],
    ['Fuente inventario', 'PAR_ALMACEN (existencia × costo promedio)'],
    ['Fuente salidas', 'PAR_MOVDET cantidad < 0 valuada a costo promedio del movimiento'],
    [],
    ['META COMPRA MENSUAL A PLANTA', meta],
    [],
    ['INVENTARIO ACTUAL'],
    ['Costo inventario (MXN)', invCosto],
    ['Costo apartado (MXN)', money(inventario.costoApartado)],
    ['Líneas con stock', inventario.conStock],
    ['Existencia (piezas)', inventario.existencia],
    ['Almacenes', inventario.almacenes],
    [],
    ['PARA COMPRAR LA META SIN CRECER EL INVENTARIO'],
    ['Debe salir del inventario (a costo) cada mes', meta],
    ['% del inventario actual a rotar / mes', pctMetaSobreInv == null ? '—' : `${pctMetaSobreInv}%`],
    ['Días de inventario si rotas a ritmo de la meta', diasCobertura == null ? '—' : diasCobertura],
    ['Interpretación', 'Si compras 5.6 M y vendes/consumes < 5.6 M a costo, el inventario sube (satura).'],
    [],
    ['PROMEDIOS MESES CERRADOS (2025-01 a penúltimo mes completo en serie)'],
    ['Promedio compra neta planta', avgCompraNeta],
    ['Promedio salida inventario a costo', avgSalida],
    ['Promedio venta a costo (mostrador/taller/mayoreo)', avgVentaCosto],
    ['Gap promedio compra vs meta 5.6 M', money(avgCompraNeta - meta)],
    ['Gap promedio salida vs meta 5.6 M', money(avgSalida - meta)],
    ['¿La salida actual sostiene la meta?', avgSalida >= meta ? 'SÍ' : 'NO — falta vender/consumir a costo'],
    ['Faltante promedio de salida vs meta', money(Math.max(0, meta - avgSalida))],
    [],
    ['NOTA MÉTODO'],
    ['1. La meta 5.6 M es compra a costo planta.'],
    ['2. Para no saturar, la salida de inventario valuada a costo debe ser ≥ 5.6 M/mes.'],
    ['3. "% del inventario" = meta / inventario actual (rotación mensual requerida a costo).'],
    ['4. Septiembre 2026 puede ir parcial según fecha de corte de la BD.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenAoA), 'Resumen');

  // --- Hoja Mensual ---
  const mensualAoA = [
    [
      'Mes',
      'Docs compra',
      'Compra planta',
      'Devoluciones planta',
      'Compra neta planta',
      'Piezas netas',
      'Salida inventario (costo)',
      'Venta (costo)',
      'Surtido taller (costo)',
      'Compra neta − meta 5.6M',
      'Salida − compra neta (libera cupo)',
      'Faltante de salida para soportar meta 5.6M',
    ],
    ...mensualRows.map((r) => [
      r.mes,
      r.docsCompra,
      r.compra,
      r.devolucion,
      r.compraNeta,
      r.piezasNetas,
      r.salidaInventarioCosto,
      r.ventaCosto,
      r.surtidoTallerCosto,
      r.compraVsMeta560,
      r.liberacionNeto,
      r.faltanteVentaParaSoportarMeta,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mensualAoA), 'Detalle mensual');

  // --- Escenario ---
  const escenarios = [0.8, 1.0, 1.2, 1.5].map((f) => {
    const compraMeta = money(meta * f);
    return [
      `${Math.round(f * 100)}% de meta`,
      compraMeta,
      compraMeta,
      invCosto > 0 ? round2((compraMeta / invCosto) * 100) : null,
      invCosto > 0 ? round2(invCosto / (compraMeta / 30)) : null,
    ];
  });
  const escenarioAoA = [
    ['Escenarios de compra vs inventario actual'],
    [],
    ['Inventario actual (costo)', invCosto],
    ['Meta base (MXN/mes)', meta],
    [],
    [
      'Escenario',
      'Compra planta objetivo',
      'Venta/consumo mínimo a costo para no saturar',
      '% del inventario actual',
      'Días de cobertura del inventario',
    ],
    ...escenarios,
    [],
    ['Lectura rápida'],
    [
      'Para comprar 5.6 M/mes sin subir el stock, debes sacar del inventario al menos 5.6 M a costo el mismo mes.',
    ],
    [
      invCosto > 0
        ? `Eso equivale a rotar ~${pctMetaSobreInv}% del inventario actual cada mes (~cada ${diasCobertura} días se da la vuelta al stock a ese ritmo).`
        : 'Sin inventario valuado no se puede calcular el %.',
    ],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(escenarioAoA), 'Escenario 5.6M');

  // --- Top inventario ---
  const topAoA = [
    ['Parte', 'Descripción', 'Almacén', 'Existencia', 'Costo promedio', 'Costo total'],
    ...topPartes.map((r) => [
      String(r.parte || '').trim(),
      String(r.descripcion || '').trim(),
      String(r.almacen || '').trim(),
      round2(r.existencia),
      round2(r.costoPromedio),
      round2(r.costo),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topAoA), 'Top inventario');

  return wb;
}

async function main() {
  console.log('Consultando inventario, compras planta y salidas...');
  const [inventario, compras, salidas, topPartes] = await Promise.all([
    getInventarioActual(),
    getComprasMensuales(),
    getSalidasCostoMensuales(),
    getTopPartesInventario(50),
  ]);

  console.log('Inventario costo:', money(inventario.costo));
  console.log('Meses compra:', compras.length);
  console.log('Meta mensual:', META_MENSUAL);

  const wb = buildWorkbook({
    inventario,
    compras,
    salidas,
    topPartes,
    meta: META_MENSUAL,
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  XLSX.writeFile(wb, OUT);
  console.log('Excel generado:', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
