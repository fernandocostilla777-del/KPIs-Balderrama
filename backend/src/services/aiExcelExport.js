const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { loadOrders, loadOpenSnapshot } = require('./postSalesLoad');
const { filterRecords, resolveNomenclatura } = require('./postSalesOrderTypes');
const { getVentas } = require('./ventas');
const { getInventory } = require('./inventoryService');

const EXPORT_DIR = path.join(__dirname, '../../data/ai-exports');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 20000;

function normalizeEstatus(estatus) {
  const key = String(estatus || 'todas').trim().toLowerCase();
  if (['abierta', 'abiertas', 'open', 'activas', 'activa'].includes(key)) return 'abiertas';
  if (['facturada', 'facturadas'].includes(key)) return 'facturadas';
  if (['cancelada', 'canceladas'].includes(key)) return 'canceladas';
  if (!key || key === 'todas' || key === 'all') return 'todas';
  return key;
}

function toIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultYtdRange() {
  const now = new Date();
  return { fechaInicio: `${now.getFullYear()}-01-01`, fechaFin: toIsoDate(now) };
}

function ensureDir() {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function cleanupOldExports() {
  ensureDir();
  const now = Date.now();
  for (const name of fs.readdirSync(EXPORT_DIR)) {
    if (!name.endsWith('.xlsx')) continue;
    const full = path.join(EXPORT_DIR, name);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs > MAX_AGE_MS) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

function safeSheetName(name, index = 0) {
  const base = String(name || `Hoja${index + 1}`)
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31);
  return base || `Hoja${index + 1}`;
}

function safeFilename(name) {
  const raw = String(name || 'export')
    .replace(/[^\w.\-áéíóúÁÉÍÓÚñÑ ]+/gi, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'export';
  return raw.toLowerCase().endsWith('.xlsx') ? raw : `${raw}.xlsx`;
}

function writeWorkbook(sheets, filenameHint) {
  cleanupOldExports();
  ensureDir();

  const wb = XLSX.utils.book_new();
  let totalRows = 0;
  let appended = 0;

  (sheets || []).forEach((sheet, i) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows.slice(0, MAX_ROWS) : [];
    if (!rows.length) return;
    totalRows += rows.length;
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheet.name, i));
    appended += 1;
  });

  if (!appended) {
    const err = new Error('No hay filas para exportar a Excel');
    err.status = 400;
    throw err;
  }

  const fileId = crypto.randomUUID().replace(/-/g, '');
  const filename = safeFilename(filenameHint);
  const diskName = `${fileId}.xlsx`;
  const diskPath = path.join(EXPORT_DIR, diskName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(diskPath, buf);

  return {
    ok: true,
    fileId,
    filename,
    rowCount: totalRows,
    sheets: appended,
    downloadUrl: `/api/ai/exports/${fileId}?name=${encodeURIComponent(filename)}`,
    label: filename,
    expiresInHours: 24,
    mensaje: `Excel generado con ${totalRows.toLocaleString('es-MX')} fila(s). Usa el botón de descarga en el chat.`,
  };
}

function mapPostventaRows(records) {
  return (records || []).map((r) => ({
    Orden: r.orden || '',
    Factura: r.factura || '',
    Cliente: r.nombre || '',
    Asesor: r.asesor || '',
    Tipo: r.tipoOrden || r.tipoPorLetra || '',
    Letra: r.letraOrden || String(r.orden || '').charAt(0),
    Estatus: r.statusLabel || r.status || '',
    Antigüedad: r.antiguedad || '',
    Días: r.dias != null ? Number(r.dias) : '',
    Importe: Number(r.importe || 0),
    'Importe abierto': Number(r.importeAbierto || 0),
    'Importe facturado': Number(r.importeFacturado || 0),
    Ingreso: r.ingreso || r.ingresoDate || '',
    Promesa: r.promesa || '',
    Serie: r.serie || '',
    Auto: r.auto || '',
    Modelo: r.modelo || '',
    Aseguradora: r.aseguradora || '',
    Teléfono: r.celular || r.telefono || '',
    Correo: r.correo || '',
  }));
}

function mapVentasRows(data) {
  const regs = data?.registros || data?.records || [];
  return regs.map((r) => ({
    Factura: r.VTE_DOCTO || r.documento || r.factura || '',
    Fecha: r.VTE_FECHDOCTO || r.fecha || '',
    Serie: r.VTE_SERIE || r.serie || r.vin || '',
    Modelo: r.VEH_TIPOAUTO || r.MODELO || r.modelo || '',
    Cliente: r.CLIENTE || r.cliente || '',
    Vendedor: r.VENDEDOR || r.vendedor || '',
    FormaPago: r.VTE_FORMAPAGO || r.formaPago || r.CANAL || r.canal || '',
    Canal: r.CANAL || r.canal || '',
    Status: r.VTE_STATUS || r.status || '',
  }));
}

function mapInventarioRows(data) {
  const regs = data?.inventoryTable || data?.vehiculos || data?.registros || [];
  return (regs || []).map((r) => ({
    Serie: r.serie || r.vin || r.VEH_NUMSERIE || '',
    Modelo: r.tipoAuto || r.modelo || r.model || '',
    Situación: r.situacionLabel || r.situacion || r.status || '',
    Días: r.daysInStock != null ? r.daysInStock : (r.dias || ''),
    Color: r.color || '',
    Familia: r.familia || '',
    Apartada: r.isApartada ? 'Sí' : 'No',
    Costo: Number(r.importeRemision || r.costo || r.costoRemision || 0),
  }));
}

async function generateExcelExport(args = {}) {
  const fuente = String(args.fuente || 'manual').toLowerCase();
  const filename = args.filename || args.titulo || `export_${fuente}`;
  let fechaInicio = args.fechaInicio;
  let fechaFin = args.fechaFin;

  if (fuente === 'postventa' || fuente === 'hyp' || fuente === 'servicio') {
    const area = fuente === 'hyp' || fuente === 'servicio'
      ? fuente
      : (args.area || 'posventa');
    const estatus = normalizeEstatus(args.estatus || 'todas');
    const tipo = args.tipo || args.nomenclatura || null;

    let records;
    if (estatus === 'abiertas') {
      // Snapshot real de abiertas actuales (todas las que siguen abiertas hoy)
      records = filterRecords(await loadOpenSnapshot(), { area, estatus: 'abiertas', tipo });
      if (args.filtrarPorIngreso && fechaInicio && fechaFin) {
        records = records.filter((r) => {
          const d = String(r.ingresoDate || '').slice(0, 10);
          if (!d) return true;
          return d >= fechaInicio && d <= fechaFin;
        });
      }
    } else {
      if (!fechaInicio || !fechaFin) {
        const ytd = defaultYtdRange();
        fechaInicio = fechaInicio || ytd.fechaInicio;
        fechaFin = fechaFin || ytd.fechaFin;
      }
      records = filterRecords(await loadOrders({ fechaInicio, fechaFin }), { area, estatus, tipo });
    }

    if (!records.length) {
      const err = new Error(
        `No hay órdenes para exportar (área=${area}, estatus=${estatus}`
        + `${tipo ? `, tipo=${tipo}` : ''}`
        + `${fechaInicio ? `, ${fechaInicio}→${fechaFin}` : ', snapshot abiertas'})`,
      );
      err.status = 400;
      throw err;
    }

    const sheetName = (() => {
      const nomen = resolveNomenclatura(tipo);
      if (nomen?.label) return String(nomen.label).slice(0, 31);
      return area === 'hyp' ? 'HyP' : area === 'servicio' ? 'Servicio' : 'PostVenta';
    })();
    const hint = filename
      || `postventa_${area}_${estatus}${tipo ? `_${String(tipo).replace(/\s+/g, '_')}` : ''}_${fechaInicio || 'abiertas'}_${fechaFin || 'hoy'}`;
    const result = writeWorkbook([{ name: sheetName, rows: mapPostventaRows(records) }], hint);
    const nomen = resolveNomenclatura(tipo);
    return {
      ...result,
      nomenclatura: nomen
        ? { id: nomen.id, label: nomen.label, letras: nomen.letras }
        : null,
      mensaje: nomen
        ? `${result.mensaje} Nomenclatura: ${nomen.label} (letras ${nomen.letras.join(', ')}).`
        : result.mensaje,
    };
  }

  if (fuente === 'ventas') {
    if (!fechaInicio || !fechaFin) {
      const ytd = defaultYtdRange();
      fechaInicio = fechaInicio || ytd.fechaInicio;
      fechaFin = fechaFin || ytd.fechaFin;
    }
    const data = await getVentas({ fechaInicio, fechaFin });
    return writeWorkbook(
      [{ name: 'Ventas', rows: mapVentasRows(data) }],
      filename || `ventas_${fechaInicio}_${fechaFin}`,
    );
  }

  if (fuente === 'inventario') {
    const data = await getInventory({ planPisoPeriod: args.planPisoPeriod || 'all' });
    const rows = mapInventarioRows(data);
    if (!rows.length) throw new Error('No se encontraron unidades de inventario para exportar');
    return writeWorkbook([{ name: 'Inventario', rows }], filename || 'inventario');
  }

  // manual: sheets o filas
  if (Array.isArray(args.sheets) && args.sheets.length) {
    return writeWorkbook(args.sheets, filename);
  }
  if (Array.isArray(args.filas) && args.filas.length) {
    return writeWorkbook([{ name: args.hoja || 'Datos', rows: args.filas }], filename);
  }

  throw new Error(
    'generar_excel requiere fuente=postventa|ventas|inventario (con fechas) o filas/sheets manuales',
  );
}

function resolveExportPath(fileId) {
  const id = String(fileId || '').replace(/[^a-f0-9]/gi, '');
  if (!id || id.length < 16) return null;
  const diskPath = path.join(EXPORT_DIR, `${id}.xlsx`);
  if (!fs.existsSync(diskPath)) return null;
  return diskPath;
}

module.exports = {
  generateExcelExport,
  resolveExportPath,
  writeWorkbook,
  EXPORT_DIR,
};
