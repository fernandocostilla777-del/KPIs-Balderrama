# BALDERRAMA Cloud API

API en la nube con **PostgreSQL** para recibir datos del dashboard local, detectar cambios y conservar históricos.

## Arquitectura

```
Dashboard local (SQL Server GMOFARRIL)
        │
        │  cada 30 min → ventas, inventario, contabilidad, CRM/leads (mes en curso)
        │  inicio del día → postventa
        │  día 1 del mes → cierre mensual + históricos
        ▼
  cloudSync (backend local)
        │  POST /api/sync/ingest
        ▼
  cloud-api (PostgreSQL)
        ├── sync_entities        (estado actual)
        ├── sync_entity_history  (versiones anteriores)
        └── sync_batches         (bitácora de sincronización)
```

## Despliegue

1. Crear base PostgreSQL en la nube (Neon, Supabase, Railway, Render, etc.).
2. Copiar `.env.example` → `.env` y configurar `DATABASE_URL` y `CLOUD_SYNC_API_KEY`.
3. Instalar e inicializar:

```bash
cd cloud-api
npm install
npm run init-db
npm start
```

4. En el backend local (`backend/.env`):

```env
CLOUD_SYNC_ENABLED=true
CLOUD_SYNC_URL=https://tu-api.ejemplo.com
CLOUD_SYNC_API_KEY=la-misma-clave-del-cloud
```

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/sync/status` | Última sync por dominio (requiere `X-API-Key`) |
| POST | `/api/sync/ingest` | Recibe lote de registros |
| GET | `/api/sync/history/:domain` | Histórico de cambios |

Header obligatorio: `X-API-Key: <CLOUD_SYNC_API_KEY>`

## Payload de ingestión

```json
{
  "domain": "ventas",
  "syncType": "incremental",
  "periodKey": "2026-07",
  "periodStart": "2026-07-01",
  "periodEnd": "2026-07-31",
  "sourceHost": "local-dashboard",
  "records": [
    { "id": "12345|VIN123456", "data": { "vteDocto": 12345, "serie": "VIN123456" } }
  ]
}
```

`syncType`:
- `incremental` — cada 30 min (mes en curso): ventas, inventario, contabilidad, CRM
- `daily` — postventa al inicio del día
- `monthly` — cierre mensual; archiva registros eliminados

### Dominio CRM (`crm`)

Incluye del SQLite local (`crm-ciclos.db`):
- **leads** — Google Sheet Acumulado (`fecha_entrada` en el mes)
- **solicitudes** — solicitudes F&I
- **pruebas** — pruebas de manejo
- **actividades** — ciclos Balderrama Ciclos

Cada registro usa `id` con formato `lead|123`, `solicitud|45`, `prueba|67`, `actividad|890`.

## Detección de cambios

Cada registro se identifica por `domain + external_id + period_key`. Se calcula un hash SHA-256 del JSON; si cambia respecto al valor almacenado, la versión anterior pasa a `sync_entity_history`.
