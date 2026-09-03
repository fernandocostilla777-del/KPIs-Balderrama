# Despliegue en Railway — BALDERRAMA Cloud API

Guía paso a paso para montar la **versión intermedia en la nube**: solo la API de sincronización y PostgreSQL. El dashboard completo (`backend/` + `frontend/`) permanece en el servidor local de la oficina.

**Repositorio:** https://github.com/fernandocostilla777-del/KPIs-Balderrama

---

## 1. Qué se despliega y qué no

### En Railway (nube)

| Servicio | Función |
|----------|---------|
| **PostgreSQL** | Almacén de datos sincronizados |
| **cloud-api** | API que recibe datos del local (`POST /api/sync/ingest`) |

### En la oficina (local)

| Componente | Función |
|------------|---------|
| **backend/** | Consulta SQL Server GMOFARRIL, ejecuta sync hacia la nube |
| **frontend/** | Interfaz del dashboard |
| **SQLite CRM** | Leads, solicitudes, pruebas de manejo |

```
[OFICINA]                              [RAILWAY]
Backend local ──API sync──►            cloud-api ──► PostgreSQL
SQL Server GMOFARRIL                   (solo datos enviados)
```

---

## 2. Requisitos previos

- Cuenta en [Railway](https://railway.app)
- Repositorio conectado: `fernandocostilla777-del/KPIs-Balderrama`
- Rama `main` actualizada (carpeta `cloud-api/` visible en el repo)
- Backend local configurado para enviar datos (sección 8)

---

## 3. Crear proyecto en Railway

1. Entra a [railway.app](https://railway.app) → **New Project**.
2. Elige **Deploy from GitHub repo**.
3. Selecciona **KPIs-Balderrama**.
4. Railway creará un primer servicio web. Lo configurarás en el paso 5.

---

## 4. Añadir PostgreSQL

1. En el mismo proyecto → **+ New** → **Database** → **PostgreSQL**.
2. Espera a que el servicio esté **Active**.
3. No necesitas copiar la URL manualmente si usas **variable references** en el paso 6.

Railway crea automáticamente `DATABASE_URL` en el plugin PostgreSQL.

---

## 5. Configurar el servicio web (`cloud-api`)

Abre el servicio web (no el de PostgreSQL) → **Settings**.

### 5.1 Root Directory (crítico)

| Campo | Valor |
|-------|--------|
| **Root Directory** | `cloud-api` |

> **Error común:** si dejas `/` (raíz), Railway ejecutará `npm start` del monorepo, intentará levantar backend + frontend y fallará con `Cannot find module 'dotenv'`. Solo debe desplegarse `cloud-api`.

Si el desplegable no muestra `cloud-api`, **escríbelo manualmente** en el campo.

### 5.2 Build y Start

| Campo | Valor |
|-------|--------|
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

El archivo `cloud-api/railway.toml` en el repo ya define estos valores como referencia.

### 5.3 Rama

| Campo | Valor |
|-------|--------|
| **Branch** | `main` |

---

## 6. Variables de entorno

En el servicio **cloud-api** → **Variables**:

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `DATABASE_URL` | Sí | Referencia al PostgreSQL del proyecto (ver abajo) |
| `CLOUD_SYNC_API_KEY` | Sí | Clave secreta larga; misma en backend local |
| `NODE_ENV` | Recomendada | `production` (errores genéricos, SSL estricto, trust proxy) |
| `CLOUD_SYNC_ALLOWED_IPS` | Recomendada | IPs del backend local autorizadas a hacer ingest (coma-separadas) |
| `CLOUD_AUTO_INIT_DB` | Primera vez | `true` para crear tablas al arrancar |
| `HOST` | No | `0.0.0.0` (opcional, ya es el default) |
| `PORT` | No | Railway la asigna automáticamente |

### Conectar PostgreSQL

1. En Variables → **+ New Variable** → **Add Reference**.
2. Servicio: **PostgreSQL**.
3. Variable: `DATABASE_URL`.
4. Guarda.

### Generar API Key

Ejemplo (PowerShell):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

O usa un generador de contraseñas de 32+ caracteres. **Guárdala**; la necesitarás en el backend local.

### Primera vez: crear tablas

1. Añade `CLOUD_AUTO_INIT_DB=true`.
2. Haz **Deploy**.
3. Cuando el deploy sea exitoso, cambia a `CLOUD_AUTO_INIT_DB=false` (o elimínala) y vuelve a desplegar.

Alternativa manual (desde tu PC, con `DATABASE_URL` de Railway):

```bash
cd cloud-api
npm install
# Crear .env con DATABASE_URL de Railway
npm run init-db
```

---

## 6.1 Almacén IEMC financiero (F-1…F-7.1)

Si Excel/presupuesto no alcanza para metas de Ventas Nuevos, `cloud-api` guarda parámetros en PostgreSQL:

| Tabla | Uso |
|---|---|
| `iemc_financiero_periodos` | Metas por mes (venta económica, gasto controlable, F&I, UOC, carga estructural) |
| `iemc_gasto_clasificacion` | Prefijos de cuenta: `controlable` / `estructural` / `excluir` |
| `iemc_financiero_snapshots` | Resultados calculados por KPI (`F-1`…`F-7.1`) |

Las tablas se crean solas al arrancar el servicio (`ensureIemcFinancieroTables`).

```bash
# Listar periodos capturados
curl -H "X-API-Key: TU_CLAVE" https://TU-URL.up.railway.app/api/iemc-financiero/periodos

# Guardar metas de un mes
curl -X PUT -H "X-API-Key: TU_CLAVE" -H "Content-Type: application/json" \
  -d '{"objetivoVentaEconomica":85000000,"gastoOperativoControlablePpto":4200000,"pvrFiObjetivo":8500}' \
  https://TU-URL.up.railway.app/api/iemc-financiero/periodos/2026-08
```

## 7. Dominio público
 y verificación

1. Servicio **cloud-api** → **Settings** → **Networking** → **Generate Domain**.
2. Obtendrás una URL como: `https://cloud-api-production-xxxx.up.railway.app`

### Comprobar health

```bash
curl https://TU-URL.up.railway.app/api/health
```

Respuesta esperada:

```json
{ "ok": true, "service": "balderrama-cloud-api" }
```

### Comprobar autenticación (status)

```bash
curl -H "X-API-Key: TU_CLAVE" https://TU-URL.up.railway.app/api/sync/status
```

---

## 8. Configurar el backend local

En `backend/.env` de la oficina:

```env
CLOUD_SYNC_ENABLED=true
CLOUD_SYNC_URL=https://TU-URL.up.railway.app
CLOUD_SYNC_API_KEY=la-misma-clave-de-railway
CLOUD_SYNC_INTERVAL_MINUTES=30
CLOUD_SYNC_DAILY_HOUR=6
CLOUD_SYNC_ON_START=false
```

Reinicia el backend local:

```bash
npm run start:backend
```

Deberías ver en consola:

```
[cloud-sync] Programado: cada 30 min (ventas/inventario/contabilidad/crm) · postventa 6:00 · cierre mensual día 1 02:00
```

### Sync manual de prueba

Con sesión autenticada en el dashboard local:

```http
POST http://localhost:3000/api/cloud-sync/run
Content-Type: application/json

{ "type": "incremental" }
```

O desde PowerShell (con cookie de sesión si aplica):

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/cloud-sync/run" `
  -ContentType "application/json" -Body '{"type":"incremental"}'
```

Luego verifica en Railway:

```bash
curl -H "X-API-Key: TU_CLAVE" https://TU-URL.up.railway.app/api/sync/status
```

---

## 9. Datos que se sincronizan

| Dominio | Frecuencia | Alcance |
|---------|------------|---------|
| Ventas | Cada 30 min | Mes en curso |
| Inventario | Cada 30 min | Mes en curso |
| Contabilidad | Cada 30 min | Mes en curso |
| CRM / leads | Cada 30 min | Mes en curso |
| Postventa | Inicio del día (06:00) | Mes en curso |
| Todos | Día 1 del mes (02:00) | Cierre mensual + históricos |

### Tablas en PostgreSQL

| Tabla | Contenido |
|-------|-----------|
| `sync_entities` | Estado actual de cada registro |
| `sync_entity_history` | Versiones anteriores (cambios detectados) |
| `sync_batches` | Bitácora de cada sincronización |

---

## 10. Endpoints de la API cloud

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/sync/status` | `X-API-Key` | Última sync por dominio |
| POST | `/api/sync/ingest` | `X-API-Key` | Recibe lote de registros |
| GET | `/api/sync/history/:domain` | `X-API-Key` | Histórico de cambios |

Header obligatorio en rutas protegidas:

```
X-API-Key: <CLOUD_SYNC_API_KEY>
```

---

## 11. Solución de problemas

### `Cannot find module 'dotenv'` (backend y frontend en logs)

**Causa:** Root Directory está en `/` en lugar de `cloud-api`.

**Solución:** Settings → Root Directory → `cloud-api` → Redeploy.

Si ves `[backend]` y `[frontend]` en los logs, la configuración sigue incorrecta.

### `DATABASE_URL no configurada`

**Causa:** PostgreSQL no está referenciado en el servicio cloud-api.

**Solución:** Variables → Add Reference → PostgreSQL → `DATABASE_URL`.

### `API key inválida` (401)

**Causa:** `CLOUD_SYNC_API_KEY` distinta entre Railway y `backend/.env`.

**Solución:** Usa exactamente la misma clave en ambos lados.

### El deploy OK pero no llegan datos

1. Verifica `CLOUD_SYNC_ENABLED=true` en local.
2. Verifica que `CLOUD_SYNC_URL` no tenga barra final extra.
3. El backend local debe tener acceso a SQL Server y SQLite CRM.
4. Revisa logs del backend: `[cloud-sync] OK` o mensajes de error.

### Error SSL con PostgreSQL

Railway PostgreSQL usa SSL. El cliente en `cloud-api/src/db.js` ya configura `ssl: { rejectUnauthorized: false }`. Si usas otro proveedor, revisa `PG_SSL=false` en variables.

---

## 12. Resumen visual del proyecto Railway

```
Proyecto: KPIs-Balderrama
│
├── PostgreSQL          (plugin base de datos)
│
└── cloud-api           (servicio web)
      Root Directory: cloud-api
      Start: npm start
      Variables:
        DATABASE_URL      → ref PostgreSQL
        CLOUD_SYNC_API_KEY
        CLOUD_AUTO_INIT_DB (solo 1ª vez)
```

**No añadas** servicios extra para `backend/` ni `frontend/` en este proyecto Railway.

---

## 13. Referencias en el repo

| Archivo | Descripción |
|---------|-------------|
| `cloud-api/server.js` | Servidor Express |
| `cloud-api/database/01_schema.sql` | Esquema PostgreSQL |
| `cloud-api/railway.toml` | Configuración Railway |
| `cloud-api/.env.example` | Plantilla de variables |
| `backend/src/services/cloudSync/` | Cliente sync local |
| `backend/.env.example` | Variables sync en local |

---

## 14. Checklist final

- [ ] Proyecto Railway creado desde GitHub
- [ ] PostgreSQL añadido y activo
- [ ] Servicio web con **Root Directory = `cloud-api`**
- [ ] `DATABASE_URL` referenciada desde PostgreSQL
- [ ] `CLOUD_SYNC_API_KEY` configurada
- [ ] `CLOUD_AUTO_INIT_DB=true` en primer deploy
- [ ] Dominio público generado
- [ ] `/api/health` responde OK
- [ ] `backend/.env` local con `CLOUD_SYNC_*` configurado
- [ ] Sync manual o automática verificada en `/api/sync/status`
