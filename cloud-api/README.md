# BALDERRAMA Cloud API

**Versión intermedia en la nube** — no es el dashboard completo. Solo recibe por API los datos que envía el servidor local y los persiste en **PostgreSQL** (estado actual + histórico de cambios).

No consulta SQL Server GMOFARRIL ni sirve la interfaz web del dashboard.

## Arquitectura

```
[OFICINA — fuente operativa]              [RAILWAY — réplica intermedia]
────────────────────────────              ────────────────────────────────
SQL Server GMOFARRIL                      PostgreSQL
SQLite CRM (leads)                              │
Backend + Frontend (dashboard)                  │
        │                                       │
        │  cloudSync (scheduler local)          │
        │  POST /api/sync/ingest                ▼
        └──────────────────────────────►  cloud-api
                                          ├── sync_entities      (último estado)
                                          ├── sync_entity_history (cambios)
                                          └── sync_batches       (bitácora)
```

**Qué guarda la nube:** únicamente los lotes enviados por el backend local (ventas, inventario, contabilidad, postventa, CRM/leads del mes en curso, según el scheduler).

**Qué NO va a Railway:** `backend/`, `frontend/`, ni conexión directa a GMOFARRIL.

### Frecuencias de envío (desde el backend local)

| Dominio | Frecuencia | Contenido |
|---------|------------|-----------|
| Ventas, inventario, contabilidad, CRM | Cada 30 min | Mes en curso |
| Postventa | Inicio del día | Mes en curso |
| Todos | Día 1 del mes | Cierre mensual + históricos |

## Despliegue

### Railway (importante)

**No despliegues la raíz del repositorio (`/`).** El `package.json` raíz arranca backend + frontend para uso local y fallará en Railway (`Cannot find module 'dotenv'`).

En el servicio web de Railway configura:

| Campo | Valor |
|-------|--------|
| **Root Directory** | `cloud-api` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

Variables mínimas:

| Variable | Valor |
|----------|--------|
| `DATABASE_URL` | Referencia al PostgreSQL de Railway |
| `CLOUD_SYNC_API_KEY` | Clave segura (igual que en backend local) |
| `CLOUD_AUTO_INIT_DB` | `true` la primera vez |
| `MOBILE_AUTH_USERS` | Usuarios móviles (`usuario:contraseña:rol`) |
| `MOBILE_AUTH_SECRET` | Secreto aleatorio de al menos 32 caracteres |

El backend y frontend **no van en Railway** (requieren SQL Server GMOFARRIL en la red local).

**Guía paso a paso:** [DEPLOY_RAILWAY.md](./DEPLOY_RAILWAY.md)

---

### Pasos generales

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
| POST | `/api/auth/login` | Inicio de sesión móvil |
| GET | `/api/auth/me` | Perfil móvil (Bearer token) |
| GET | `/api/mobile/overview` | Resumen del periodo (Bearer token) |
| GET | `/api/mobile/ventas` | Métricas de ventas (Bearer token) |
| GET | `/api/mobile/inventory` | Inventario sincronizado (Bearer token) |

Los endpoints `/api/sync/*` usan `X-API-Key`. Los endpoints `/api/mobile/*` usan el token devuelto por `/api/auth/login`; la clave de sincronización nunca debe incluirse en la app.

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
