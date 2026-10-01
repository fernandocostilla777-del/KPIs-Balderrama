/**
 * Campañas monitoreadas para conversión (reporte Marketing / One Pager hoja 5).
 * aliases: nombres reales en crm_leads (casing / encoding / guiones).
 * tipo: reactiva | proactiva
 *
 * Regla de negocio: la vida útil del lead es LEAD_VIDA_DIAS (90).
 * Tras ese plazo, una venta posterior NO cuenta como conversión de la campaña.
 *
 * NO cuentan como reactivas (ni para conversión reactiva):
 * - AMDGM (Facebook / TikTok / Landing Google) → van como proactivas
 * - GMF Retención, GMF Lealtad, Equity Mining NVS/UVS Mature, GMMX_GMF_LEASING → proactivas
 * - Campañas ABP* o CODE* → excluidas del One Pager
 *
 * Cualquier otra campaña CRM (no ABP/CODE y no proactiva) cuenta como reactiva
 * automáticamente, aunque no esté listada abajo.
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
    tipo: 'reactiva',
    aliases: ['Facebook Chevrolet'],
  },
  {
    key: 'gmf_finance_calculator',
    label: 'GMF Finance Calculator',
    tipo: 'reactiva',
    aliases: ['GMF Finance Calculator'],
  },
  {
    key: 'gmmx_solicita_cotizacion',
    label: 'GMMX Solicita Cotizacion Chevrolet',
    tipo: 'reactiva',
    aliases: [
      'GMMX Solicita Cotizacion Chevrolet',
      'GMMX_Solicita Cotizacion_Chevrolet',
      'GMMX_Solicita Cotización_Chevrolet',
    ],
  },
  {
    key: 'sw_cotizacion_nuevos',
    label: 'Sitio Web Distribuidor Cotizacion Nuevos',
    tipo: 'reactiva',
    aliases: ['Sitio Web Distribuidor Cotizacion Nuevos'],
  },
  {
    key: 'chevroletazo_landing',
    label: 'Chevroletazo Landing',
    tipo: 'reactiva',
    aliases: ['Chevroletazo Landing'],
  },
  {
    key: 'sw_gmf_calculadora',
    label: 'Sitio Web Distribuidor GMF Calculadora Financiera',
    tipo: 'reactiva',
    aliases: [
      'Sitio Web Distribuidor GMF Calculadora Financiera',
      'Sitio Web Distribuidor GMF Calculadora FInanciera',
    ],
  },
  {
    key: 'gm_tiktok',
    label: 'GM TIKTOK',
    tipo: 'reactiva',
    aliases: ['GM TIKTOK'],
  },
  {
    key: 'raq_evs_brandiste',
    label: 'RAQ EVs Brandiste',
    tipo: 'reactiva',
    aliases: ['RAQ EVs Brandiste'],
  },
  {
    key: 'groove_my2026',
    label: 'GROOVE MY2026 LANZAMIENTO',
    tipo: 'reactiva',
    aliases: ['GROOVE MY2026 LANZAMIENTO'],
  },
  {
    key: 'landing_suvs',
    label: 'Landing Segment Page SUVs',
    tipo: 'reactiva',
    aliases: ['Landing Segment Page SUVs'],
  },
  {
    key: 'captiva_phev_mov',
    label: 'Captiva PHEV MOV',
    tipo: 'reactiva',
    aliases: ['Captiva PHEV MOV'],
  },
  {
    key: 'gmmx_prueba_manejo',
    label: 'GMMX Prueba de manejo Chevrolet',
    tipo: 'reactiva',
    aliases: [
      'GMMX Prueba de manejo Chevrolet',
      'GMMX_Prueba de manejo_Chevrolet',
    ],
  },
  {
    key: 'ev_live_captiva_raq',
    label: 'EV LIVE Captiva PHEV RAQ',
    tipo: 'reactiva',
    aliases: ['EV LIVE Captiva PHEV RAQ'],
  },
  {
    key: 'ev_live_spark',
    label: 'EV LIVE Spark EV',
    tipo: 'reactiva',
    aliases: ['EV LIVE Spark EV'],
  },
  {
    key: 'scd_abandon_finance',
    label: 'SCD- Abandon - Profile (Finance)',
    tipo: 'reactiva',
    aliases: ['SCD- Abandon - Profile (Finance)', 'SCD Abandon Profile (Finance)'],
  },
  {
    key: 'sw_prueba_manejo_nuevos',
    label: 'Sitio Web Distribuidor Prueba de Manejo Nuevos',
    tipo: 'reactiva',
    aliases: ['Sitio Web Distribuidor Prueba de Manejo Nuevos'],
  },
  {
    key: 'scd_abandon_cash',
    label: 'SCD- Abandon - Profile (Cash)',
    tipo: 'reactiva',
    aliases: ['SCD- Abandon - Profile (Cash)', 'SCD Abandon Profile (Cash)'],
  },
  {
    key: 'scd_complete_finance',
    label: 'SCD - Complete - Finance - New Vehicle',
    tipo: 'reactiva',
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
    tipo: 'reactiva',
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
    tipo: 'reactiva',
    aliases: ['EV LIVE CAPTIVA PHEV TD'],
  },
  {
    key: 'ev_live_spark_td',
    label: 'EV LIVE Spark EV TD',
    tipo: 'reactiva',
    aliases: ['EV LIVE Spark EV TD'],
  },
  {
    key: 'scd_trade_in',
    label: 'SCD - Trade In Lead - New Vehicle',
    tipo: 'reactiva',
    aliases: ['SCD - Trade In Lead - New Vehicle'],
  },
  {
    key: 'scd_ask_question',
    label: 'SCD - Ask a Question - New Vehicle',
    tipo: 'reactiva',
    aliases: [
      'SCD - Ask a Question - New Vehicle',
      'SCD - Ask a Question -New Vehicle',
    ],
  },
  {
    key: 'brightdrop_config',
    label: 'Brighdrop Configuration',
    tipo: 'reactiva',
    aliases: ['Brighdrop Configuration', 'BrightDrop Configuration', 'Brightdrop Configuration'],
  },
  {
    key: 'scd_test_drive',
    label: 'SCD - Test Drive - New Vehicle',
    tipo: 'reactiva',
    aliases: ['SCD - Test Drive - New Vehicle'],
  },
  {
    key: 'scd_vehicle_na',
    label: 'SCD - Vehicle Not Available - New Vehicle',
    tipo: 'reactiva',
    aliases: ['SCD - Vehicle Not Available - New Vehicle'],
  },
  {
    key: 'eventos_ev',
    label: 'Eventos Vehiculos electricos',
    tipo: 'reactiva',
    aliases: [
      'Eventos Vehiculos electricos',
      'Eventos Vehículos eléctricos',
    ],
  },
  {
    key: 'gmf_retencion',
    label: 'GMF Retención',
    tipo: 'proactiva',
    aliases: ['GMF Retención', 'GMF Retencion', 'GMF RETENCIÓN'],
  },
  {
    key: 'gmf_lealtad',
    label: 'GMF Lealtad',
    tipo: 'proactiva',
    aliases: ['GMF Lealtad', 'GMF LEALTAD'],
  },
  {
    key: 'equity_mining_nvs',
    label: 'Equity Mining NVS Mature',
    tipo: 'proactiva',
    aliases: [
      'Equity Mining NVS Mature',
      'Equity Mining NVS',
      'EQUITY MINING NVS MATURE',
    ],
  },
  {
    key: 'equity_mining_uvs',
    label: 'Equity Mining UVS Mature',
    tipo: 'proactiva',
    aliases: [
      'Equity Mining UVS Mature',
      'Equity Mining UVS',
      'EQUITY MINING UVS',
      'EQUITY MINING UVS MATURE',
    ],
  },
  {
    key: 'gmmx_gmf_leasing',
    label: 'GMMX GMF LEASING',
    tipo: 'proactiva',
    aliases: ['GMMX_GMF_LEASING', 'GMMX GMF LEASING', 'GMMX GMF Leasing'],
  },
  {
    key: 'amdgm_facebook',
    label: 'AMDGM Facebook',
    tipo: 'proactiva',
    aliases: ['AMDGM Facebook', 'AMDGM_Facebook'],
  },
  {
    key: 'amdgm_tiktok',
    label: 'AMDGM TikTok',
    tipo: 'proactiva',
    aliases: ['AMDGM TikTok', 'AMDGM_TikTok'],
  },
  {
    key: 'amdgm_landing_google',
    label: 'AMDGM Landing Google',
    tipo: 'proactiva',
    aliases: ['AMDGM Landing Google', 'AMDGM_Landing Google'],
  },
];

/** Normaliza auto_interes a familia de vehículo estilo One Pager. */
function normalizeVehiculoLead(value) {
  const raw = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw || raw === 'SIN VEHICULO' || raw === 'N A' || raw === 'NA' || raw === 'NULL') {
    return '(sin vehículo)';
  }

  const rules = [
    [/AVEO\s*HB|AVEO\s*HATCH/, 'AVEO HB'],
    [/AVEO\s*NB|AVEO\s*SEDAN|AVEO\s*NOTCH/, 'AVEO NB'],
    [/\bAVEO\b/, 'AVEO'],
    [/CAPTIVA\s*PHEV/, 'CAPTIVA PHEV'],
    [/\bCAPTIVA\b/, 'CAPTIVA'],
    [/BLAZER\s*EV/, 'BLAZER EV'],
    [/\bBLAZER\b/, 'BLAZER'],
    [/EQUINOX\s*EV/, 'EQUINOX EV'],
    [/\bEQUINOX\b/, 'EQUINOX'],
    [/\bGROOVE\b/, 'GROOVE'],
    [/\bONIX\b/, 'ONIX'],
    [/\bTRAX\b/, 'TRAX'],
    [/\bTRACKER\b/, 'TRACKER'],
    [/\bTRAVERSE\b/, 'TRAVERSE'],
    [/\bTAHOE\b/, 'TAHOE'],
    [/\bSUBURBAN\b/, 'SUBURBAN'],
    [/\bMONTANA\b/, 'MONTANA'],
    [/TORNADO/, 'TORNADO VAN'],
    [/S10|SILVERADO|CHEYENNE|COLORADO/, 'S10 / PICK UP'],
    [/EXPRESS|BRIGHTDROP|BRIGHDROP/, 'VAN / COMERCIAL'],
    [/\bSPARK\b/, 'Spark'],
    [/\bBOLT\b/, 'BOLT'],
    [/\bCAVALIER\b/, 'CAVALIER'],
    [/\bCORVETTE\b/, 'CORVETTE'],
    [/\bCAMARO\b/, 'CAMARO'],
  ];
  for (const [re, label] of rules) {
    if (re.test(raw)) return label;
  }
  return raw.length > 28 ? `${raw.slice(0, 28)}…` : raw;
}

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

/** Campañas internas ABP / CODE: no entran a conversión One Pager. */
function isCampanaAbpOrCode(campanaName) {
  const n = normCampana(campanaName);
  if (!n) return false;
  return /^(ABP|CODE)(\s|$)/.test(n);
}

/**
 * Clasifica una campaña CRM para el One Pager.
 * - proactiva: catálogo explícito
 * - excluida: ABP* / CODE*
 * - reactiva: catálogo o cualquier otra campaña (dinámica)
 */
function classifyCampanaConversion(campanaName) {
  const raw = String(campanaName || '').trim() || '(sin campaña)';
  if (isCampanaAbpOrCode(raw)) {
    return { tipo: null, key: null, label: raw, excluded: 'abp_code', dinamica: false };
  }

  const key = resolveCampanaConversionKey(raw);
  if (key) {
    const cfg = CAMPANAS_CONVERSION.find((c) => c.key === key);
    if (cfg) {
      return {
        tipo: cfg.tipo || 'reactiva',
        key: cfg.key,
        label: cfg.label,
        excluded: null,
        dinamica: false,
      };
    }
  }

  const n = normCampana(raw);
  const dynKey = `dyn_${n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'sin_campana'}`;
  return {
    tipo: 'reactiva',
    key: dynKey,
    label: raw,
    excluded: null,
    dinamica: true,
  };
}

module.exports = {
  LEAD_VIDA_DIAS,
  CAMPANAS_CONVERSION,
  normCampana,
  normalizeVehiculoLead,
  resolveCampanaConversionKey,
  isCampanaAbpOrCode,
  classifyCampanaConversion,
};
