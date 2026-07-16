require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { query, getPool } = require('../src/db');

(async () => {
  // try find grupo catalog used by vista
  const g = await query(`
    SELECT TOP 20 grupoRefaccion, COUNT(*) c, SUM(existenciaActual) e
    FROM dbo.vistaRefaccionesActual
    GROUP BY grupoRefaccion ORDER BY SUM(existenciaActual) DESC
  `);

  // definition of vista if possible
  let def = null;
  try {
    def = await query(`
      SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.vistaRefaccionesActual')) AS def
    `);
  } catch (_) {}

  const summary = `
================================================================================
RESUMEN EJECUTIVO — Inventario PostVenta (descubrimiento ${new Date().toISOString()})
================================================================================

## Tablas listas para usar (recomendadas)

1) dbo.PAR_ALMACEN  *** FUENTE OPERATIVA ACTUAL ***
   - ~57,293 líneas | ~11 almacenes | ~43,366 partes
   - ~7,357 líneas con existencia > 0
   - Existencia total ~117,823 | Costo inventariado ~\$39.8M
   - Campos clave:
     ALM_IDPARTE, ALM_IDALMA, ALM_EXISTEN, ALM_APARTADA, ALM_PROCESO,
     ALM_CTOPROM (costo promedio), ALM_CLASIFICA, ALM_STATUS, ALM_STOCK,
     ALM_FECHULCOM, ALM_FECHULTVEN, ALM_FECHOPE

2) dbo.PAR_PARTES  *** CATÁLOGO / FAMILIA ***
   - ~43,470 partes
   - Campos clave: PTS_IDPARTE, PTS_DESPARTE, PTS_GRUPO, PTS_LINEA, PTS_SUBGPO,
     PTS_CUNREPO / PTS_CUNULCO (costos), PTS_PCOLISTA, PTS_SITPTA

3) dbo.vistaRefaccionesActual  *** VISTA BI SIMPLE (sin costo) ***
   - ~43,289 filas, fechaAlta hasta 2026-07-13 (fresca)
   - existenciaActual suma ~117,429 (alineada a PAR_ALMACEN)
   - Campos: codigoRefaccion, nombreRefaccion, grupoRefaccion, subgrupoRefaccion,
     existenciaActual, fechaAlta, dias
   - NO trae costo ni almacén (agregado a nivel parte)

## Candidata NO usable para KPIs actuales

- dbo.BI_REF_INVENT: schema excelente (Existencia, Total_Costo, Almacen, Grupo_invn)
  PERO snapshot congelado 2013-04-05 (13,047 filas, un solo id_dis=19323).
  Útil solo como referencia de columnas/naming, NO como fuente de dashboard.

## Otras (no prioritarias para stock PV)

- par_existencias: histórico masivo (~38M filas), fechas 2011 — snapshot/histórico
- PAR_INVENTARIO / INV_INVENTARIO: conteos físicos, vacíos
- DDOA_*/DDS_PartsInventory / UDBPARTSINVENTORYLINE: interfaces DMS, no BI primario
- BI_INVENTARIO_NUEVOS / VDS_*: inventario de UNIDADES (autos), no refacciones
- SER_INVENTARIO: checklist de orden servicio, no stock de partes

## Ejemplo 2 filas (PAR_ALMACEN + PAR_PARTES, existencia>0)

1) parte=42821409 | COFRE | almacén=ALM7 | exist=69 | costo_u=9953.29 | total≈686,777 | grupo=12 | fechope=12/02/2026
2) parte=P070 | PELICULA | almacén=GEN | exist=299 | costo_u≈2108.59 | total≈630,468 | grupo=98 | fechope=10/01/2024

## HYP vs Refacciones — cómo distinguirlos

NO hay tabla/vista de inventario con nombre HYP ni columna "HYP" en stock.
En PostVenta:

A) Contable / centros de costo (ya en config del proyecto):
   - Refacciones: cuentas ventas 0470/0476…0491 y costo 0662–0691 (área refacciones)
   - HYP (Hojalatería y Pintura): ventas 0480–0484 y costo 0660 (área hyp)
   - Ver: costCenterMapping.js, accountCatalogMapping.js

B) Órdenes de servicio (postSalesLoad.js ORDER_TYPE):
   - J = Interna HYP
   - Ó = Interna nuevos HYP
   - H = Interna seminuevos HYP
   HYP se distingue por TIPO DE ORDEN / área operativa, no por almacén de partes.

C) Inventario de partes:
   Stock es UN SOLO inventario de refacciones (PAR_ALMACEN).
   Materiales de HYP (pintura, película, etc.) viven en el mismo catálogo
   (ej. grupo 98 / líneas P*); no hay almacén etiquetado "HYP" en los ids:
   GEN, ALM2–ALM9, CHOL, VEN.
   Para "inventario HYP" habría que filtrar por grupo/línea de materiales de carrocería
   o por consumo en órdenes tipo HYP — no por tabla separada.

## Query sugerida de resumen (KPIs)

-- Totales + por almacén
SELECT
  LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
  COUNT(*) AS lineas,
  SUM(CASE WHEN a.ALM_EXISTEN > 0 THEN 1 ELSE 0 END) AS lineas_con_existencia,
  SUM(a.ALM_EXISTEN) AS existencia,
  SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM, 0)) AS costo_inventario,
  SUM(a.ALM_APARTADA) AS apartadas,
  SUM(a.ALM_PROCESO) AS en_proceso
FROM dbo.PAR_ALMACEN a
WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
GROUP BY LTRIM(RTRIM(a.ALM_IDALMA))
ORDER BY costo_inventario DESC;

-- Por familia (grupo de parte)
SELECT
  LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, ''))) AS grupo,
  MAX(LTRIM(RTRIM(v.grupoRefaccion))) AS grupo_label, -- opcional via vista
  COUNT(*) AS lineas,
  SUM(a.ALM_EXISTEN) AS existencia,
  SUM(a.ALM_EXISTEN * ISNULL(a.ALM_CTOPROM, 0)) AS costo_inventario
FROM dbo.PAR_ALMACEN a
LEFT JOIN dbo.PAR_PARTES p
  ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(p.PTS_IDPARTE))
LEFT JOIN dbo.vistaRefaccionesActual v
  ON LTRIM(RTRIM(a.ALM_IDPARTE)) = LTRIM(RTRIM(v.codigoRefaccion))
WHERE a.ALM_EXISTEN <> 0
GROUP BY LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, '')))
ORDER BY costo_inventario DESC;

-- Alternativa rápida SIN costo (solo existencia / familia):
SELECT grupoRefaccion, COUNT(*) lineas, SUM(existenciaActual) existencia
FROM dbo.vistaRefaccionesActual
GROUP BY grupoRefaccion
ORDER BY SUM(existenciaActual) DESC;

## Grupos top (vistaRefaccionesActual)
${JSON.stringify(g, null, 2)}

## Definición vistaRefaccionesActual (si disponible)
${def && def[0] ? String(def[0].def).slice(0, 2000) : '(no disponible)'}

================================================================================
Archivo generado por scripts/_discover-inv-postventa*.js
Raw dump + follow-ups arriba en este mismo archivo.
================================================================================
`;

  fs.appendFileSync('scripts/_inv-postventa-discovery.txt', summary, 'utf8');
  console.log(summary);
  await (await getPool()).close();
})().catch((e) => { console.error(e); process.exit(1); });
