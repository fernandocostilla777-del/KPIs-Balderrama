/**
 * Campañas reactivas monitoreadas para conversión (reporte Marketing).
 * aliases: nombres reales en crm_leads (casing / encoding / guiones).
 *
 * Regla de negocio: la vida útil del lead es LEAD_VIDA_DIAS (90).
 * Tras ese plazo, una venta posterior NO cuenta como conversión de la campaña.
 */
const LEAD_VIDA_DIAS = 90;

function normCampana(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const CAMPANAS_CONVERSION = [
  {
    key: 'facebook_chevrolet',
    label: 'Facebook Chevrolet',
    aliases: ['Facebook Chevrolet'],
  },
  {
    key: 'gmf_finance_calculator',
    label: 'GMF Finance Calculator',
    aliases: ['GMF Finance Calculator'],
  },
  {
    key: 'gmmx_solicita_cotizacion',
    label: 'GMMX Solicita Cotizacion Chevrolet',
    aliases: [
      'GMMX Solicita Cotizacion Chevrolet',
      'GMMX_Solicita Cotizacion_Chevrolet',
      'GMMX_Solicita Cotización_Chevrolet',
    ],
  },
  {
    key: 'sw_cotizacion_nuevos',
    label: 'Sitio Web Distribuidor Cotizacion Nuevos',
    aliases: ['Sitio Web Distribuidor Cotizacion Nuevos'],
  },
  {
    key: 'chevroletazo_landing',
    label: 'Chevroletazo Landing',
    aliases: ['Chevroletazo Landing'],
  },
  {
    key: 'sw_gmf_calculadora',
    label: 'Sitio Web Distribuidor GMF Calculadora Financiera',
    aliases: [
      'Sitio Web Distribuidor GMF Calculadora Financiera',
      'Sitio Web Distribuidor GMF Calculadora FInanciera',
    ],
  },
  {
    key: 'gm_tiktok',
    label: 'GM TIKTOK',
    aliases: ['GM TIKTOK'],
  },
  {
    key: 'raq_evs_brandiste',
    label: 'RAQ EVs Brandiste',
    aliases: ['RAQ EVs Brandiste'],
  },
  {
    key: 'groove_my2026',
    label: 'GROOVE MY2026 LANZAMIENTO',
    aliases: ['GROOVE MY2026 LANZAMIENTO'],
  },
  {
    key: 'landing_suvs',
    label: 'Landing Segment Page SUVs',
    aliases: ['Landing Segment Page SUVs'],
  },
  {
    key: 'captiva_phev_mov',
    label: 'Captiva PHEV MOV',
    aliases: ['Captiva PHEV MOV'],
  },
  {
    key: 'gmmx_prueba_manejo',
    label: 'GMMX Prueba de manejo Chevrolet',
    aliases: [
      'GMMX Prueba de manejo Chevrolet',
      'GMMX_Prueba de manejo_Chevrolet',
    ],
  },
  {
    key: 'ev_live_captiva_raq',
    label: 'EV LIVE Captiva PHEV RAQ',
    aliases: ['EV LIVE Captiva PHEV RAQ'],
  },
  {
    key: 'ev_live_spark',
    label: 'EV LIVE Spark EV',
    aliases: ['EV LIVE Spark EV'],
  },
  {
    key: 'scd_abandon_finance',
    label: 'SCD- Abandon - Profile (Finance)',
    aliases: ['SCD- Abandon - Profile (Finance)', 'SCD Abandon Profile (Finance)'],
  },
  {
    key: 'sw_prueba_manejo_nuevos',
    label: 'Sitio Web Distribuidor Prueba de Manejo Nuevos',
    aliases: ['Sitio Web Distribuidor Prueba de Manejo Nuevos'],
  },
  {
    key: 'scd_abandon_cash',
    label: 'SCD- Abandon - Profile (Cash)',
    aliases: ['SCD- Abandon - Profile (Cash)', 'SCD Abandon Profile (Cash)'],
  },
  {
    key: 'scd_complete_finance',
    label: 'SCD - Complete - Finance - New Vehicle',
    aliases: [
      'SCD - Complete - Finance - New Vehicle',
      'SCD - Complete - Financeí-New Vehicle',
      'SCD - Complete - Finance',
    ],
    matchIncludes: ['SCD COMPLETE FINANCE', 'NEW VEHICLE'],
  },
  {
    key: 'scd_complete_cash',
    label: 'SCD - Complete - Cash - New Vehicle',
    aliases: [
      'SCD - Complete - Cash - New Vehicle',
      'SCD - Complete - Cashí-New Vehicle',
      'SCD - Complete - Cash',
    ],
    matchIncludes: ['SCD COMPLETE CASH', 'NEW VEHICLE'],
  },
  {
    key: 'ev_live_captiva_td',
    label: 'EV LIVE CAPTIVA PHEV TD',
    aliases: ['EV LIVE CAPTIVA PHEV TD'],
  },
  {
    key: 'ev_live_spark_td',
    label: 'EV LIVE Spark EV TD',
    aliases: ['EV LIVE Spark EV TD'],
  },
  {
    key: 'scd_trade_in',
    label: 'SCD - Trade In Lead - New Vehicle',
    aliases: ['SCD - Trade In Lead - New Vehicle'],
  },
  {
    key: 'scd_ask_question',
    label: 'SCD - Ask a Question - New Vehicle',
    aliases: [
      'SCD - Ask a Question - New Vehicle',
      'SCD - Ask a Question -New Vehicle',
    ],
  },
  {
    key: 'brightdrop_config',
    label: 'Brighdrop Configuration',
    aliases: ['Brighdrop Configuration', 'BrightDrop Configuration', 'Brightdrop Configuration'],
  },
  {
    key: 'scd_test_drive',
    label: 'SCD - Test Drive - New Vehicle',
    aliases: ['SCD - Test Drive - New Vehicle'],
  },
  {
    key: 'scd_vehicle_na',
    label: 'SCD - Vehicle Not Available - New Vehicle',
    aliases: ['SCD - Vehicle Not Available - New Vehicle'],
  },
  {
    key: 'eventos_ev',
    label: 'Eventos Vehiculos electricos',
    aliases: [
      'Eventos Vehiculos electricos',
      'Eventos Vehículos eléctricos',
      'Eventos Vehiculos electricos',
    ],
  },
];

function resolveCampanaConversionKey(campanaName) {
  const n = normCampana(campanaName);
  if (!n) return null;

  for (const c of CAMPANAS_CONVERSION) {
    for (const alias of c.aliases || []) {
      if (normCampana(alias) === n) return c.key;
    }
  }

  for (const c of CAMPANAS_CONVERSION) {
    const parts = c.matchIncludes || [];
    if (parts.length && parts.every((p) => n.includes(normCampana(p)))) {
      return c.key;
    }
  }

  return null;
}

module.exports = {
  LEAD_VIDA_DIAS,
  CAMPANAS_CONVERSION,
  normCampana,
  resolveCampanaConversionKey,
};
