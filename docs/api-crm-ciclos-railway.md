# API CRM Ciclos (Railway)

Documentación de la API en la nube para **ciclos CRM** desplegada en Railway.

| | |
|---|---|
| **Base URL** | `https://kpis-balderrama-production.up.railway.app` |
| **Prefijo** | `/api/crm` |
| **Auth** | Header `X-API-Key` (variable `CLOUD_SYNC_API_KEY`) |
| **Fuente de datos** | PostgreSQL (`crm_ciclos`, `crm_contactos`) sincronizado desde la oficina |

> Esta API **no** consulta SQL Server GMOFARRIL. Solo lee la réplica en Railway alimentada por el sync local.

---

## Autenticación

Todas las rutas de lectura/escritura de ciclos requieren API key:

```http
X-API-Key: <CLOUD_SYNC_API_KEY>
```

La clave debe coincidir con la configurada en el servicio Railway `KPIs-Balderrama`.

### Errores de auth

| HTTP | Cuerpo | Causa |
|------|--------|--------|
| `401` | `{ "error": "API key inválida" }` | Header ausente o incorrecto |
| `503` | `{ "error": "CLOUD_SYNC_API_KEY no configurada en el servidor" }` | Variable no definida en Railway |

---

## Endpoints

### 1. Embudo BDC

```http
GET /api/crm/bdc?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD
```

Calcula el embudo BDC sobre `crm_ciclos` + `crm_contactos` en el periodo indicado.

**Query**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `fechaInicio` | `YYYY-MM-DD` | Sí | Inicio del periodo |
| `fechaFin` | `YYYY-MM-DD` | Sí | Fin del periodo |

**Respuesta 200 (ejemplo)**

```json
{
  "disponible": true,
  "status": "completo",
  "fuente": "crm_contactos + crm_ciclos (Railway)",
  "real": {
    "contactos": 316,
    "citasAgendadas": 138,
    "citasConfirmadas": 134,
    "citasCumplidas": 73,
    "entregasBdc": 13
  },
  "conversion": {
    "citasSobreContactosPct": 43.7,
    "confirmadasSobreAgendadasPct": 97.1,
    "cumplidasSobreConfirmadasPct": 54.5,
    "entregasSobreCumplidasPct": 17.8
  },
  "nota": "Contactos únicos con ciclo iniciado en el periodo; las etapas posteriores se calculan con sus actividades CRM."
}
```

**Definición de métricas**

| Campo | Significado |
|-------|-------------|
| `contactos` | Contactos únicos con ciclo iniciado en el periodo |
| `citasAgendadas` | Actividades tipo `CITA` |
| `citasConfirmadas` | Citas con `fecha_resp_actividad` |
| `citasCumplidas` | Citas con resultado de asistencia / PM OK / etc. |
| `entregasBdc` | Contactos con `fecha_entrega` en el periodo |

---

### 2. Resumen global

```http
GET /api/crm/summary
```

Totales agregados de la tabla `crm_ciclos`.

**Respuesta 200 (ejemplo)**

```json
{
  "ok": true,
  "filas": 119156,
  "contactos": 79801,
  "ciclos": 104824,
  "vins": 6601,
  "facturas": 6685,
  "byEstatus": [
    { "estatus": "Lead Caducado", "total": 48635 },
    { "estatus": "Prospección", "total": 14931 }
  ],
  "byVendedor": [
    { "vendedor": "Gabriel Chacon Orozco", "total": 513 }
  ]
}
```

---

### 3. Listar / filtrar ciclos

```http
GET /api/crm
```

**Query**

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `q` | string | — | Busca en contacto, nombre, VIN, factura, vendedor |
| `vendedor` | string | — | Filtro parcial (`ILIKE`) |
| `estatus` | string | — | Estatus exacto |
| `idContacto` | string | — | Alias: `D_CONTACTO`, `ID_CONTACTO` |
| `vin` | string | — | VIN exacto (mayúsculas) |
| `idCiclo` | string | — | Alias: `ID_CICLO` |
| `limit` | number | `200` | Máximo `2000` |
| `offset` | number | `0` | Paginación |

**Respuesta 200**

```json
{
  "ok": true,
  "count": 2,
  "ciclos": [
    {
      "idContacto": "1242657",
      "nombreContacto": "SAULO BERMEJO GARCIA",
      "idCiclo": "…",
      "fechaInicioCiclo": "2026-09-01",
      "estatus": "Neg. Caliente",
      "tipoActividad": "CITA",
      "vin": "",
      "numFactura": "",
      "vendedor": "…",
      "fechaEntrega": "",
      "updatedAt": "…"
    }
  ]
}
```

---

### 4. Ciclos por contacto

```http
GET /api/crm/:idContacto
```

Equivale a filtrar por `idContacto`. `limit` por defecto: `2000`.

**Respuesta 200**

```json
{
  "ok": true,
  "idContacto": "1242657",
  "count": 12,
  "ciclos": [ … ]
}
```

---

### 5. Ingest (escritura desde oficina)

```http
POST /api/crm/ingest
Content-Type: application/json
```

Carga o actualiza ciclos desde el servidor local.

**Body aceptado**

```json
{
  "records": [ { … }, { … } ],
  "replaceAll": false,
  "source": "api"
}
```

También acepta:

- `{ "rows": [ … ] }`
- `{ "ciclos": [ … ] }`
- un array directo `[ … ]`

Si `replaceAll: true`, reemplaza el contenido completo antes de insertar.

**Respuesta 201**

```json
{
  "ok": true,
  "inserted": 10,
  "updated": 2,
  "total": 12
}
```

---

## Campos principales de un ciclo

| Campo API | Descripción |
|-----------|-------------|
| `idContacto` | ID CRM del contacto |
| `nombreContacto` | Nombre |
| `idCiclo` | Identificador del ciclo |
| `fechaInicioCiclo` | Inicio del ciclo |
| `estatus` | Estatus comercial |
| `tipoActividad` | Tipo (p. ej. `CITA`) |
| `fechaCreaActividad` / `fechaProgActividad` / `fechaRespActividad` | Fechas de actividad |
| `resultadoActividad` | Resultado |
| `vin` | Serie del vehículo |
| `numFactura` | Factura |
| `fechaFactura` / `fechaEntrega` | Facturación / entrega |
| `vendedor` | Asesor |
| `formaContacto` / `medioContacto` / `submedioContacto` | Canal |

---

## Ejemplos cURL

```bash
export API=https://kpis-balderrama-production.up.railway.app
export KEY="<CLOUD_SYNC_API_KEY>"

# Embudo BDC septiembre 2026
curl -s -H "X-API-Key: $KEY" \
  "$API/api/crm/bdc?fechaInicio=2026-09-01&fechaFin=2026-09-30" | jq

# Resumen
curl -s -H "X-API-Key: $KEY" "$API/api/crm/summary" | jq

# Buscar por texto
curl -s -H "X-API-Key: $KEY" "$API/api/crm?q=garcia&limit=10" | jq

# Por VIN
curl -s -H "X-API-Key: $KEY" "$API/api/crm?vin=LZWPRMGN8TF131284&limit=20" | jq

# Por contacto
curl -s -H "X-API-Key: $KEY" "$API/api/crm/1242657?limit=50" | jq
```

---

## Relación con el dashboard local

| Capa | Rol |
|------|-----|
| **Oficina** (`backend`) | Lee CRM local (SQLite) + DMS; sincroniza a Railway |
| **Railway** (`cloud-api`) | Expone esta API sobre Postgres |
| **Objetivos Web / móvil** | Consumen BDC y snapshots vía cloud-api |

Para Seguimiento 360 se recomienda la API dedicada:

- Documentación: [`docs/api-seguimiento-360.md`](./api-seguimiento-360.md)
- Oficina: `GET /api/seguimiento-360/*` (sesión dashboard)
- Railway: `GET /api/seguimiento-360/*` (`X-API-Key`)

Rutas legacy del dashboard local (equivalentes parciales):

- `GET /api/crm/contactos`
- `GET /api/crm/contactos/:idContacto/historico`
- `GET /api/crm/vendedores/resumen`

---

## Notas operativas

1. Los datos en nube dependen del **cloud-sync** del PC de oficina (cada ~30 min).
2. El embudo BDC en Objetivos Web puede enriquecer Contactos con leads EV del snapshot; el endpoint `/api/crm/bdc` puro reporta solo ciclos Railway (p. ej. ~316 contactos en sep-2026).
3. No publiques la `CLOUD_SYNC_API_KEY` en el repositorio; usa secrets de GitHub / variables de Railway.

---

## Verificación rápida (sep-2026)

Prueba realizada contra producción:

| Endpoint | HTTP | Resultado |
|----------|------|-----------|
| `/api/crm/bdc` | 200 | 316 contactos · 138 citas · 134 conf. · 73 cumpl. · 13 entregas |
| `/api/crm/summary` | 200 | 104,824 ciclos · 79,801 contactos |
| `/api/crm?limit=5` | 200 | Lista OK |
