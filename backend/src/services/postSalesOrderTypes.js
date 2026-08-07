/** Nomenclatura PostVenta: primera letra del folio → área (Servicio / HyP). */

const TIPO_POR_LETRA = {
  V: 'Aseguradora Body 31',
  A: 'Aseguradoras',
  F: 'Aseguradoras particulares',
  E: 'Empleados',
  Á: 'Flotilla',
  G: 'Garantías',
  I: 'Interna',
  J: 'Interna HYP',
  Ó: 'Interna nuevos HYP',
  M: 'Interna seminuevos',
  H: 'Interna seminuevos HYP',
  O: 'Interna ventas',
  N: 'Normal',
  Y: 'Normal Cholula',
  Q: 'Normal Zacatelco',
  Z: 'Particulares Body 31',
  S: 'Previas',
  R: 'Reclamaciones',
  D: 'Reparación',
  X: 'Reparación Cholula',
  C: 'Reparación Zacatelco',
  K: 'Tipo K',
};

const AREA_LETRAS = {
  servicio: ['C', 'D', 'G', 'I', 'K', 'N', 'O', 'Q', 'S', 'X', 'Y', 'Á', 'M', 'E', 'R'],
  hyp: ['A', 'F', 'H', 'J', 'V', 'Z', 'Ó'],
};

/**
 * Asesores de HyP (nombres DMS): JAIR…, BRIAN… (Brayan/Bryan), EDEL…
 * De ellos solo se atribuyen a HyP las letras I (interna) y E (empleados).
 */
const HYP_ASESORES = ['jair', 'brian', 'brayan', 'bryan', 'edel'];
const HYP_ASESORES_EMPLEADOS = HYP_ASESORES;
const HYP_ASESOR_LETRAS_INCLUIDAS = new Set(['I', 'E']);

/** Folios de órdenes internas (Servicio + HyP). */
const INTERNAS_LETRAS = new Set(['I', 'J', 'Ó', 'M', 'H', 'O']);

/**
 * Grupos de nomenclatura que el usuario puede pedir en lenguaje natural.
 * Cada grupo lista letras + alias (sin acentos / plurales).
 */
const NOMENCLATURA_GRUPOS = [
  {
    id: 'internas',
    label: 'Internas',
    letras: ['I', 'J', 'Ó', 'M', 'H', 'O'],
    aliases: ['interna', 'internas', 'interno', 'internos'],
  },
  /**
   * Segmentación UI de la pestaña HyP (chips Externas / Internas).
   * Distinto de "internas" clásico (incluye M/O de Servicio).
   */
  {
    id: 'externas',
    label: 'Externas HyP',
    letras: ['A', 'F', 'V', 'Z'],
    aliases: ['externa', 'externas', 'hyp externas', 'externas hyp', 'segmentacion externas'],
  },
  {
    id: 'hyp_internas',
    label: 'Internas HyP',
    letras: ['J', 'H', 'Ó', 'I', 'E'],
    aliases: [
      'hyp internas',
      'internas hyp',
      'interna hyp',
      'segmentacion internas',
      'internas hojalateria',
      'internas pintura',
    ],
  },
  {
    id: 'normales',
    label: 'Normales',
    letras: ['N', 'Y', 'Q'],
    aliases: ['normal', 'normales', 'norma'],
  },
  {
    id: 'reparacion',
    label: 'Reparación',
    letras: ['D', 'X', 'C'],
    aliases: ['reparacion', 'reparación', 'reparaciones', 'reparar'],
  },
  {
    id: 'garantias',
    label: 'Garantías',
    letras: ['G'],
    aliases: ['garantia', 'garantía', 'garantias', 'garantías'],
  },
  {
    id: 'aseguradoras',
    label: 'Aseguradoras',
    letras: ['A', 'F', 'V'],
    aliases: ['aseguradora', 'aseguradoras', 'seguro', 'seguros'],
  },
  {
    id: 'particulares',
    label: 'Particulares Body 31',
    letras: ['Z'],
    aliases: ['particular', 'particulares', 'body31', 'body 31'],
  },
  {
    id: 'empleados',
    label: 'Empleados',
    letras: ['E'],
    aliases: ['empleado', 'empleados'],
  },
  {
    id: 'flotilla',
    label: 'Flotilla',
    letras: ['Á'],
    aliases: ['flotilla', 'flotillas'],
  },
  {
    id: 'previas',
    label: 'Previas',
    letras: ['S'],
    aliases: ['previa', 'previas'],
  },
  {
    id: 'reclamaciones',
    label: 'Reclamaciones',
    letras: ['R'],
    aliases: ['reclamacion', 'reclamación', 'reclamaciones'],
  },
];

const OPEN_STATUSES = new Set(['A', 'T', 'D', 'P']);

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function firstLetter(orden) {
  const s = String(orden || '').trim();
  if (!s) return '';
  return s[0].toUpperCase();
}

function letterOfRecord(record) {
  const fromField = String(record?.letraOrden || '').trim().toUpperCase();
  if (fromField) return fromField;
  return firstLetter(record?.orden);
}

function matchesArea(record, area) {
  const key = String(area || '').toLowerCase();
  if (!key || key === 'posventa' || key === 'todas' || key === 'refacciones') return true;
  const letra = letterOfRecord(record);
  if (key === 'hyp') {
    if (new Set(AREA_LETRAS.hyp).has(letra)) return true;
    return isHypAsesorOrdenParaHyp(record);
  }
  if (key === 'servicio') {
    if (!new Set(AREA_LETRAS.servicio).has(letra)) return false;
    if (isHypAsesorOrdenParaHyp(record)) return false;
    return true;
  }
  const letras = AREA_LETRAS[key];
  if (!letras) return true;
  return new Set(letras).has(letra);
}

/** Órdenes de asesores HyP (Jair, Brian/Brayan, Edel). */
function isHypAsesor(record) {
  const asesor = stripAccents(record?.asesor || '');
  if (!asesor) return false;
  return HYP_ASESORES.some((name) => {
    const re = new RegExp(`(?:^|[^a-z])${name}(?:[^a-z]|$)`);
    return re.test(asesor);
  });
}

/** Asesor HyP + letra I o E → cuenta en HyP. */
function isHypAsesorOrdenParaHyp(record) {
  if (!isHypAsesor(record)) return false;
  return HYP_ASESOR_LETRAS_INCLUIDAS.has(letterOfRecord(record));
}

function isHypEmpleadoAsesor(record) {
  return isHypAsesorOrdenParaHyp(record);
}

function findNomenclaturaGroup(tipo) {
  const raw = String(tipo || '').trim();
  if (!raw) return null;
  const key = stripAccents(raw);
  if (!key || key === 'todas' || key === 'all' || key === 'posventa') return null;

  for (const g of NOMENCLATURA_GRUPOS) {
    if (g.id === key || stripAccents(g.label) === key) return g;
    if (g.aliases.some((a) => stripAccents(a) === key)) return g;
  }
  return null;
}

/**
 * Resuelve un tipo/nomenclatura a letras concretas.
 * Acepta: "normales", "internas", "N", "N,Y,Q", "Normal Cholula", etc.
 * @returns {{ id: string|null, label: string, letras: string[] } | null}
 */
function resolveNomenclatura(tipo) {
  const raw = String(tipo || '').trim();
  if (!raw) return null;
  const key = stripAccents(raw);
  if (!key || key === 'todas' || key === 'all' || key === 'posventa') return null;

  const group = findNomenclaturaGroup(raw);
  if (group) {
    return { id: group.id, label: group.label, letras: group.letras.slice() };
  }

  // Lista de letras: "N,Y,Q" o "N Y Q" (solo tokens de 1 carácter)
  if (/[,\s]/.test(raw)) {
    const tokens = raw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => t.length === 1)) {
      const letras = [...new Set(tokens.map((x) => x.toUpperCase()))];
      return {
        id: 'letras',
        label: `Letras ${letras.join(', ')}`,
        letras,
      };
    }
  }

  // Una sola letra
  if (raw.length === 1) {
    const L = raw.toUpperCase();
    return {
      id: L,
      label: TIPO_POR_LETRA[L] || `Tipo ${L}`,
      letras: [L],
    };
  }

  // Coincidencia con etiqueta de letra (ej. "Normal Cholula" → Y)
  const exactLabel = [];
  const partialLabel = [];
  for (const [letra, label] of Object.entries(TIPO_POR_LETRA)) {
    const lab = stripAccents(label);
    if (lab === key) exactLabel.push(letra);
    else if (lab.includes(key) || key.includes(lab)) partialLabel.push(letra);
  }
  const matched = exactLabel.length ? exactLabel : partialLabel;
  if (matched.length) {
    return {
      id: key,
      label: matched.map((L) => TIPO_POR_LETRA[L]).join(' · '),
      letras: matched,
    };
  }

  return null;
}

function normalizeTipo(tipo) {
  const resolved = resolveNomenclatura(tipo);
  if (!resolved) return null;
  return resolved.id || stripAccents(tipo);
}

function isInterna(record) {
  return INTERNAS_LETRAS.has(letterOfRecord(record));
}

function matchesTipo(record, tipo) {
  const resolved = resolveNomenclatura(tipo);
  if (!resolved || !resolved.letras.length) return true;
  return resolved.letras.includes(letterOfRecord(record));
}

function isOpen(record) {
  const status = String(record?.status || '').trim().toUpperCase();
  return OPEN_STATUSES.has(status);
}

function isFacturada(record) {
  return String(record?.status || '').trim().toUpperCase() === 'I';
}

function matchesEstatus(record, estatus) {
  const key = String(estatus || 'todas').toLowerCase();
  if (!key || key === 'todas') return true;
  if (key === 'abiertas' || key === 'abierta' || key === 'open') return isOpen(record);
  if (key === 'facturadas' || key === 'facturada') return isFacturada(record);
  if (key === 'canceladas' || key === 'cancelada') {
    return String(record?.status || '').trim().toUpperCase() === 'C';
  }
  return String(record?.status || '').trim().toUpperCase() === key.toUpperCase();
}

function filterRecords(records, { area = 'posventa', estatus = 'todas', tipo = null } = {}) {
  return (records || []).filter(
    (r) => matchesArea(r, area) && matchesEstatus(r, estatus) && matchesTipo(r, tipo),
  );
}

function countByLetter(records) {
  const map = new Map();
  for (const r of records || []) {
    const L = letterOfRecord(r) || '?';
    map.set(L, (map.get(L) || 0) + 1);
  }
  return [...map.entries()]
    .map(([letra, total]) => ({
      letra,
      tipo: TIPO_POR_LETRA[letra] || `Tipo ${letra}`,
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Texto corto para prompts / respuestas IA. */
function nomenclaturaHelpText() {
  return NOMENCLATURA_GRUPOS.map(
    (g) => `${g.label} (${g.letras.join(', ')})`,
  ).join(' · ');
}

module.exports = {
  TIPO_POR_LETRA,
  AREA_LETRAS,
  HYP_ASESORES,
  HYP_ASESORES_EMPLEADOS,
  HYP_ASESOR_LETRAS_INCLUIDAS,
  INTERNAS_LETRAS,
  NOMENCLATURA_GRUPOS,
  OPEN_STATUSES,
  firstLetter,
  letterOfRecord,
  matchesArea,
  isHypAsesor,
  isHypAsesorOrdenParaHyp,
  isHypEmpleadoAsesor,
  findNomenclaturaGroup,
  resolveNomenclatura,
  normalizeTipo,
  isInterna,
  matchesTipo,
  isOpen,
  isFacturada,
  matchesEstatus,
  filterRecords,
  countByLetter,
  nomenclaturaHelpText,
  stripAccents,
};
