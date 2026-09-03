/**
 * Utilidades compartidas para leer export Balderrama Ciclos (CSV / XLSX).
 */
const fs = require('fs');
const readline = require('readline');
const XLSX = require('xlsx');

const COLUMNS = [
  'ID_CONTACTO', 'NOMBRE_CONTACTO', 'ID_CICLO', 'FECHA_INICIO_CICLO',
  'FECHA_ESPERADA_CIERRE', 'ESTATUS', 'FECHA_ESTATUS', 'TIPO_ACTIVIDAD',
  'FECHA_CREA_ACTIVIDAD', 'FECHA_PROG_ACTIVIDAD', 'FECHA_RESP_ACTIVIDAD',
  'RESULTADO_ACTIVIDAD', 'FORMA_CONTACTO', 'MEDIO_CONTACTO', 'SUBMEDIO_CONTACTO',
  'NUM_FACTURA', 'FACTURADO_A', 'PRODUCTO_VENDIDO', 'FECHA_FACTURA', 'VIN',
  'FECHA_ENTREGA', 'VENDEDOR',
];

const DATE_COLS = new Set([
  'FECHA_INICIO_CICLO', 'FECHA_ESPERADA_CIERRE', 'FECHA_ESTATUS',
  'FECHA_CREA_ACTIVIDAD', 'FECHA_PROG_ACTIVIDAD', 'FECHA_RESP_ACTIVIDAD',
  'FECHA_FACTURA', 'FECHA_ENTREGA',
]);

function toIso(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const number = Number(value);
  if (Number.isFinite(number) && number > 20000 && number < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + number * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function mapRecord(header, cells) {
  const rec = {};
  for (const col of COLUMNS) {
    const idx = header.indexOf(col);
    let val = idx >= 0 ? cells[idx] : null;
    if (DATE_COLS.has(col)) val = toIso(val);
    else val = cleanText(val);
    rec[col] = val;
  }
  return rec;
}

function toCloudRow(rec) {
  const limits = {
    id_contacto: 64,
    nombre_contacto: 255,
    id_ciclo: 64,
    fecha_inicio_ciclo: 40,
    fecha_esperada_cierre: 40,
    estatus: 80,
    fecha_estatus: 40,
    tipo_actividad: 120,
    fecha_crea_actividad: 40,
    fecha_prog_actividad: 40,
    fecha_resp_actividad: 40,
    resultado_actividad: 255,
    forma_contacto: 80,
    medio_contacto: 80,
    submedio_contacto: 120,
    num_factura: 64,
    facturado_a: 255,
    producto_vendido: 255,
    fecha_factura: 40,
    vin: 32,
    fecha_entrega: 40,
    vendedor: 160,
  };
  const trim = (value, max) => {
    const text = value == null ? '' : String(value).trim();
    return text.slice(0, max);
  };
  return {
    id_contacto: trim(rec.ID_CONTACTO, limits.id_contacto),
    nombre_contacto: trim(rec.NOMBRE_CONTACTO, limits.nombre_contacto),
    id_ciclo: trim(rec.ID_CICLO, limits.id_ciclo),
    fecha_inicio_ciclo: trim(rec.FECHA_INICIO_CICLO, limits.fecha_inicio_ciclo),
    fecha_esperada_cierre: trim(rec.FECHA_ESPERADA_CIERRE, limits.fecha_esperada_cierre),
    estatus: trim(rec.ESTATUS, limits.estatus),
    fecha_estatus: trim(rec.FECHA_ESTATUS, limits.fecha_estatus),
    tipo_actividad: trim(rec.TIPO_ACTIVIDAD, limits.tipo_actividad),
    fecha_crea_actividad: trim(rec.FECHA_CREA_ACTIVIDAD, limits.fecha_crea_actividad),
    fecha_prog_actividad: trim(rec.FECHA_PROG_ACTIVIDAD, limits.fecha_prog_actividad),
    fecha_resp_actividad: trim(rec.FECHA_RESP_ACTIVIDAD, limits.fecha_resp_actividad),
    resultado_actividad: trim(rec.RESULTADO_ACTIVIDAD, limits.resultado_actividad),
    forma_contacto: trim(rec.FORMA_CONTACTO, limits.forma_contacto),
    medio_contacto: trim(rec.MEDIO_CONTACTO, limits.medio_contacto),
    submedio_contacto: trim(rec.SUBMEDIO_CONTACTO, limits.submedio_contacto),
    num_factura: trim(rec.NUM_FACTURA, limits.num_factura),
    facturado_a: trim(rec.FACTURADO_A, limits.facturado_a),
    producto_vendido: trim(rec.PRODUCTO_VENDIDO, limits.producto_vendido),
    fecha_factura: trim(rec.FECHA_FACTURA, limits.fecha_factura),
    vin: trim(rec.VIN, limits.vin),
    fecha_entrega: trim(rec.FECHA_ENTREGA, limits.fecha_entrega),
    vendedor: trim(rec.VENDEDOR, limits.vendedor),
  };
}

async function* iterCiclosRecords(sourcePath) {
  const ext = require('path').extname(sourcePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(sourcePath);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    });
    if (!rows.length) return;
    const header = rows[0].map((h) => String(h || '').trim().toUpperCase());
    for (let i = 1; i < rows.length; i++) {
      const rec = mapRecord(header, rows[i] || []);
      if (!rec.ID_CONTACTO) continue;
      yield rec;
    }
    return;
  }

  let header = null;
  const rl = readline.createInterface({
    input: fs.createReadStream(sourcePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line.replace(/^\uFEFF/, '')).map((h) => h.trim().toUpperCase());
      continue;
    }
    if (!line.trim()) continue;
    const rec = mapRecord(header, parseCsvLine(line));
    if (!rec.ID_CONTACTO) continue;
    yield rec;
  }
}

function rowKeyFromCloudRow(row) {
  const crypto = require('crypto');
  const identity = [
    row.id_contacto || '',
    row.id_ciclo || '',
    row.tipo_actividad || '',
    row.fecha_crea_actividad || '',
    row.fecha_prog_actividad || '',
    row.fecha_resp_actividad || '',
    row.vin || '',
    row.num_factura || '',
  ].join('|');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

module.exports = {
  COLUMNS,
  iterCiclosRecords,
  toCloudRow,
  rowKeyFromCloudRow,
};
