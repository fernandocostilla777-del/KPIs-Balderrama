const { query } = require('../db');

const DOMAIN = 'objetivos';

function periodKeyFromRange(fechaInicio, fechaFin) {
  const source = String(fechaInicio || fechaFin || '').trim();
  const match = source.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function pct(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return null;
  return Math.round((p / t) * 1000) / 10;
}

/**
 * Embudo BDC calculado directamente sobre el CRM sincronizado en Railway.
 * crm_contactos define las personas únicas; crm_ciclos aporta sus actividades,
 * citas, respuestas, resultados y entregas.
 */
async function getBdcEmbudo({ fechaInicio, fechaFin } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin || '')) {
    return { disponible: false, status: 'sin-periodo', real: null };
  }

  const result = await query(
    `WITH ciclos_periodo AS (
       SELECT cc.*
       FROM crm_ciclos cc
       INNER JOIN crm_contactos contacto ON contacto.id_contacto = cc.id_contacto
       WHERE (
         CASE
           WHEN cc.fecha_inicio_ciclo ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN LEFT(cc.fecha_inicio_ciclo, 10)::date
           ELSE NULL
         END
       ) BETWEEN $1::date AND $2::date
     ),
     contactos AS (
       SELECT COUNT(DISTINCT id_contacto)::int AS total
       FROM ciclos_periodo
     ),
     citas AS (
       SELECT *
       FROM ciclos_periodo
       WHERE UPPER(TRIM(tipo_actividad)) = 'CITA'
     ),
     entregas AS (
       SELECT COUNT(DISTINCT id_contacto)::int AS total
       FROM ciclos_periodo
       WHERE fecha_entrega <> ''
         AND CASE
           WHEN fecha_entrega ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN LEFT(fecha_entrega, 10)::date
           ELSE NULL
         END BETWEEN $1::date AND $2::date
     )
     SELECT
       (SELECT total FROM contactos) AS contactos,
       COUNT(*)::int AS citas_agendadas,
       COUNT(*) FILTER (
         WHERE fecha_resp_actividad <> ''
       )::int AS citas_confirmadas,
       COUNT(*) FILTER (
         WHERE
           UPPER(resultado_actividad) = 'PM OK'
           OR UPPER(resultado_actividad) LIKE '%CONFIRMA%ASISTENCIA%'
           OR UPPER(resultado_actividad) LIKE '%CITA%CUMPLIDA%'
           OR UPPER(resultado_actividad) LIKE '%CLIENTE%ASISTE%'
           OR UPPER(resultado_actividad) LIKE '%CLIENTE%ACUDE%'
           OR UPPER(resultado_actividad) LIKE '%CONTACTO EN PISO%'
       )::int AS citas_cumplidas,
       (SELECT total FROM entregas) AS entregas_bdc
     FROM citas`,
    [fechaInicio, fechaFin]
  );

  const row = result.rows[0] || {};
  const real = {
    contactos: Number(row.contactos || 0),
    citasAgendadas: Number(row.citas_agendadas || 0),
    citasConfirmadas: Number(row.citas_confirmadas || 0),
    citasCumplidas: Number(row.citas_cumplidas || 0),
    entregasBdc: Number(row.entregas_bdc || 0),
  };

  return {
    disponible: true,
    status: 'completo',
    real,
    fuente: 'crm_contactos + crm_ciclos (Railway)',
    conversion: {
      citasSobreContactosPct: pct(real.citasAgendadas, real.contactos),
      confirmadasSobreAgendadasPct: pct(real.citasConfirmadas, real.citasAgendadas),
      cumplidasSobreConfirmadasPct: pct(real.citasCumplidas, real.citasConfirmadas),
      entregasSobreCumplidasPct: pct(real.entregasBdc, real.citasCumplidas),
    },
    nota: 'Contactos únicos con ciclo iniciado en el periodo; las etapas posteriores se calculan con sus actividades CRM.',
  };
}

/**
 * El backend local calcula el tablero completo y lo empuja como un único
 * registro por periodo. Aquí solo se sirve el último snapshot recibido.
 */
async function getObjetivosSnapshot({ fechaInicio, fechaFin } = {}) {
  const periodKey = periodKeyFromRange(fechaInicio, fechaFin);

  const result = await query(
    `SELECT payload, last_seen_at, first_seen_at
     FROM sync_entities
     WHERE domain = $1 AND period_key IS NOT DISTINCT FROM $2
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [DOMAIN, periodKey]
  );

  const row = result.rows[0];
  if (!row) return { found: false, periodKey };

  return {
    found: true,
    periodKey,
    payload: row.payload,
    sincronizadoEn: row.last_seen_at,
    primerRegistroEn: row.first_seen_at,
  };
}

async function listObjetivosPeriodos() {
  const result = await query(
    `SELECT period_key, last_seen_at
     FROM sync_entities
     WHERE domain = $1
     ORDER BY period_key DESC`,
    [DOMAIN]
  );
  return result.rows.map((row) => ({
    periodKey: row.period_key,
    sincronizadoEn: row.last_seen_at,
  }));
}

module.exports = {
  getBdcEmbudo,
  getObjetivosSnapshot,
  listObjetivosPeriodos,
};
