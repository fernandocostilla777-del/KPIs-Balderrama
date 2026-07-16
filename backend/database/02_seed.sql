/*
  KPIs BALDERRAMA — Datos semilla
  Basado en: Total de cuentas.xlsx, Gatos para buscar origen.xlsx,
             costCenterMapping.js, prorationMatrix.js, VTASMEN
*/

SET NOCOUNT ON;

/* --- Tipos de cuenta --- */
MERGE kpi.tipos_cuenta AS t
USING (VALUES
  (1, 'activo',     N'Activo circulante / Caja-Bancos-CxC', '0200', '0299', 'DEUD'),
  (2, 'activo_fijo',N'Activo fijo y diferido',             '0300', '0399', 'DEUD'),
  (3, 'ingreso',    N'Ingresos operativos',                '0400', '0499', 'ACRE'),
  (4, 'costo',      N'Costo de ventas',                    '0600', '0699', 'DEUD'),
  (5, 'gasto',      N'Gastos de operación',                '0700', '0799', 'DEUD'),
  (6, 'financiero', N'Productos / gastos financieros',     '0800', '0999', NULL)
) AS s(id, codigo, nombre, prefijo_desde, prefijo_hasta, naturaleza)
ON t.id = s.id
WHEN NOT MATCHED THEN INSERT (id, codigo, nombre, prefijo_desde, prefijo_hasta, naturaleza)
  VALUES (s.id, s.codigo, s.nombre, s.prefijo_desde, s.prefijo_hasta, s.naturaleza);
GO

/* --- Áreas de negocio --- */
MERGE kpi.areas AS t
USING (VALUES
  ('autosNuevos',  N'Autos nuevos',        1, 1),
  ('seminuevos',   N'Seminuevos',          1, 2),
  ('servicio',     N'Servicio',            1, 3),
  ('refacciones',  N'Refacciones',         1, 4),
  ('hyp',          N'Hojalatería y Pintura',1, 5),
  ('postventa',    N'Postventa admin',     1, 6),
  ('admin',        N'Administración',      0, 7),
  ('verificentro', N'Verificentro',        1, 8)
) AS s(id, nombre, es_operativa, orden)
ON t.id = s.id
WHEN NOT MATCHED THEN INSERT (id, nombre, es_operativa, orden)
  VALUES (s.id, s.nombre, s.es_operativa, s.orden);
GO

/* --- Centros de costo --- */
MERGE kpi.centros_costo AS t
USING (VALUES
  ('piso',        N'Piso (Autos Nuevos)', 'autosNuevos', '0001', 'operativo'),
  ('foraneos',    N'Foráneos',            'autosNuevos', '0002', 'operativo'),
  ('cholula',     N'Cholula',             'autosNuevos', '0004', 'operativo'),
  ('zacatelco',   N'Zacatelco',           'autosNuevos', '0005', 'operativo'),
  ('flotillas',   N'Flotillas',           'autosNuevos', '0006', 'operativo'),
  ('casa',        N'Casa / BDC',          'autosNuevos', '0007', 'operativo'),
  ('suauto',      N'SuAuto',              'autosNuevos', '0008', 'operativo'),
  ('intercambios',N'Intercambios',        'autosNuevos', '0010', 'operativo'),
  ('seminuevos',  N'Seminuevos',          'seminuevos',  NULL,   'operativo'),
  ('servicio',    N'Servicio',            'servicio',    NULL,   'operativo'),
  ('refacciones', N'Refacciones',         'refacciones', NULL,   'operativo'),
  ('hyp',         N'Hojalatería y Pintura','hyp',        NULL,   'operativo'),
  ('postventa_admon', N'Postventa Admon', 'postventa',   NULL,   'administrativo'),
  ('admin_general',   N'Administración General', 'admin', NULL, 'administrativo'),
  ('verificentro',N'Verificentro',        'verificentro',NULL,   'operativo')
) AS s(id, nombre, area_id, segmento, tipo)
ON t.id = s.id
WHEN NOT MATCHED THEN INSERT (id, nombre, area_id, segmento, tipo)
  VALUES (s.id, s.nombre, s.area_id, s.segmento, s.tipo);
GO

/* --- Grupos contables (CTA_GPOCONT) --- */
MERGE kpi.grupos_contables AS t
USING (VALUES
  ('110', N'Activo circulante',           NULL, 'activo',    0, 0),
  ('120', N'Cuentas por cobrar',          NULL, 'activo',    0, 0),
  ('150', N'Inventarios / Plan piso',     NULL, 'activo',    0, 0),
  ('400', N'Ingresos por ventas',         'autosNuevos', 'ingreso', 0, 0),
  ('411', N'Ventas autos nuevos',         'autosNuevos', 'ingreso', 1, 0),
  ('600', N'Costo de ventas (general)',   NULL, 'costo',     0, 0),
  ('611', N'Costo autos nuevos',          'autosNuevos', 'costo', 1, 0),
  ('621', N'Costo seminuevos',            'seminuevos',  'costo', 0, 0),
  ('700', N'Gastos de operación (general)',NULL,'gasto',    0, 0),
  ('711', N'Gastos Piso',                 'autosNuevos', 'gasto', 1, 0),
  ('712', N'Gastos Foráneos',             'autosNuevos', 'gasto', 1, 0),
  ('713', N'Gastos SuAuto',               'autosNuevos', 'gasto', 1, 0),
  ('714', N'Gastos Cholula',              'autosNuevos', 'gasto', 1, 0),
  ('715', N'Gastos Zacatelco',            'autosNuevos', 'gasto', 1, 0),
  ('716', N'Gastos Flotillas',            'autosNuevos', 'gasto', 1, 0),
  ('717', N'Gastos Intercambios',         'autosNuevos', 'gasto', 1, 0),
  ('718', N'Gastos Casa / BDC',           'autosNuevos', 'gasto', 1, 0),
  ('720', N'Gastos Seminuevos',           'seminuevos',  'gasto', 0, 0),
  ('730', N'Gastos Postventa admin',      'postventa',   'gasto', 0, 0),
  ('731', N'Gastos Servicio',             'servicio',    'gasto', 0, 0),
  ('732', N'Gastos HYP',                  'hyp',         'gasto', 0, 0),
  ('733', N'Gastos Refacciones',          'refacciones', 'gasto', 0, 0),
  ('740', N'Administración (bolsón)',     'admin',       'gasto', 0, 1),
  ('750', N'Verificentro',                'verificentro','gasto', 0, 0),
  ('812', N'Productos financieros',       NULL, 'financiero', 0, 0),
  ('901', N'Gastos financieros',          NULL, 'financiero', 0, 0)
) AS s(codigo, nombre, area_id, tipo_reporte, es_vtasmen, es_admin)
ON t.codigo = s.codigo
WHEN NOT MATCHED THEN INSERT (codigo, nombre, area_id, tipo_reporte, es_vtasmen, es_admin)
  VALUES (s.codigo, s.nombre, s.area_id, s.tipo_reporte, s.es_vtasmen, s.es_admin);
GO

/* --- Subcuentas de gasto críticas --- */
MERGE kpi.subcuentas_gasto AS t
USING (VALUES
  ('0011', N'Comisiones por venta',           1),
  ('0013', N'Acondicionamiento / materiales', 0),
  ('0021', N'Remuneraciones gerentes',        0),
  ('0022', N'Remuneraciones oficina',         0),
  ('0065', N'Publicidad',                     0),
  ('0076', N'Intereses Plan Piso',            1),
  ('0080', N'Rentas',                         1),
  ('0086', N'Intereses hipoteca',             0),
  ('0091', N'Depreciaciones',                 0)
) AS s(codigo, nombre, es_critica)
ON t.codigo = s.codigo
WHEN NOT MATCHED THEN INSERT (codigo, nombre, es_critica)
  VALUES (s.codigo, s.nombre, s.es_critica);
GO

/* --- VTASMEN sucursales --- */
MERGE kpi.vtasmen_sucursales AS t
USING (VALUES
  ('piso',        '0001', '0400-0001-%', '0600-0001-%', '711', NULL),
  ('foraneos',    '0002', '0400-0002-%', '0600-0002-%', '712', NULL),
  ('suauto',      '0008', '0400-0008-%', '0600-0008-%;0600-0003-%', '713', NULL),
  ('cholula',     '0004', '0400-0004-%', '0600-0004-%', '714', NULL),
  ('zacatelco',   '0005', '0400-0005-%', '0600-0005-%', '715', NULL),
  ('casa',        '0007', '0400-0007-%', '0600-0007-%', '718', NULL),
  ('flotillas',   '0006', '0400-0006-%', '0600-0006-%', NULL,  '0700-%-0006-%'),
  ('intercambios','0010', '0400-0010-%', '0600-0010-%', NULL,  '0700-%-0010-%')
) AS s(id, segmento, prefijo_ingreso, prefijo_costo, grupo_gasto, patron_gasto)
ON t.id = s.id
WHEN NOT MATCHED THEN INSERT (id, segmento, prefijo_ingreso, prefijo_costo, grupo_gasto, patron_gasto)
  VALUES (s.id, s.segmento, s.prefijo_ingreso, s.prefijo_costo, s.grupo_gasto, s.patron_gasto);
GO

/* --- Matriz de prorrateo (admin → operativos) --- */
MERGE kpi.matriz_prorrateo AS t
USING (VALUES
  ('piso',        0.22),
  ('foraneos',    0.10),
  ('cholula',     0.08),
  ('zacatelco',   0.06),
  ('flotillas',   0.08),
  ('casa',        0.05),
  ('suauto',      0.04),
  ('intercambios',0.03),
  ('seminuevos',  0.08),
  ('refacciones', 0.10),
  ('servicio',    0.10),
  ('hyp',         0.06)
) AS s(centro_costo_id, porcentaje)
ON t.centro_costo_id = s.centro_costo_id AND t.vigente_desde = '2026-01-01'
WHEN NOT MATCHED THEN INSERT (centro_costo_id, porcentaje, vigente_desde)
  VALUES (s.centro_costo_id, s.porcentaje, '2026-01-01');
GO

/* --- Reglas de mapeo (prefijos → área/centro) --- */
MERGE kpi.reglas_mapeo_cuenta AS t
USING (VALUES
  (N'Ingreso Piso',       '0400-0001-%', 'ingreso', 'autosNuevos', 'piso',        '400', 10),
  (N'Ingreso Foráneos',   '0400-0002-%', 'ingreso', 'autosNuevos', 'foraneos',    '400', 10),
  (N'Ingreso Cholula',    '0400-0004-%', 'ingreso', 'autosNuevos', 'cholula',     '400', 10),
  (N'Ingreso Zacatelco',  '0400-0005-%', 'ingreso', 'autosNuevos', 'zacatelco',   '400', 10),
  (N'Ingreso SuAuto',     '0400-0008-%', 'ingreso', 'autosNuevos', 'suauto',      '400', 10),
  (N'Ingreso Casa',       '0400-0007-%', 'ingreso', 'autosNuevos', 'casa',        '400', 10),
  (N'Costo Piso',         '0600-0001-%', 'costo',   'autosNuevos', 'piso',        '611', 10),
  (N'Costo Foráneos',    '0600-0002-%', 'costo',   'autosNuevos', 'foraneos',    '611', 10),
  (N'Gasto grupo 711',    '0700-%-0001-%','gasto',  'autosNuevos', 'piso',        '711', 20),
  (N'Gasto grupo 740',    '0700-%',       'gasto',   'admin',       'admin_general','740', 90)
) AS s(nombre, prefijo, tipo_movimiento, area_id, centro_costo_id, grupo_contable, prioridad)
ON t.nombre = s.nombre
WHEN NOT MATCHED THEN INSERT (nombre, prefijo, tipo_movimiento, area_id, centro_costo_id, grupo_contable, prioridad)
  VALUES (s.nombre, s.prefijo, s.tipo_movimiento, s.area_id, s.centro_costo_id, s.grupo_contable, s.prioridad);
GO

/* --- Periodos 2026 --- */
MERGE kpi.periodos AS t
USING (VALUES
  (202601, 2026, 1,  N'ENE 26'),
  (202602, 2026, 2,  N'FEB 26'),
  (202603, 2026, 3,  N'MAR 26'),
  (202604, 2026, 4,  N'ABR 26'),
  (202605, 2026, 5,  N'MAY 26'),
  (202606, 2026, 6,  N'JUN 26'),
  (202607, 2026, 7,  N'JUL 26'),
  (202608, 2026, 8,  N'AGO 26'),
  (202609, 2026, 9,  N'SEP 26'),
  (202610, 2026, 10, N'OCT 26'),
  (202611, 2026, 11, N'NOV 26'),
  (202612, 2026, 12, N'DIC 26')
) AS s(id, anio, mes, nombre)
ON t.id = s.id
WHEN NOT MATCHED THEN INSERT (id, anio, mes, nombre)
  VALUES (s.id, s.anio, s.mes, s.nombre);
GO

/* --- Estados financieros --- */
MERGE kpi.estados_financieros AS t
USING (VALUES
  ('VTASMEN_PISO',     N'Estado de Resultados Depto Ventas - Piso',     'vtasmen'),
  ('VTASMEN_GENERAL',  N'Estado de Resultados VTASMEN Consolidado',    'vtasmen'),
  ('EEFF_GENERAL',     N'Estado de Resultados General',                'eeff'),
  ('BALANCE_GENERAL',  N'Balance General',                             'balance')
) AS s(codigo, nombre, tipo)
ON t.codigo = s.codigo
WHEN NOT MATCHED THEN INSERT (codigo, nombre, tipo)
  VALUES (s.codigo, s.nombre, s.tipo);
GO

PRINT 'Seed kpi completado.';
GO
