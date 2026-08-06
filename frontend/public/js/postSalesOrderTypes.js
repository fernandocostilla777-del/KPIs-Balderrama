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

  /**
   * Asesores de HyP (nombres DMS): JAIR…, BRIAN… (Brayan/Bryan), EDEL…
   * De ellos solo se atribuyen a HyP las letras I (interna) y E (empleados).
   */
  const HYP_ASESORES = ['jair', 'brian', 'brayan', 'bryan', 'edel'];
  /** Letras extra de asesores HyP que sí cuentan en HyP (resto de Servicio se queda en Servicio). */
  const HYP_ASESOR_LETRAS_INCLUIDAS = new Set(['I', 'E']);
  /** @deprecated alias de compatibilidad */
  const HYP_ASESORES_EMPLEADOS = HYP_ASESORES;

  const AREA_META = {
    posventa: {
      id: 'posventa',
      label: 'PostVenta',
      hint: 'Vista principal · conformada por Servicio, Refacciones y HyP',
    },
    servicio: {
      id: 'servicio',
      label: 'Servicio',
      hint: 'Órdenes C–Y de Servicio; I/E de Jair/Brian/Edel van a HyP',
    },
    refacciones: {
      id: 'refacciones',
      label: 'Refacciones',
      hint: 'Todos los pedidos de refacciones (compra a planta/proveedor)',
    },
    hyp: {
      id: 'hyp',
      label: 'HyP',
      hint: 'Órdenes A, F, H, J, V, Z, Ó + I/E de Jair, Brian y Edel',
    },
  };

  /** Letras de órdenes relacionadas a aseguradoras (A / F / V). */
  const ASEGURADORAS_LETRAS = ['A', 'F', 'V'];
  const ASEGURADORAS_SET = new Set(ASEGURADORAS_LETRAS);

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

  function stripAccents(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
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

  /** @deprecated usar isHypAsesorOrdenParaHyp — se mantiene por compatibilidad. */
  function isHypEmpleadoAsesor(record) {
    return isHypAsesorOrdenParaHyp(record);
  }

  function matchesArea(record, area) {
    const key = String(area || '').toLowerCase();
    if (!key || key === 'posventa' || key === 'refacciones') return true;
    const letra = letterOfRecord(record);
    if (key === 'hyp') {
      if (new Set(AREA_LETRAS.hyp).has(letra)) return true;
      return isHypAsesorOrdenParaHyp(record);
    }
    if (key === 'servicio') {
      if (!new Set(AREA_LETRAS.servicio).has(letra)) return false;
      // I/E de asesores HyP se reportan en HyP, no en Servicio
      if (isHypAsesorOrdenParaHyp(record)) return false;
      return true;
    }
    const letras = AREA_LETRAS[key];
    if (!letras) return true;
    return new Set(letras).has(letra);
  }

  function isAseguradora(record) {
    return ASEGURADORAS_SET.has(letterOfRecord(record));
  }

  function areaMeta(area) {
    return AREA_META[String(area || 'posventa').toLowerCase()] || AREA_META.posventa;
  }

  global.PostSalesOrderTypes = {
    TIPO_POR_LETRA,
    AREA_LETRAS,
    AREA_META,
    ASEGURADORAS_LETRAS,
    HYP_ASESORES,
    HYP_ASESORES_EMPLEADOS,
    HYP_ASESOR_LETRAS_INCLUIDAS: ['I', 'E'],
    CATALOGO,
    firstLetter,
    fromOrden,
    isSinAseguradora,
    isAseguradora,
    isHypAsesor,
    isHypAsesorOrdenParaHyp,
    isHypEmpleadoAsesor,
    letterOfRecord,
    matchesArea,
    areaMeta,
  };
}(typeof window !== 'undefined' ? window : global));
