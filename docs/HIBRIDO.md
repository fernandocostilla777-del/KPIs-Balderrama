# Modo híbrido — oficina + nube

La app debe funcionar **en la red de la agencia** y **fuera de ella**, sin perder
los datos del CRM ni las consultas al DMS.

## Orden de lectura

### SQL Server (GMOFARRIL)
1. **Local** `192.168.0.2` (LAN Business Pro)
2. Si no responde → **Remota** `189.197.60.78`
3. Si ninguno responde → **réplica** en Railway (`desktop-cache` + `CLOUD_READ_API_KEY`)

El selector del menú (admin) fuerza Local / Remota. Al fallar una consulta de
conexión, el backend también hace failover automático al otro host.

### CRM (antes solo SQLite)
1. **SQLite local** `backend/data/crm-ciclos.db` (Sheets + Excel + `crm_ciclos_live`)
2. Si no hay archivo / está vacío → **pull desde Railway** `GET /api/crm`
   hacia la tabla local `crm_ciclos_live`
3. Opcional: `PG_READONLY_URL` (Postgres de solo lectura) con el script
   `sync-crm-ciclos-live.js`

## Orden de escritura / publicación

| Origen | Destino | Cómo |
|--------|---------|------|
| Oficina con SQLite + SQL | Railway | `CLOUD_SYNC_ENABLED=true` → `/api/sync/ingest` + CRM |
| Export ciclos / API | Railway `crm_ciclos` | `POST /api/crm/ingest` |
| Railway | Escritorio | `POST /api/crm/pull-cloud` o sync diario 06:00 |

En el **PC de oficina** conviene:

```env
CLOUD_SYNC_ENABLED=true
CLOUD_SYNC_URL=https://kpis-balderrama-production.up.railway.app
CLOUD_SYNC_API_KEY=<llave de sync>
CLOUD_READ_API_KEY=<llave de lectura>
```

En el **escritorio / híbrido**:

```env
DATA_SOURCE=auto
CLOUD_SYNC_URL=https://kpis-balderrama-production.up.railway.app
CLOUD_SYNC_API_KEY=<misma llave sync, para leer /api/crm y publicar si aplica>
CLOUD_READ_API_KEY=<llave lectura réplica desktop-cache>
CRM_CLOUD_PULL_ON_START=true
```

## APIs útiles

- `GET /api/data-source` — modo sql/cloud + estado híbrido CRM
- `GET /api/conexion` — Local / Remota / Nube
- `GET /api/crm/status` — disponibilidad SQLite + hybrid
- `POST /api/crm/pull-cloud` — (admin) baja ciclos desde Railway ya

## Tablas Sheets en la nube

Tras `node backend/scripts/sync-crm-sheets.js` (o ETL locales) y
`node backend/scripts/push-crm-sheets-cloud.js --replace`:

| Tabla local | Cloud |
|-------------|-------|
| `crm_leads` | `crm_sheet_rows` + `GET/POST /api/crm/sheets/*` |
| `crm_trafico_piso` | igual |
| `crm_solicitudes`, `crm_pruebas_manejo`, `crm_financiamiento`, `crm_pagos_gmf`, CSI | igual |
| `crm_ciclos_live` / ciclos | `crm_ciclos` vía `GET /api/crm` |

El pull híbrido (`POST /api/crm/pull-cloud` o sync 06:00) baja ciclos y, si el
endpoint está desplegado, también las tablas Sheets.

## Límites actuales

- La réplica `desktop-cache` no publica vistas filtradas por sucursal; Cholula
  siempre consulta SQL local con alcance cuando hay red.
- Hasta desplegar la cloud-api con `/api/crm/sheets/*`, el push usa
  `sync_entities` (dominio `crm`, periodKey `sheets-<tabla>`) como respaldo.
