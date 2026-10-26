# Réplica en la nube

Permite usar el tablero **sin SQL Server**, por ejemplo desde el escritorio
fuera de la red de la agencia. Está adaptada de KPIs-VECSA (`cloudReplica/`).

## Cómo funciona

```
Oficina (con SQL Server)                     Nube (cloud-api, Railway)              Escritorio sin SQL Server
replicaPublisher ── calcula /api/* ──POST──▶  desktop_cache (ruta+consulta→JSON) ◀──GET── replicaMiddleware
   cada 30 min: mes actual y anterior +          anota lo que se pidió y faltaba           X-Read-Key (solo lectura)
   lo usado en 14 días                           borra lo que nadie usa en 45 días
   cada 5 min: solo lo pedido que falta
```

1. **Publicar.** El servidor de la oficina (`CLOUD_SYNC_ENABLED=true`) se pide a
   sí mismo cada vista con una sesión interna y sube el JSON comprimido. Solo
   publica mientras ve SQL Server, para no subir vistas vacías.
2. **Pedir.** Si alguien sin SQL Server abre una vista que aún no está, la nube
   la anota y el ciclo de 5 minutos la publica.
3. **Leer.** El backend sin SQL Server (`DATA_SOURCE=auto` y SQL Server caído, o
   `DATA_SOURCE=cloud`) contesta los GET con la réplica. La respuesta lleva
   `X-Data-Source: cloud` y `X-Replica-Generado` con la hora en que se calculó.
4. **Si la vista aún no está publicada** o la nube no responde, se resuelve en
   local: funciona lo que no depende de SQL Server (CRM, archivos, IA).

## Diferencias con VECSA

| | VECSA | Balderrama |
|---|---|---|
| Lectura | Entra a la nube con usuario y contraseña (incluye contraseñas de respaldo escritas en el código) | Llave de solo lectura `CLOUD_READ_API_KEY`; la nube nunca recibe contraseñas de usuarios |
| Permisos | La nube aplica el alcance por marca | El permiso se revisa en local antes de leer; las respuestas no cambian por perfil, así que hay una sola réplica |
| Vista no publicada | Adaptador de 811 líneas a `/api/gerencia/*` | Se resuelve en local |
| Datos de clientes | Se publican | **No se publican** las vistas de un cliente individual (expediente, historial, búsqueda, orden, factura) |
| Escrituras sin SQL Server | 503 | Van al backend local |

## Configuración

**cloud-api** (`.env` en Railway):
```
CLOUD_SYNC_API_KEY=<llave para publicar>        # ya existía
CLOUD_READ_API_KEY=<otra llave, solo lectura>
```

**Servidor de la oficina** (`backend/.env`):
```
CLOUD_SYNC_ENABLED=true
CLOUD_SYNC_URL=https://<cloud-api>
CLOUD_SYNC_API_KEY=<llave para publicar>
```

**Escritorio o equipo sin SQL Server** (`backend/.env`):
```
DATA_SOURCE=auto
CLOUD_SYNC_URL=https://<cloud-api>
CLOUD_READ_API_KEY=<llave de solo lectura>
```
Sin `CLOUD_READ_API_KEY` no hay modo nube: el backend se queda en SQL Server,
como antes.

Estado: `GET /api/data-source` (modo actual, motivo y última publicación).
En la nube: `GET /api/desktop-cache/estado` con la llave de publicación.

## Pendiente

- **App móvil:** leer la réplica con su propio inicio de sesión requiere que la
  nube revise los permisos de cada perfil. Va en una etapa posterior.
- **Aviso en pantalla** de que se están viendo datos de la nube, con la hora de
  `X-Replica-Generado` (en VECSA está en la barra superior).
- Validar en la oficina el tamaño de las vistas grandes y los tiempos de cada ciclo.
