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
| GET | `/api/personal` | Lista personal DMS activo (`categoria`, `subtipo`, `q`, `limit`) |
| GET | `/api/personal/summary` | Conteos por categoría / subtipo |
| GET | `/api/personal/:categoria` | Filtra por `VENDEDOR`, `PERSONAL_DMS` o `ASESOR_SERVICIO` |
| POST | `/api/crm/ingest` | Ingest de ciclos/actividades CRM (histórico acumulativo) |
| GET | `/api/crm` | Lista actividades (`idContacto`, `limit`, `offset`) |
| GET | `/api/crm/contactos/:idContacto/historico` | Persona → ciclos → actividades |

Los endpoints `/api/sync/*` usan `X-API-Key`. Los endpoints `/api/mobile/*` usan el token devuelto por `/api/auth/login`; la clave de sincronización nunca debe incluirse en la app.

### Asistente IA móvil

Requiere `OPENAI_API_KEY` (y opcionalmente `OPENAI_MODEL`) en Railway.

| Método | Path | Descripción |
|--------|------|-------------|
| `GET` | `/api/mobile/ai/status` | Si el asistente está configurado + tools del rol |
| `POST` | `/api/mobile/ai/chat` | Chat ultra-resumido; tools filtradas por rol |

Las tools leen datos ya sincronizados (`mobileData`), no SQL Server en vivo. El rol del usuario (`MOBILE_AUTH_USERS`) limita módulos y herramientas igual que en el dashboard web.

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

### Dominio personal (`personal`)

Tabla dedicada en PostgreSQL: **`dms_personal`** (solo activos).

| categoria | Origen SQL Server |
|-----------|-------------------|
| `VENDEDOR` | `PER_ROLES` (`VENU`/`VESE`/`VETA`/`VECA`) + `PER_PERSONAS` |
| `PERSONAL_DMS` | Otros roles activos (no cliente) |
| `ASESOR_SERVICIO` | `PNC_PARAMETR` tipo `AS` con `PAR_STATUS='A'` |

Se sincroniza con el scheduler local (`domain: personal`) y se consulta con:

```bash
curl -H "X-API-Key: $CLOUD_SYNC_API_KEY" \
  "https://tu-api.up.railway.app/api/personal?categoria=VENDEDOR"
```

### Ciclos CRM (`crm_ciclos`)

Tabla dedicada con el export de Balderrama Ciclos (un renglón = actividad). Se crea sola al arrancar cloud-api.

Campos: `ID_CONTACTO` (también `D_CONTACTO`), `NOMBRE_CONTACTO`, `ID_CICLO`, fechas de ciclo/actividad, `ESTATUS`, `TIPO_ACTIVIDAD`, resultado, medio de contacto, factura, VIN, vendedor.

Carga remota desde el servidor de oficina (`X-API-Key`):

```bash
curl -X POST https://kpis-balderrama-production.up.railway.app/api/crm/ingest \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $CLOUD_SYNC_API_KEY" \
  -d '{"replaceAll":false,"records":[{"ID_CONTACTO":"123","NOMBRE_CONTACTO":"Juan Pérez","ID_CICLO":"C1","VENDEDOR":"Ana"}]}'
```

| Método | Ruta | Uso |
|--------|------|-----|
| `POST` | `/api/crm/ingest` | Upsert. `replaceAll: true` vacía la tabla y recarga |
| `GET` | `/api/crm/summary` | Totales por contacto, ciclo, VIN, estatus, vendedor |
| `GET` | `/api/crm` | Filtros: `q`, `vendedor`, `estatus`, `idContacto`, `vin`, `idCiclo`, `limit`, `offset` |
| `GET` | `/api/crm/:idContacto` | Actividades de un contacto |

Máximo 25 000 filas por llamada. También se llena si el sync local envía `domain: crm` con actividades.

## Detección de cambios

Cada registro se identifica por `domain + external_id + period_key`. Se calcula un hash SHA-256 del JSON; si cambia respecto al valor almacenado, la versión anterior pasa a `sync_entity_history`.
