#!/usr/bin/env node
'use strict';
/**
 * Cuadra el estado de resultados del tablero (Contabilidad › Estado de resultados)
 * contra el libro de Excel de Contraloría (EEFF SUMMARY), concepto por concepto.
 * Adaptado de cuadra-estado-resultados.js de KPIs-VECSA.
 *
 *   node backend/scripts/cuadra-estado-resultados.js --libro "C:\\ruta\\EEFF SEP 2026.xlsx" \
 *        --desde 2026-09-01 --hasta 2026-09-30 [--hoja "EDO FINANCIERO"] [--columna F] [--tolerancia 1]
 *
 * - Busca cada concepto por su nombre en la primera columna con texto (sin acentos ni
 *   mayúsculas) y lee el importe de --columna (por omisión, la última columna numérica
 *   del renglón). Imprime qué renglón tomó, para confirmarlo la primera vez.
 * - Costo y gastos se comparan en valor absoluto: el libro los trae en positivo y el
 *   tablero con el signo de la balanza.
 * - Sale con código 1 si algún concepto difiere más que la tolerancia o no se encontró.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CONCEPTOS = [
  { key: 'ventas', label: 'Total ventas', alias: ['total ventas', 'ventas totales', 'total de ventas'] },
  { key: 'costo', label: 'Costo de ventas', alias: ['costo de ventas', 'costo total', 'total costo de ventas'], absoluto: true },
  { key: 'utilidadBruta', label: 'Utilidad bruta', alias: ['utilidad bruta', 'total utilidad bruta'] },
  { key: 'gastosOperacion', label: 'Gastos de operación', alias: ['gastos de operacion', 'gastos operacion'], absoluto: true },
  { key: 'gastosAdministracion', label: 'Gastos de administración', alias: ['gastos administracion', 'gastos de administracion'], absoluto: true },
  { key: 'gastos', label: 'Total de gastos', alias: ['suma gastos', 'total gastos', 'total de gastos'], absoluto: true },
  { key: 'utilidadOperacion', label: 'Utilidad de operación', alias: ['utilidad de operacion', 'utilidad operacion'] },
  { key: 'utilidadNeta', label: 'Utilidad del periodo', alias: ['utilidad', 'utilidad neta', 'utilidad del ejercicio', 'utilidad del periodo'] },
];

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function aNumero(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[()$,\s-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const colIndex = (letra) => [...String(letra).toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/** Lee los conceptos del libro. `filas` es la hoja como arreglo de renglones. */
function leerLibro(filas, { columna = null } = {}) {
  const encontrados = {};
  filas.forEach((fila, i) => {
    const textoIdx = fila.findIndex((c) => typeof c === 'string' && c.trim());
    if (textoIdx < 0) return;
    const etiqueta = normalizar(fila[textoIdx]);
    for (const c of CONCEPTOS) {
      if (encontrados[c.key] || !c.alias.includes(etiqueta)) continue;
      let valor = null;
      if (columna) valor = aNumero(fila[colIndex(columna)]);
      else for (let j = fila.length - 1; j > textoIdx; j -= 1) { const n = aNumero(fila[j]); if (n != null) { valor = n; break; } }
      encontrados[c.key] = { renglon: i + 1, etiqueta: fila[textoIdx], valor };
    }
  });
  return encontrados;
}

/** Compara el libro contra los totales del tablero (signo de presentación). */
function comparar(libro, totales, { tolerancia = 1 } = {}) {
  return CONCEPTOS.map((c) => {
    const l = libro[c.key];
    const tablero = Number(totales?.[c.key]);
    if (!l || l.valor == null) return { ...c, estado: 'sin-renglon', tablero };
    const a = c.absoluto ? Math.abs(tablero) : tablero;
    const b = c.absoluto ? Math.abs(l.valor) : l.valor;
    const diferencia = Math.round((a - b) * 100) / 100;
    return { ...c, estado: Math.abs(diferencia) <= tolerancia ? 'ok' : 'difiere', tablero: a, libro: b, diferencia, renglon: l.renglon, etiqueta: l.etiqueta };
  });
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.libro || !a.desde || !a.hasta) {
    console.error('Uso: --libro <archivo.xlsx> --desde YYYY-MM-DD --hasta YYYY-MM-DD [--hoja "EDO FINANCIERO"] [--columna F] [--tolerancia 1]');
    process.exit(2);
  }
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(a.libro);
  const hoja = a.hoja || wb.SheetNames.find((n) => /edo\.?\s*financiero|estado de resultados/i.test(n)) || wb.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: '', raw: true });
  const libro = leerLibro(filas, { columna: a.columna || null });

  const { getEstadoResultadosFormato } = require('../src/services/contabilidadFormatoService');
  const er = await getEstadoResultadosFormato({ fechaInicio: a.desde, fechaFin: a.hasta });
  const totales = { ...er.totales };
  const resultado = comparar(libro, totales, { tolerancia: Number(a.tolerancia || 1) });

  const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }));
  console.log(`Libro: ${path.basename(a.libro)} · hoja «${hoja}» · periodo ${a.desde} a ${a.hasta}\n`);
  for (const r of resultado) {
    const marca = r.estado === 'ok' ? 'OK     ' : (r.estado === 'difiere' ? 'DIFIERE' : 'FALTA  ');
    const donde = r.renglon ? `renglón ${r.renglon} «${r.etiqueta}»` : 'no se encontró en el libro';
    console.log(`${marca} ${r.label.padEnd(26)} tablero ${fmt(r.tablero).padStart(16)}  libro ${fmt(r.libro).padStart(16)}  dif ${fmt(r.diferencia).padStart(12)}  · ${donde}`);
  }
  if (er.cuentasSinRenglon?.length) {
    console.log(`\nCuentas con saldo sin renglón: ${er.cuentasSinRenglon.length}`);
    er.cuentasSinRenglon.slice(0, 20).forEach((c) => console.log(`  ${c.cuenta}  ${c.descripcion}  ${fmt(c.importe)}`));
  }
  if (er.gastosFueraDelEstado?.length) {
    console.log('\nDepartamentos con gasto fuera del estado:');
    er.gastosFueraDelEstado.forEach((g) => console.log(`  GPO ${g.gpo} ${g.label}  ${fmt(g.importe)}`));
  }
  if (resultado.some((r) => r.estado !== 'ok')) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { leerLibro, comparar, normalizar, CONCEPTOS };
