(function (global) {
  const CANALES_ORDEN = ['PISO', 'FORANEOS', 'CHOLULA', 'ZACATELCO', 'SUAUTO', 'CASA', 'FLOTILLAS', 'PERDIDA', 'OTROS'];
  const CANALES_LABEL = {
    PISO: 'Piso', FORANEOS: 'Foraneos', CHOLULA: 'Cholula', ZACATELCO: 'Zacatelco',
    SUAUTO: 'Suauto', CASA: 'Casa', FLOTILLAS: 'Flotillas', PERDIDA: 'Perdida', OTROS: 'Otros',
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

  function getCanalVenta(formapago) {
    const codigo = String(formapago || '').trim().toUpperCase();
    if (!codigo) return 'OTROS';
    for (const canal of CANALES_ORDEN) {
      const reglas = CANALES_MAP[canal];
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
    const canal = row.CANAL_VENTA || getCanalVenta(formapago);
    return { ...row, FORMAPAGO_ORIGINAL: formapago, CANAL_VENTA: canal, CANAL_LABEL: row.CANAL_LABEL || getCanalLabel(canal) };
  }

  function countByCanal(rows) {
    const map = Object.fromEntries(CANALES_ORDEN.map((c) => [c, 0]));
    for (const row of rows) {
      const enriched = enrichRegistro(row);
      map[enriched.CANAL_VENTA] = (map[enriched.CANAL_VENTA] || 0) + 1;
    }
    return CANALES_ORDEN.map((canal) => ({ canal, label: getCanalLabel(canal), count: map[canal] || 0 })).filter((i) => i.count > 0);
  }

  global.CanalesVenta = {
    enrichRegistro,
    countByCanal,
    getCanalLabel,
    getCanalVenta,
    CANALES_ORDEN,
    CANALES_LABEL,
  };
})(window);
