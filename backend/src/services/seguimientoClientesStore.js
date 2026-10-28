'use strict';
/**
 * Etiquetas de seguimiento uno a uno de clientes (leads del CRM) que pone el equipo
 * de ventas: caliente, en seguimiento, frío o no va a comprar.
 *
 * Se guardan aparte del CRM porque la carga del CRM vuelve a crear crm_leads y
 * las borraría. La clave es el id_crm del lead. Cada cambio queda en el historial
 * con quién y cuándo.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARCHIVO = () => process.env.SEGUIMIENTO_CLIENTES_PATH
  || path.join(__dirname, '../../data/seguimiento-clientes.json');

const MAX_HISTORIAL = 20;
const MAX_NOTA = 500;

const ETIQUETAS = {
  caliente: { label: 'Caliente', descripcion: 'Va a comprar pronto: ya vio la unidad, cotizó o tiene fecha.' },
  seguimiento: { label: 'En seguimiento', descripcion: 'Sigue interesado y se le está dando seguimiento.' },
  frio: { label: 'Frío', descripcion: 'Interés bajo o sin respuesta reciente; se mantiene en la cartera.' },
  no_compra: { label: 'No va a comprar', descripcion: 'Se descarta; lleva un motivo.' },
  compro: { label: 'Compró', descripcion: 'El CRM ya tiene su compra; se pone solo.' },
};

/** Etiquetas que el equipo puede poner a mano (Compró sale del CRM). */
const ETIQUETAS_MANUALES = ['caliente', 'seguimiento', 'frio', 'no_compra'];

const MOTIVOS_NO_COMPRA = {
  otra_agencia: 'Compró en otra agencia',
  credito: 'No le aprobaron crédito',
  precio: 'Precio o presupuesto',
  pospone: 'Pospuso la compra',
  no_responde: 'Ya no responde',
  otro: 'Otro',
};

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

function cargar() {
  try {
    const archivo = ARCHIVO();
    if (fs.existsSync(archivo)) {
      const data = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      if (data && typeof data.clientes === 'object' && data.clientes) {
        if (!data.revisiones || typeof data.revisiones !== 'object') data.revisiones = {};
        return data;
      }
    }
  } catch {
    /* archivo ausente o dañado: se empieza vacío */
  }
  return { clientes: {}, revisiones: {} };
}

function guardar(data) {
  const archivo = ARCHIVO();
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const tmp = `${archivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, archivo);
}

/** Etiquetas guardadas de una lista de clientes: { [idCrm]: registro }. */
function leerEtiquetas(ids) {
  const { clientes } = cargar();
  const out = {};
  for (const id of ids || []) {
    const key = String(id);
    if (clientes[key]) out[key] = clientes[key];
  }
  return out;
}

function validar({ etiqueta, motivo, nota }) {
  const clave = String(etiqueta || '').trim();
  if (clave === 'compro') throw error(400, '«Compró» se pone solo cuando el CRM registra la compra.');
  if (clave && !ETIQUETAS_MANUALES.includes(clave)) throw error(400, 'Etiqueta no válida.');
  const motivoLimpio = clave === 'no_compra' ? String(motivo || '').trim() : '';
  if (clave === 'no_compra' && !MOTIVOS_NO_COMPRA[motivoLimpio]) {
    throw error(400, 'Indica por qué no va a comprar.');
  }
  const notaLimpia = String(nota || '').replace(/\s+/g, ' ').trim();
  if (notaLimpia.length > MAX_NOTA) throw error(400, `La nota supera ${MAX_NOTA} caracteres.`);
  if (clave === 'no_compra' && motivoLimpio === 'otro' && !notaLimpia) {
    throw error(400, 'Con motivo «Otro» escribe una nota breve.');
  }
  return { clave, motivo: motivoLimpio || null, nota: notaLimpia || null };
}

/**
 * Pone, cambia o quita (etiqueta vacía) la etiqueta de un cliente.
 * Regresa el registro guardado, o null si se quitó.
 */
function etiquetar(idCrm, { etiqueta, motivo, nota, autor } = {}) {
  const key = String(idCrm || '').trim();
  if (!key) throw error(400, 'Falta el cliente.');
  const v = validar({ etiqueta, motivo, nota });
  const data = cargar();
  const previo = data.clientes[key] || null;
  const ahora = new Date().toISOString();
  const quien = String(autor || 'usuario').trim() || 'usuario';
  const entrada = { etiqueta: v.clave || null, motivo: v.motivo, nota: v.nota, autor: quien, fecha: ahora };
  const historial = [entrada, ...(previo?.historial || [])].slice(0, MAX_HISTORIAL);

  if (!v.clave) {
    if (!previo) return null;
    data.clientes[key] = { ...previo, etiqueta: null, motivo: null, nota: null, autor: quien, actualizado: ahora, historial };
  } else {
    data.clientes[key] = {
      etiqueta: v.clave,
      motivo: v.motivo,
      nota: v.nota,
      autor: quien,
      actualizado: ahora,
      historial,
    };
  }
  guardar(data);
  return data.clientes[key].etiqueta ? data.clientes[key] : null;
}

// ── Revisiones del gerente ────────────────────────────────────────────────
// Fecha en la que el gerente vuelve a confirmar con el asesor el estatus de un cliente.

const QUE_REVISAR = {
  estatus: 'Estatus del cliente',
  firma: 'Fecha de firma',
  cotizacion: 'Que envió la cotización',
  credito: 'Crédito o solicitud',
  prueba: 'Prueba de manejo',
  otro: 'Otro',
};

const ESTADOS_REVISION = ['pendiente', 'lista', 'cancelada'];

function fechaValida(v) {
  const s = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : null;
}

/** Programa una revisión. `cliente` y `vendedor` se guardan como referencia para la agenda. */
function programarRevision(idCrm, { fecha, que, nota, autor, cliente, vendedor, hoy } = {}) {
  const key = String(idCrm || '').trim();
  if (!key) throw error(400, 'Falta el cliente.');
  const dia = fechaValida(fecha);
  if (!dia) throw error(400, 'Indica la fecha de la revisión.');
  if (hoy && dia < hoy) throw error(400, 'La revisión no puede quedar en una fecha pasada.');
  const clave = String(que || '').trim();
  if (!QUE_REVISAR[clave]) throw error(400, 'Indica qué se va a confirmar.');
  const notaLimpia = String(nota || '').replace(/\s+/g, ' ').trim();
  if (notaLimpia.length > MAX_NOTA) throw error(400, `La nota supera ${MAX_NOTA} caracteres.`);
  if (clave === 'otro' && !notaLimpia) throw error(400, 'Con «Otro» escribe qué se va a confirmar.');
  const data = cargar();
  const ahora = new Date().toISOString();
  const revision = {
    id: crypto.randomUUID(),
    idCrm: key,
    fecha: dia,
    que: clave,
    nota: notaLimpia || null,
    cliente: String(cliente || '').trim() || null,
    vendedor: String(vendedor || '').trim() || null,
    autor: String(autor || 'usuario').trim() || 'usuario',
    creada: ahora,
    estado: 'pendiente',
    cerrada: null,
    cerradaPor: null,
  };
  data.revisiones[revision.id] = revision;
  guardar(data);
  return revision;
}

/** Marca una revisión como lista o cancelada (o la regresa a pendiente). */
function cerrarRevision(id, { estado, autor } = {}) {
  const data = cargar();
  const revision = data.revisiones[String(id || '')];
  if (!revision) throw error(404, 'Revisión no encontrada.');
  if (!ESTADOS_REVISION.includes(estado)) throw error(400, 'Estado no válido.');
  revision.estado = estado;
  revision.cerrada = estado === 'pendiente' ? null : new Date().toISOString();
  revision.cerradaPor = estado === 'pendiente' ? null : (String(autor || 'usuario').trim() || 'usuario');
  guardar(data);
  return revision;
}

/** Revisiones, opcionalmente de un rango de fechas o de ciertos clientes. */
function listarRevisiones({ desde, hasta, ids } = {}) {
  const { revisiones } = cargar();
  const filtroIds = ids ? new Set([...ids].map(String)) : null;
  return Object.values(revisiones)
    .filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta))
    .filter((r) => !filtroIds || filtroIds.has(r.idCrm))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.creada).localeCompare(String(b.creada)));
}

function etiquetaQue(clave) {
  return QUE_REVISAR[clave] || clave;
}

module.exports = {
  ETIQUETAS,
  ETIQUETAS_MANUALES,
  MOTIVOS_NO_COMPRA,
  leerEtiquetas,
  etiquetar,
  QUE_REVISAR,
  programarRevision,
  cerrarRevision,
  listarRevisiones,
  etiquetaQue,
};
