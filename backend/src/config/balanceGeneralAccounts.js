/**
 * Balance General — cuentas mayor (ACUM) definidas por listado Excel Balderrama.
 * Activo = circulante + fijo + diferido
 * Pasivo = circulante + largo plazo
 * Capital = cuentas 0360 / 0370 / 0385 / 0386 + Resultado del ejercicio (PyG YTD)
 */

function acc(cuenta, label) {
  return { cuenta, label };
}

const BALANCE_GENERAL_SECTIONS = [
  {
    key: 'activoCirculante',
    label: 'Activo circulante',
    pertenece: 'ACTIVO',
    accounts: [
      acc('0200-0000-0000-0000', 'Fondo de caja chica'),
      acc('0201-0000-0000-0000', 'Caja'),
      acc('0202-0000-0000-0000', 'Bancos'),
      acc('0260-0000-0000-0000', 'Inversiones en valores'),
      acc('0205-0000-0000-0000', 'Contratos en tránsito'),
      acc('0220-0000-0000-0000', 'Cuentas por cobrar clientes crédito'),
      acc('0225-0000-0000-0000', 'Cuentas por cobrar clientes contado'),
      acc('0231-0000-0000-0000', 'Inventarios automóviles nuevos'),
      acc('0237-0000-0000-0000', 'Inventario comerciales nuevos'),
      acc('0240-0000-0000-0000', 'Inventario autos seminuevos'),
      acc('0241-0000-0000-0000', 'Inventario comerciales seminuevos'),
      acc('0242-0000-0000-0000', 'Inventario partes y accesorios'),
      acc('0245-0000-0000-0000', 'Inventario de pintura HYP'),
      acc('0246-0000-0000-0000', 'Mano de obra de trabajos en otros talleres'),
      acc('0247-0000-0000-0000', 'Mano de obra trabajos en procesos'),
      acc('0261-0000-0000-0000', 'Cuentas por cobrar a GM (no garantías)'),
      acc('0262-0000-0000-0000', 'Adeudos de compañías financieras'),
      acc('0263-0000-0000-0000', 'Reclamación de garantías'),
      acc('0270-0000-0000-0000', 'Impuestos pagados por anticipado'),
      acc('0272-0000-0000-0000', 'I.V.A. por acreditar'),
      acc('0293-0000-0000-0000', 'Documentos y ctas. por cobrar · func. y emplea.'),
      acc('0294-0000-0000-0000', 'Documentos y ctas. por cobrar · otros'),
    ],
  },
  {
    key: 'activoFijo',
    label: 'Activo fijo',
    pertenece: 'ACTIVO',
    accounts: [
      acc('0282-0000-0000-0000', 'Maquinaria y equipo de taller'),
      acc('0283-0000-0000-0000', 'Equipo de partes y accesorios'),
      acc('0284-0000-0000-0000', 'Muebles y enseres'),
      acc('0285-0000-0000-0000', 'Vehículos uso compañía'),
      acc('0286-0000-0000-0000', 'Mejoras en inmuebles arrendados'),
      acc('0287-0000-0000-0000', 'Equipo de cómputo'),
      acc('0351-0000-0000-0000', 'Deprec. acum. edificios y mejoras'),
      acc('0352-0000-0000-0000', 'Deprec. acum. maquinaria y eq. de taller'),
      acc('0353-0000-0000-0000', 'Deprec. acum. equipo para accesorios y partes'),
      acc('0354-0000-0000-0000', 'Deprec. acum. muebles y enseres'),
      acc('0355-0000-0000-0000', 'Deprec. acum. vehículos uso compañía'),
      acc('0357-0000-0000-0000', 'Deprec. acum. equipo de cómputo'),
    ],
  },
  {
    key: 'activoDiferido',
    label: 'Activo diferido',
    pertenece: 'ACTIVO',
    accounts: [
      acc('0296-0000-0000-0000', 'Inversiones y activos diversos'),
      acc('0271-0000-0000-0000', 'Seguros pagados por anticipado'),
    ],
  },
  {
    key: 'pasivoCortoPlazo',
    label: 'Pasivo circulante',
    pertenece: 'PASIVO',
    accounts: [
      acc('0221-0000-0000-0000', 'Anticipo de clientes'),
      acc('0300-0000-0000-0000', 'Cuentas por pagar · acreedores comerciales'),
      acc('0310-0000-0000-0000', 'Doctos. por pagar · autos nuevos'),
      acc('0311-0000-0000-0000', 'Doctos. por pagar plan piso · autos seminuevos'),
      acc('0321-0000-0000-0000', 'Remuneraciones por pagar'),
      acc('0323-0000-0000-0000', 'Impuestos y retenciones'),
      acc('0327-0000-0000-0000', 'Otros impuestos por pagar'),
      acc('0324-0000-0000-0000', 'Impuesto sobre ventas y servicios (IVA e ISAN)'),
      acc('0330-0000-0000-0000', 'Bonos para prestaciones'),
      acc('0331-0000-0000-0000', 'Otras cuentas por pagar'),
    ],
  },
  {
    key: 'pasivoLargoPlazo',
    label: 'Pasivo a largo plazo',
    pertenece: 'PASIVO',
    accounts: [
      acc('0326-0000-0000-0000', 'Provisiones'),
      acc('0336-0000-0000-0000', 'Provisión primas de antigüedad'),
    ],
  },
  {
    key: 'capital',
    label: 'Capital contable',
    pertenece: 'CAPITAL',
    accounts: [
      acc('0360-0000-0000-0000', 'Capital social'),
      acc('0370-0000-0000-0000', 'Utilidades retenidas (pérdidas acumuladas)'),
      acc('0385-0000-0000-0000', 'Result. acum. por posición monetaria'),
      acc('0386-0000-0000-0000', 'Reembolso de capital'),
    ],
  },
];

function getBalanceGeneralAccountsFlat() {
  return BALANCE_GENERAL_SECTIONS.flatMap((s) =>
    s.accounts.map((a) => ({ ...a, sectionKey: s.key, pertenece: s.pertenece })),
  );
}

module.exports = {
  BALANCE_GENERAL_SECTIONS,
  getBalanceGeneralAccountsFlat,
};
