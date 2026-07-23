(function (global) {
  'use strict';

  /** Catálogo oficial: primera letra del folio → tipo de orden */
  const TIPO_POR_LETRA = {
    V: 'Aseguradora Body 31',
    A: 'Aseguradoras',
    F: 'Aseguradoras particulares',
    E: 'Empleados',
    '\u00C1': 'Flotilla',
    G: 'Garantías',
    I: 'Interna',
    J: 'Interna HYP',
    '\u00D3': 'Interna nuevos HYP',
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

  /** Filtros rápidos Post-Venta: nomenclatura por sección */
  const AREA_LETRAS = {
    servicio: ['C', 'D', 'G', 'I', 'K', 'N', 'O', 'Q', 'S', 'X', 'Y', '\u00C1', 'M', 'E', 'R'],
    hyp: ['A', 'F', 'H', 'J', 'V', 'Z', '\u00D3'],
    refacciones: null, // pedidos PAR_PEDIDO (no órdenes de taller)
  };

  const AREA_META = {
    posventa: {
      id: 'posventa',
      label: 'PostVenta',
      hint: 'Vista principal · conformada por Servicio, Refacciones y HyP',
    },
    servicio: {
      id: 'servicio',
      label: 'Servicio',
      hint: 'Órdenes C, D, G, I, K, N, O, Q, S, X, Y, Á, M, E, R',
    },
    refacciones: {
      id: 'refacciones',
      label: 'Refacciones',
      hint: 'Todos los pedidos de refacciones (compra a planta/proveedor)',
    },
    hyp: {
      id: 'hyp',
      label: 'HyP',
      hint: 'Órdenes A, F, H, J, V, Z, Ó',
    },
  };

  const CATALOGO = [
    'V', 'A', 'F', 'E', '\u00C1', 'G', 'I', 'J', '\u00D3', 'M', 'H', 'O',
    'N', 'Y', 'Q', 'Z', 'S', 'R', 'D', 'X', 'C', 'K',
  ].map((letra) => ({ letra, tipo: TIPO_POR_LETRA[letra] }));

  function firstLetter(orden) {
    const s = String(orden || '').trim();
    if (!s) return '';
    return s[0].toUpperCase();
  }

  function fromOrden(orden) {
    const letra = firstLetter(orden);
    if (!letra) return { letra: '', tipo: 'Sin clasificar', label: 'Sin clasificar' };
    const tipo = TIPO_POR_LETRA[letra] || `Tipo ${letra}`;
    return { letra, tipo, label: `${letra} — ${tipo}` };
  }

  function isSinAseguradora(record) {
    return !String(record?.aseguradora || '').trim();
  }

  function letterOfRecord(record) {
    const fromField = String(record?.letraOrden || '').trim().toUpperCase();
    if (fromField) return fromField;
    return firstLetter(record?.orden);
  }

  function matchesArea(record, area) {
    const key = String(area || '').toLowerCase();
    if (!key || key === 'posventa' || key === 'refacciones') return true;
    const letras = AREA_LETRAS[key];
    if (!letras) return true;
    const set = new Set(letras);
    return set.has(letterOfRecord(record));
  }

  function areaMeta(area) {
    return AREA_META[String(area || 'posventa').toLowerCase()] || AREA_META.posventa;
  }

  global.PostSalesOrderTypes = {
    TIPO_POR_LETRA,
    AREA_LETRAS,
    AREA_META,
    CATALOGO,
    firstLetter,
    fromOrden,
    isSinAseguradora,
    letterOfRecord,
    matchesArea,
    areaMeta,
  };
}(typeof window !== 'undefined' ? window : global));
