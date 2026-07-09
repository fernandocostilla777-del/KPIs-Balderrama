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
  };

  const CATALOGO = [
    'V', 'A', 'F', 'E', '\u00C1', 'G', 'I', 'J', '\u00D3', 'M', 'H', 'O',
    'N', 'Y', 'Q', 'Z', 'S', 'R', 'D', 'X', 'C',
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

  global.PostSalesOrderTypes = {
    TIPO_POR_LETRA,
    CATALOGO,
    firstLetter,
    fromOrden,
    isSinAseguradora,
  };
}(typeof window !== 'undefined' ? window : global));
