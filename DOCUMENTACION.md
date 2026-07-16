# Documentación de avance — KPIs BALDERRAMA

**Fecha de corte:** 13 jul 2026  
**Stack:** monorepo Node.js — backend Express (:3000) + frontend estático (:5173)  
**BD operativa:** SQL Server `GMOFARRIL`

Este documento resume **lo implementado hasta ahora**. Para instalación y arranque ver [README.md](./README.md).

---

## 1. Arquitectura actual

```
Prueba Dashbord/
├── backend/                 # API REST
│   ├── server.js            # :3000
│   ├── src/routes/          # api.js, auth.js
│   ├── src/services/        # lógica de negocio
│   ├── src/config/          # EEFF, presupuesto, prorrateo, catálogos
│   ├── src/auth/            # roles, sesión, usuarios
│   ├── data/                # xlsx, csv, objetivos
│   └── scripts/             # exploración / validación
└── frontend/
    ├── server.js            # :5173 + proxy /api → backend
    └── public/              # HTML, JS, CSS, img
```

| Acción | Comando |
|--------|---------|
| Instalar | `npm run install:all` |
| Arrancar ambos | `npm start` |
| Solo API / UI | `npm run start:backend` · `npm run start:frontend` |

Config: `backend/.env` (desde `backend/.env.example`).

---

## 2. Módulos UI

| Ruta | Estado | Capacidad principal |
|------|--------|---------------------|
| `/login.html` | Listo | Login por cookie |
| `/` (overview) | Listo | Resumen ejecutivo + analytics |
| `/sales.html` | Listo | Ventas retail / SOFIA / canales / objetivos |
| `/forecast.html` | Listo | Pronóstico unidades; gráfico acotado a **12 meses** de histórico |
| `/inventory.html` | Listo | **Autos nuevos** + **Postventa** (tabs) |
| `/contabilidad.html` | Listo | Tabs Catálogo + **EEFF** (`?tab=eeff`) |
| `/eeff.html` | Redirect | → `/contabilidad.html?tab=eeff` |
| `/post-sales.html` | Listo | Órdenes, abiertas, acumulado mes curso N/D/Q/C/X/Y |
| `/assistant.html` | Listo | Chat IA (+ burbuja en otras páginas) |
| `/admin.html` | Listo | CRUD usuarios (rol administración) |

Navegación: `frontend/public/js/sidebar.js` (filtrada por rol).

---

## 3. API principal (`/api`)

Auth en `/api/auth/*`. Rutas de negocio en `backend/src/routes/api.js` (requieren sesión si `AUTH_ENABLED=true`).

| Endpoint | Uso |
|----------|-----|
| `GET /health` | Salud |
| `GET /overview` · `/overview/analytics` | Resumen + analytics ventas |
| `GET /ventas` · objetivos | Ventas y metas |
| `GET /inventory` | Autos nuevos / plan piso |
| `GET /inventory/postventa` | Servicio / refacciones / HYP |
| `GET /post-sales` | Postventa (incluye `mesCursoNomenclatura`) |
| `GET /contabilidad` | Orquestador contable |
| `GET /eeff` | EEFF + comparativa presupuesto 2026 |
| `GET /forecast?horizon=` | Pronóstico (3–12 meses) |
| `GET /crm/status` | Estado base interna CRM (Balderrama Ciclos) |
| `GET /crm/contactos?q=` | Buscar cliente por ID CRM, nombre o VIN |
| `GET /crm/contactos/:id/historico` | Histórico completo del cliente (ciclos, compras, actividades) |
| `GET/POST /ai/*` | Asistente |

---

## 4. Avances recientes (detalle)

### 4.1 Contabilidad / EEFF

- EEFF por ventas, postventa, seminuevos; drill-down en UI (`eeff.js`).
- Comparativa **real vs PPTO** solo en **2026** (`budget2026Service` + `backend/data/presupuesto-2026.xlsx`).
- Nomenclatura de cuentas desde `backend/data/nomenclatura-eeff.xlsx`.
- Saldos con criterio acumulado (`CTA_ACUMDET = 'ACUM'` donde aplica).
- **Prorrateo administración** (`prorationMatrix.js`):
  - Años ≠ 2026 → matriz histórica.
  - **2026** → Piso 38.56%, Foráneos 19.70%, Intercambios 9.34%, Seminuevos 8%, Cholula 7.06%, Zacatelco 7.46%, Casa 6.03%, Flotillas 3.85%.
- Casa incluida en menudeo en `eeffSummaryConfig.js`.
- KPIs EEFF expandibles; desglose cerrado por defecto.

### 4.2 Inventario

**Autos nuevos** (`inventoryService.js`):

- Situaciones: FIS, DIS, PED, PEN, **SEP**, DEMO, TRAN.
- **SEP = Apartada**: días desde `VEH_FECHSEP`, quién apartó vía `VEH_PERAPAR` → `PER_PERSONAS` (fallback `VEH_CVEUSU`).
- KPI **Disponibles** = FIS + DIS + SEP, con subtítulo libres vs apartadas.
- Desglose KPI clicable; filas apartadas resaltadas; columnas días aparte / apartó.
- Plan piso + unidades envejecidas.
- Join a personas compatible con **SQL Server 2008** (sin `TRY_CONVERT`).

**Postventa** (`inventoryPostventaService.js`):

- Tab Servicio (`ALM_PROCESO > 0`), Refacciones, HYP (grupo 32 / ALM8).

### 4.3 Postventa operativa

- Tabla **Acumulado mes en curso** por nomenclatura N/D/Q/C/X/Y (excluye canceladas).
- Backend: `loadMesCursoNomenclatura()` en `postSalesLoad.js`.

### 4.4 Pronóstico

- Modelo sobre ventas mensuales SQL (`ADE_VTAFI` + `SER_VEHICULO`); fallback CSV.
- Gráfico **Histórico vs pronóstico**: solo **últimos 12 meses** de real + horizonte (el entrenamiento sigue usando todo el historial).

### 4.5 Base interna CRM — histórico de clientes

- Fuente: export del CRM `Balderrama Ciclos.csv` (~1,048,575 actividades · 78,061 contactos · 96,861 ciclos · 2018–2022+ con actividades hasta 2026).
- Clave de rastreo: **`ID_CONTACTO` = ID CRM**.
- Carga: `node backend/scripts/etl-crm-ciclos.js "<ruta CSV>"` → SQLite `backend/data/crm-ciclos.db` (no versionada).
- Servicio: `backend/src/services/crmCiclosService.js` — búsqueda (ID/nombre/VIN/teléfono/correo) e histórico.
- **Compra en ciclo de venta** = VIN asignado en columna T del CRM (`crm_actividades.vin`). Ese VIN se cruza con SQL como número de serie:
  - `SER_VEHICULO.VEH_NUMSERIE` ≡ `ADE_VTAFI.VTE_SERIE` → factura `VTE_DOCTO`
  - `SER_ORDEN.ORE_NUMSERIE` → historial de órdenes de servicio
  - El CRM a veces trae VIN corto; el match acepta serie completa o sufijo.
- Asistente IA: herramientas `buscar_cliente_crm`, `historico_cliente_crm` (con enriquecimiento SQL por VIN) y `resumen_leads`.
- UI: pantalla **Seguimiento 360** (`/seguimiento.html`, página `seguimiento` — roles administración, dirección y gerencia comercial): buscador de clientes y vista 360 (leads, ciclos, compras por VIN con factura SQL, órdenes de servicio y línea de tiempo). Acepta `?id=<ID CRM>` o `?q=<búsqueda>`.
- Seguimiento 360 permite filtrar las órdenes por fecha de ingreso (`SER_ORDEN.ORE_FECHAORD`). El importe generado en taller usa la misma regla de Postventa: `SER_FACORDEN.fos_total`; si no existe, detalle (`SER_ORDENDET`: subtotal + IVA); como último respaldo, `SER_ORDTOTCXP.TCX_TOTAL`. Las órdenes canceladas no se incluyen en el importe total.

#### Leads (interesados)

- Fuente: Google Sheet "Acumulado" (30,148 leads 2025 · Chevrolet/otras sucursales · canales FBABP, GMMX, etc.).
- Clave de relación: **columna G "ID CRM"** = `id_crm` = `ID_CONTACTO` de ciclos (27,564 leads con ID; 1,207 clientes cruzan con actividades de ciclos).
- Carga: descargar el sheet como xlsx a `backend/data/leads-source.xlsx` y ejecutar `node backend/scripts/etl-crm-leads.js` → tabla `crm_leads` en la misma `crm-ciclos.db`.
- **Sync automático:** el backend programa `sync-crm-sheets.js` cada **5 horas** (configurable con `CRM_SHEETS_SYNC_HOURS`). Descarga el Google Sheet y recarga leads, solicitudes F&I y pruebas de manejo. Estado: `GET /api/crm/sheets-sync/status`; forzar: `POST /api/crm/sheets-sync/run`. Desactivar: `CRM_SHEETS_SYNC_ENABLED=false`.
- API: `GET /api/crm/leads/resumen?desde&hasta&agruparPor` (canal, sucursal, tipo, campaña, resultado, fuerza_ventas, ejecutivo, estatus_compra, auto_interes, mes); los leads también aparecen en `/crm/contactos` y en el histórico por contacto.

#### Solicitudes de crédito (F&I)

- Fuente: Google Sheet, hoja **"Solicitudes"** (9,512 solicitudes 2026 · GMF y otras financieras · estatus APROBADA/APROBADA FACT/etc.).
- Clave de relación: **columna H "Contacto CRM"** = `id_crm` = `ID_CONTACTO` de ciclos (6,477 con ID; 668 IDs cruzan con ciclos y 767 con leads).
- Carga: mismo xlsx `backend/data/leads-source.xlsx` y ejecutar `node backend/scripts/etl-crm-solicitudes.js` → tabla `crm_solicitudes` en la misma `crm-ciclos.db`.
- Campos clave: no. solicitud, financiera, fecha solicitud, estatus, respuesta de la financiera, unidad y paquete, fecha de aprobación/firma/compra, F&I, enganche.
- Las solicitudes aparecen en `/crm/contactos` (conteo por cliente), en el histórico por contacto (`solicitudes[]` + `resumen.totalSolicitudes`) y en la pantalla Seguimiento 360 (tabla "Solicitudes de crédito (F&I)" y badge "Solicitud F&I").

### 4.6 Auth / roles

| Rol | Acceso UI (resumen) |
|-----|---------------------|
| `administracion` | Todo + admin usuarios |
| `direccion` | Overview, ventas, forecast, inventario, contabilidad, post-sales |
| `gerencia_comercial` | Ventas, forecast |
| `contabilidad` | Contabilidad / EEFF |

---

## 5. Archivos de datos / config

| Recurso | Ruta |
|---------|------|
| Presupuesto 2026 | `backend/data/presupuesto-2026.xlsx` |
| Nomenclatura EEFF | `backend/data/nomenclatura-eeff.xlsx` |
| Forecast fallback | `backend/data/forecast-source.csv` |
| Objetivos históricos | `backend/data/sales-goals-historic.json` |
| Prorrateo | `backend/src/config/prorationMatrix.js` |
| EEFF sucursales/secciones | `backend/src/config/eeffSummaryConfig.js` |
| Presupuesto keys | `backend/src/config/budget2026Config.js` |

---

## 6. Mapa módulo → código

| Módulo | Backend | Frontend |
|--------|---------|----------|
| Overview | `overviewService.js`, `salesExecutiveAnalytics.js` | `index.html`, `overview.js` |
| Ventas | `ventas.js`, `salesGoals.js`, `canales-venta.js`, `ytd-comparativo.js` | `sales.html`, `sales.js` |
| Forecast | `forecastService.js`, `forecastModel.js` | `forecast.html`, `forecast.js` |
| Inventario | `inventoryService.js`, `inventoryPostventaService.js` | `inventory.html`, `inventory.js` |
| Contabilidad | `contabilidadService.js`, ETL, catalog KPIs | `contabilidad.html`, `contabilidad.js` |
| EEFF + PPTO | `eeffSummaryService.js`, `eeffComparativaService.js`, `budget2026Service.js`, nomenclatura | `eeff.js` |
| Postventa | `postSalesService.js`, `postSalesLoad.js` | `post-sales.html`, `post-sales.js` |
| IA | `aiAgent.js`, `aiTools.js`, `aiVisualizations.js` | `assistant.html`, `assistant-bubble.js` |
| Auth | `src/auth/*`, `routes/auth.js` | `login.js`, `admin.js`, `auth-client.js` |

---

## 7. Notas operativas

- Tras cambios de backend: reiniciar `npm start` (no hay nodemon).
- Tras cambios de frontend: Ctrl+F5 (cache busting con `?v=` en CSS/JS).
- Comparativa presupuesto **solo 2026**.
- SQL Server destino es 2008R2 en ambiente actual: evitar funciones ≥ 2012 (`TRY_CONVERT`, etc.).
- No versionar `.env` ni `node_modules/`.

---

## 8. Pendientes / fuera de este corte

El plan de fases (consolidación, validación, go-live y expansión) está en **[PLAN_PROYECTO.md](./PLAN_PROYECTO.md)**.
