/**
 * Perfiles atados a una sucursal. El resto de los roles ven la agencia.
 * Cholula es el canal de venta CH, la fuerza/sucursal CRM "Cholula"
 * y el menudeo contable 0004 (GPO 714).
 */
const PERFILES = {
  cholula: {
    id: 'cholula',
    label: 'Cholula',
    canalVenta: 'CHOLULA',
    contabilidadId: 'cholula',
    crmTexto: 'CHOLULA',
    afluenciaKey: 'cholula',
  },
};

function alcanceDeRol(roleId) {
  return PERFILES[roleId] || null;
}

function filtrarFilasCanal(rows, canal) {
  if (!canal) return rows || [];
  return (rows || []).filter((row) => String(row.CANAL_VENTA || '') === canal);
}

/** Predicado SQLite para crm_leads. El texto sale del catálogo, no del usuario. */
function sqlCrmSucursal(texto) {
  const t = String(texto || '').replace(/[^A-Z0-9 ]/g, '').trim();
  if (!t) return null;
  return {
    sql: `(instr(upper(COALESCE(sucursal, '')), ?) > 0 OR instr(upper(COALESCE(fuerza_ventas, '')), ?) > 0)`,
    params: [t, t],
  };
}

module.exports = {
  PERFILES,
  alcanceDeRol,
  filtrarFilasCanal,
  sqlCrmSucursal,
};
