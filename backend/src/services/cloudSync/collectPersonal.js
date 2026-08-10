/**
 * Extrae personal DMS activo desde SQL Server (GMOFARRIL)
 * para sincronizar a Railway (tabla dms_personal).
 */
const { query } = require('../../db');

const SQL_PERSONAL_ACTIVO = `
WITH vendedores AS (
  SELECT DISTINCT
    'VENDEDOR' AS categoria,
    LTRIM(RTRIM(r.ROL_ROL)) AS subtipo,
    CAST(r.ROL_IDPERSONA AS varchar(30)) AS external_id,
    LTRIM(RTRIM(COALESCE(p.PER_PATERNO, ''))) AS paterno,
    LTRIM(RTRIM(COALESCE(p.PER_MATERNO, ''))) AS materno,
    LTRIM(RTRIM(COALESCE(p.PER_NOMRAZON, ''))) AS nombre,
    LTRIM(RTRIM(COALESCE(p.PER_EMAIL, ''))) AS email,
    LTRIM(RTRIM(COALESCE(p.PER_SUCURSAL, ''))) AS sucursal
  FROM PER_ROLES r
  INNER JOIN PER_PERSONAS p ON p.PER_IDPERSONA = r.ROL_IDPERSONA
  WHERE LTRIM(RTRIM(COALESCE(r.ROL_ESTATUS, ''))) = '1'
    AND UPPER(LTRIM(RTRIM(r.ROL_ROL))) IN ('VENU', 'VESE', 'VETA', 'VECA')
    AND UPPER(LTRIM(RTRIM(COALESCE(p.PER_TIPO, '')))) = 'FIS'
    AND (
      NULLIF(LTRIM(RTRIM(p.PER_PATERNO)), '') IS NOT NULL
      OR NULLIF(LTRIM(RTRIM(p.PER_MATERNO)), '') IS NOT NULL
    )
),
personal_dms AS (
  SELECT DISTINCT
    'PERSONAL_DMS' AS categoria,
    LTRIM(RTRIM(r.ROL_ROL)) AS subtipo,
    CAST(r.ROL_IDPERSONA AS varchar(30)) AS external_id,
    LTRIM(RTRIM(COALESCE(p.PER_PATERNO, ''))) AS paterno,
    LTRIM(RTRIM(COALESCE(p.PER_MATERNO, ''))) AS materno,
    LTRIM(RTRIM(COALESCE(p.PER_NOMRAZON, ''))) AS nombre,
    LTRIM(RTRIM(COALESCE(p.PER_EMAIL, ''))) AS email,
    LTRIM(RTRIM(COALESCE(p.PER_SUCURSAL, ''))) AS sucursal
  FROM PER_ROLES r
  INNER JOIN PER_PERSONAS p ON p.PER_IDPERSONA = r.ROL_IDPERSONA
  WHERE LTRIM(RTRIM(COALESCE(r.ROL_ESTATUS, ''))) = '1'
    AND UPPER(LTRIM(RTRIM(r.ROL_ROL))) NOT IN (
      'CLI', 'PSP', 'FAC', 'PVE', 'CIT', 'CTC', 'PRSLEA', 'PLZSAN', 'EMP',
      'VENU', 'VESE', 'VETA', 'VECA'
    )
    AND UPPER(LTRIM(RTRIM(COALESCE(p.PER_TIPO, '')))) = 'FIS'
    AND (
      NULLIF(LTRIM(RTRIM(p.PER_PATERNO)), '') IS NOT NULL
      OR NULLIF(LTRIM(RTRIM(p.PER_MATERNO)), '') IS NOT NULL
    )
),
asesores_servicio AS (
  SELECT
    'ASESOR_SERVICIO' AS categoria,
    'AS' AS subtipo,
    LTRIM(RTRIM(a.PAR_IDENPARA)) AS external_id,
    CAST('' AS varchar(100)) AS paterno,
    CAST('' AS varchar(100)) AS materno,
    LTRIM(RTRIM(COALESCE(a.PAR_DESCRIP1, ''))) AS nombre,
    CAST('' AS varchar(100)) AS email,
    CAST('' AS varchar(50)) AS sucursal
  FROM PNC_PARAMETR a
  WHERE a.PAR_TIPOPARA = 'AS'
    AND UPPER(LTRIM(RTRIM(COALESCE(a.PAR_STATUS, '')))) = 'A'
    AND NULLIF(LTRIM(RTRIM(a.PAR_DESCRIP1)), '') IS NOT NULL
)
SELECT * FROM vendedores
UNION ALL
SELECT * FROM personal_dms
UNION ALL
SELECT * FROM asesores_servicio
`;

function mapPersonalRecords(rows) {
  return rows.map((row) => {
    const categoria = String(row.categoria || '').trim().toUpperCase();
    const subtipo = String(row.subtipo || '').trim().toUpperCase();
    const externalId = String(row.external_id || '').trim();
    const data = {
      categoria,
      subtipo,
      externalId,
      paterno: String(row.paterno || '').trim(),
      materno: String(row.materno || '').trim(),
      nombre: String(row.nombre || '').trim(),
      email: String(row.email || '').trim(),
      sucursal: String(row.sucursal || '').trim(),
      activo: true,
    };
    return {
      id: `${categoria}:${subtipo}:${externalId}`,
      data,
    };
  });
}

async function collectPersonal(_options = {}) {
  const rows = await query(SQL_PERSONAL_ACTIVO);
  const records = mapPersonalRecords(rows);
  const byCategoria = {};
  for (const rec of records) {
    const cat = rec.data.categoria;
    byCategoria[cat] = (byCategoria[cat] || 0) + 1;
  }
  return {
    domain: 'personal',
    syncType: 'monthly',
    periodKey: 'global',
    periodStart: null,
    periodEnd: null,
    records,
    meta: {
      total: records.length,
      byCategoria,
      soloActivos: true,
    },
  };
}

module.exports = {
  SQL_PERSONAL_ACTIVO,
  mapPersonalRecords,
  collectPersonal,
};
