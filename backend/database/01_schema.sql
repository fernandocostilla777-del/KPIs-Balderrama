/*
  KPIs BALDERRAMA — Esquema analítico
  Base de datos de reporteo / ETL (capa propia del dashboard)
  Compatible SQL Server 2012+
*/

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'kpi')
  EXEC('CREATE SCHEMA kpi');
GO

/* ============================================================
   DIMENSIONES — Catálogo contable
   ============================================================ */

CREATE TABLE kpi.tipos_cuenta (
  id            TINYINT       NOT NULL PRIMARY KEY,
  codigo        VARCHAR(20)   NOT NULL UNIQUE,   -- activo, ingreso, costo, gasto, financiero
  nombre        NVARCHAR(80)  NOT NULL,
  prefijo_desde CHAR(4)       NOT NULL,          -- ej. '0400'
  prefijo_hasta CHAR(4)       NULL,
  naturaleza    CHAR(4)       NULL               -- DEUD | ACRE
);

CREATE TABLE kpi.areas (
  id            VARCHAR(30)   NOT NULL PRIMARY KEY,
  nombre        NVARCHAR(80)  NOT NULL,
  es_operativa  BIT           NOT NULL DEFAULT 1,
  orden         SMALLINT      NOT NULL DEFAULT 0
);

CREATE TABLE kpi.centros_costo (
  id            VARCHAR(30)   NOT NULL PRIMARY KEY,
  nombre        NVARCHAR(80)  NOT NULL,
  area_id       VARCHAR(30)   NOT NULL REFERENCES kpi.areas(id),
  segmento      CHAR(4)       NULL,              -- 0001, 0002… posición CCCC en CTA_NUMCTA
  tipo          VARCHAR(20)   NOT NULL DEFAULT 'operativo',  -- operativo | administrativo
  activo        BIT           NOT NULL DEFAULT 1,
  CONSTRAINT UQ_centros_costo_segmento UNIQUE (segmento)
);

CREATE TABLE kpi.grupos_contables (
  codigo        VARCHAR(10)   NOT NULL PRIMARY KEY,  -- CTA_GPOCONT: 400, 711, 740…
  nombre        NVARCHAR(120) NOT NULL,
  area_id       VARCHAR(30)   NULL REFERENCES kpi.areas(id),
  tipo_reporte  VARCHAR(30)   NULL,  -- ingreso | costo | gasto | activo | balance
  es_vtasmen    BIT           NOT NULL DEFAULT 0,
  es_admin      BIT           NOT NULL DEFAULT 0
);

CREATE TABLE kpi.subcuentas_gasto (
  codigo        CHAR(4)       NOT NULL PRIMARY KEY,  -- 0011, 0076, 0080…
  nombre        NVARCHAR(80)  NOT NULL,
  es_critica    BIT           NOT NULL DEFAULT 0      -- comisiones, plan piso, rentas
);

CREATE TABLE kpi.cuentas (
  id            INT           IDENTITY(1,1) PRIMARY KEY,
  numero_cuenta VARCHAR(25)   NOT NULL UNIQUE,       -- CTA_NUMCTA
  descripcion   NVARCHAR(200) NOT NULL,
  tipo_cuenta_id TINYINT      NULL REFERENCES kpi.tipos_cuenta(id),
  grupo_contable VARCHAR(10)  NULL REFERENCES kpi.grupos_contables(codigo),
  centro_costo_id VARCHAR(30) NULL REFERENCES kpi.centros_costo(id),
  subcuenta_gasto CHAR(4)     NULL REFERENCES kpi.subcuentas_gasto(codigo),
  naturaleza    CHAR(4)       NULL,                  -- DEUD | ACRE
  nivel         CHAR(4)       NOT NULL DEFAULT 'DETA', -- ACUM | DETA
  rubro         CHAR(4)       NOT NULL,              -- PPPP
  subrubro      CHAR(4)       NULL,                  -- SSSS
  segmento      CHAR(4)       NULL,                  -- CCCC
  detalle       CHAR(4)       NULL,                  -- FFFF
  activa        BIT           NOT NULL DEFAULT 1,
  origen        VARCHAR(30)   NOT NULL DEFAULT 'CON_CTAS',
  actualizado_en DATETIME2    NOT NULL DEFAULT SYSDATETIME()
);

CREATE INDEX IX_cuentas_grupo   ON kpi.cuentas(grupo_contable);
CREATE INDEX IX_cuentas_rubro   ON kpi.cuentas(rubro);
CREATE INDEX IX_cuentas_segmento ON kpi.cuentas(segmento);
CREATE INDEX IX_cuentas_nivel   ON kpi.cuentas(nivel);

CREATE TABLE kpi.periodos (
  id            INT           NOT NULL PRIMARY KEY,  -- YYYYMM ej. 202606
  anio          SMALLINT      NOT NULL,
  mes           TINYINT       NOT NULL,
  nombre        NVARCHAR(20)  NOT NULL,              -- JUN 26
  CONSTRAINT UQ_periodos_anio_mes UNIQUE (anio, mes)
);

CREATE TABLE kpi.estados_financieros (
  id            INT           IDENTITY(1,1) PRIMARY KEY,
  codigo        VARCHAR(60)   NOT NULL UNIQUE,
  nombre        NVARCHAR(120) NOT NULL,
  tipo          VARCHAR(30)   NOT NULL  -- vtasmen | eeff | balance | flujo
);

CREATE TABLE kpi.lineas_estado_resultado (
  id            INT           IDENTITY(1,1) PRIMARY KEY,
  estado_id     INT           NOT NULL REFERENCES kpi.estados_financieros(id),
  consecutivo   INT           NOT NULL,
  tipo_linea    VARCHAR(20)   NOT NULL,  -- GRUPO | CORTE01 | FORMULA
  dato          NVARCHAR(120) NOT NULL,
  grupo_contable VARCHAR(10)  NULL REFERENCES kpi.grupos_contables(codigo),
  signo         CHAR(1)       NULL,      -- + | -
  formula       NVARCHAR(200) NULL,
  CONSTRAINT UQ_lineas_estado UNIQUE (estado_id, consecutivo)
);

/* ============================================================
   CONFIGURACIÓN — Mapeos y prorrateo
   ============================================================ */

CREATE TABLE kpi.reglas_mapeo_cuenta (
  id            INT           IDENTITY(1,1) PRIMARY KEY,
  nombre        NVARCHAR(80)  NOT NULL,
  prefijo       VARCHAR(30)   NOT NULL,   -- 0400-0001-%, 0700-%-0006-%
  tipo_movimiento VARCHAR(20) NOT NULL,   -- ingreso | costo | gasto
  area_id       VARCHAR(30)   NULL REFERENCES kpi.areas(id),
  centro_costo_id VARCHAR(30) NULL REFERENCES kpi.centros_costo(id),
  grupo_contable VARCHAR(10)  NULL,
  prioridad     SMALLINT      NOT NULL DEFAULT 100,
  activa        BIT           NOT NULL DEFAULT 1
);

CREATE TABLE kpi.vtasmen_sucursales (
  id            VARCHAR(30)   NOT NULL PRIMARY KEY REFERENCES kpi.centros_costo(id),
  segmento      CHAR(4)       NOT NULL,
  prefijo_ingreso VARCHAR(30) NOT NULL,
  prefijo_costo   VARCHAR(80) NOT NULL,  -- puede tener varios separados por ;
  grupo_gasto   VARCHAR(10)   NULL REFERENCES kpi.grupos_contables(codigo),
  patron_gasto  VARCHAR(30)   NULL       -- 0700-%-0006-% si no usa grupo
);

CREATE TABLE kpi.matriz_prorrateo (
  id            INT           IDENTITY(1,1) PRIMARY KEY,
  centro_costo_id VARCHAR(30) NOT NULL REFERENCES kpi.centros_costo(id),
  porcentaje    DECIMAL(8,6)  NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 1),
  vigente_desde DATE          NOT NULL DEFAULT '2026-01-01',
  vigente_hasta DATE          NULL,
  activa        BIT           NOT NULL DEFAULT 1,
  CONSTRAINT UQ_prorrateo_centro_vigencia UNIQUE (centro_costo_id, vigente_desde)
);

/* ============================================================
   HECHOS — Movimientos y resultados ETL
   ============================================================ */

CREATE TABLE kpi.movimientos_contables (
  id            BIGINT        IDENTITY(1,1) PRIMARY KEY,
  cuenta_id     INT           NOT NULL REFERENCES kpi.cuentas(id),
  periodo_id    INT           NOT NULL REFERENCES kpi.periodos(id),
  cargo         DECIMAL(18,2) NOT NULL DEFAULT 0,
  abono         DECIMAL(18,2) NOT NULL DEFAULT 0,
  neto          DECIMAL(18,2) NOT NULL DEFAULT 0,
  origen_tabla  VARCHAR(40)   NOT NULL,   -- CON_CTAS012026
  sincronizado_en DATETIME2   NOT NULL DEFAULT SYSDATETIME(),
  CONSTRAINT UQ_movimiento_cuenta_periodo UNIQUE (cuenta_id, periodo_id)
);

CREATE INDEX IX_movimientos_periodo ON kpi.movimientos_contables(periodo_id);

CREATE TABLE kpi.etl_ejecuciones (
  id            BIGINT        IDENTITY(1,1) PRIMARY KEY,
  proceso       VARCHAR(10)   NOT NULL,   -- A | B | C | D | FULL
  fecha_inicio  DATE          NOT NULL,
  fecha_fin     DATE          NOT NULL,
  estado        VARCHAR(20)   NOT NULL DEFAULT 'ok',
  registros     INT           NULL,
  mensaje       NVARCHAR(500) NULL,
  ejecutado_en  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

CREATE TABLE kpi.bolson_administrativo (
  id            BIGINT        IDENTITY(1,1) PRIMARY KEY,
  etl_id        BIGINT        NOT NULL REFERENCES kpi.etl_ejecuciones(id),
  cuenta_id     INT           NOT NULL REFERENCES kpi.cuentas(id),
  periodo_id    INT           NOT NULL REFERENCES kpi.periodos(id),
  monto         DECIMAL(18,2) NOT NULL,
  grupo_contable VARCHAR(10)  NOT NULL DEFAULT '740'
);

CREATE TABLE kpi.prorrateo_detalle (
  id            BIGINT        IDENTITY(1,1) PRIMARY KEY,
  etl_id        BIGINT        NOT NULL REFERENCES kpi.etl_ejecuciones(id),
  centro_costo_id VARCHAR(30) NOT NULL REFERENCES kpi.centros_costo(id),
  periodo_id    INT           NOT NULL REFERENCES kpi.periodos(id),
  monto_origen  DECIMAL(18,2) NOT NULL,
  porcentaje    DECIMAL(8,6)  NOT NULL,
  monto_asignado DECIMAL(18,2) NOT NULL
);

CREATE TABLE kpi.consolidado_centro_costo (
  id            BIGINT        IDENTITY(1,1) PRIMARY KEY,
  etl_id        BIGINT        NOT NULL REFERENCES kpi.etl_ejecuciones(id),
  periodo_id    INT           NOT NULL REFERENCES kpi.periodos(id),
  centro_costo_id VARCHAR(30) NOT NULL REFERENCES kpi.centros_costo(id),
  area_id       VARCHAR(30)   NOT NULL REFERENCES kpi.areas(id),
  ventas_netas  DECIMAL(18,2) NOT NULL DEFAULT 0,
  costo_ventas  DECIMAL(18,2) NOT NULL DEFAULT 0,
  utilidad_bruta DECIMAL(18,2) NOT NULL DEFAULT 0,
  gasto_directo DECIMAL(18,2) NOT NULL DEFAULT 0,
  gasto_asignado DECIMAL(18,2) NOT NULL DEFAULT 0,
  utilidad_operativa DECIMAL(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT UQ_consolidado UNIQUE (etl_id, periodo_id, centro_costo_id)
);

CREATE INDEX IX_consolidado_periodo ON kpi.consolidado_centro_costo(periodo_id);

/* ============================================================
   VISTAS — Consultas frecuentes del dashboard
   ============================================================ */

GO
CREATE VIEW kpi.vw_catalogo_cuentas AS
SELECT
  c.numero_cuenta,
  c.descripcion,
  tc.nombre       AS tipo_cuenta,
  gc.codigo       AS grupo_contable,
  gc.nombre       AS grupo_nombre,
  cc.nombre       AS centro_costo,
  a.nombre        AS area,
  c.naturaleza,
  c.nivel,
  c.rubro,
  c.subrubro,
  c.segmento,
  sg.nombre       AS subcuenta_gasto
FROM kpi.cuentas c
LEFT JOIN kpi.tipos_cuenta tc ON tc.id = c.tipo_cuenta_id
LEFT JOIN kpi.grupos_contables gc ON gc.codigo = c.grupo_contable
LEFT JOIN kpi.centros_costo cc ON cc.id = c.centro_costo_id
LEFT JOIN kpi.areas a ON a.id = cc.area_id
LEFT JOIN kpi.subcuentas_gasto sg ON sg.codigo = c.subcuenta_gasto;
GO

CREATE VIEW kpi.vw_movimientos_mes AS
SELECT
  p.anio,
  p.mes,
  p.nombre        AS periodo,
  c.numero_cuenta,
  c.descripcion,
  gc.codigo       AS grupo_contable,
  cc.nombre       AS centro_costo,
  m.cargo,
  m.abono,
  m.neto
FROM kpi.movimientos_contables m
JOIN kpi.periodos p ON p.id = m.periodo_id
JOIN kpi.cuentas c ON c.id = m.cuenta_id
LEFT JOIN kpi.grupos_contables gc ON gc.codigo = c.grupo_contable
LEFT JOIN kpi.centros_costo cc ON cc.id = c.centro_costo_id;
GO

CREATE VIEW kpi.vw_resultado_operativo AS
SELECT
  p.anio,
  p.mes,
  cc.nombre       AS centro_costo,
  a.nombre        AS area,
  co.ventas_netas,
  co.costo_ventas,
  co.utilidad_bruta,
  co.gasto_directo,
  co.gasto_asignado,
  co.utilidad_operativa,
  CASE WHEN co.ventas_netas <> 0
    THEN ROUND(co.utilidad_operativa / co.ventas_netas * 100, 2)
    ELSE NULL END AS margen_operativo_pct
FROM kpi.consolidado_centro_costo co
JOIN kpi.periodos p ON p.id = co.periodo_id
JOIN kpi.centros_costo cc ON cc.id = co.centro_costo_id
JOIN kpi.areas a ON a.id = co.area_id;
GO
