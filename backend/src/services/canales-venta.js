const CANALES_ORDEN = [
  'PISO',
  'FORANEOS',
  'CHOLULA',
  'ZACATELCO',
  'SUAUTO',
  'CASA',
  'FLOTILLAS',
  'PERDIDA',
  'OTROS',
];

const CANALES_LABEL = {
  PISO: 'Piso',
  FORANEOS: 'Foraneos',
  CHOLULA: 'Cholula',
  ZACATELCO: 'Zacatelco',
  SUAUTO: 'Suauto',
  CASA: 'Casa',
  FLOTILLAS: 'Flotillas',
  PERDIDA: 'Perdida',
  OTROS: 'Otros',
};

const CANALES_MAP = {
  PISO: {
    prefijos: ['PISO'],
    codigos: ['CRE', 'PLNCON', 'INT', 'CON', 'SNPCON', 'SNPCRE'],
  },
  FORANEOS: {
    prefijos: ['FOR'],
    codigos: [],
  },
  CHOLULA: {
    prefijos: ['CH'],
    codigos: [],
  },
  ZACATELCO: {
    prefijos: ['ZAC'],
    codigos: [],
  },
  CASA: {
    prefijos: ['CASA'],
    codigos: [],
  },
  SUAUTO: {
    prefijos: ['CXCSUA'],
    codigos: ['SUAGMF', 'CXCSUAU', 'CXCSUAUC', 'SNPSUA', 'SUA'],
  },
  FLOTILLAS: {
    prefijos: [],
    codigos: ['FLOT', 'FLOTGMF'],
  },
  PERDIDA: {
    prefijos: [],
    codigos: ['PERDIDA'],
  },
};

function getCanalVenta(formapago) {
  const codigo = String(formapago || '').trim().toUpperCase();
  if (!codigo) return 'OTROS';

  for (const canal of CANALES_ORDEN) {
    const reglas = CANALES_MAP[canal];
    if (!reglas) continue;

    if (reglas.codigos.includes(codigo)) return canal;
    if (reglas.prefijos.some((prefijo) => codigo.startsWith(prefijo))) return canal;
  }

  return 'OTROS';
}

function getCanalLabel(canal) {
  return CANALES_LABEL[canal] || canal;
}

function enrichVentasRows(rows) {
  return rows.map((row) => {
    const canal = getCanalVenta(row.FORMAPAGO_ORIGINAL);
    return {
      ...row,
      CANAL_VENTA: canal,
      CANAL_LABEL: getCanalLabel(canal),
    };
  });
}

function countByCanal(rows) {
  const map = Object.fromEntries(CANALES_ORDEN.map((c) => [c, 0]));

  for (const row of rows) {
    const canal = row.CANAL_VENTA || getCanalVenta(row.FORMAPAGO_ORIGINAL);
    map[canal] = (map[canal] || 0) + 1;
  }

  return CANALES_ORDEN
    .map((canal) => ({
      canal,
      label: getCanalLabel(canal),
      count: map[canal] || 0,
    }))
    .filter((item) => item.count > 0);
}

module.exports = {
  CANALES_ORDEN,
  CANALES_LABEL,
  getCanalVenta,
  getCanalLabel,
  enrichVentasRows,
  countByCanal,
};
