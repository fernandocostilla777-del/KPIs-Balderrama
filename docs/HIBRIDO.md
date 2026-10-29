# Modo híbrido — oficina + nube

La app debe funcionar **en la red de la agencia** y **fuera de ella**, sin perder
los datos del CRM ni las consultas al DMS.

## Orden de lectura

### SQL Server (GMOFARRIL) — vistas DMS
Ventas, inventario, postventa, overview, forecast, etc. **siempre** consultan
SQL Server por una de estas IPs (nunca la réplica mientras haya SQL):

1. **Local** `192.168.0.2` (LAN Business Pro)
2. Si no responde → **Remota** `189.197.60.78`
3. Solo si **ninguna** responde y `DATA_SOURCE=auto` → réplica Railway

El selector del menú (admin) fija Local / Remota y deja el backend en modo SQL.
Hay failover automático entre las dos IPs si cae la conexión activa.

### CRM
| Entorno | Fuente |
|---------|--------|
| **Oficina** | SQLite `backend/data/crm-ciclos.db` (ETL Sheets) → publica a Railway |
| **Electron** | **Solo nube** — no usa el `.db` de oficina. Al arrancar baja ciclos + Sheets a `userData/crm-cloud-cache.db` |

Escritorio fuerza: `DESKTOP_CRM_CLOUD=1`, `CRM_SOURCE=cloud`, `CRM_SHEETS_SYNC_ENABLED=false`.

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

## Usuarios (login en la nube)

Los usuarios de `backend/data/users.json` se publican a Railway:

```bash
node backend/scripts/push-auth-users-cloud.js --replace
```

| Destino | Uso |
|---------|-----|
| Tabla `auth_users` | Login preferido `POST /api/auth/login` |
| `sync_entities` (domain=auth) | Respaldo / sync oficina |

El escritorio intenta login local y, si falla, Railway (`AUTH_CLOUD_FALLBACK=true`).

## APIs útiles

- `GET /api/data-source` — modo sql/cloud + estado híbrido CRM
- `GET /api/conexion` — Local / Remota / Nube
- `GET /api/crm/status` — disponibilidad SQLite + hybrid
- `POST /api/crm/pull-cloud` — (admin) baja ciclos desde Railway ya
- `GET /api/auth/users/summary` — (cloud) conteo `auth_users`
- `POST /api/auth/users/ingest` — (cloud) carga hashes de usuarios

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
