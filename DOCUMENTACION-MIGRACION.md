# Documentación de migración de base de datos

Guía para migrar **KPIs BALDERRAMA** a otra base de datos (por ejemplo PostgreSQL, MySQL u otro SQL Server).

Última actualización: 2026-07-30  
Repositorio: [KPIs-Balderrama](https://github.com/fernandocostilla777-del/KPIs-Balderrama)

---

## 1. Objetivo y alcance

Este documento inventaria **todas las fuentes de datos** del monorepo y define un plan para sustituir o consolidar la base operativa principal.

| Alcance | ¿Qué implica? |
|---------|----------------|
| **A — Solo GMOFARRIL** | Reemplazar SQL Server operativo por otra BD (caso más frecuente) |
| **B — Unificar CRM** | Mover también SQLite `crm-ciclos.db` a la misma BD destino |
| **C — Unificar nube** | Fusionar cloud-api (PostgreSQL) con la BD operativa |
| **D — Lift & shift** | Copiar tablas 1:1 (mismas estructuras) |
| **E — Modelo nuevo** | Rediseñar a schema analítico (p. ej. `kpi.*`) |

> **Importante:** “Migrar la base” casi siempre significa migrar **SQL Server GMOFARRIL**.  
> `cloud-api` ya usa **PostgreSQL**. SQLite CRM y archivos JSON/XLSX son stores auxiliares.

---

## 2. Arquitectura actual

```
Prueba Dashbord /
├── backend/       # API operativa (:3000) → SQL Server + SQLite CRM
├── frontend/      # UI (:5173) → sin BD (proxy /api → backend)
├── cloud-api/     # API nube (:4000) → PostgreSQL
├── mobile-app/    # Ionic → solo cloud-api
└── package.json   # concurrently backend + frontend
```

### Flujo de datos

```
SQL Server (GMOFARRIL)
        │
        ▼
   backend (mssql)
        │
        ├──► frontend (dashboard web)
        │
        └──► cloudSync ──POST──► cloud-api ──► PostgreSQL
                                                    │
                                                    ▼
                                              mobile-app

Google Sheets ──xlsx──► ETL scripts ──► backend/data/crm-ciclos.db (SQLite)
XLSX / JSON locales ──► servicios de configuración (presupuesto, metas, auth…)
```

| Paquete | BD | Driver |
|---------|----|--------|
| `backend/` | SQL Server + SQLite | `mssql`, `better-sqlite3`, `xlsx` |
| `frontend/` | Ninguna | — |
| `cloud-api/` | PostgreSQL | `pg` |
| `mobile-app/` | Ninguna (HTTP a cloud-api) | — |

---

## 3. Fuente 1 — SQL Server (GMOFARRIL)

### 3.1 Conexión

Archivo: `backend/src/db.js`

| Parámetro | Variable | Default |
|-----------|----------|---------|
| Host | `DB_HOST` | (requerido) |
| Puerto | `DB_PORT` | `1433` |
| Database | `DB_NAME` | (p. ej. `GMOFARRIL`) |
| Usuario | `DB_USER` | |
| Contraseña | `DB_PASSWORD` | |
| encrypt | hardcode | `false` |
| trustServerCertificate | hardcode | `true` |
| Pool | | max 10, idle 30s |
| Timeouts | | connect 30s, request 120s |

API: `{ getPool, query, sql }` — parámetros estilo `@nombre`, resultado en `recordset`.

**Compatibilidad documentada:** SQL Server **2008 R2** (evitar `TRY_CONVERT`, `STRING_AGG`, etc.).

### 3.2 Tablas / objetos principales

| Dominio | Objetos |
|---------|---------|
| Ventas | `ADE_VTAFI`, `ADE_VTAFIDET`, `ADE_CFDI`, `UNI_TEMLIBROVENTAS` |
| Unidades | `SER_VEHICULO`, `UNI_CATALOGO`, `UNI_CATACOLOR`, `UNI_VEHDETA` |
| Personas | `PER_PERSONAS`, `PNC_PARAMETR` |
| SOFIA | `SOF_Venta_Cancel_DEMO` |
| Postventa | `SER_ORDEN`, `SER_ORDENDET`, `SER_FACORDEN`, `SER_ORDTOTCXP` |
| Refacciones | `PAR_ALMACEN`, `PAR_PARTES`, `PAR_PEDIDO`, `PAR_PEDIDETA`, `PAR_PEDMOST`, `PAR_MOVTOS`, `PAR_MOVDET` |
| CXC | `CXC_PAGANT`, `CXC_PAGANTDET`, `CXC_PagosCajaDet` |
| Contabilidad | `CON_CTAS01{AAAA}` (ej. `CON_CTAS012026`), `CON_CONFESTADORESULTADO`, `CON_CONFBALANCEGENERAL` |
| BI | `BI_INVENTARIO_NUEVOS` |

### 3.3 Joins canónicos (ventas)

```
ADE_VTAFI.VTE_SERIE          = SER_VEHICULO.VEH_NUMSERIE
ADE_VTAFI.VTE_IDCLIENTE      = PER_PERSONAS.PER_IDPERSONA
SER_VEHICULO.VEH_VENDEDOR    = PER_PERSONAS.PER_IDPERSONA
SER_VEHICULO ↔ UNI_CATALOGO  (VEH_ANMODELO + VEH_CATALOGO)
SER_VEHICULO ↔ UNI_CATACOLOR (colores)
ADE_VTAFI ↔ UNI_TEMLIBROVENTAS (utilidad / libro)
ADE_VTAFI ↔ SOF_Venta_Cancel_DEMO (entregas; SOF_Factura = VTE_DOCTO)
```

**Fechas:** muchas columnas llegan como texto `dd/mm/yyyy` → en T-SQL se usa `CONVERT(DATE|datetime, col, 103)`.

### 3.4 Contabilidad anual

- Tablas dinámicas: `CON_CTAS01` + año (`CON_CTAS012025`, `CON_CTAS012026`).
- Detección con `INFORMATION_SCHEMA.TABLES`.
- Campos típicos: `CTA_NUMCTA`, `CTA_GPOCONT`, `CTA_SDOINICIAL`, `CTA_CARGO{n}`, `CTA_ABONO{n}`, `CTA_ACUMDET`.

### 3.5 Schema analítico opcional (no sustituye GMOFARRIL)

- `backend/database/01_schema.sql` / `02_seed.sql` → schema `kpi.*`
- Documentación: `backend/database/README.md`
- El runtime del dashboard **lee GMOFARRIL directo**, no el schema `kpi.*`.

---

## 4. Fuente 2 — SQLite CRM (`crm-ciclos.db`)

| Ítem | Valor |
|------|-------|
| Path | `backend/data/crm-ciclos.db` |
| Driver | `better-sqlite3` (addon nativo) |
| Uso en app | lectura `readonly: true` |
| Escritura | scripts ETL / sync Sheets |

### Tablas

| Tabla | Script ETL | Origen |
|-------|------------|--------|
| `crm_actividades` | `backend/scripts/etl-crm-ciclos.js` | CSV/XLSX Balderrama Ciclos |
| `crm_leads` | `etl-crm-leads.js` | Google Sheet → `leads-source.xlsx` |
| `crm_solicitudes` | `etl-crm-solicitudes.js` | hoja solicitudes |
| `crm_pruebas_manejo` | `etl-crm-pruebas-manejo.js` | hoja pruebas |
| `crm_financiamiento` | `etl-crm-financiamiento.js` | hoja financiamiento |
| `crm_csi_posventa` / `crm_csi_ventas` | `etl-crm-csi.js` | hojas CSI |

**Orquestación:** `backend/scripts/sync-crm-sheets.js` + `backend/src/services/crmSheetsSync.js`

**Consumidores:** `crmCiclosService.js` (híbrido SQLite + SQL Server), `financiamientoService.js`.

Claves de relación: `id_crm` / `id_contacto` ↔ VIN (`vin`) ↔ factura DMS.

---

## 5. Fuente 3 — Google Sheets

| Variable | Uso |
|----------|-----|
| `CRM_SHEETS_SYNC_ENABLED` | default `true` |
| `CRM_SHEETS_SYNC_HOURS` | intervalo (default `5`) |
| `CRM_SHEETS_SYNC_ON_START` | sync al arrancar |
| `CRM_SHEETS_URL` | URL export XLSX |
| `CRM_SHEETS_XLSX` | destino local (default `backend/data/leads-source.xlsx`) |

Flujo: HTTP export → XLSX → ETLs → SQLite.

API: `GET /api/crm/sheets-sync/status`, `POST /api/crm/sheets-sync/run`.

---

## 6. Fuente 4 — PostgreSQL (cloud-api)

Archivo: `cloud-api/src/db.js`

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` | connection string PostgreSQL |
| `PG_SSL` | `false` desactiva SSL |
| `CLOUD_SYNC_API_KEY` | autenticación ingest |
| `MOBILE_AUTH_SECRET` | JWT / auth móvil |

Schema: `cloud-api/database/01_schema.sql`

Tablas: `sync_batches`, `sync_entities`, `sync_entity_history` (payloads **JSONB** por dominio).

Dominios sync: `overview`, `ventas`, `forecast`, `inventario`, `contabilidad`, `crm`, `postventa`, `auth`.

> Esta capa es **réplica documental**. No reemplaza las queries operativas a GMOFARRIL.

---

## 7. Stores locales (sin SQL Server)

| Archivo | Uso |
|---------|-----|
| `backend/data/presupuesto-2026.xlsx` | Presupuesto EEFF (`BUDGET_XLSX_PATH` opcional) |
| `backend/data/nomenclatura-eeff.xlsx` | Nomenclatura EEFF |
| `backend/data/forecast-source.csv` | Fallback forecast sin SQL |
| `backend/data/sales-goals.json` / `sales-goals-historic.json` | Metas |
| `backend/data/users.json` | Usuarios (fallback vs `AUTH_USERS`) |
| `backend/data/alertPrefs.json` | Preferencias de alertas |
| `backend/data/adminExpenseProration.json` | Prorrateo gastos |
| `backend/data/gerentes-financiamiento.json` (+ `.xlsx`) | Catálogo gerentes F&I |
| `backend/data/financiamiento-notes.json` | Notas de facturas F&I |
| `backend/data/ai-exports/` | Excel generados por el asistente |

---

## 8. Variables de entorno críticas

### Backend (`backend/.env.example`)

```env
DB_HOST=
DB_PORT=1433
DB_NAME=
DB_USER=
DB_PASSWORD=

HOST=0.0.0.0
PORT=3000
FRONTEND_URL=http://localhost:5173

AUTH_ENABLED=true
AUTH_SECRET=
AUTH_USERS=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

CRM_SHEETS_SYNC_ENABLED=true
CRM_SHEETS_SYNC_HOURS=5

CLOUD_SYNC_ENABLED=false
CLOUD_SYNC_URL=
CLOUD_SYNC_API_KEY=
```

### Cloud (`cloud-api/.env.example`)

```env
DATABASE_URL=postgresql://...
CLOUD_SYNC_API_KEY=
MOBILE_AUTH_SECRET=
OPENAI_API_KEY=
```

### Frontend (`frontend/.env.example`)

```env
FRONTEND_PORT=5173
BACKEND_URL=http://localhost:3000
```

---

## 9. Servicios que consultan base de datos

### SQL Server (`backend/src/db.js`)

| Servicio | Dominio |
|----------|---------|
| `ventas.js`, `ytd-comparativo.js`, `sofia-entregas.js` | Ventas / SOFIA |
| `overviewService.js`, `salesExecutiveAnalytics.js` | Resumen |
| `forecastService.js` | Pronóstico (+ CSV fallback) |
| `inventoryService.js`, `inventoryPostventaService.js` | Inventario |
| `postSalesLoad.js`, `postSalesService.js` | Postventa |
| `ventasPorAuto.js`, `ventasNuevosFinanciero.js`, `utilidadCarlineService.js` | Utilidad / autos |
| `refaccionesPedidosService.js` | Pedidos / refacciones |
| `accounting*`, `eeff*`, `balanceGeneralService.js`, `contabilidadService.js` | Contabilidad |
| `crmCiclosService.js` | **Híbrido** SQLite + SQL Server |
| `aiTools.js` | SQL ad-hoc + `INFORMATION_SCHEMA` |
| `alertsService.js`, `facturaMovimientosService.js` | Alertas / factura |

### Solo SQLite

| Servicio | Tablas |
|----------|--------|
| `financiamientoService.js` | `crm_financiamiento`, `crm_solicitudes` |

### Acceso IA por perfil

| Archivo | Rol |
|---------|-----|
| `aiRoleAccess.js` | Filtra herramientas del chat según páginas del rol |
| `aiAgent.js` | System prompt + tools filtradas por sesión |

---

## 10. Dialectismos T-SQL a reescribir

Al pasar a PostgreSQL / MySQL / otro, auditar y reemplazar:

| T-SQL | Alternativa típica (PostgreSQL) |
|-------|----------------------------------|
| `CONVERT(DATE, col, 103)` | `TO_DATE(col, 'DD/MM/YYYY')` |
| `CONVERT(datetime, @p, 112)` | cast / `TO_DATE(..., 'YYYYMMDD')` |
| `ISNULL(a, b)` | `COALESCE(a, b)` |
| `GETDATE()` | `NOW()` / `CURRENT_TIMESTAMP` |
| `DATEADD` / `DATEDIFF` | aritmética de fechas / `AGE` |
| `ISNUMERIC(x)` | regex / `~` |
| `LTRIM/RTRIM` | `TRIM` |
| `a + b` (strings) | `a \|\| b` |
| `SELECT TOP n` | `LIMIT n` |
| `@param` + `request.input` | `$1`, `$2` (pg) |
| `result.recordset` | `result.rows` |

Archivos con uso intensivo de `CONVERT(..., 103)`:  
`ventas.js`, `ventasNuevosFinanciero.js`, `refaccionesPedidosService.js`, `sofia-entregas.js`, `crmCiclosService.js`, `salesExecutiveAnalytics.js`, `alertsService.js`.

---

## 11. Plan de migración (checklist)

### Fase A — Definir alcance

- [ ] Confirmar escenario A/B/C/D/E (§1)
- [ ] Elegir motor destino (PostgreSQL recomendado si se unifica con cloud-api)
- [ ] Decidir si SQLite CRM se migra o se mantiene

### Fase B — Inventario y extracción

- [ ] Dump DDL de tablas §3.2 desde GMOFARRIL real (`INFORMATION_SCHEMA`)
- [ ] Sample de filas y tipado real de fechas (varchar vs datetime)
- [ ] Snapshot de `crm-ciclos.db` + lista de ETLs
- [ ] Inventario de XLSX/JSON que deben seguir en filesystem o cargarse a BD

### Fase C — Capa de acceso

- [ ] Reescribir `backend/src/db.js` (driver, pool, placeholders)
- [ ] Adaptar ~24 servicios + `aiTools.js`
- [ ] Sustituir dialectismos (§10)
- [ ] Revisar tablas dinámicas `CON_CTAS01{AAAA}`
- [ ] Actualizar tests / scripts `backend/scripts/test-*.js`

### Fase D — Datos auxiliares

- [ ] Google Sheets: mismo export; cambiar solo destino final del ETL
- [ ] cloud-api: mantener PostgreSQL o apuntar collectors al nuevo esquema
- [ ] Auth: sigue en `AUTH_USERS` / `users.json` (no está en SQL Server)

### Fase E — Paridad funcional

- [ ] Ventas YTD + comparativo anual
- [ ] Entregas SOFIA + penetración GMF / OnStar
- [ ] Inventario (SEP, antigüedad carline)
- [ ] Postventa mes curso + nomenclatura HyP/Servicio
- [ ] EEFF / presupuesto / balance
- [ ] Forecast 12 meses
- [ ] Seguimiento 360 (SQLite + joins VIN)
- [ ] Financiamiento F&I (CRM)
- [ ] Asistente IA (tools + SQL exploratorio)
- [ ] Cloud sync + login móvil

### Fase F — Cutover

- [ ] Dual-run (lectura sombra) si es posible
- [ ] Actualizar `.env.example`, README y esta guía
- [ ] Plan de rollback a GMOFARRIL
- [ ] Ventana de mantenimiento y verificación de métricas clave

---

## 12. Estrategias recomendadas

### Opción 1 — PostgreSQL unificado (recomendada a medio plazo)

1. Migrar tablas operativas GMOFARRIL → PostgreSQL (mismo cloud o instancia dedicada).
2. Reescribir `backend/src/db.js` con `pg`.
3. Opcional: migrar CRM SQLite a schemas `crm_*` en el mismo Postgres.
4. cloud-api puede seguir con sync JSONB o leer vistas materializadas.

**Pros:** un solo motor, mejor despliegue cloud.  
**Contras:** reescritura grande de SQL; fechas string requieren ETL de limpieza.

### Opción 2 — Lift & shift a otro SQL Server

1. Restaurar backup / replicación a nuevo host.
2. Solo cambiar `DB_*` en `backend/.env`.
3. Validar collations, firewall y timeouts.

**Pros:** mínimo cambio de código.  
**Contras:** no reduce deuda técnica ni unifica con cloud-api.

### Opción 3 — Capa analítica + DMS intacto

1. Mantener GMOFARRIL como origen.
2. Poblar `kpi.*` o un warehouse (ETL nocturno).
3. Ir moviendo módulos del dashboard a leer el warehouse.

**Pros:** bajo riesgo operativo.  
**Contras:** doble mantenimiento hasta el cutover total.

---

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Fechas como `varchar` + style 103 | Queries rotas en PG/MySQL | Normalizar a `date`/`timestamptz` en ETL |
| SQL Server 2008 R2 | Funciones modernas no disponibles hoy | No asumir features 2012+ en el origen |
| `better-sqlite3` nativo | Fallos de build en CI/Windows | Migrar CRM a SQL destino o usar `sql.js` |
| `aiTools.js` SQL libre | Consultas inválidas post-migración | Catálogo de vistas seguras + denylist |
| Tablas anuales contables | Naming dinámico | Generador de nombres + smoke test por año |
| Cloud JSONB ≠ operacional | Móvil puede divergir | Sync frecuente + pruebas de paridad |
| Auth fuera de BD | Olvidar usuarios en cutover | Documentar `AUTH_USERS` / sync domain `auth` |

---

## 14. Pruebas mínimas post-migración

| Módulo | Endpoint / pantalla | Criterio |
|--------|---------------------|----------|
| Health | `GET /api/health` | `ok: true` |
| Ventas | `/sales.html` mes actual | Totales retail/flotilla/SOFIA coherentes |
| YTD | Comparativo anual | Serie meses = conteos DMS |
| Inventario | `/inventory.html` | SEP + antigüedad carline |
| Postventa | `/post-sales.html` | Abiertas HyP vs Servicio |
| Contabilidad | `/contabilidad.html?tab=eeff` | EEFF vs PPTO |
| CRM 360 | `/seguimiento.html` | Ficha por ID CRM / VIN |
| F&I | Ventas → Financiamiento | Contratos + OnStar mes |
| IA | Chat | Solo tools del rol; sin SQL si perfil restringido |
| Móvil | cloud-api `/api/mobile/*` | Login + métricas sync |

---

## 15. Referencias rápidas

| Recurso | Path |
|---------|------|
| Pool SQL Server | `backend/src/db.js` |
| Pool PostgreSQL | `cloud-api/src/db.js` |
| Env backend | `backend/.env.example` |
| Env cloud | `cloud-api/.env.example` |
| Modelo tablas IA | `backend/src/config/aiDataModel.js` |
| Docs generales | `DOCUMENTACION.md`, `README.md` |
| Schema KPI | `backend/database/01_schema.sql` |
| Schema cloud | `cloud-api/database/01_schema.sql` |
| Sync Sheets | `backend/scripts/sync-crm-sheets.js` |
| ETLs CRM | `backend/scripts/etl-crm-*.js` |
| Acceso IA por rol | `backend/src/services/aiRoleAccess.js` |

---

## 16. Contacto / siguientes pasos sugeridos

1. Elegir destino (PostgreSQL vs otro SQL Server).
2. Exportar DDL real de GMOFARRIL y validar tipado de fechas.
3. Prototipar `db.js` + un módulo piloto (p. ej. ventas YTD).
4. Ampliar módulo a módulo con checklist de paridad (§11.E).

Si se define el motor destino concreto, este documento se puede ampliar con:

- Mapeo columna-a-columna DDL origen → destino  
- Scripts de ETL de carga inicial  
- Diferencias exactas de `mssql` → `pg` (o el driver elegido)
