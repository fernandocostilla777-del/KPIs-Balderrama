(function (global) {
  const CANALES_ORDEN = [
    'PISO', 'FORANEOS', 'CHOLULA', 'ZACATELCO', 'SUAUTO', 'CASA',
    'SEMINUEVOS_NUEVOS', 'FLOTILLAS', 'PERDIDA', 'OTROS',
  ];
  const CANALES_LABEL = {
    PISO: 'Piso', FORANEOS: 'Foraneos', CHOLULA: 'Cholula', ZACATELCO: 'Zacatelco',
    SUAUTO: 'Suauto', CASA: 'Casa', SEMINUEVOS_NUEVOS: 'Seminuevos Nuevos',
    FLOTILLAS: 'Flotillas', PERDIDA: 'Perdida', OTROS: 'Otros',
  };
  const CANALES_MAP = {
    PISO: { prefijos: ['PISO'], codigos: ['CRE', 'PLNCON', 'INT', 'CON', 'SNPCON', 'SNPCRE'] },
    FORANEOS: { prefijos: ['FOR'], codigos: [] },
    CHOLULA: { prefijos: ['CH'], codigos: [] },
    ZACATELCO: { prefijos: ['ZAC'], codigos: [] },
    CASA: { prefijos: ['CASA'], codigos: [] },
    SUAUTO: { prefijos: ['CXCSUA'], codigos: ['SUAGMF', 'CXCSUAU', 'CXCSUAUC', 'SNPSUA', 'SUA'] },
    FLOTILLAS: { prefijos: [], codigos: ['FLOT', 'FLOTGMF'] },
    PERDIDA: { prefijos: [], codigos: ['PERDIDA'] },
  };

  const SEMINUEVOS_NUEVOS_VENDEDORES = [
    'LOPEZ PEREZ LUIS PABLO',
    'CALDERON CARCANO LUIS ARTURO',
    'FLORES PARADA LAURA GABRIELA',
    'RAMIREZ TORRES JACOB NOEL',
    'NAHUACATL HERNANDEZ HECTOR URIEL',
    'PEREZ HERNANDEZ CARLOS IVAN',
    'ESCOBAR GUZMAN JUAN CARLOS',
    'FLORES QUIROZ VIRIDIANA ITZEL',
    'AGUILAR VAZQUEZ FERNANDO',
    'ROJAS ROBLES CINTHIA DEL CARMEN',
    'LOPEZ CORTES ANA EUGENIA',
    'MOGUEL PEREZ EDSON OSWALDO',
    'MARTINEZ RODRIGUEZ EMMANUEL',
  ];

  function normalizePersonName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  const SEMINUEVOS_NUEVOS_SET = new Set(SEMINUEVOS_NUEVOS_VENDEDORES.map(normalizePersonName));

  function isVendedorSeminuevosNuevos(vendedor) {
    const key = normalizePersonName(vendedor);
    return Boolean(key) && SEMINUEVOS_NUEVOS_SET.has(key);
  }

  function getCanalVenta(formapago, vendedor) {
    if (isVendedorSeminuevosNuevos(vendedor)) return 'SEMINUEVOS_NUEVOS';
    const codigo = String(formapago || '').trim().toUpperCase();
    if (!codigo) return 'OTROS';
    for (const canal of CANALES_ORDEN) {
      const reglas = CANALES_MAP[canal];
      if (!reglas) continue;
      if (reglas.codigos.includes(codigo)) return canal;
      if (reglas.prefijos.some((p) => codigo.startsWith(p))) return canal;
    }
    return 'OTROS';
  }

  function getCanalLabel(canal) {
    return CANALES_LABEL[canal] || canal;
  }

  function enrichRegistro(row) {
    const formapago = row.FORMAPAGO_ORIGINAL || row.VTE_FORMAPAGO || '';
    const canal = getCanalVenta(formapago, row.VENDEDOR);
    return {
      ...row,
      FORMAPAGO_ORIGINAL: formapago,
      CANAL_VENTA: canal,
      CANAL_LABEL: getCanalLabel(canal),
    };
  }

  function countByCanal(rows) {
    const map = Object.fromEntries(CANALES_ORDEN.map((c) => [c, 0]));
    for (const row of rows) {
      const enriched = enrichRegistro(row);
      map[enriched.CANAL_VENTA] = (map[enriched.CANAL_VENTA] || 0) + 1;
    }
    return CANALES_ORDEN
      .map((canal) => ({ canal, label: getCanalLabel(canal), count: map[canal] || 0 }))
      .filter((i) => i.count > 0);
  }

  global.CanalesVenta = {
    enrichRegistro,
    countByCanal,
    getCanalLabel,
    getCanalVenta,
    isVendedorSeminuevosNuevos,
    CANALES_ORDEN,
    CANALES_LABEL,
    SEMINUEVOS_NUEVOS_VENDEDORES,
  };
})(window);
