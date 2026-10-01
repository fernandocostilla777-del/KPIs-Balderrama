# API Seguimiento 360

Documentación de la API de **Seguimiento 360** (acompañamiento por **cliente** y por **VIN** + KPIs de retención / recompra).

## Enfoque del proceso

El 360 **no** es un embudo de leads fríos. Opera sobre clientes con unidad entregada y sus VIN, con dos resultados:

1. **Retención en taller** — proyectar la próxima visita según consumo de km por **carline** y **paquete**, alineado a las **franjas de retención marcadas por planta en FEM**.
2. **Recompra / Seminuevos** — identificar modelos/paquetes buscados por el área de Seminuevos y construir oferta de **equity** para generar una venta nueva.
3. **Clientes diamante** — sección dedicada a clientes con **precios preferenciales** y **aprobación inmediata en financiamiento**, para priorizar el cierre sin fricción.

| Entrada | Qué acompaña | Salida típica |
|---------|--------------|---------------|
| Cliente (ID CRM / nombre) | Radiografía, timeline, F&I, quejas, unidades vinculadas, estatus diamante | Contacto BDC / asesores |
| VIN | Órdenes, km, carline/paquete, franja FEM, señal Seminuevos | Pronóstico de visita + equity |

KPIs ABP relacionados: **P-6** (retención / CLV / tiempo entre compras y visitas), CSI/NPS, backlog Postventa y pipeline de recompra Seminuevos. Captación de prospectos nuevos sigue en Ventas → Leads.

---

Hay dos capas:

| Capa | Base | Auth | Alcance |
|------|------|------|---------|
| **Oficina** (`backend`) | `http://localhost:3000` | Sesión dashboard (`balderrama_session` / Bearer) | Completo: CRM SQLite + DMS SQL Server |
| **Railway** (`cloud-api`) | `https://kpis-balderrama-production.up.railway.app` | Header `X-API-Key` | Resumen sync + expediente ligero desde `crm_ciclos` |

Prefijo en ambas: **`/api/seguimiento-360`**

Formato de respuesta: `formato: "seguimiento-360-v1"`.

> Las rutas legacy `/api/crm/contactos*` del dashboard local **siguen activas**. Esta API es la superficie estable para apps, integraciones y GitHub.

---

## Autenticación

### Oficina (local)

Misma sesión del dashboard Balderrama. Cookie `balderrama_session` o header:

```http
Authorization: Bearer <token>
```

### Railway

```http
X-API-Key: <CLOUD_SYNC_API_KEY>
```

| HTTP | Cuerpo | Causa |
|------|--------|--------|
| `401` | API key / sesión inválida | Credencial ausente o incorrecta |
| `503` | Base CRM no disponible | SQLite CRM ausente en oficina |

---

## Endpoints — Oficina (completos)

### 1. Estado

```http
GET /api/seguimiento-360/status
```

Responde disponibilidad de `crm-ciclos.db`, stats y catálogo de endpoints.

### 2. Resumen de periodo

```http
GET /api/seguimiento-360/resumen?fechaInicio=2026-09-01&fechaFin=2026-09-30
GET /api/seguimiento-360/resumen?periodo=2026-09
```

**Query**

| Parámetro | Descripción |
|-----------|-------------|
| `fechaInicio` / `desde` | Inicio `YYYY-MM-DD` |
| `fechaFin` / `hasta` | Fin `YYYY-MM-DD` |
| `periodo` | Alternativa `YYYY-MM` |

**Incluye**

- `leads`, `solicitudes`, `pruebasManejo`, `ciclos`, `financiamiento`
- `conversiones` (lead/solicitud/prueba → compra %)
- `reglas` / semántica de cohorte CRM

```bash
curl -s -b cookies.txt \
  "http://localhost:3000/api/seguimiento-360/resumen?periodo=2026-09" | jq
```

### 3. Buscar contactos

```http
GET /api/seguimiento-360/buscar?q=GARCIA&limit=25
```

`q` acepta **ID CRM**, **nombre** o **VIN**.

```bash
curl -s -b cookies.txt \
  "http://localhost:3000/api/seguimiento-360/buscar?q=1242657" | jq
```

### 4. Expediente del cliente (ficha 360)

```http
GET /api/seguimiento-360/cliente/:idContacto?enrichSql=1&fechaInicio=2026-01-01&fechaFin=2026-09-30
```

**Query**

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `enrichSql` | `1` | `0` desactiva cruce DMS (taller / unidades) |
| `fechaInicio` / `fechaFin` | — | Ventana opcional de órdenes |

**Payload principal**

| Campo | Contenido |
|-------|-----------|
| `resumen` | Conteos: ciclos, compras, leads, F&I, pruebas, taller, quejas, importes |
| `ficha360` | Radiografía consolidada (CLV, unidad, F&I, km, franja FEM / pronóstico de visita, señal Seminuevos-equity, **cliente diamante**) |
| `timeline360` | Línea de tiempo unificada (comercial / compra / taller / F&I / CSI) |
| `ciclos`, `compras`, `leads`, `solicitudes`, `pruebasManejo` | Detalle por dominio |
| `contratosFinanciamiento` | Contratos + PVAs |
| `unidadesDistribuidor`, `ordenesServicio` | DMS |
| `quejasCsi` | CSI posventa / ventas |

```bash
curl -s -b cookies.txt \
  "http://localhost:3000/api/seguimiento-360/cliente/1242657" | jq '.resumen, .ficha360'
```

### 5. Vendedores

```http
GET /api/seguimiento-360/vendedores?q=JUAN&limit=50
GET /api/seguimiento-360/vendedor?vendedor=NOMBRE&fechaInicio=2026-09-01&fechaFin=2026-09-30
```

### 6. Cierres de taller

```http
GET /api/seguimiento-360/cierres-taller?fechaInicio=2026-09-01&fechaFin=2026-09-30&limit=200
```

Clientes con órdenes **cerradas** en el periodo (`ORE_FECHACIE`).

---

## Endpoints — Railway

Base: `https://kpis-balderrama-production.up.railway.app`

### 1. Estado

```http
GET /api/seguimiento-360/status
```

### 2. Resumen

```http
GET /api/seguimiento-360/resumen?periodo=2026-09
```

Lee el snapshot de sync (`domain=crm` → `meta.seguimiento`) más totales de `crm_ciclos`.

```bash
export API=https://kpis-balderrama-production.up.railway.app
export KEY="$CLOUD_SYNC_API_KEY"

curl -s -H "X-API-Key: $KEY" \
  "$API/api/seguimiento-360/resumen?periodo=2026-09" | jq
```

### 3. Buscar

```http
GET /api/seguimiento-360/buscar?q=GARCIA&limit=25
```

Agrupa contactos distintos desde `crm_ciclos` en Postgres.

### 4. Cliente (ligero)

```http
GET /api/seguimiento-360/cliente/:idContacto?limit=2000
```

Arma ciclos, compras (VIN), timeline y `ficha360` **solo con datos sincronizados**.

**No incluye** (solo oficina):

- Órdenes de taller / importes DMS  
- Unidades en piso del distribuidor  
- Quejas CSI  
- Leads / solicitudes / pruebas del SQLite local  

El JSON marca `limitacionesNube` cuando aplica.

```bash
curl -s -H "X-API-Key: $KEY" \
  "$API/api/seguimiento-360/cliente/1242657" | jq '.resumen, .limitacionesNube'
```

---

## Relación con otras APIs

| API | Uso |
|-----|-----|
| `/api/crm/*` (Railway) | Ciclos crudos, BDC, ingest |
| `/api/crm/contactos*` (oficina) | Legacy UI dashboard `seguimiento.html` |
| `/api/mobile/metrics/seguimiento` | Resumen móvil (misma fuente sync) |
| **`/api/seguimiento-360/*`** | Superficie estable para expediente 360 |

Flujo de datos:

```
Oficina SQLite/DMS ──cloud-sync──► Railway Postgres
        │                                │
        ▼                                ▼
 /api/seguimiento-360              /api/seguimiento-360
 (completo)                        (resumen + cliente ligero)
```

---

## Errores comunes

| HTTP | Cuándo |
|------|--------|
| `400` | Falta `q`, `vendedor` o fechas |
| `401` | Sin sesión / API key |
| `404` | Cliente no encontrado |
| `503` | CRM local no cargado (falta ETL) |
| `500` | Error DMS / interno |

---

## Verificación rápida

### Oficina

```bash
curl -s -b cookies.txt http://localhost:3000/api/seguimiento-360/status | jq
curl -s -b cookies.txt "http://localhost:3000/api/seguimiento-360/resumen?periodo=2026-09" | jq '.leads,.conversiones'
```

### Railway

```bash
curl -s -H "X-API-Key: $KEY" "$API/api/seguimiento-360/status" | jq
curl -s -H "X-API-Key: $KEY" "$API/api/seguimiento-360/buscar?q=1242657" | jq
```
